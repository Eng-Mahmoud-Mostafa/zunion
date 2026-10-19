// Drives the REAL backend (bundled with pg aliased to the recording stub) over HTTP,
// to prove the POST /api/orders fix: 201 on save, idempotent retry, and party validation
// still enforced. Captures the exact INSERT INTO orders statement the handler emits.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COOKIE_SECRET = "test-secret-for-verification";
const cookieName = "zunion_app_session";

const j = async (base, p, init) => {
  const res = await fetch(base + p, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, raw: text };
};

function forgeCookie(role = "Master") {
  const payload = Buffer.from(JSON.stringify({
    email: "mahmoud@zunion.local", username: "mahmoud", fullName: "Mahmoud", role,
    tokenVersion: 0, expiresAt: new Date(Date.now() + 3600e3).toISOString(),
  }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", COOKIE_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function buildBackend() {
  return new Promise((resolve, reject) => {
    const out = path.join(root, "scripts", "_dist-test-server.cjs");
    const args = [
      path.join(root, "node_modules", "esbuild", "bin", "esbuild"),
      path.join(root, "backend", "src", "server.ts"),
      "--bundle", "--platform=node", "--format=cjs", "--target=node20",
      `--alias:pg=${path.join(root, "scripts", "_pg-stub.mjs")}`,
      `--outfile=${out}`,
    ];
    const p = spawn(process.execPath, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error("esbuild failed " + code))));
  });
}

function startServer(bundle, env, logPath) {
  const port = env.PORT;
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, ...env, PG_STUB_LOG: logPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let booted = false;
  const boot = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server boot timeout")), 15000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { booted = true; clearTimeout(t); resolve(); } });
    child.stderr.on("data", (d) => process.stderr.write("[srv] " + d));
    child.on("exit", (c) => { if (!booted) { clearTimeout(t); reject(new Error("server exited " + c)); } });
  });
  return { child, boot, url: `http://127.0.0.1:${port}` };
}

function parity(sql, params) {
  const colsMatch = /insert\s+into\s+orders\s*\(([^)]*)\)/i.exec(sql);
  const cols = colsMatch ? colsMatch[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
  const vIdx = sql.toLowerCase().indexOf("values");
  // capture the balanced parenthesised list after VALUES, tolerating nested coalesce(...)
  let depth = 0, start = -1, end = -1;
  for (let i = vIdx; i < sql.length; i++) {
    if (sql[i] === "(") { if (depth === 0) start = i; depth++; }
    else if (sql[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  const valuesClause = start >= 0 && end > start ? sql.slice(start + 1, end) : "";
  const phs = valuesClause.match(/\$\d+/g) || [];
  const maxPh = phs.length ? Math.max(...phs.map((p) => parseInt(p.slice(1), 10))) : 0;
  return { cols: cols.length, params: params.length, maxPh, ok: cols.length === maxPh && params.length === maxPh };
}

async function main() {
  const bundle = await buildBackend();
  const logPath = path.join(root, "scripts", "_queries.jsonl");
  const results = [];
  const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? " :: " + detail : ""}`); };

  // ---- Run 1: new customer draft + idempotent retry ----
  fs.writeFileSync(logPath, "");
  const s1 = startServer(bundle, { PORT: "4591", DATABASE_URL: "stub://db", COOKIE_SECRET, NODE_ENV: "development" }, logPath);
  await s1.boot;
  const cookie = forgeCookie("Master");
  const H = { cookie: `${cookieName}=${cookie}` };
  const id = crypto.randomUUID();
  const draft = {
    id, source_person: "زبون تجريبي", source_party: "", source_party_id: null,
    customer_name_snapshot: "زبون تجريبي", customer_code_snapshot: "", phone_snapshot: "01000000001",
    delivery_date: "2026-10-20", type: "قميص", productName: "قميص", paymentMethod: "cash",
    materialsStatus: "available", machineName: "", worker_name: "", operationMethods: ["تطريز"],
    operation_attachments: [], quantity: 1, price: 0, paid: 0, old_account: 0,
    status: "NEW", workStage: "new", notes: "", message_text: "", quality_notes: "",
    damaged_pieces: 0, production_notes: "", finishing_notes: "", details: "", draft: true,
  };
  const r1 = await j(s1.url, "/api/orders", { method: "POST", headers: H, body: JSON.stringify(draft) });
  check("Run1: POST draft order -> 201/200 (not 500)", r1.status === 201 || r1.status === 200, `status=${r1.status} body=${JSON.stringify(r1.body).slice(0, 160)}`);

  const log1 = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ins = log1.find((e) => /^\s*insert into orders/i.test(e.sql));
  check("Run1: handler issued an INSERT INTO orders", !!ins);
  if (ins) {
    const p = parity(ins.sql, ins.params);
    check("Run1: INSERT columns == placeholders == params", p.ok, `cols=${p.cols} placeholders=$1..$${p.maxPh} params=${p.params}`);
  }
  const cust = log1.find((e) => /^\s*insert into customers/i.test(e.sql));
  if (cust) {
    const cm = /insert\s+into\s+customers\s*\(([^)]*)\)/i.exec(cust.sql);
    const ccols = cm ? cm[1].split(",").map((c) => c.trim()).filter(Boolean) : [];
    check("Run1: customers INSERT includes source_party_id", ccols.includes("source_party_id"), `cols=[${ccols.join(",")}]`);
  }

  const r2 = await j(s1.url, "/api/orders", { method: "POST", headers: H, body: JSON.stringify(draft) });
  check("Run1: retry same id -> 200 idempotent (no duplicate)", r2.status === 200, `status=${r2.status}`);
  s1.child.kill();

  // ---- Run 2: party mismatch -> 400 Arabic, validation NOT bypassed ----
  fs.writeFileSync(logPath, "");
  const existingPartyId = crypto.randomUUID();
  const incomingPartyId = crypto.randomUUID();
  const existingCustomer = { id: "c-exist", source_party_id: existingPartyId, source_party: "الطرف أ" };
  const s2 = startServer(bundle, { PORT: "4592", DATABASE_URL: "stub://db", COOKIE_SECRET, NODE_ENV: "development", PG_STUB_EXISTING_CUSTOMER: JSON.stringify(existingCustomer) }, logPath);
  await s2.boot;
  const nonDraft = {
    id: crypto.randomUUID(), source_person: "زبون آخر", source_party: "الطرف ب",
    source_party_id: incomingPartyId,
    customer_name_snapshot: "زبون آخر", customer_code_snapshot: "", phone_snapshot: "01000000002",
    delivery_date: "2026-10-20", type: "قميص", productName: "قميص", paymentMethod: "cash",
    materialsStatus: "available", machineName: "", worker_name: "", operationMethods: ["تطريز"],
    operation_attachments: [], quantity: 2, price: 10, paid: 0, old_account: 0,
    status: "NEW", workStage: "new", notes: "", message_text: "", quality_notes: "",
    damaged_pieces: 0, production_notes: "", finishing_notes: "", details: "", draft: false,
  };
  const r3 = await j(s2.url, "/api/orders", { method: "POST", headers: H, body: JSON.stringify(nonDraft) });
  console.log("Run2 raw:", r3.raw.slice(0, 700));
  check("Run2: party mismatch -> 400 with Arabic message", r3.status === 400 && JSON.stringify(r3.body).includes("الطرف"), `status=${r3.status} body=${JSON.stringify(r3.body).slice(0, 160)}`);
  s2.child.kill();

  // ---- Run 3: PUT edit order -> 200 + statement parity; PUT mismatch -> 400 ----
  fs.writeFileSync(logPath, "");
  const s3 = startServer(bundle, { PORT: "4593", DATABASE_URL: "stub://db", COOKIE_SECRET, NODE_ENV: "development" }, logPath);
  await s3.boot;
  const editOrder = { ...draft, id: crypto.randomUUID(), draft: false, source_party: "الطرف أ", source_party_id: incomingPartyId, customer_name_snapshot: "زبون تجريبي", phone_snapshot: "01000000003", quantity: 3, price: 5 };
  const r4 = await j(s3.url, "/api/orders/" + editOrder.id, { method: "PUT", headers: H, body: JSON.stringify(editOrder) });
  check("Run3: PUT edit order -> 200", r4.status === 200, `status=${r4.status} body=${JSON.stringify(r4.body).slice(0, 160)}`);
  const log3 = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const upd = log3.find((e) => /update\s+orders\s+set\s+source_party\s*=/i.test(e.sql));
  if (upd) {
    const phs = upd.sql.match(/\$\d+/g) || [];
    const maxPh = phs.length ? Math.max(...phs.map((p) => parseInt(p.slice(1), 10))) : 0;
    check("Run3: UPDATE orders placeholders == params", maxPh > 0 && maxPh === upd.params.length, `$1..$${maxPh} params=${upd.params.length}`);
  } else {
    check("Run3: found UPDATE orders statement", false, "no update orders statement logged");
  }
  s3.child.kill();

  fs.writeFileSync(logPath, "");
  const s4 = startServer(bundle, { PORT: "4594", DATABASE_URL: "stub://db", COOKIE_SECRET, NODE_ENV: "development", PG_STUB_EXISTING_CUSTOMER: JSON.stringify(existingCustomer) }, logPath);
  await s4.boot;
  const r5 = await j(s4.url, "/api/orders/" + crypto.randomUUID(), { method: "PUT", headers: H, body: JSON.stringify(editOrder) });
  check("Run4: PUT party mismatch -> 400 Arabic", r5.status === 400 && JSON.stringify(r5.body).includes("الطرف"), `status=${r5.status} body=${JSON.stringify(r5.body).slice(0, 160)}`);
  s4.child.kill();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
