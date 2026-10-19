// Recording stub for node-postgres, aliased into the real backend bundle by esbuild.
// Records every SQL string + params and returns canned rows so the real handler runs end-to-end.
import fs from "node:fs";

const LOG = process.env.PG_STUB_LOG || "";
const insertedOrderIds = new Set();

function log(entry) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
}

function rowsFor(sql, params) {
  const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
  if (s.startsWith("insert into users")) return [{ id: "u-master", email: params?.[0], role: params?.[1] || "Master", token_version: 0 }];
  if (s.startsWith("select id from parties where id=")) return [{ id: params?.[0] }];
  if (s.includes("from parties where lower(btrim(name))")) return [{ id: "p1" }];
  if (s.includes("from customers where phone")) {
    const raw = process.env.PG_STUB_EXISTING_CUSTOMER;
    if (raw) { try { return [JSON.parse(raw)]; } catch { return []; } }
    return []; // default: new customer -> insert path
  }
  if (s.startsWith("insert into customers")) return [{ id: "c1" }];
  if (s.startsWith("insert into customer_accounts")) return [{ id: "ca1" }];
  if (s.includes("nextval('orders_number_seq')")) return [{ n: "00042" }];
  if (s.startsWith("insert into orders")) {
    const id = params?.[0] || "gen";
    if (insertedOrderIds.has(id)) return []; // on conflict (id) do nothing -> no row on duplicate
    insertedOrderIds.add(id);
    return [{ id }];
  }
  if (s.startsWith("select id, order_number from orders where id")) return [{ id: params?.[0], order_number: "00042" }];
  if (s.startsWith("select * from orders where id")) return [{ id: params?.[0], status: "NEW", source_party: "", source_party_id: null, materials_status: "available" }];
  if (s.startsWith("update customers")) return { rows: [], rowCount: 1 };
  if (s.startsWith("update orders")) return { rows: [], rowCount: 1 };
  if (s.startsWith("insert into audit_logs")) return { rows: [], rowCount: 1 };
  if (s.startsWith("select id from customer_accounts")) return [{ id: "ca1" }];
  return { rows: [], rowCount: 0 };
}

class Pool {
  constructor() {}
  async query(sql, params) {
    log({ sql, params });
    const r = rowsFor(sql, params);
    return Array.isArray(r) ? { rows: r, rowCount: r.length } : r;
  }
  async connect() {
    const self = this;
    return {
      query: (sql, params) => self.query(sql, params),
      release() {},
    };
  }
  async end() {}
}

export { Pool };
export default { Pool };
