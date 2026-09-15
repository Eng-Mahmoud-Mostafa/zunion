import { useEffect, useMemo, useState } from "react";
import { Plus, Printer, RotateCcw, Search, Trash2 } from "lucide-react";
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
  account_id: string;
  customer_id: string;
  txn_date: string;
  txn_date_text?: string;
  entry_type: "charge" | "payment";
  order_id: string | null;
  order_number: string | null;
  description: string;
  logo: string;
  quantity: number;
  price: number;
  debit: number;
  credit: number;
  created_by: string | null;
  created_at: string;
};

type StatementResponse = {
  transactions: AccountTransaction[];
  total: number;
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
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
  return normalizeDigitsToEnglish(new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0));
}

function backToApiDate(value: string) {
  return normalizeDigitsToEnglish(value) || null;
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

export default function CustomerAccountsPage({ customers, orders, session }: Props) {
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [logo, setLogo] = useState("");
  const [q, setQ] = useState("");
  const [entryType, setEntryType] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [searchTick, setSearchTick] = useState(0);
  const [data, setData] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) ?? null,
    [customers, customerId],
  );

  const customerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter((order) =>
      order.customer_id === selectedCustomer.id ||
      (Boolean(selectedCustomer.client_code) && order.client_code === selectedCustomer.client_code) ||
      (Boolean(selectedCustomer.phone) && order.phone === selectedCustomer.phone),
    ).sort((a, b) => String(b.order_number).localeCompare(String(a.order_number)));
  }, [orders, selectedCustomer]);

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

  useEffect(() => {
    if (!customerId) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (logo) query.set("logo", logo);
    if (entryType) query.set("entry_type", entryType);
    if (q.trim()) query.set("q", q.trim());
    const suffix = query.toString() ? `?${query.toString()}` : "";
    backendJson<StatementResponse>(`/api/customer-accounts/${encodeURIComponent(customerId)}/transactions${suffix}`)
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) { setData(null); setError(err instanceof Error ? err.message : "تعذر تحميل الكشف."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, from, to, logo, entryType, q, searchTick]);

  const rows = useMemo(() => {
    if (!data) return [];
    let running = Number(data.openingDebit) - Number(data.openingCredit);
    return data.transactions.map((txn) => {
      running = round2(running + Number(txn.debit) - Number(txn.credit));
      return { ...txn, balance: running };
    });
  }, [data]);

  const totalDebit = Number(data?.totalDebit ?? 0);
  const totalCredit = Number(data?.totalCredit ?? 0);
  const openingBalance = Number(data?.openingDebit ?? 0) - Number(data?.openingCredit ?? 0);
  const finalBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;

  function resetFilters() {
    setFrom("");
    setTo("");
    setLogo("");
    setQ("");
    setEntryType("");
    setSearchTick((tick) => tick + 1);
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
        <h2>كشف حساب ${printableCell(selectedCustomer?.client_name ?? "")}</h2>
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
      .toolbar{margin-bottom:12px}.toolbar button{background:#E60012;color:white;border:0;border-radius:7px;padding:10px 18px;font-weight:800}
      @media print{.toolbar{display:none}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">طباعة</button></div>
      ${body}<p style="color:#6b7280;font-size:11px;margin-top:12px">${escapeHtml(printedAt)}${user ? ` - المستخدم: ${escapeHtml(user)}` : ""}</p></body></html>`;
    if (!popup) { window.print(); return; }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  }

  async function deleteTransaction(txn: AccountTransaction) {
    if (!window.confirm(`حذف العملية رقم ${txn.order_number || txn.id}؟`)) return;
    setBusy(true);
    try {
      await backendJson(`/api/customer-accounts/transactions/${encodeURIComponent(txn.id)}?customer_id=${encodeURIComponent(customerId)}`, { method: "DELETE" });
      setMessage("تم حذف العملية.");
      setSearchTick((tick) => tick + 1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "تعذر حذف العملية.");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setModal(false);
    setMessage("");
  }

  return (
    <div className="stack ca-screen">
      <section className="panel">
        <div className="panel-head">
          <h2>حسابات العملاء</h2>
          <label className="ca-customer-pick">العميل
            <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSearchTick((tick) => tick + 1); }}>
              <option value="" disabled hidden>اختر العميل</option>
              {sortedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.client_name}{customer.client_code ? ` (${customer.client_code})` : ""}</option>)}
            </select>
          </label>
        </div>

        {!customerId && !loading && (
          <p className="muted">اختر عميلاً لعرض كشف حسابه.</p>
        )}

        {customerId && selectedCustomer && (
          <div className="ca-body">
            <div className="ca-cards">
              <div className="ca-card ca-card-debit"><span>مدين (شغل)</span><strong>{accountMoney(totalDebit)}</strong></div>
              <div className="ca-card ca-card-credit"><span>دائن (دفعات)</span><strong>{accountMoney(totalCredit)}</strong></div>
              <div className="ca-card ca-card-balance"><span>رصيد نهائي</span><strong>{accountMoney(finalBalance)}</strong></div>
            </div>

            <div className="ca-filters">
              <label>من تاريخ<input type="date" value={normalizeDigitsToEnglish(from)} onChange={(event) => setFrom(normalizeDigitsToEnglish(event.target.value))} /></label>
              <label>إلى تاريخ<input type="date" value={normalizeDigitsToEnglish(to)} onChange={(event) => setTo(normalizeDigitsToEnglish(event.target.value))} /></label>
              <label>اللوجو<select value={logo} onChange={(event) => setLogo(event.target.value)}><option value="">الكل</option>{logoOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>بيان<input value={normalizeDigitsToEnglish(q)} onChange={(event) => setQ(normalizeDigitsToEnglish(event.target.value))} placeholder="بحث في البيان" /></label>
              <button type="button" className="ghost-btn compact" onClick={() => setAdvanced((value) => !value)}>بحث متقدم</button>
              <button type="button" className="ghost-btn compact" onClick={resetFilters}>مسح الفلاتر</button>
              <button type="button" className="ca-btn ca-btn-search" onClick={() => setSearchTick((tick) => tick + 1)}><Search size={16} /> بحث</button>
              <button type="button" className="ca-btn ca-btn-add" onClick={() => setModal(true)}><Plus size={16} /> إضافة عملية</button>
              <button type="button" className="ca-btn ca-btn-print" onClick={printStatement}><Printer size={16} /> طباعة</button>
            </div>

            {advanced && (
              <div className="ca-filters ca-advanced">
                <label>نوع العملية<select value={entryType} onChange={(event) => setEntryType(event.target.value)}><option value="">الكل</option><option value="charge">شغل</option><option value="payment">دفعة</option></select></label>
              </div>
            )}

            {message && <p className="ca-message">{message}</p>}
            {error && <ErrorText message={error} />}

            {loading ? <p className="muted">جاري تحميل الكشف...</p> : (
              <div className="table-wrap ca-table-wrap">
                <table className="ca-table">
                  <thead>
                    <tr>{["التاريخ", "رقم الأوردر", "البيان", "اللوجو", "العدد", "السعر", "مدين (شغل)", "دائن (دفعات)", "رصيد نهائي", ""].map((head) => <th key={head}>{head}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={10}>لا توجد عمليات.</td></tr>}
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{accountDay(row)}</td>
                        <td>{row.order_number || "—"}</td>
                        <td>{row.description || "—"}</td>
                        <td>{row.logo || "—"}</td>
                        <td className="num">{row.entry_type === "charge" ? formatNumberLocal(row.quantity) : "—"}</td>
                        <td className="num">{row.entry_type === "charge" ? accountMoney(row.price) : "—"}</td>
                        <td className="num ca-debit">{row.debit ? accountMoney(row.debit) : "—"}</td>
                        <td className="num ca-credit">{row.credit ? accountMoney(row.credit) : "—"}</td>
                        <td className="num ca-balance">{accountMoney(row.balance)}</td>
                        <td className="actions">{session.role === "Master" && <button type="button" className="ghost-btn compact ca-delete" onClick={() => deleteTransaction(row)} disabled={busy}><Trash2 size={14} /></button>}</td>
                      </tr>
                    ))}
                    {rows.length > 0 && (
                      <tr className="ca-totals">
                        <td colSpan={6}>الإجمالي</td>
                        <td className="num">{accountMoney(totalDebit)}</td>
                        <td className="num">{accountMoney(totalCredit)}</td>
                        <td className="num">{accountMoney(finalBalance)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {modal && selectedCustomer && <TransactionModal customer={selectedCustomer} orders={customerOrders} logos={logoOptions} onClose={closeModal} onSaved={() => { setModal(false); setMessage(""); setSearchTick((tick) => tick + 1); }} />}
    </div>
  );
}

function ErrorText({ message }: { message: string }) {
  return <p className="field-error ca-error">{message}</p>;
}

function formatNumberLocal(value: unknown) {
  return normalizeDigitsToEnglish(new Intl.NumberFormat("en-US").format(Number(value ?? 0) || 0));
}

function TransactionModal({ customer, orders, logos, onClose, onSaved }: {
  customer: AccountCustomer;
  orders: AccountOrder[];
  logos: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entryType, setEntryType] = useState<"charge" | "payment">("charge");
  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function chooseOrder(order: AccountOrder | null) {
    setOrderId(order?.id ?? "");
    if (order) {
      const orderLogo = String(order.logo_place || order.logo_status || "").trim();
      if (orderLogo) setLogo(orderLogo);
      if (Number(order.quantity || 0) > 0) setQuantity(String(order.quantity));
      if (Number(order.price || 0) > 0) setPrice(String(order.price));
    }
  }

  const computedDebit = entryType === "charge" ? round2((Number(quantity) || 0) * (Number(price) || 0)) : 0;

  async function submit() {
    setError("");
    if (!txnDate) { setError("التاريخ مطلوب"); return; }
    if (entryType === "charge") {
      if (!orderId) { setError("اختر رقم الأوردر"); return; }
      if (!(Number(quantity) > 0)) { setError("العدد يجب أن يكون 1 على الأقل"); return; }
      if (!(Number(price) > 0)) { setError("السعر مطلوب"); return; }
    } else {
      if (!(Number(amount) > 0)) { setError("مبلغ الدفعة مطلوب"); return; }
    }
    setSaving(true);
    try {
      const clientKey = `ca-${customer.id}-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)}`;
      await backendJson("/api/customer-accounts/transactions", {
        method: "POST",
        body: JSON.stringify({
          account_id: customer.id,
          customer_id: customer.id,
          txn_date: backToApiDate(txnDate) ?? "",
          entry_type: entryType,
          order_id: entryType === "charge" ? orderId : null,
          description,
          logo: entryType === "charge" ? logo : "",
          quantity: entryType === "charge" ? Number(quantity) || 0 : 0,
          price: entryType === "charge" ? Number(price) || 0 : 0,
          debit: entryType === "charge" ? computedDebit : 0,
          credit: entryType === "payment" ? round2(Number(amount) || 0) : 0,
          client_key: clientKey,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ العملية.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ca-modal">
      <div className="ca-modal-box">
        <div className="ca-modal-head"><h3>إضافة عملية - {customer.client_name}</h3><button type="button" className="ghost-btn compact" onClick={onClose} aria-label="إغلاق">×</button></div>
        <div className="ca-form">
          <label>نوع العملية
            <select value={entryType} onChange={(event) => { setEntryType(event.target.value as "charge" | "payment"); setError(""); }}>
              <option value="charge">شغل (مدين)</option>
              <option value="payment">دفعة (دائن)</option>
            </select>
          </label>
          <label>التاريخ<input type="date" value={normalizeDigitsToEnglish(txnDate)} onChange={(event) => setTxnDate(normalizeDigitsToEnglish(event.target.value))} /></label>
          {entryType === "charge" && (
            <>
              <label>رقم الأوردر
                <select value={orderId} onChange={(event) => chooseOrder(orders.find((order) => order.id === event.target.value) ?? null)}>
                  <option value="" disabled hidden>اختر الأوردر</option>
                  {orders.map((order) => <option key={order.id} value={order.id}>#{order.order_number}</option>)}
                </select>
              </label>
              <label>اللوجو
                <input value={normalizeDigitsToEnglish(logo)} onChange={(event) => setLogo(normalizeDigitsToEnglish(event.target.value))} placeholder="اللوجو" list="ca-logo-options" />
                <datalist id="ca-logo-options">{logos.map((value) => <option key={value} value={value} />)}</datalist>
              </label>
              <div className="ca-form-row">
                <label>العدد<input type="number" min="1" value={normalizeDigitsToEnglish(quantity)} onChange={(event) => setQuantity(normalizeDigitsToEnglish(event.target.value))} /></label>
                <label>السعر<input type="number" min="0" step="0.01" value={normalizeDigitsToEnglish(price)} onChange={(event) => setPrice(normalizeDigitsToEnglish(event.target.value))} /></label>
              </div>
              <div className="ca-compute">إجمالي الشغل: <strong>{accountMoney(computedDebit)}</strong></div>
            </>
          )}
          {entryType === "payment" && (
            <label>المبلغ<input type="number" min="0" step="0.01" value={normalizeDigitsToEnglish(amount)} onChange={(event) => setAmount(normalizeDigitsToEnglish(event.target.value))} placeholder="مبلغ الدفعة" /></label>
          )}
          <label>البيان<textarea value={normalizeDigitsToEnglish(description)} onChange={(event) => setDescription(normalizeDigitsToEnglish(event.target.value))} rows={2} placeholder="وصف اختياري" /></label>
        </div>
        <ErrorText message={error} />
        <div className="ca-modal-actions">
          <button type="button" className="ca-btn ca-btn-add" onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : `${entryType === "charge" ? "إضافة شغل" : "إضافة دفعة"}`}</button>
          <button type="button" className="ghost-btn" onClick={onClose} disabled={saving}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char);
}