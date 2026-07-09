export type Role = "Master" | "Helper" | "Worker" | "Finish";

export type ApiUser = {
  id: string;
  email: string;
  role: Role;
};

export type ApiOrder = {
  id: string;
  order_number: string;
  source_party: string;
  customer_name_snapshot: string;
  customer_code_snapshot: string;
  phone_snapshot: string;
  delivery_date: string;
  type: string;
  quantity: number;
  price?: number;
  total?: number;
  paid?: number;
  remaining?: number;
  old_account?: number;
  net_account?: number;
  status: string;
  notes: string;
  message_text: string;
  quality_notes: string;
  damaged_pieces: number;
  production_notes: string;
  finishing_notes: string;
  created_at: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Backend server is not running. Start the Zunion API and database, then try again.");
  }
  if (!response.ok) {
    const raw = await response.text();
    let body: { message?: string } = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { message: raw };
    }
    if (response.status >= 500 && (body.message || raw).includes("Internal Server Error")) {
      throw new Error("Backend server or database is not running. Start Docker/PostgreSQL, then request the OTP again.");
    }
    throw new Error(body.message || response.statusText || "Request failed");
  }
  return response.json() as Promise<T>;
}

export const api = {
  requestOtp: (email: string) => request<{ ok: boolean; devOtp?: string }>("/auth/request-otp", { method: "POST", body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, otp: string, stayLoggedIn: boolean) =>
    request<{ user: ApiUser }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ email, otp, stayLoggedIn }) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: ApiUser }>("/auth/me"),
  summary: () => request<{ summary: Record<string, number | string> }>("/dashboard/summary"),
  alerts: () => request<{ alerts: Array<{ type: string; order: ApiOrder }> }>("/dashboard/alerts"),
  orders: (params = "") => request<{ orders: ApiOrder[] }>(`/orders${params}`),
  order: (id: string) => request<{ order: ApiOrder; files: Array<{ id: string; original_name: string; mime_type: string; file_type: string }> }>(`/orders/${id}`),
  createOrder: (body: Partial<ApiOrder>) => request<{ id: string }>("/orders", { method: "POST", body: JSON.stringify(body) }),
  updateOrder: (id: string, body: Partial<ApiOrder>) => request<{ ok: boolean }>(`/orders/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  updateStatus: (id: string, body: { status: string; production_notes?: string; finishing_notes?: string; damaged_pieces?: number }) =>
    request<{ ok: boolean }>(`/orders/${id}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteOrder: (id: string) => request<{ ok: boolean }>(`/orders/${id}`, { method: "DELETE" }),
  uploadFiles: (id: string, form: FormData) => request<{ files: Array<{ id: string }> }>(`/orders/${id}/files`, { method: "POST", body: form }),
  customers: (search = "") => request<{ customers: Array<Record<string, string | number>> }>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  updateCustomer: (id: string, body: Record<string, string | number>) => request<{ ok: boolean }>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  customerOrders: (id: string) => request<{ orders: ApiOrder[] }>(`/customers/${id}/orders`),
  audit: () => request<{ audit: Array<Record<string, unknown>> }>("/audit"),
};

export function fileUrl(orderId: string, fileId: string) {
  return `${API_BASE}/orders/${orderId}/files/${fileId}`;
}

export function printUrl(orderId: string) {
  return `${API_BASE}/orders/${orderId}/print`;
}
