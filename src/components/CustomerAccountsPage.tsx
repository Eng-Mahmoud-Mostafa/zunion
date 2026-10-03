import { useEffect, useMemo, useState } from "react";
import { Calendar, Printer, RotateCcw, Search, Trash2 } from "lucide-react";
import { formatDateArabic, normalizeDigitsToEnglish } from "../utils/formatters";

type AccountCustomer = {
  id: string;
  client_name: string;
  client_code: string;
  phone: string;
};

type AccountOrder = {
  id: string;
  customer_id?: string;
  order_number: string;
  client_name?: string;
  client_code?: string;
  phone?: string;
  logo_place?: string;
  logo_status?: string;
  quantity?: number;
  price?: number;
};

type AccountTransaction = {
  id: string;
  account_id?: string;
  customer_id: string;
  txn_date: string;
  txn_date_text?: string;
  entry_type: "charge" | "payment";
  order_id: string | null;
  order_number: string | null;
  customer_name?: string | null;
  description: string;
  logo: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  /** "order" rows come from saved orders and are read-only. */
  source?: "ledger" | "order";
};

type StatementResponse = {
  transactions: AccountTransaction[];
  total: number;
  hasMore?: boolean;
  /** Totals over the whole matching dataset, not just the returned page. */
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
  openingBalance?: number;
  balance?: number;
};

type AccountSession = { email?: string; username?: string; fullName?: string; role: string };

type Props = {
  customers: AccountCustomer[];
  orders: AccountOrder[];
  session: AccountSession;
};

function accountDay(row: Pick<AccountTransaction, "txn_date" | "txn_date_text">) {
  const text = String(row.txn_date_text || row.txn_date || "");
  const day = text.slice(0, 10);
  return day ? formatDateArabic(`${day}T00:00:00`) : "—";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function accountMoney(value: unknown) {
  const n = Number(value ?? 0);
  const rounded = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return normalizeDigitsToEnglish(formatPlainNumber(rounded));
}

function formatPlainNumber(value: number) {
  const text = String(value);
  if (text.includes(".")) {
    const stripped = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return stripped;
  }
  return text;
}

function localToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function randomKey() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}

async function backendJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = response.statusText;
    try {
      const body = raw ? JSON.parse(raw) as { message?: string; error?: string } : {};
      message = body.message || body.error || message;
    } catch {
      message = raw || message;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function printableCell(value: unknown) {
  const html = normalizeDigitsToEnglish(value);
  if (/^[+()0-9 .-]+$/.test(String(value ?? ""))) return `&#8206;${String(html).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char)}`;
  return String(html).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char);
}

type DraftFields = { quantity?: string; price?: string; credit?: string };
type ChargeDraft = { orderId: string; logo: string; quantity: string; price: string };

export default function CustomerAccountsPage({ customers, orders, session }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [logo, setLogo] = useState("");
  const [q, setQ] = useState("");
  const [entryType, setEntryType] = useState("");
  /** Optional refinement. Empty means every order for the current selection. */
  const [orderFilter, setOrderFilter] = useState("");
  const [searchTick, setSearchTick] = useState(0);
  const [data, setData] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, DraftFields>>({});
  const [paymentAmount, setPaymentAmount] = useState("");
  const [charge, setCharge] = useState<ChargeDraft>({ orderId: "", logo: "", quantity: "", price: "" });

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) ?? null,
    [customers, customerId],
  );

  const canEdit = Boolean(selectedCustomer);
  const userName = session?.fullName || session?.username || session?.email || "";

  const customerOrders = useMemo(() => {
    const mine = selectedCustomer ? orders.filter((order) =>
      order.customer_id === selectedCustomer.id ||
      (Boolean(selectedCustomer.client_code) && order.client_code === selectedCustomer.client_code) ||
      (Boolean(selectedCustomer.phone) && order.phone === selectedCustomer.phone),
    ) : orders;
    return [...mine].sort((a, b) => String(b.order_number).localeCompare(String(a.order_number)));
  }, [orders, selectedCustomer]);

  /** Options for the optional order-number filter. */
  const orderFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const values: { id: string; label: string }[] = [];
    for (const order of customerOrders) {
      if (!order.id || seen.has(order.id)) continue;
      seen.add(order.id);
      values.push({ id: order.id, label: `#${order.order_number}` });
    }
    return values;
  }, [customerOrders]);

  const logoOptions = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const order of customerOrders) {
      const value = String(order.logo_place || order.logo_status || "").trim();
      if (value && !seen.has(value)) { seen.add(value); values.push(value); }
    }
    return values;
  }, [customerOrders]);

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.client_name.localeCompare(b.client_name, "ar")),
    [customers],
  );

  const chargedOrderIds = useMemo(() => {
    // Any charge row represents the order, whether it was posted by hand or
    // derived from the order itself, so the order can't be charged twice.
    const set = new Set<string>();
    for (const txn of data?.transactions ?? []) {
      if (txn.entry_type === "charge" && txn.order_id) set.add(txn.order_id);
    }
    return set;
  }, [data]);

  const availableOrders = useMemo(
    () => customerOrders.filter((order) => !chargedOrderIds.has(order.id)),
    [customerOrders, chargedOrderIds],
  );

  /**
   * Loads the whole statement, not just the first page: the backend caps each
   * page, so keep following `hasMore` until every matching row is collected.
   * An empty customer id means "الكل", which is simply no customer filter.
   */
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const base = new URLSearchParams();
    if (from) base.set("from", from);
    if (to) base.set("to", to);
    if (logo) base.set("logo", logo);
    if (entryType) base.set("entry_type", entryType);
    if (q.trim()) base.set("q", q.trim());
    if (orderFilter) base.set("order_id", orderFilter);
    const endpoint = customerId
      ? `/api/customer-accounts/${encodeURIComponent(customerId)}/transactions`
      : `/api/customer-accounts/transactions`;
    const pageSize = 500;
    const collected: AccountTransaction[] = [];
    let meta: StatementResponse | null = null;

    const loadPage = async (offset: number): Promise<void> => {
      const page = new URLSearchParams(base);
      page.set("limit", String(pageSize));
      page.set("offset", String(offset));
      const result = await backendJson<StatementResponse>(`${endpoint}?${page.toString()}`);
      meta = result;
      collected.push(...result.transactions);
      if (result.hasMore ?? collected.length < result.total) {
        if (result.transactions.length === 0) return;
        await loadPage(offset + result.transactions.length);
      }
    };

    loadPage(0)
      .then(() => {
        if (!active || !meta) return;
        setData({ ...(meta as StatementResponse), transactions: collected });
      })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : "تعذر تحميل الكشف.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, from, to, logo, entryType, q, orderFilter, searchTick]);

  const rows = useMemo(() => {
    if (!data) return [];
    let running = Number(data.openingDebit) - Number(data.openingCredit);
    return data.transactions.map((txn) => {
      const next = { ...txn, debit: Number(txn.debit), credit: Number(txn.credit), balance: 0, effQty: Number(txn.quantity), effPrice: Number(txn.price) };
      const d = draft[txn.id];
      if (txn.entry_type === "charge") {
        const dq = d?.quantity != null && d.quantity.trim() !== "" ? Number(d.quantity) : Number(txn.quantity);
        const dp = d?.price != null && d.price.trim() !== "" ? Number(d.price) : Number(txn.price);
        next.effQty = Number.isFinite(dq) ? dq : 0;
        next.effPrice = Number.isFinite(dp) ? dp : 0;
        next.debit = round2(next.effQty * next.effPrice);
        next.credit = 0;
      } else {
        const dc = d?.credit != null && d.credit.trim() !== "" ? round2(Number(d.credit)) : Number(txn.credit);
        next.debit = 0;
        next.credit = Number.isFinite(dc) ? dc : 0;
      }
      running = round2(running + next.debit - next.credit);
      next.balance = running;
      return next;
    });
  }, [data, draft]);

  const openingBalance = Number(data?.openingBalance ?? (Number(data?.openingDebit ?? 0) - Number(data?.openingCredit ?? 0)));
  const hasPendingEdits = Object.keys(draft).length > 0;
  const computedDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const computedCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  const computedBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;
  // Without pending edits the server's figures win: they cover the entire
  // matching dataset, including any row the current page did not carry.
  const totalDebit = hasPendingEdits ? computedDebit : Number(data?.totalDebit ?? computedDebit);
  const totalCredit = hasPendingEdits ? computedCredit : Number(data?.totalCredit ?? computedCredit);
  const finalBalance = hasPendingEdits ? computedBalance : Number(data?.balance ?? computedBalance);
  const totalQuantity = rows.reduce((sum, row) => sum + (row.entry_type === "charge" ? Number(row.effQty || 0) : 0), 0);
  const lastBalance = computedBalance;

  const chargeDebit = round2((Number(charge.quantity) || 0) * (Number(charge.price) || 0));
  const paymentDebit = round2(Number(paymentAmount) || 0);

  function changeCustomer(id: string) {
    // Changing the customer must clear the previous order restriction and any
    // half-typed entry, but keeps the current table on screen until the new
    // statement arrives so the view never flashes empty.
    setCustomerId(id);
    setOrderFilter("");
    setDraft({});
    setPaymentAmount("");
    setCharge({ orderId: "", logo: "", quantity: "", price: "" });
    setNotice(null);
    setSearchTick((tick) => tick + 1);
  }

  function resetFilters() {
    setCustomerId("");
    setFrom("");
    setTo("");
    setLogo("");
    setQ("");
    setEntryType("");
    setOrderFilter("");
    setDraft({});
    setPaymentAmount("");
    setCharge({ orderId: "", logo: "", quantity: "", price: "" });
    setNotice(null);
    setSearchTick((tick) => tick + 1);
  }

  function touchDraft(id: string, key: keyof DraftFields, value: string) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  function pickChargeOrder(orderId: string) {
    const order = availableOrders.find((item) => item.id === orderId);
    const patch: Partial<ChargeDraft> = { orderId };
    if (order) {
      const orderLogo = String(order.logo_place || order.logo_status || "").trim();
      if (orderLogo) patch.logo = orderLogo;
      if (Number(order.quantity || 0) > 0) patch.quantity = String(order.quantity);
      if (Number(order.price || 0) > 0) patch.price = String(order.price);
    }
    setCharge((prev) => ({ ...prev, ...patch }));
  }

  async function deleteTransaction(txn: AccountTransaction) {
    if (!window.confirm(`حذف العملية رقم ${txn.order_number || txn.id}؟`)) return;
    setSaving(true);
    try {
      await backendJson(`/api/customer-accounts/transactions/${encodeURIComponent(txn.id)}?customer_id=${encodeURIComponent(txn.customer_id)}`, { method: "DELETE" });
      setNotice({ text: "تم حذف العملية.", ok: true });
      setSearchTick((tick) => tick + 1);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "تعذر حذف العملية.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!selectedCustomer) return;
    setSaving(true);
    setNotice(null);
    setError("");
    try {
      const patches: { id: string; customerId: string; quantity?: number; price?: number; credit?: number }[] = [];
      for (const row of data?.transactions ?? []) {
        const d = draft[row.id];
        if (!d) continue;
        const patch: { id: string; customerId: string; quantity?: number; price?: number; credit?: number } = { id: row.id, customerId: row.customer_id };
        if (row.entry_type === "charge") {
          if (d.quantity != null && d.quantity.trim() !== "") {
            const current = Number(d.quantity);
            if (String(current) !== String(Number(row.quantity))) patch.quantity = current;
          }
          if (d.price != null && d.price.trim() !== "") {
            const current = Number(d.price);
            if (String(current) !== String(Number(row.price))) patch.price = current;
          }
        } else {
          if (d.credit != null && d.credit.trim() !== "") {
            const current = round2(Number(d.credit));
            if (String(current) !== String(Number(row.credit))) patch.credit = current;
          }
        }
        if (patch.quantity !== undefined || patch.price !== undefined || patch.credit !== undefined) patches.push(patch);
      }

      // The order number is optional for a charge; quantity and price decide.
      const hasCharge = Number(charge.quantity) >= 1 && Number(charge.price) > 0;
      const hasPayment = paymentDebit > 0;
      if (!patches.length && !hasCharge && !hasPayment) {
        setNotice({ text: "لا توجد تغييرات للحفظ.", ok: false });
        setSaving(false);
        return;
      }

      for (const p of patches) {
        await backendJson(`/api/customer-accounts/transactions/${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ customer_id: p.customerId, quantity: p.quantity, price: p.price, credit: p.credit }),
        });
      }

      if (hasCharge) {
        await backendJson("/api/customer-accounts/transactions", {
          method: "POST",
          body: JSON.stringify({
            account_id: selectedCustomer.id,
            customer_id: selectedCustomer.id,
            txn_date: localToday(),
            entry_type: "charge",
            order_id: charge.orderId,
            description: "",
            logo: charge.logo,
            quantity: Number(charge.quantity) || 0,
            price: Number(charge.price) || 0,
            debit: chargeDebit,
            credit: 0,
            client_key: `ca-${selectedCustomer.id}-${Date.now()}-c-${randomKey()}`,
          }),
        });
      }

      if (hasPayment) {
        await backendJson("/api/customer-accounts/transactions", {
          method: "POST",
          body: JSON.stringify({
            account_id: selectedCustomer.id,
            customer_id: selectedCustomer.id,
            txn_date: localToday(),
            entry_type: "payment",
            order_id: null,
            description: "",
            logo: "",
            quantity: 0,
            price: 0,
            debit: 0,
            credit: paymentDebit,
            client_key: `ca-${selectedCustomer.id}-${Date.now()}-p-${randomKey()}`,
          }),
        });
      }

      setDraft({});
      setPaymentAmount("");
      setCharge({ orderId: "", logo: "", quantity: "", price: "" });
      setNotice({ text: "تم الحفظ بنجاح.", ok: true });
      setSearchTick((tick) => tick + 1);
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "تعذر الحفظ.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  function printStatement() {
    const balanceRow = rows.length ? rows[rows.length - 1].balance : openingBalance;
    const body = `
      <style>
        .st-report{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#111827}
        .st-report h2{color:#062747;margin:0 0 6px;font-size:20px}
        .st-report .st-meta{color:#4b5563;font-size:12px;margin-bottom:14px;line-height:1.8}
        .st-report table{width:100%;border-collapse:collapse;font-size:12px}
        .st-report th{background:#062747 !important;color:#fff !important;border:1px solid #062747;padding:8px;font-weight:800;text-align:right}
        .st-report td{border:1px solid #d1d5db;padding:7px;text-align:right;color:#111827 !important}
        .st-report .num{direction:ltr;unicode-bidi:embed}
        .st-report .totals td{background:#fff4f5;font-weight:800;color:#062747 !important;border-top:2px solid #062747}
      </style>
      <div class="st-report">
        <h2>كشف حساب ${printableCell(selectedCustomer?.client_name ?? "جميع العملاء")}</h2>
        <div class="st-meta">${printableCell(selectedCustomer?.client_code ? `كود العميل: ${selectedCustomer.client_code}` : "")}${selectedCustomer?.phone ? ` - التليفون: ${selectedCustomer.phone}` : ""}${from || to ? `<br>الفترة: ${printableCell(from ? formatDateArabic(from + "T00:00:00") : "البداية")} إلى ${printableCell(to ? formatDateArabic(to + "T00:00:00") : "الآن")}` : ""}</div>
        <table>
          <thead><tr><th>التاريخ</th><th>رقم الأوردر</th><th>البيان</th><th>اللوجو</th><th>العدد</th><th>السعر</th><th>مدين</th><th>دائن</th><th>رصيد نهائي</th></tr></thead>
          <tbody>
            ${rows.map((row) => `<tr><td>${printableCell(accountDay(row))}</td><td>${printableCell(row.order_number || "—")}</td><td>${printableCell(row.description || "—")}</td><td>${printableCell(row.logo || "—")}</td><td class="num">${printableCell(row.entry_type === "charge" ? row.quantity : "—")}</td><td class="num">${printableCell(row.entry_type === "charge" ? row.price : "—")}</td><td class="num">${accountMoney(row.debit)}</td><td class="num">${accountMoney(row.credit)}</td><td class="num">${accountMoney(row.balance)}</td></tr>`).join("")}
            <tr class="totals"><td colspan="6">الإجمالي</td><td class="num">${accountMoney(totalDebit)}</td><td class="num">${accountMoney(totalCredit)}</td><td class="num">${accountMoney(balanceRow)}</td></tr>
          </tbody>
        </table>
      </div>`;
    const popup = window.open("", "_blank", "width=1100,height=780");
    const printedAt = new Date().toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const user = session?.fullName || session?.username || session?.email || "";
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>كشف حساب ${escapeHtml(selectedCustomer?.client_name ?? "")}</title>
      <style>@page{size:landscape;margin:12mm}body{font-family:Tahoma,Arial,sans-serif;color:#111827;margin:0;direction:rtl}
      .toolbar{margin-bottom:12px}.toolbar button{background:#ED1525;color:white;border:0;border-radius:7px;padding:10px 18px;font-weight:800}
      @media print{.toolbar{display:none}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">طباعة</button></div>
      ${body}<p style="color:#6b7280;font-size:11px;margin-top:12px">${escapeHtml(printedAt)}${user ? ` - المستخدم: ${escapeHtml(user)}` : ""}</p></body></html>`;
    if (!popup) { window.print(); return; }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  const today = localToday();

  // With a single customer selected the layout is exactly as before. "الكل"
  // needs an extra column so each row can be attributed to its customer.
  const showCustomer = !selectedCustomer;
  const colCount = showCustomer ? 11 : 10;
  const baseWidths = ["11.59%", "11.59%", "11.59%", "13.04%", "11.59%", "6.52%", "6.52%", "8.33%", "8.33%", "10.87%"];
  const colWidths = showCustomer
    ? ["14%", ...baseWidths.map((w) => `${(Number.parseFloat(w) * 0.86).toFixed(2)}%`)]
    : baseWidths;

  return (
    <div className="stack ca-screen">
      <div className="ca-customer-row">
        <label className="ca-customer-button">العميل حساب
          <select value={customerId} onChange={(event) => changeCustomer(event.target.value)}>
            <option value="">الكل / جميع العملاء</option>
            {sortedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.client_name}{customer.client_code ? ` (${customer.client_code})` : ""}</option>)}
          </select>
        </label>
      </div>

{loading && <p className="muted">جاري تحميل الكشف...</p>}
      {error && <ErrorText message={error} />}
      {!loading && !error && !data && <p className="muted">لا توجد بيانات.</p>}

      {data && (<>
        <div className="ss-filters">
          <div className="ss-filter"><span>من تاريخ</span><div className="ss-date-wrap"><Calendar size={15} /><input type="date" value={normalizeDigitsToEnglish(from)} onChange={(event) => setFrom(normalizeDigitsToEnglish(event.target.value))} /></div></div>
          <div className="ss-filter"><span>إلى تاريخ</span><div className="ss-date-wrap"><Calendar size={15} /><input type="date" value={normalizeDigitsToEnglish(to)} onChange={(event) => setTo(normalizeDigitsToEnglish(event.target.value))} /></div></div>
          <div className="ss-filter"><span>البيان</span><select value={logo} onChange={(event) => setLogo(event.target.value)}><option value="">الكل</option>{logoOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="ss-filter"><span>رقم الأوردر</span><select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}><option value="">جميع الأوردرات</option>{orderFilterOptions.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}</select></div>
          <div className="ss-filter"><span>بحث في البيان</span><div className="ss-date-wrap"><Search size={15} /><input value={normalizeDigitsToEnglish(q)} onChange={(event) => setQ(normalizeDigitsToEnglish(event.target.value))} placeholder="إبحث في البيان" /></div></div>
          <div className="ss-filter"><span>نوع العملية</span><select value={entryType} onChange={(event) => setEntryType(event.target.value)}><option value="">الكل</option><option value="charge">شغل</option><option value="payment">دفعة</option></select></div>
          <div className="ss-filter-actions">
            <button type="button" className="ca-btn ca-btn-search" onClick={() => setSearchTick((tick) => tick + 1)}><Search size={15} /> بحث</button>
            <button type="button" className="ca-btn ca-btn-print" onClick={resetFilters}><RotateCcw size={15} /> مسح</button>
            <button type="button" className="ca-btn ca-btn-print" onClick={printStatement}><Printer size={15} /> طباعة</button>
          </div>
        </div>

        {notice && <p className={"ss-message " + (notice.ok ? "ok" : "err")}>{notice.text}</p>}

        <div className="ss-scroll">
          <table className="ss-table">
            <colgroup>
              {colWidths.map((width, index) => <col key={index} style={{ width }} />)}
            </colgroup>
            <thead>
              <tr className="ss-top">
                <td className="ss-save"><button type="button" className="ss-save-btn" onClick={saveDraft} disabled={saving || !canEdit}>{saving ? "جاري الحفظ..." : "حفظ"}</button></td>
                <td className="ss-title" colSpan={colCount - 2}>{selectedCustomer ? `حساب العميل — ${selectedCustomer.client_name}` : "العمليات — جميع العملاء"}</td>
                <td className="ss-balance-cell">{accountMoney(finalBalance)}</td>
              </tr>
              <tr className="ss-head">
                <th>كتب بواسطة</th>
                {showCustomer && <th>العميل</th>}
                <th>تاريخ التسليم</th>
                <th>رقم الأوردر</th>
                <th>النوع</th>
                <th>اللوجو</th>
                <th>العدد</th>
                <th>السعر</th>
                <th>مدين (شغل)</th>
                <th>دائن (دفعات)</th>
                <th>رصيد نهائي</th>
              </tr>
            </thead>
            <tbody className="ss-body">
              {!loading && !error && rows.length === 0 && <tr><td colSpan={colCount} className="ss-empty">لا توجد عمليات.</td></tr>}
              {rows.map((row) => {
                const editable = canEdit && (row.source ?? "ledger") === "ledger";
                return (
                <tr key={row.id} className={row.entry_type === "payment" ? "ss-pay-row" : undefined}>
                  <td className="grp-gray ss-name-cell">
                    <span className="ss-name">{row.created_by_name || "—"}</span>
                    {session.role === "Master" && editable && (
                      <button type="button" className="ss-delete-row" onClick={() => deleteTransaction(row)} disabled={saving} aria-label="حذف"><Trash2 size={14} /></button>
                    )}
                  </td>
                  {showCustomer && <td className="grp-gray">{row.customer_name || "—"}</td>}
                  <td className="grp-gray">{accountDay(row)}</td>
                  <td className="grp-gray">{row.order_number || "—"}</td>
                  <td className={"ss-type" + (row.entry_type === "payment" ? " ss-pay-type" : "")}>{row.entry_type === "payment" ? "دفعة" : "شغل"}</td>
                  <td>{row.logo || "—"}</td>
                  {editable && row.entry_type === "charge" ? (
                    <>
                      <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={draft[row.id]?.quantity ?? String(row.quantity)} onChange={(event) => touchDraft(row.id, "quantity", normalizeDigitsToEnglish(event.target.value))} aria-label="العدد" /></td>
                      <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={draft[row.id]?.price ?? String(row.price)} onChange={(event) => touchDraft(row.id, "price", normalizeDigitsToEnglish(event.target.value))} aria-label="السعر" /></td>
                    </>
                  ) : (
                    <>
                      <td className="ss-num">{row.entry_type === "charge" ? formatNumberLocal(row.quantity) : "—"}</td>
                      <td className="ss-num">{row.entry_type === "charge" ? accountMoney(row.price) : "—"}</td>
                    </>
                  )}
                  <td className="ss-num ss-debit-val">{accountMoney(row.debit)}</td>
                  {editable && row.entry_type === "payment" ? (
                    <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={draft[row.id]?.credit ?? String(row.credit)} onChange={(event) => touchDraft(row.id, "credit", normalizeDigitsToEnglish(event.target.value))} aria-label="الدائن" /></td>
                  ) : (
                    <td className="ss-num">{row.entry_type === "payment" ? accountMoney(row.credit) : "—"}</td>
                  )}
                  <td className="ss-num ss-bal">{accountMoney(row.balance)}</td>
                </tr>
                );
              })}
              {rows.length > 0 && (
                <tr className="ss-total">
                  <td className="grp-gray" colSpan={showCustomer ? 5 : 4}>الإجمالي</td>
                  <td />
                  <td className="ss-num">{formatNumberLocal(totalQuantity)}</td>
                  <td />
                  <td className="ss-num">{accountMoney(totalDebit)}</td>
                  <td className="ss-num">{accountMoney(totalCredit)}</td>
                  <td className="ss-num ss-bal">{accountMoney(finalBalance)}</td>
                </tr>
              )}
              {canEdit && (
                <tr className="ss-entry ss-charge-entry">
                  <td className="grp-gray ss-name-cell"><span className="ss-name">{userName || "—"}</span></td>
                  {showCustomer && <td className="grp-gray">—</td>}
                  <td className="grp-gray">{formatDateArabic(`${today}T00:00:00`)}</td>
                  <td className="grp-gray">
                    <select className="ss-select-cell" value={charge.orderId} onChange={(event) => pickChargeOrder(event.target.value)}>
                      <option value="">بدون أوردر</option>
                      {availableOrders.map((order) => <option key={order.id} value={order.id}>#{order.order_number}</option>)}
                    </select>
                  </td>
                  <td className="ss-type">شغل</td>
                  <td><input className="ss-cell-input" value={normalizeDigitsToEnglish(charge.logo)} onChange={(event) => setCharge((prev) => ({ ...prev, logo: normalizeDigitsToEnglish(event.target.value) }))} placeholder="اللوجو" list="ca-logo-options" /></td>
                  <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={normalizeDigitsToEnglish(charge.quantity)} onChange={(event) => setCharge((prev) => ({ ...prev, quantity: normalizeDigitsToEnglish(event.target.value) }))} placeholder="0" aria-label="العدد الجديد" /></td>
                  <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={normalizeDigitsToEnglish(charge.price)} onChange={(event) => setCharge((prev) => ({ ...prev, price: normalizeDigitsToEnglish(event.target.value) }))} placeholder="0" aria-label="السعر الجديد" /></td>
                  <td className="ss-num ss-debit-val">{accountMoney(chargeDebit)}</td>
                  <td className="ss-num">—</td>
                  <td className="ss-num ss-bal">{accountMoney(round2(lastBalance + chargeDebit))}</td>
                </tr>
              )}
              {canEdit && (
                <tr className="ss-entry ss-pay-entry">
                  <td className="grp-gray ss-name-cell"><span className="ss-name">{userName || "—"}</span></td>
                  {showCustomer && <td className="grp-gray">—</td>}
                  <td className="ss-pay-date">{formatDateArabic(`${today}T00:00:00`)}</td>
                  <td className="grp-gray">—</td>
                  <td className="ss-pay-type">دفعة</td>
                  <td className="grp-gray">—</td>
                  <td className="grp-gray">—</td>
                  <td className="grp-gray">—</td>
                  <td className="ss-num">0</td>
                  <td className="ss-num"><input className="ss-cell-input" inputMode="decimal" value={normalizeDigitsToEnglish(paymentAmount)} onChange={(event) => setPaymentAmount(normalizeDigitsToEnglish(event.target.value))} placeholder="0" aria-label="مبلغ الدفعة" /></td>
                  <td className="ss-num ss-bal">{accountMoney(round2(lastBalance - paymentDebit))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && <datalist id="ca-logo-options">{logoOptions.map((value) => <option key={value} value={value} />)}</datalist>}
        </>
      )}
    </div>
  );
}

function ErrorText({ message }: { message: string }) {
  return <p className="field-error ca-error">{message}</p>;
}

function formatNumberLocal(value: unknown) {
  const n = Number(value ?? 0) || 0;
  return normalizeDigitsToEnglish(Math.round(n * 100) / 100);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char);
}