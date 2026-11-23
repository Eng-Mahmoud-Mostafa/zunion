// Exercise the real React page with a local API fixture. No production writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";
const require = createRequire(import.meta.url);
const { build } = require("../backend/node_modules/esbuild");
const out = process.env.OUT_DIR || join(tmpdir(), "zunion-account-review");
mkdirSync(out, { recursive: true });
const customers = [{ id: "c1", client_name: "شركة شيمه", client_code: "1054", source_person: "Mahmoud" }, { id: "c2", client_name: "عميل آخر", client_code: "1055", source_person: "Ali" }];
const row = { id: "o1", kind: "charge", txn_date_text: "2026-09-12", order_id: "order-48", order_number: "00048", created_by_name: "Mahmoud", description: "تطريز", logo: "", color: "أحمر", quantity: 10, price: 5, debit: 50, credit: 0, balance: 50, source: "order" };
let payments = [{ ...row, id: "p1", kind: "payment", order_id: null, order_number: "", color: "", quantity: 0, price: 0, debit: 0, credit: 40, balance: 10, txn_date_text: "2026-09-13", source: "ledger" }];
let period = 1, paymentCalls = 0, periodCalls = 0;
const periodInfo = n => ({ id: `period-${n}`, seq: n, status: n === period ? "active" : "closed", opened_at: "2026-09-01", closed_at: n < period ? "2026-11-23" : null, opening_balance: n === 1 ? 0 : -990, closing_balance: n < period ? 0 : null });
const ledger = requested => {
  const old = requested === "period-1" && period > 1;
  const rows = period === 1 || old ? [row, ...payments] : [{ ...row, id: "in", kind: "transfer_in", order_id: null, order_number: "", color: "", quantity: 0, price: 0, debit: 0, credit: 990, balance: -990, source: "ledger" }];
  if (old) rows.push({ ...rows.at(-1), id: "out", kind: "transfer_out", debit: 990, credit: 0, balance: 0 });
  return { customer: { id: "c1", name: customers[0].client_name, code: "1054", party: "Mahmoud" },
    periods: Array.from({ length: period }, (_, i) => periodInfo(i + 1)),
    period: { ...periodInfo(old ? 1 : period), openingBalance: 0, closingBalance: old ? 0 : rows.at(-1).balance, carriedIn: !old && period > 1 ? -990 : null, minOpenDate: null, driftAfterClose: 0 },
    closing: old ? { reference: "TR-TEST", preTransferBalance: -990, transferredAmount: -990, closingAfterTransfer: 0, closedAt: "2026-11-23", effectiveDate: "2026-11-23", byName: "Mahmoud" } : null,
    summary: { operationCount: period === 1 || old ? 1 + payments.length : 0, totalWork: period === 1 || old ? 50 : 0, totalPayments: period === 1 || old ? payments.reduce((sum, p) => sum + p.credit, 0) : 0, currentBalance: 50 - payments.reduce((sum, p) => sum + p.credit, 0) }, rows, total: rows.length, hasMore: false };
};
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from './src/components/CustomerLedgerPage'; createRoot(document.getElementById('root')).render(<Page customers={${JSON.stringify(customers)}} parties={['Mahmoud','Ali']} session={{role:new URLSearchParams(location.search).get('role') || 'Master'}} initialCustomerId={new URLSearchParams(location.search).get('direct') || undefined} onOrderClick={id=>{window.openedOrder=id}}/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const css = readFileSync(join("dist/assets", readdirSync("dist/assets").find(f => f.endsWith(".css"))), "utf8");
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (url.pathname === "/zunion-logo.png") { res.setHeader("Content-Type", "image/png"); res.end(readFileSync("public/zunion-logo.png")); return; }
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (url.pathname.endsWith("/payments")) { paymentCalls++; payments.push({ ...payments[0], id: "p2", credit: data.amount, balance: 10 - data.amount, txn_date_text: data.date }); }
      if (url.pathname.endsWith("/periods")) { periodCalls++; period++; }
      res.end(JSON.stringify({ ok: true })); return;
    }
    res.end(JSON.stringify(ledger(url.searchParams.get("period_id")))); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#f7f9fc;padding:12px}#root{background:white;border:1px solid #e3e6ee;border-radius:16px;padding:12px;min-width:0}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let child, cdp;
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  ({ child, target: globalThis.ledgerTarget } = await launch());
  cdp = await connect(globalThis.ledgerTarget.webSocketDebuggerUrl);
  const page = expression => evaluate(cdp, expression);
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await page(expression)) return; await sleep(100); } throw new Error(`Timed out: ${expression}`); };
  const fill = (selector, value) => page(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1163, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: base });
  await wait("!!document.querySelector('#cl-customer')");
  await fill("#cl-customer", "1054");
  await wait("document.querySelectorAll('[role=option]').length===1");
  await page("document.querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  await wait("document.querySelectorAll('.cl-table tbody tr').length===2");
  assert.equal(await page("document.querySelectorAll('.cl-table th').length"), 11);
  assert.equal(await page("document.querySelectorAll('.cl-table th')[6].textContent"), "العدد");
  assert.equal(await page("getComputedStyle(document.querySelector('.cl-table th')).color"), "rgb(255, 255, 255)");
  assert.match(await page("getComputedStyle(document.querySelector('.cl-table th')).backgroundImage"), /gradient/);
  assert.equal(await page("getComputedStyle(document.querySelector('.cl-btn-red')).color"), "rgb(255, 255, 255)");
  assert.equal(await page("document.querySelector('.cl-info').textContent.includes('شركة شيمه')"), true);
  assert.equal(await page("document.querySelector('.cl-table tbody').textContent.includes('أحمر')"), true);
  await page("document.querySelector('a.cl-pill').click()");
  assert.equal(await page("window.openedOrder"), "order-48");
  await page("document.querySelector('.cl-btn-red').click()");
  await wait("!!document.querySelector('.cl-modal input[inputmode=decimal]')");
  await fill(".cl-modal input[inputmode=decimal]", "1000");
  await page("document.querySelector('.cl-modal').requestSubmit();document.querySelector('.cl-modal').requestSubmit()");
  await wait("document.querySelector('.cl-stat.bal strong')?.textContent==='-990'");
  assert.equal(paymentCalls, 1);
  assert.equal(await page("document.querySelector('.cl-stat.bal').classList.contains('credit')"), true);
  assert.equal(await page("document.querySelector('.cl-stat.paid strong').textContent"), "1,040");
  await shot(cdp, join(out, "customer-account-desktop.png"));
  // Reload and open from a customer record: the fixture retains the saved payment.
  await cdp.send("Page.navigate", { url: `${base}/?direct=c1` });
  await wait("document.querySelector('.cl-stat.bal strong')?.textContent==='-990'");
  await cdp.send("Runtime.evaluate", { expression: "[...document.querySelectorAll('.cl-outline-btn')].find(el=>el.textContent.includes('طباعة')).click()", userGesture: true });
  let printTarget;
  for (let i = 0; i < 30; i++) { printTarget = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(t => t.id !== globalThis.ledgerTarget.id && t.type === 'page'); if (printTarget) break; await sleep(100); }
  assert.ok(printTarget, "statement popup opened");
  const popup = await connect(printTarget.webSocketDebuggerUrl);
  assert.equal(await evaluate(popup, "document.querySelectorAll('th').length"), 11);
  assert.equal(await evaluate(popup, "document.body.textContent.includes('-990') && !!document.querySelector('img[alt=Zunion]')"), true);
  await popup.send("Page.enable");
  const pdf = await popup.send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
  writeFileSync(join(out, "customer-statement.pdf"), Buffer.from(pdf.data, "base64"));
  await popup.send("Page.close"); popup.close();
  await page("[...document.querySelectorAll('.cl-outline-btn')].find(el=>el.textContent.includes('فتح حساب')).click()");
  await wait("!!document.querySelector('.cl-modal-open')");
  assert.equal(await page("document.querySelector('.cl-modal-open').textContent.includes('شركة شيمه')"), false);
  assert.equal(await page("document.querySelectorAll('.cl-transfer-box').length"), 1);
  await page("document.querySelector('.cl-modal-open').requestSubmit();document.querySelector('.cl-modal-open').requestSubmit()");
  await wait("document.querySelector('#cl-period')?.value==='period-2'");
  assert.equal(periodCalls, 1);
  assert.equal(await page("document.querySelector('.cl-stat.paid strong').textContent"), "0");
  await page("const el=document.querySelector('#cl-period');el.value='period-1';el.dispatchEvent(new Event('change',{bubbles:true}))");
  await wait("!!document.querySelector('.cl-closing')");
  assert.equal(await page("document.querySelector('.cl-btn-red').disabled"), true);
  console.log("PASS selection by code, customer data, columns, saved color, order link, payment double submit, summary refresh, reload, A4 PDF and period controls");
  await cdp.send("Page.navigate", { url: `${base}/?direct=c1&role=Operator` });
  await wait("!!document.querySelector('.cl-stat')");
  assert.equal(await page("[...document.querySelectorAll('.cl-outline-btn')].find(el=>el.textContent.includes('فتح حساب')).getAttribute('aria-disabled')"), "true");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(250);
  assert.equal(await page("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await page("const w=document.querySelector('.cl-table-wrap');w.scrollWidth>w.clientWidth"), true);
  const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
  const mobile = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: cssContentSize.height, scale: 1 } });
  writeFileSync(join(out, "customer-account-mobile.png"), Buffer.from(mobile.data, "base64"));
  console.log(`PASS role restriction and contained mobile table scrolling. Review artifacts: ${out}`);
} finally {
  cdp?.close(); if (child) cleanup(child);
  await new Promise(resolve => server.close(resolve));
}
