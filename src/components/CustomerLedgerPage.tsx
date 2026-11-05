import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, Coins, FilePlus2, FileText, IdCard, Info, Layers, Plus, Printer, Search, ShoppingCart, UserRound, Users, Wallet, X } from "lucide-react";
import { normalizeDigitsToEnglish } from "../utils/formatters";

type LedgerCustomer = {
  id: string;
  client_name: string;
  client_code: string;
  phone?: string;
  source_person?: string;
};

type LedgerRow = {
  id: string;
  kind: "opening" | "carried" | "charge" | "payment" | "adjustment";
  txn_date_text: string;
  order_id: string | null;
  order_number: string;
  created_by_name: string | null;
  description: string;
  logo: string;
  color: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  balance: number;
  source: "ledger" | "order" | "system";
};

type PeriodSummary = {
  id: string;
  seq: number;
  status: "active" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  closing_balance: number | null;
};

type LedgerData = {
  customer: { id: string; name: string; code: string | null; phone: string | null; party: string };
  periods: PeriodSummary[];
  period: {
    id: string;
    seq: number;
    status: "active" | "closed";
    opened_at: string;
    closed_at: string | null;
    openingBalance: number;
    closingBalance: number;
    snapshotClosing: number | null;
    driftAfterClose: number;
  };
  summary: { operationCount: number; totalWork: number; totalPayments: number; currentBalance: number };
  rows: LedgerRow[];
  total: number;
  hasMore: boolean;
};

type Props = {
  customers: LedgerCustomer[];
  /** Names of the available أطراف. */
  parties: string[];
  session: { role: string; fullName?: string; username?: string };
  /** Opens that customer's account directly (from another customer page). */
  initialCustomerId?: string;
  onOrderClick?: (orderId: string) => void;
};

const PAYMENT_METHODS: Array<[string, string]> = [
  ["cash", "كاش"],
  ["bank_transfer", "تحويل بنكي"],
  ["instapay", "انستا باي"],
  ["wallet", "محفظة"],
  ["deferred", "آجل"],
  ["other", "أخرى"],
];

const COLUMNS = ["كتب بواسطة", "تاريخ التسليم", "رقم الأوردر", "النوع", "اللون", "اللوجو", "العدد", "السعر", "مدين (شغل)", "دائن (دفعات)", "رصيد نهائي"];

const money = (value: unknown) => {
  const n = Number(value ?? 0);
  return normalizeDigitsToEnglish(new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0));
};
/** Search/compare key: digits, hamza/alef variants, ya/alef-maqsura, ta-marbuta and diacritics are ignored. */
const norm = (value: unknown) =>
  normalizeDigitsToEnglish(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
const codeLabel = (code: string | null | undefined) => (code ? (/^c-/i.test(code) ? code : `C-${code}`) : "—");
const dayLabel = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
};
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function balanceInfo(value: number) {
  if (value > 0) return { label: "رصيد مدين — على العميل", tone: "debit" as const };
  if (value < 0) return { label: "رصيد دائن — للعميل", tone: "credit" as const };
  return { label: "حساب مسدد", tone: "zero" as const };
}

function periodLabel(period: PeriodSummary) {
  const from = period.opened_at.startsWith("1970") ? "البداية" : dayLabel(period.opened_at.slice(0, 10));
  if (period.status === "active") return `الحساب الحالي — فترة ${period.seq} (من ${from})`;
  return `فترة ${period.seq} — من ${from} إلى ${dayLabel((period.closed_at ?? "").slice(0, 10))}`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message || "حدث خطأ، يرجى المحاولة مرة أخرى");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload as T;
}

const esc = (value: unknown) =>
  String(normalizeDigitsToEnglish(value)).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char);

function typeLabel(row: LedgerRow) {
  if (row.kind === "payment") return "دفعة";
  if (row.kind === "carried") return "رصيد مرحّل";
  if (row.kind === "opening") return "رصيد سابق";
  if (row.kind === "adjustment") return "تسوية";
  return "شغل";
}

function Dash({ red }: { red?: boolean }) {
  return <span className={`cl-dash${red ? " red" : ""}`}>—</span>;
}

/** A non-<button> so the app-wide red button style does not repaint it. */
function OutlineAction({ disabled, onClick, children, title }: { disabled?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled ? true : undefined}
      title={title}
      className={`cl-outline-btn${disabled ? " disabled" : ""}`}
      onClick={() => { if (!disabled) onClick(); }}
      onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}
    >
      {children}
    </div>
  );
}

function buildPrintHtml(data: LedgerData, periodTitle: string) {
  const info = balanceInfo(data.period.closingBalance);
  const body = data.rows
    .map((row) => {
      const system = row.source === "system";
      const cells = [
        system ? "—" : row.created_by_name || "—",
        system ? "—" : dayLabel(row.txn_date_text),
        row.order_number || "—",
        typeLabel(row),
        row.color || "—",
        row.logo || "—",
        row.kind === "charge" ? money(row.quantity) : "—",
        row.kind === "charge" ? money(row.price) : "—",
        row.debit ? money(row.debit) : "—",
        row.credit ? money(row.credit) : "—",
        money(row.balance),
      ];
      const cls = row.kind === "charge" ? "charge" : row.kind === "payment" ? "payment" : "system";
      return `<tr class="${cls}">${cells.map((cell, index) => `<td${index >= 6 ? ' class="num"' : ""}>${esc(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${esc(data.customer.name)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Tahoma, Arial, sans-serif; color: #111827; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #ED1525; padding-bottom: 10px; margin-bottom: 12px; }
  .head img { height: 54px; border-radius: 8px; }
  .head h1 { margin: 0; font-size: 20px; color: #0b2545; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin-bottom: 12px; font-size: 13px; }
  .meta b { color: #0b2545; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #ED1525; color: #fff; padding: 6px 4px; border: 1px solid #c4101d; }
  td { padding: 5px 4px; border: 1px solid #d1d5db; text-align: center; word-break: break-word; }
  td.num { direction: ltr; unicode-bidi: isolate; }
  tr.charge td:nth-child(9) { background: #fde8ea; }
  tr.payment td:nth-child(10) { background: #e3f6e8; }
  tr.system td { background: #f3f4f6; font-weight: 700; }
  .foot { margin-top: 12px; font-size: 14px; font-weight: 700; display: flex; gap: 24px; }
  .foot span { color: #0b2545; }
</style></head><body>
<div class="head"><div><h1>كشف حساب العميل</h1><div style="font-size:12px;color:#6b7280">Zunion System Control</div></div><img src="${location.origin}/zunion-logo.png" alt="Zunion"></div>
<div class="meta">
  <div><b>اسم العميل:</b> ${esc(data.customer.name)}</div>
  <div><b>كود العميل:</b> ${esc(data.customer.code || "—")}</div>
  <div><b>طرف:</b> ${esc(data.customer.party || "—")}</div>
  <div><b>الفترة المحاسبية:</b> ${esc(periodTitle)}</div>
  <div><b>الرصيد الافتتاحي:</b> ${esc(money(data.period.openingBalance))}</div>
  <div><b>عدد العمليات:</b> ${esc(data.summary.operationCount)}</div>
  <div><b>إجمالي الشغل:</b> ${esc(money(data.summary.totalWork))}</div>
  <div><b>إجمالي المدفوعات:</b> ${esc(money(data.summary.totalPayments))}</div>
</div>
<table><thead><tr>${COLUMNS.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
<div class="foot"><span>الرصيد الختامي: <span dir="ltr">${esc(money(data.period.closingBalance))}</span></span><span>${esc(info.label)}</span></div>
<script>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 250); };</script>
</body></html>`;
}

export default function CustomerLedgerPage({ customers, parties, session, initialCustomerId, onOrderClick }: Props) {
  const [party, setParty] = useState("");
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // payment modal
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS[0][0]);
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const payLock = useRef(false);
  const payKey = useRef("");

  // open-period modal
  const [openModal, setOpenModal] = useState(false);
  const [openSaving, setOpenSaving] = useState(false);
  const [openError, setOpenError] = useState("");
  const openLock = useRef(false);
  const openKey = useRef("");

  const canPay = ["Master", "Helper", "Operator"].includes(session.role);
  const canOpenPeriod = ["Master", "Helper"].includes(session.role);

  const selected = useMemo(() => customers.find((c) => c.id === customerId) ?? null, [customers, customerId]);

  const partyOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const name of parties) if (name && !byKey.has(norm(name))) byKey.set(norm(name), name);
    for (const customer of customers) {
      const name = customer.source_person;
      if (name && !byKey.has(norm(name))) byKey.set(norm(name), name);
    }
    return [...byKey.values()];
  }, [parties, customers]);

  const results = useMemo(() => {
    const needle = norm(search);
    const pool = party ? customers.filter((c) => norm(c.source_person ?? "") === norm(party)) : customers;
    const matched = needle
      ? pool.filter((c) => norm(`${c.client_name} ${c.client_code} ${c.phone ?? ""}`).includes(needle))
      : pool;
    return [...matched].sort((a, b) => a.client_name.localeCompare(b.client_name, "ar")).slice(0, 50);
  }, [customers, party, search]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function chooseCustomer(id: string) {
    setCustomerId(id);
    setPeriodId("");
    setData(null); // never keep showing the previous customer's figures
    setError("");
    setNotice(null);
    setSearch("");
    setPickerOpen(false);
  }

  function changeParty(next: string) {
    setParty(next);
    // A customer who does not belong to the chosen طرف must not stay selected.
    if (next && selected && norm(selected.source_person ?? "") !== norm(next)) {
      setCustomerId("");
      setPeriodId("");
      setData(null);
    }
  }

  // Load the whole ledger of the selected customer/period (pages are followed so balances stay exact).
  useEffect(() => {
    if (!customerId) { setData(null); return; }
    let active = true;
    setLoading(true);
    setError("");
    (async () => {
      const collected: LedgerRow[] = [];
      let first: LedgerData | null = null;
      for (let offset = 0; offset < 100000; ) {
        const qs = new URLSearchParams({ limit: "2000", offset: String(offset) });
        if (periodId) qs.set("period_id", periodId);
        const page = await api<LedgerData>(`/api/account-ledger/${encodeURIComponent(customerId)}?${qs.toString()}`);
        first = first ?? page;
        collected.push(...page.rows);
        if (!page.hasMore || page.rows.length === 0) break;
        offset += page.rows.length;
      }
      if (active && first) setData({ ...first, rows: collected, hasMore: false });
    })()
      .catch((err: unknown) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : "تعذر تحميل حساب العميل");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, periodId, tick]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const view = data && data.customer.id === customerId ? data : null;
  const viewingActive = view?.period.status === "active";
  const balance = view ? view.summary.currentBalance : 0;
  const balanceView = balanceInfo(view ? view.period.closingBalance : 0);

  function openPayment() {
    if (!view || !canPay || !viewingActive) return;
    payKey.current = newKey(); // one key per modal session: a retry after a network error cannot double-post
    payLock.current = false;
    setPayAmount(""); setPayDate(todayIso()); setPayMethod(PAYMENT_METHODS[0][0]); setPayNotes(""); setPayError(""); setPaySaving(false);
    setPayOpen(true);
  }

  async function savePayment() {
    if (payLock.current || !view) return;
    const amount = Number(normalizeDigitsToEnglish(payAmount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return setPayError("أدخل مبلغًا صحيحًا أكبر من صفر");
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return setPayError("المبلغ يجب ألا يزيد عن خانتين عشريتين");
    if (!payDate) return setPayError("اختر تاريخ الدفع");
    payLock.current = true;
    setPaySaving(true);
    setPayError("");
    try {
      await api(`/api/account-ledger/${encodeURIComponent(view.customer.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount, date: payDate, method: payMethod, notes: payNotes.trim(), client_key: payKey.current, period_id: view.period.id }),
      });
      setPayOpen(false);
      setNotice({ text: "تم تسجيل الدفعة بنجاح", ok: true });
      setTick((value) => value + 1);
    } catch (err) {
      payLock.current = false;
      setPayError(err instanceof Error ? err.message : "تعذر حفظ الدفعة، يرجى المحاولة مرة أخرى");
    } finally {
      setPaySaving(false);
    }
  }

  function openNewPeriodDialog() {
    if (!view || !canOpenPeriod || !viewingActive) return;
    openKey.current = newKey();
    openLock.current = false;
    setOpenError(""); setOpenSaving(false);
    setOpenModal(true);
  }

  async function confirmNewPeriod() {
    if (openLock.current || !view) return;
    openLock.current = true;
    setOpenSaving(true);
    setOpenError("");
    try {
      await api(`/api/account-ledger/${encodeURIComponent(view.customer.id)}/periods`, {
        method: "POST",
        body: JSON.stringify({ client_key: openKey.current, expected_period_id: view.period.id }),
      });
      setOpenModal(false);
      setPeriodId("");
      setNotice({ text: "تم فتح حساب جديد وترحيل الرصيد بنجاح", ok: true });
      setTick((value) => value + 1);
    } catch (err) {
      openLock.current = false;
      setOpenError(err instanceof Error ? err.message : "تعذر فتح حساب جديد، يرجى المحاولة مرة أخرى");
      if ((err as { status?: number })?.status === 409) setTick((value) => value + 1);
    } finally {
      setOpenSaving(false);
    }
  }

  const currentPeriod = view?.periods.find((p) => p.id === view.period.id);
  function printStatement() {
    if (!view || !currentPeriod) return;
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) { setNotice({ text: "المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.", ok: false }); return; }
    win.document.open();
    win.document.write(buildPrintHtml(view, periodLabel(currentPeriod)));
    win.document.close();
  }

  const closing = view?.period.closingBalance ?? 0;
  const closingInfo = balanceInfo(closing);
  const cardTone = balance === 0 ? "zero" : "owed";
  let seq = 0;

  return (
    <div className="cl-page" dir="rtl">
      <div className="cl-picker-bar">
        <div className="cl-pick cl-pick-customer" ref={pickerRef}>
          <label htmlFor="cl-customer" className="cl-pick-label"><UserRound size={24} aria-hidden="true" />اختر العميل</label>
          <div className="cl-combo">
            <Search size={20} aria-hidden="true" className="cl-combo-icon" />
            <input
              id="cl-customer"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-controls="cl-customer-list"
              autoComplete="off"
              placeholder={selected ? `${selected.client_name} — ${selected.client_code}` : "ابحث باسم العميل أو كود العميل ..."}
              value={search}
              onFocus={() => setPickerOpen(true)}
              onChange={(event) => { setSearch(event.target.value); setPickerOpen(true); }}
            />
            {selected ? (
              <span role="button" tabIndex={0} className="cl-clear" aria-label="إلغاء اختيار العميل" onClick={() => chooseCustomer("")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") chooseCustomer(""); }}><X size={16} /></span>
            ) : null}
            <ChevronDown size={20} aria-hidden="true" className="cl-chevron" />
            {pickerOpen ? (
              <div className="cl-combo-list" id="cl-customer-list" role="listbox">
                {results.length === 0 ? <div className="cl-combo-empty">لا يوجد عملاء مطابقون</div> : null}
                {results.map((customer) => (
                  <div
                    key={customer.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={customer.id === customerId}
                    className={`cl-combo-item${customer.id === customerId ? " selected" : ""}`}
                    onMouseDown={(event) => { event.preventDefault(); chooseCustomer(customer.id); }}
                    onKeyDown={(event) => { if (event.key === "Enter") chooseCustomer(customer.id); }}
                  >
                    <strong>{customer.client_name}</strong>
                    <span dir="ltr">{codeLabel(customer.client_code)}</span>
                    {customer.source_person ? <em>{customer.source_person}</em> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="cl-pick cl-pick-party">
          <label htmlFor="cl-party" className="cl-pick-label"><Users size={22} aria-hidden="true" />طرف</label>
          <div className="cl-select">
            <select id="cl-party" value={party} onChange={(event) => changeParty(event.target.value)}>
              <option value="">الكل</option>
              {partyOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown size={20} aria-hidden="true" className="cl-chevron" />
          </div>
        </div>
      </div>

      <div className="cl-actions">
        <OutlineAction disabled={!view} onClick={printStatement}><Printer size={20} aria-hidden="true" />طباعة كشف الحساب</OutlineAction>
        <button type="button" className="cl-btn-red" disabled={!view || !canPay || !viewingActive} onClick={openPayment} title={!canPay ? "ليس لديك صلاحية لإضافة دفعة" : !viewingActive && view ? "الفترة المحاسبية مغلقة" : undefined}>
          <Plus size={20} aria-hidden="true" />إضافة دفعة
        </button>
        <OutlineAction disabled={!view || !canOpenPeriod || !viewingActive} onClick={openNewPeriodDialog} title={!canOpenPeriod ? "ليس لديك صلاحية لفتح حساب جديد" : !viewingActive && view ? "افتح الحساب الجديد من الحساب الحالي" : undefined}>
          <FilePlus2 size={20} aria-hidden="true" />فتح حساب جديد
        </OutlineAction>
        <div className="cl-period">
          <label htmlFor="cl-period">الفترة المحاسبية</label>
          <div className="cl-select">
            <select id="cl-period" disabled={!view} value={view?.period.id ?? ""} onChange={(event) => { const next = event.target.value; const activeId = view?.periods.find((p) => p.status === "active")?.id; setPeriodId(next === activeId ? "" : next); }}>
              {!view ? <option value="">—</option> : null}
              {[...(view?.periods ?? [])].reverse().map((p) => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}
            </select>
            <ChevronDown size={18} aria-hidden="true" className="cl-chevron" />
          </div>
        </div>
      </div>

      {notice ? <div className={`cl-notice${notice.ok ? " ok" : " bad"}`} role="status">{notice.text}</div> : null}
      {error ? <div className="cl-notice bad" role="alert">{error}</div> : null}

      {!customerId ? (
        <div className="cl-empty">
          <BookOpen size={40} aria-hidden="true" />
          <h2>اختر عميلًا لعرض حسابه</h2>
          <p>ابحث بالاسم أو الكود، أو اختر الطرف أولًا لتصفية العملاء.</p>
        </div>
      ) : loading && !view ? (
        <div className="cl-empty" role="status"><p>جار تحميل حساب العميل...</p></div>
      ) : view ? (
        <>
          <section className="cl-info">
            <h2><UserRound size={36} fill="currentColor" aria-hidden="true" />حساب العميل</h2>
            <div className="cl-info-fields">
              <div className="cl-info-field"><UserRound size={22} aria-hidden="true" /><div><span>اسم العميل</span><strong>{view.customer.name}</strong></div></div>
              <div className="cl-info-field"><IdCard size={22} aria-hidden="true" /><div><span>كود العميل</span><strong dir="ltr">{codeLabel(view.customer.code)}</strong></div></div>
              <div className="cl-info-field"><Users size={22} aria-hidden="true" /><div><span>طرف</span><strong>{view.customer.party || "—"}</strong></div></div>
            </div>
          </section>

          <div className="cl-cards">
            <div className="cl-stat ops"><FileText size={42} strokeWidth={1.6} aria-hidden="true" /><div><span>عدد العمليات</span><strong>{money(view.summary.operationCount)}</strong></div></div>
            <div className="cl-stat work"><ShoppingCart size={42} strokeWidth={1.6} aria-hidden="true" /><div><span>إجمالي الشغل</span><strong dir="ltr">{money(view.summary.totalWork)}</strong></div></div>
            <div className="cl-stat paid"><Wallet size={42} strokeWidth={1.6} aria-hidden="true" /><div><span>إجمالي المدفوعات</span><strong dir="ltr">{money(view.summary.totalPayments)}</strong></div></div>
            <div className={`cl-stat bal ${cardTone}`}><Coins size={42} strokeWidth={1.6} aria-hidden="true" /><div><span>الرصيد الحالي</span><strong dir="ltr">{money(balance)}</strong></div></div>
          </div>

          {view.period.status === "closed" ? (
            <div className="cl-notice info" role="note">
              هذه فترة مغلقة (للعرض فقط). الرصيد الختامي لها: <b dir="ltr">{money(view.period.snapshotClosing ?? view.period.closingBalance)}</b>
              {Math.abs(view.period.driftAfterClose) > 0.004 ? <> — تم تعديل أوردرات بعد إغلاقها بقيمة <b dir="ltr">{money(view.period.driftAfterClose)}</b> وتظهر كتسوية في الحساب الحالي.</> : null}
            </div>
          ) : null}

          <section className="cl-ledger">
            <div className="cl-ledger-head">
              <h2><Layers size={26} aria-hidden="true" />كشف الحساب</h2>
              <span className="cl-ledger-sub">الرصيد الافتتاحي: <b dir="ltr">{money(view.period.openingBalance)}</b></span>
            </div>
            <div className="cl-table-wrap">
              <table className="cl-table">
                <thead><tr><th className="cl-idx">م</th>{COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {view.rows.length === 0 ? (
                    <tr><td colSpan={COLUMNS.length + 1} className="cl-table-empty">لا توجد حركات في هذه الفترة</td></tr>
                  ) : view.rows.map((row, index) => {
                    const system = row.source === "system";
                    if (!system) seq += 1;
                    const isLast = index === view.rows.length - 1;
                    const pill = row.kind === "payment" ? "pay" : row.kind === "charge" ? "work" : "sys";
                    return (
                      <tr key={row.id} className={`cl-row-${row.kind}${isLast ? " last" : ""}`}>
                        <td className="cl-idx">{system ? "—" : seq}</td>
                        <td className="cl-user">{system ? <Dash /> : row.created_by_name || <Dash />}</td>
                        <td className="cl-nowrap">{system || !row.txn_date_text ? <Dash /> : dayLabel(row.txn_date_text)}</td>
                        <td className="cl-nowrap">
                          {row.order_number
                            ? (onOrderClick && row.order_id
                              ? <a className="cl-pill red" href={`#editOrder/${encodeURIComponent(row.order_id)}`} onClick={(event) => { event.preventDefault(); onOrderClick(row.order_id as string); }}>{row.order_number}</a>
                              : <span className="cl-pill red">{row.order_number}</span>)
                            : <Dash />}
                        </td>
                        <td><span className={`cl-pill ${pill}`} title={row.kind === "payment" ? row.description : row.kind === "charge" ? row.description : undefined}>{typeLabel(row)}</span></td>
                        <td>{row.color ? <span className="cl-pill red">{row.color}</span> : <Dash />}</td>
                        <td>{row.logo || <Dash />}</td>
                        <td className="cl-num cl-qty">{row.kind === "charge" ? money(row.quantity) : <Dash red />}</td>
                        <td className="cl-num cl-qty">{row.kind === "charge" ? money(row.price) : <Dash red />}</td>
                        <td className="cl-num cl-debit">{row.debit > 0 ? money(row.debit) : "0"}</td>
                        <td className="cl-num cl-credit">{row.credit > 0 ? money(row.credit) : <Dash red />}</td>
                        <td className={`cl-num cl-balance${row.balance > 0 ? " pos" : " neg"}`}>{money(row.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="cl-legend">
            <div className="cl-legend-item"><span className="cl-pill work">شغل =</span><span>قيمة أوردر / شغل للعميل</span></div>
            <div className="cl-legend-item"><span className="cl-pill pay">دفعة =</span><span>عملية دفع من العميل</span></div>
            <div className="cl-note">
              <Info size={20} aria-hidden="true" />
              <p><b>ملاحظة:</b> الرصيد النهائي يتم احتسابه بشكل تراكمي بعد كل عملية<br /><small>( الرصيد الموجب = مبلغ مستحق من العميل ) ، ( الرصيد السالب = رصيد دائن لصالح العميل )</small></p>
            </div>
          </div>
        </>
      ) : null}

      {payOpen && view ? (
        <div className="cl-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !paySaving) setPayOpen(false); }}>
          <form className="cl-modal" role="dialog" aria-modal="true" aria-labelledby="cl-pay-title" onSubmit={(event) => { event.preventDefault(); void savePayment(); }} noValidate>
            <h3 id="cl-pay-title">إضافة دفعة</h3>
            <label>اسم العميل<input value={view.customer.name} readOnly /></label>
            <label>المبلغ المدفوع<input inputMode="decimal" autoFocus value={payAmount} onChange={(event) => setPayAmount(event.target.value)} placeholder="0.00" dir="ltr" /></label>
            <label>تاريخ الدفع<input type="date" value={payDate} onChange={(event) => setPayDate(event.target.value)} /></label>
            <label>طريقة الدفع
              <select value={payMethod} onChange={(event) => setPayMethod(event.target.value)}>
                {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>ملاحظات<textarea rows={2} maxLength={500} value={payNotes} onChange={(event) => setPayNotes(event.target.value)} /></label>
            {payError ? <div className="cl-notice bad" role="alert">{payError}</div> : null}
            <div className="cl-modal-actions">
              <button type="submit" className="primary-btn" disabled={paySaving}>{paySaving ? "جار الحفظ..." : "حفظ الدفعة"}</button>
              <button type="button" className="ghost-btn" disabled={paySaving} onClick={() => setPayOpen(false)}>إلغاء</button>
            </div>
          </form>
        </div>
      ) : null}

      {openModal && view ? (
        <div className="cl-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !openSaving) setOpenModal(false); }}>
          <div className="cl-modal" role="dialog" aria-modal="true" aria-labelledby="cl-open-title">
            <h3 id="cl-open-title">فتح حساب جديد</h3>
            <p className="cl-modal-lead">سيتم إغلاق الحساب الحالي بكل حركاته وفتح حساب جديد لنفس العميل، مع ترحيل الرصيد الحالي كما هو.</p>
            <dl className="cl-confirm">
              <div><dt>اسم العميل</dt><dd>{view.customer.name}</dd></div>
              <div><dt>كود العميل</dt><dd dir="ltr">{codeLabel(view.customer.code)}</dd></div>
              <div><dt>تاريخ فتح الحساب الجديد</dt><dd>{dayLabel(todayIso())}</dd></div>
              <div><dt>الرصيد الحالي</dt><dd dir="ltr">{money(view.period.closingBalance)}</dd></div>
              <div><dt>الرصيد الذي سيتم ترحيله</dt><dd dir="ltr">{money(view.period.closingBalance)}</dd></div>
              <div><dt>نوع الرصيد</dt><dd><span className={`cl-tag ${closingInfo.tone}`}>{closingInfo.tone === "debit" ? "رصيد مدين" : closingInfo.tone === "credit" ? "رصيد دائن" : "حساب مسدد"}</span></dd></div>
            </dl>
            {openError ? <div className="cl-notice bad" role="alert">{openError}</div> : null}
            <div className="cl-modal-actions">
              <button type="button" className="primary-btn" disabled={openSaving} onClick={() => void confirmNewPeriod()}>{openSaving ? "جار الفتح..." : "تأكيد فتح الحساب"}</button>
              <button type="button" className="ghost-btn" disabled={openSaving} onClick={() => setOpenModal(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
