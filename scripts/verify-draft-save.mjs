// Checks that pressing "حفظ مؤقت" inside a NEW order creates a draft entry
// that shows up on the حفظ مؤقت page.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NORMAL_NUM = "26-6-8-900002";

const SEED = `
(() => {
  try {
    if (!sessionStorage.getItem("__zunion_seed2")) {
      sessionStorage.setItem("__zunion_seed2", "1");
      localStorage.setItem("zunion-local-session", JSON.stringify({ email: "mahmoudmostafa3104@gmail.com", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      const now = new Date().toISOString();
      const normal = { id: "seed-normal-1", created_by: "mahmoud", order_number: "${NORMAL_NUM}", source_person: "أحمد", client_name: "عميل عادي", client_code: "902", phone: "", delivery_date: "2026-12-31", price: 50, quantity: 3, total: 150, paid: 0, remaining: 150, old_balance: 0, net_balance: 150, order_type: "تطريز", materialsStatus: "available", operationMethods: [""], operationItems: [{ method: "", logoImage: "", workOrderImage: "" }], logo_image_url: "", work_order_image_url: "", draft: false, order_status: "جديد", workStage: "new", workflow_stage: "أوردر جديد", operation_status: "لم يبدأ", finishing_status: "لم يبدأ", items: [], created_at: now, updated_at: now, completedAt: "" };
      localStorage.setItem("zunion-local-orders-v2", JSON.stringify([normal]));
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String((init && init.method) || "GET").toUpperCase();
      const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
      if (url.indexOf("/api/orders") !== -1) {
        if (method === "GET") return json({ message: "offline mock" }, 503);
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) {}
        return json({ id: body.id || "srv-id", order_number: body.order_number || "" }, 200);
      }
      if (url.indexOf("/api/") !== -1) return json({ message: "offline mock" }, 503);
      return originalFetch(input, init);
    };
  } catch (e) {}
})();
`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`);
}

let cdp, child;
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  const ev = (expr) => evaluate(cdp, expr);
  const clickSubitem = (label) => ev(`(() => { const b = [...document.querySelectorAll('.sidebar-subitem')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
  const pageText = `document.body.innerText`;
  const countOccurrences = (num) => ev(`((t) => t.split(${JSON.stringify(num)}).length - 1)(${pageText})`);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: `${BASE}/#/new` });
  await sleep(2500);

  await ev(`(() => { const p = [...document.querySelectorAll('.sidebar-parent')].find((x) => x.textContent.includes('الرئيسية')); if (p) p.click(); return !!p; })()`);
  await sleep(300);

  const headingBefore = await ev(`document.querySelector('.order-form h3') ? document.querySelector('.order-form h3').textContent.trim() : null`);
  check("opened new order form", headingBefore === "أوردر جديد", headingBefore);
  await shot(cdp, `${OUT}\\draft-save-new.png`);

  // Press حفظ مؤقت inside the new order form.
  const clicked = await ev(`(() => { const b = [...document.querySelectorAll('.nf-actionbar button')].find((x) => x.textContent.trim() === 'حفظ مؤقت'); if (b) b.click(); return !!b; })()`);
  check("حفظ مؤقت button present in new order form", clicked);
  await sleep(900);
  const notice = await ev(`(() => { const n = document.querySelector('.nf-draft-notice .field-success'); return n ? n.textContent.trim() : null; })()`);
  check("draft save notice shown", notice && notice.includes("تم حفظ الأوردر كمسودة بنجاح"), notice);

  // Draft now visible on the حفظ مؤقت page, normal order excluded.
  await clickSubitem("حفظ مؤقت");
  await sleep(600);
  const rows = await ev(`(() => { const t = document.querySelector('.drafts-table tbody'); return t ? [...t.querySelectorAll('tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) : null; })()`);
  check("draft created from new order appears on حفظ مؤقت", rows && rows.some((r) => r.includes("استكمال الأوردر")), rows);
  const normalOnDrafts = await countOccurrences(NORMAL_NUM);
  check("normal order not listed on حفظ مؤقت", normalOnDrafts === 0, { occurrences: normalOnDrafts });
  await shot(cdp, `${OUT}\\draft-save-list.png`);

  const failed = results.filter((r) => !r.pass);
  console.log("\nSUMMARY: " + (results.length - failed.length) + "/" + results.length + " passed");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err && err.message ? err.message : err);
  try { await shot(cdp, `${OUT}\\draft-save-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (child) cleanup(child);
}
