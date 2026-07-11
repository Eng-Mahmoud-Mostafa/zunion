import { supabase } from "../lib/supabase";

export type DbOrder = {
  id: string;
  order_number: string | number | null;
  customer_name: string | null;
  client_name?: string | null;
  phone: string | null;
  party: string | null;
  source_person?: string | null;
  service_type: string | null;
  order_type?: string | null;
  pieces_count: number | null;
  quantity?: number | null;
  received_date: string | null;
  delivery_date: string | null;
  total: number | null;
  paid: number | null;
  remaining: number | null;
  operation_status: string | null;
  finishing_status: string | null;
  delivery_status: string | null;
  order_status?: string | null;
  created_at: string | null;
};

export type DbTransaction = {
  id: string;
  transaction_type: string | null;
  kind?: string | null;
  date: string | null;
  description: string | null;
  amount: number | null;
  value?: number | null;
  total?: number | null;
  expense_type: string | null;
  account_destination: string | null;
  customer_name?: string | null;
  detail_number?: string | number | null;
  added_by?: string | null;
  created_at: string | null;
};

export type DashboardStats = {
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
  newOrders: number;
  inOperation: number;
  inFinishing: number;
  ready: number;
  latestOrders: DbOrder[];
  latestExpenses: DbTransaction[];
  latestRevenues: DbTransaction[];
};

export type OperationStats = {
  inOperation: number;
  inFinishing: number;
  readyToSend: number;
  deliveryToday: number;
  orders: DbOrder[];
};

export type ReportsData = {
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
  monthlyRows: Array<{ month: string; income: number; expense: number; net: number }>;
};

const incomeValues = new Set(["إيراد", "الايراد", "الإيراد", "income"]);
const expenseValues = new Set(["مصروف", "مصروفات", "expense"]);

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function transactionAmount(row: DbTransaction) {
  return toNumber(row.amount ?? row.value ?? row.total);
}

function isIncome(row: DbTransaction) {
  return incomeValues.has(String(row.transaction_type || row.kind || "").trim());
}

function isExpense(row: DbTransaction) {
  return expenseValues.has(String(row.transaction_type || row.kind || "").trim());
}

function inMonth(row: DbTransaction, month: number, year: number) {
  const raw = row.date || row.created_at;
  if (!raw) return false;
  const date = new Date(raw);
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

function monthKey(row: DbTransaction) {
  const date = new Date(row.date || row.created_at || "");
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function queryOrders(limit?: number) {
  let query = supabase.from("orders").select("*").order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DbOrder[];
}

async function queryTransactions(limit?: number) {
  let query = supabase.from("transactions").select("*").order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DbTransaction[];
}

export async function getLatestOrders(limit = 5) {
  return queryOrders(limit);
}

export async function getLatestExpenses(limit = 5) {
  const rows = await queryTransactions();
  return rows.filter(isExpense).slice(0, limit);
}

export async function getLatestRevenues(limit = 5) {
  const rows = await queryTransactions();
  return rows.filter(isIncome).slice(0, limit);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [orders, transactions] = await Promise.all([queryOrders(5), queryTransactions()]);
  const allOrders = await queryOrders();
  const incomeTotal = transactions.filter(isIncome).reduce((sum, row) => sum + transactionAmount(row), 0);
  const expenseTotal = transactions.filter(isExpense).reduce((sum, row) => sum + transactionAmount(row), 0);
  return {
    incomeTotal,
    expenseTotal,
    netTotal: incomeTotal - expenseTotal,
    newOrders: allOrders.filter((order) => ["جديد", "أوردر جديد"].includes(String(order.operation_status || order.order_status || "").trim())).length,
    inOperation: allOrders.filter((order) => String(order.operation_status || "").trim() === "قيد التشغيل").length,
    inFinishing: allOrders.filter((order) => String(order.finishing_status || "").trim() === "قيد التشطيب").length,
    ready: allOrders.filter((order) => ["جاهز", "جاهز للإرسال"].includes(String(order.delivery_status || order.finishing_status || "").trim())).length,
    latestOrders: orders,
    latestExpenses: transactions.filter(isExpense).slice(0, 5),
    latestRevenues: transactions.filter(isIncome).slice(0, 5),
  };
}

export async function getMonthlyFinancialStats(month: number, year: number, accountDestination = "") {
  const rows = (await queryTransactions()).filter((row) => inMonth(row, month, year));
  const filtered = accountDestination ? rows.filter((row) => row.account_destination === accountDestination) : rows;
  const incomeTotal = filtered.filter(isIncome).reduce((sum, row) => sum + transactionAmount(row), 0);
  const expenseTotal = filtered.filter(isExpense).reduce((sum, row) => sum + transactionAmount(row), 0);
  return {
    incomeTotal,
    expenseTotal,
    netTotal: incomeTotal - expenseTotal,
    transactions: filtered,
  };
}

export async function createTransaction(input: {
  transaction_type: string;
  date: string;
  description: string;
  amount: number;
  expense_type: string;
  account_destination: string;
  added_by?: string;
}) {
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      transaction_type: input.transaction_type,
      date: input.date,
      description: input.description,
      amount: input.amount,
      expense_type: input.expense_type,
      account_destination: input.account_destination,
      added_by: input.added_by,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DbTransaction;
}

export async function getOperationStats(): Promise<OperationStats> {
  const orders = await queryOrders();
  return {
    inOperation: orders.filter((order) => String(order.operation_status || "").trim() === "قيد التشغيل").length,
    inFinishing: orders.filter((order) => String(order.finishing_status || "").trim() === "قيد التشطيب").length,
    readyToSend: orders.filter((order) => String(order.finishing_status || order.delivery_status || "").trim() === "جاهز للإرسال").length,
    deliveryToday: orders.filter((order) => order.delivery_date === todayIso()).length,
    orders,
  };
}

export async function getReportsData(month: number, year: number): Promise<ReportsData> {
  const rows = await queryTransactions();
  const selected = rows.filter((row) => inMonth(row, month, year));
  const incomeTotal = selected.filter(isIncome).reduce((sum, row) => sum + transactionAmount(row), 0);
  const expenseTotal = selected.filter(isExpense).reduce((sum, row) => sum + transactionAmount(row), 0);
  const grouped = rows.reduce<Record<string, { month: string; income: number; expense: number; net: number }>>((acc, row) => {
    const key = monthKey(row);
    acc[key] ||= { month: key, income: 0, expense: 0, net: 0 };
    if (isIncome(row)) acc[key].income += transactionAmount(row);
    if (isExpense(row)) acc[key].expense += transactionAmount(row);
    acc[key].net = acc[key].income - acc[key].expense;
    return acc;
  }, {});
  return {
    incomeTotal,
    expenseTotal,
    netTotal: incomeTotal - expenseTotal,
    monthlyRows: Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
