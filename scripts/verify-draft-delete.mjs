// Verifies the "حذف" (delete draft) action on the حفظ مؤقت page:
// button styling, confirmation modal, success/failure handling, refresh persistence,
// and that استكمال الأوردر still works afterwards.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = "26-6-8-900101";
const B = "26-6-8-900102";
const NORMAL = "26-6-8-900002";

const SEED = `
(() => {
  try {
    if (!sessionStorage.getItem("__zunion_seed3")) {
      sessionStorage.setItem("__zunion_seed3", "1");
      localStorage.setItem("zunion-local-session", JSON.stringify({ email: "mahmoudmostafa3104@gmail.com", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      const now = new Date().toISOString();
      const mk = (id, num, name, draft, updated) => ({
        id, created_by: "mahmoud", order_number: num, source_person: "أحمد", client_name: name, client_code: "9", phone: "",
        delivery_date: "2026-12-31", price: 50, quantity: 3, total: 150, paid: 0, remaining: 150, old_balance: 0, net_balance: 150,
        order_type: "تطريز", materialsStatus: "available", operationMethods: [""], operationItems: [{ method: "", logoImage: "", workOrderImage: "" }],
        logo_image_url: "", work_order_image_url: "", draft, order_status: "جديد", workStage: "new", workflow_stage: "أوردر جديد",
        operation_status: "لم يبدأ", finishing_status: "لم يبدأ", items: [], created_at: now, updated_at: updated || now, completedAt: "",
      });
      const list = [
        mk("seed-normal-1", "${NORMAL}", "عميل عادي", false, now),
        mk("seed-draft-a", "${A}", "مسودة أ", true, new Date(Date.now() - 1000).toISOString()),
        mk("seed-draft-b", "${B}", "مسودة ب", true, new Date(Date.now() - 5000).toISOString()),
      ];
      localStorage.setItem("zunion-local-orders-v2", JSON.stringify(list));
    }
    window.__failDelete = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
      if (url.indexOf("/api/orders") !== -1) {
        if (method === "GET") return json({ message: "offline mock" }, 503);
        if (method === "DELETE") return window.__failDelete ? json({ message: "تعذر حذف المسودة من الخادم" }, 500) : json({ ok: true }, 200);
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
  const count = (num) => ev(`(document.body.innerText.split(${JSON.stringify(num)}).length - 1)`);
  const rowDeleteBtn = (num) => `(() => {
    const tr = [...document.querySelectorAll('.drafts-table tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(num)}));
    if (!tr) return false;
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().includes('حذف'));
    if (!b) return false;
    b.click(); return true;
  })()`;

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: `${BASE}/#/drafts` });
  await sleep(2500);

  const initial = await ev(`(() => {
    const rows = [...document.querySelectorAll('.drafts-table tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim());
    const head = document.querySelector('.drafts-panel .panel-head') ? document.querySelector('.drafts-panel .panel-head').innerText : '';
    return { rows, head };
  })()`);
  check("two drafts listed before delete", initial.rows.filter((r) => r.includes(A) || r.includes(B)).length === 2, initial.rows);
  check("draft count shows 2", initial.head.includes("2"), initial.head);
  await shot(cdp, `${OUT}\\draft-delete-list.png`);

  const btnStyle = await ev(`(() => {
    const tr = [...document.querySelectorAll('.drafts-table tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(A)}));
    const btns = [...tr.querySelectorAll('button')].map((b) => b.textContent.trim());
    const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim().includes('حذف'));
    const cs = getComputedStyle(b);
    return { buttons: btns, bg: cs.backgroundColor, color: cs.color, hasIcon: !!b.querySelector('svg'), disabled: b.disabled };
  })()`);
  check("delete button is red with white text", initial && (await ev(`(() => { const tr=[...document.querySelectorAll('.drafts-table tbody tr')].find((r)=>r.innerText.includes(${JSON.stringify(A)})); const b=[...tr.querySelectorAll('button')].find((x)=>x.textContent.trim().includes('حذف')); const cs=getComputedStyle(b); return cs.backgroundColor==='rgb(237, 21, 37)' && cs.color==='rgb(255, 255, 255)'; })()`)), initial.rows);
  check("delete button has trash icon", await ev(`(() => { const tr=[...document.querySelectorAll('.drafts-table tbody tr')].find((r)=>r.innerText.includes(${JSON.stringify(A)})); const b=[...tr.querySelectorAll('button')].find((x)=>x.textContent.trim().includes('حذف')); return !!b.querySelector('svg'); })()`));
  check("resume + delete buttons share the row", await ev(`(() => { const tr=[...document.querySelectorAll('.drafts-table tbody tr')].find((r)=>r.innerText.includes(${JSON.stringify(A)})); const t=tr.innerText; return t.includes('استكمال الأوردر') && t.includes('حذف'); })()`));

  // Open confirm modal.
  check("clicked حذف on draft A", await ev(rowDeleteBtn(A)));
  await sleep(400);
  const modal = await ev(`(() => { const m = document.querySelector('.drafts-confirm'); if (!m) return { open: false }; return { open: true, text: m.innerText.replace(/\\s+/g, ' ').trim(), buttons: [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) }; })()`);
  check("confirmation modal shown with حذف + إلغاء", modal.open && modal.buttons.includes("حذف") && modal.buttons.includes("إلغاء"), modal);
  await shot(cdp, `${OUT}\\drafts-confirm.png`);

  // Cancel keeps both drafts.
  await ev(`(() => { const m = document.querySelector('.drafts-confirm'); const b=[...m.querySelectorAll('button')].find((x)=>x.textContent.trim()==='إلغاء'); b.click(); return true; })()`);
  await sleep(300);
  check("إلغاء closes modal without deleting", (await ev(`!document.querySelector('.drafts-confirm')`)) && (await count(A)) === 1);

  // Confirm delete of draft A.
  await ev(rowDeleteBtn(A));
  await sleep(300);
  await ev(`(() => { const m = document.querySelector('.drafts-confirm'); const b=[...m.querySelectorAll('button')].find((x)=>x.textContent.trim()==='حذف'); b.click(); return true; })()`);
  await sleep(900);
  check("success notice shown", await ev(`(() => { const n = document.querySelector('.drafts-notice .field-success'); return n ? n.textContent.trim() : null; })()` ) && (await ev(`(document.querySelector('.drafts-notice .field-success')||{}).textContent||''`)).includes("تم حذف المسودة بنجاح"), await ev(`(document.querySelector('.drafts-notice .field-success')||{}).textContent||''`));
  check("draft A removed", await ev(`!document.body.innerText.includes(${JSON.stringify(A)})`));
  check("draft B preserved", (await count(B)) >= 1);
  check("count updated to 1", await ev(`document.querySelector('.drafts-panel .panel-head').innerText.includes('1 أوردر')`));
  check("normal order untouched (not on drafts page)", await ev(`!document.body.innerText.includes(${JSON.stringify(NORMAL)})`));
  await shot(cdp, `${OUT}\\drafts-after-delete.png`);

  // Failure path: make DELETE fail for draft B.
  await ev(`window.__failDelete = true`);
  await ev(rowDeleteBtn(B));
  await sleep(300);
  await ev(`(() => { const m = document.querySelector('.drafts-confirm'); const b=[...m.querySelectorAll('button')].find((x)=>x.textContent.trim()==='حذف'); b.click(); return true; })()`);
  await sleep(900);
  const failState = await ev(`(() => { const m = document.querySelector('.drafts-confirm'); return { error: m ? (m.querySelector('.field-error') ? m.querySelector('.field-error').textContent.trim() : '') : null, modalOpen: !!m }; })()`);
  check("Arabic error displayed on failure", failState.error && failState.error.length > 0, failState);
  check("draft B row kept on failure", await ev(`!!document.querySelector('.drafts-confirm')`) && (await count(B)) >= 1);
  await shot(cdp, `${OUT}\\drafts-delete-error.png`);
  await ev(`(() => { const m = document.querySelector('.drafts-confirm'); if (m) { const b=[...m.querySelectorAll('button')].find((x)=>x.textContent.trim()==='إلغاء'); if (b) b.click(); } return true; })()`);
  await sleep(300);

  // Refresh: deleted stays deleted, kept stays kept.
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  check("deleted draft A stays gone after refresh", await ev(`!document.body.innerText.includes(${JSON.stringify(A)})`));
  check("draft B still present after refresh", (await count(B)) >= 1);

  // استكمال الأوردر still works for the remaining draft.
  await ev(`(() => { const tr = [...document.querySelectorAll('.drafts-table tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(B)})); const b=[...tr.querySelectorAll('button')].find((x)=>x.textContent.trim()==='استكمال الأوردر'); b.click(); return true; })()`);
  await sleep(700);
  const resumeHeading = await ev(`document.querySelector('.order-form h3') ? document.querySelector('.order-form h3').textContent.trim() : null`);
  check("استكمال الأوردر still works", resumeHeading && resumeHeading.includes("استكمال الأوردر") && resumeHeading.includes(B), resumeHeading);

  const failed = results.filter((r) => !r.pass);
  console.log("\nSUMMARY: " + (results.length - failed.length) + "/" + results.length + " passed");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err && err.message ? err.message : err);
  try { await shot(cdp, `${OUT}\\drafts-delete-crash.png`); } catch {}
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (child) cleanup(child);
}
