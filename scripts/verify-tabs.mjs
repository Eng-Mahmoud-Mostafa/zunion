// Verifies the persistent internal tabs feature against the built dist.
// The app runs in server-auth mode, so /api/* is mocked via fetch interception:
// /api/orders GET fails (the app keeps its seeded local cache), /api/orders POST
// is toggleable to simulate a save failure. Checks: opening tabs from the
// sidebar, preserving typed values across tab switches, per-record order tabs,
// the dirty indicator, and the close-confirm flow (save / discard / cancel).
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FULL_ORDER = {
  phone: "", paid: 0, old_balance: 0, order_type: "new", details: "", logo_place: "", logo_status: "",
  workflow_stage: "", items: [], logo_image_url: "", work_order_image_url: "", notes: "",
};
const ORDER_A = {
  ...FULL_ORDER,
  id: "ord-a", order_number: "900001", client_name: "أحمد الشريف", client_code: "أحمد-0001",
  source_person: "أحمد", productName: "بدلة", quantity: 5, price: 250, materialsStatus: "متوفرة",
  delivery_date: "2026-11-20", order_status: "جديد", workStage: "new",
  operation_status: "not_started", finishing_status: "not_started",
  operationItems: [{ method: "تطريز", logoImage: "https://cdn.example.com/logo.jpg", workOrderImage: "https://cdn.example.com/wo.jpg" }],
  created_by: "mahmoudmostafa3104@gmail.com", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", draft: false,
};
const ORDER_B = {
  ...FULL_ORDER,
  id: "ord-b", order_number: "900002", client_name: "سارة منصور", client_code: "أحمد-0002",
  source_person: "أحمد", productName: "قميص", quantity: 3, price: 150, materialsStatus: "متوفرة",
  delivery_date: "2026-11-25", order_status: "جديد", workStage: "new",
  operation_status: "not_started", finishing_status: "not_started",
  operationItems: [{ method: "طباعة", logoImage: "https://cdn.example.com/logo2.jpg", workOrderImage: "https://cdn.example.com/wo2.jpg" }],
  created_by: "mahmoudmostafa3104@gmail.com", created_at: "2026-10-02T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z", draft: false,
};

const SEED = `
(() => {
  try {
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false }));
    localStorage.setItem('zunion-local-orders-v2', JSON.stringify(${JSON.stringify([ORDER_A, ORDER_B])}));
    window.__ordersPostFail = false;
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = (input && input.url) || String(input || '');
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const json = (body, status) => Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.indexOf('/api/orders') !== -1) {
        if (method === 'POST') {
          if (window.__ordersPostFail) return json({ message: 'server error' }, 500);
          return json({ id: 'srv-' + Date.now(), order_number: '999999' });
        }
        return json({ message: 'offline mock' }, 503);
      }
      if (url.indexOf('/api/uploads') !== -1) return json({ url: 'https://cdn.example.com/uploaded.jpg' });
      if (url.indexOf('/api/') !== -1) return json({ message: 'offline mock' }, 503);
      return original.call(window, input, init);
    };
  } catch (e) {}
})();
`;

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}

const SETVAL = `const setVal = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };`;
const NORM = `const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();`;

const tabsState = `(() => {
  const tabs = [...document.querySelectorAll('.tabbar .tab')].map(t => ({
    label: t.querySelector('.tab-label')?.textContent?.trim() || '',
    active: t.classList.contains('active'),
    dirty: !!t.querySelector('.tab-dot'),
  }));
  return { tabs };
})()`;

const clickTab = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const tab = [...document.querySelectorAll('.tabbar .tab')].find(t => norm(t.querySelector('.tab-label')?.textContent || '').includes(want));
  if (!tab) return { ok: false, have: [...document.querySelectorAll('.tabbar .tab')].map(t => norm(t.querySelector('.tab-label')?.textContent || '')) };
  tab.querySelector('.tab-main').click();
  return { ok: true };
})()`;

const closeTab = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const tab = [...document.querySelectorAll('.tabbar .tab')].find(t => norm(t.querySelector('.tab-label')?.textContent || '').includes(want));
  if (!tab) return { ok: false, have: [...document.querySelectorAll('.tabbar .tab')].map(t => norm(t.querySelector('.tab-label')?.textContent || '')) };
  tab.querySelector('.tab-close').click();
  return { ok: true };
})()`;

const setQty = (value) => `(() => {
  ${SETVAL}
  ${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return { ok: false, reason: 'no visible pane' };
  const labels = [...pane.querySelectorAll('label')];
  const label = labels.find(l => norm(l.textContent).includes('العدد') && l.querySelector('input:not([readonly])'));
  const input = label ? label.querySelector('input:not([readonly])') : null;
  if (!input) return { ok: false, labels: labels.map(l => norm(l.textContent).slice(0, 20)) };
  setVal(input, ${JSON.stringify(value)});
  return { ok: true, value: input.value };
})()`;

const readQty = `(() => {
  ${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return null;
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('العدد') && l.querySelector('input'));
  return label ? label.querySelector('input').value : null;
})()`;

const readOrderNumber = `(() => {
  ${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return null;
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('رقم الاوردر') && l.querySelector('input'));
  return label ? label.querySelector('input').value : null;
})()`;

const countOrderTabs = `(() => [...document.querySelectorAll('.tabbar .tab-label')].filter(e => /9000/.test(e.textContent)).length)()`;

const confirmVisible = `(() => { const el = document.querySelector('.tab-confirm'); return el ? { text: el.textContent.replace(/\\s+/g,' ').trim() } : null; })()`;

const clickConfirm = (text) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(text)});
  const box = document.querySelector('.tab-confirm');
  if (!box) return { ok: false };
  const btn = [...box.querySelectorAll('button')].find(b => norm(b.textContent).includes(want));
  if (!btn) return { ok: false, have: [...box.querySelectorAll('button')].map(b => norm(b.textContent)) };
  btn.click();
  return { ok: true };
})()`;

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  console.log("== 1. initial tab ==");
  let state = await evaluate(cdp, tabsState);
  check("one initial tab (نظرة عامة)", state.tabs.length === 1 && state.tabs[0].active, state);

  console.log("== 2. sidebar opens a new tab ==");
  await evaluate(cdp, `(() => {
    ${NORM}
    const child = [...document.querySelectorAll('.sidebar-subitem')].find(b => norm(b.textContent).includes(norm('اوردر جديد')));
    if (!child) {
      const parent = [...document.querySelectorAll('.sidebar-parent')].find(b => norm(b.textContent).includes(norm('الرئيسية')));
      if (parent) parent.click();
    }
  })()`);
  await sleep(700);
  await evaluate(cdp, `(() => {
    ${NORM}
    const child = [...document.querySelectorAll('.sidebar-subitem')].find(b => norm(b.textContent).includes(norm('اوردر جديد')));
    if (child) child.click();
  })()`);
  await sleep(1200);
  state = await evaluate(cdp, tabsState);
  check("new-order tab opened", state.tabs.length === 2 && state.tabs.some(t => t.label.includes('جديد')), state);
  await shot(cdp, `${OUT}\\tabs-01-open.png`);

  console.log("== 3. typed value + dirty dot ==");
  const typed = await evaluate(cdp, setQty('7'));
  check("quantity typed", typed.ok && typed.value === '7', typed);
  await sleep(500);
  state = await evaluate(cdp, tabsState);
  const newTab = state.tabs.find(t => t.label.includes('جديد'));
  check("dirty dot shown on edited tab", !!newTab && newTab.dirty, state);

  console.log("== 4. switching tabs preserves the typed value ==");
  await evaluate(cdp, clickTab('نظرة عامة'));
  await sleep(900);
  state = await evaluate(cdp, tabsState);
  check("dashboard tab now active", state.tabs.find(t => t.active)?.label.includes('نظرة'), state);
  await evaluate(cdp, clickTab('جديد'));
  await sleep(900);
  const preserved = await evaluate(cdp, readQty);
  check("quantity preserved after returning", preserved === '7', preserved);

  console.log("== 5. per-record order tabs via hash ==");
  await evaluate(cdp, `window.location.hash = '#/editOrder/900001'`);
  await sleep(1000);
  await evaluate(cdp, `window.location.hash = '#/editOrder/900002'`);
  await sleep(1000);
  state = await evaluate(cdp, tabsState);
  const orderTabCount = await evaluate(cdp, countOrderTabs);
  check("two order tabs opened", state.tabs.length === 4 && orderTabCount === 2, { state, orderTabCount });
  const numB = await evaluate(cdp, readOrderNumber);
  check("second order tab shows its record", numB === '900002', numB);
  await evaluate(cdp, clickTab('900001'));
  await sleep(800);
  const numA = await evaluate(cdp, readOrderNumber);
  check("first order tab shows its record", numA === '900001', numA);
  await shot(cdp, `${OUT}\\tabs-02-orders.png`);

  console.log("== 6. dirty order tab + cancel close ==");
  const editedA = await evaluate(cdp, setQty('9'));
  check("order quantity typed", editedA.ok && editedA.value === '9', editedA);
  await sleep(500);
  state = await evaluate(cdp, tabsState);
  check("edited order tab marked dirty", state.tabs.find(t => t.active)?.dirty, state);
  await evaluate(cdp, closeTab('900001'));
  await sleep(500);
  let modal = await evaluate(cdp, confirmVisible);
  check("close confirm modal shown", !!modal, modal);
  await shot(cdp, `${OUT}\\tabs-03-confirm.png`);
  await evaluate(cdp, clickConfirm('إلغاء'));
  await sleep(500);
  modal = await evaluate(cdp, confirmVisible);
  state = await evaluate(cdp, tabsState);
  check("cancel keeps the tab open", !modal && state.tabs.length === 4, { modal, state });

  console.log("== 7. discard changes closes the tab ==");
  await evaluate(cdp, closeTab('900001'));
  await sleep(500);
  await evaluate(cdp, clickConfirm('تجاهل'));
  await sleep(700);
  state = await evaluate(cdp, tabsState);
  check("discard closes the tab", state.tabs.length === 3 && !state.tabs.some(t => t.label.includes('900001')), state);

  console.log("== 8. close a clean tab removes it silently ==");
  await evaluate(cdp, closeTab('نظرة عامة'));
  await sleep(600);
  modal = await evaluate(cdp, confirmVisible);
  state = await evaluate(cdp, tabsState);
  check("clean tab closed without prompt", !modal && !state.tabs.some(t => t.label.includes('نظرة عامة')), { modal, state });

  console.log("== 8b. closing the active tab activates a neighbour ==");
  await evaluate(cdp, clickTab('900002'));
  await sleep(600);
  await evaluate(cdp, closeTab('900002'));
  await sleep(600);
  state = await evaluate(cdp, tabsState);
  check("neighbour activated after close", state.tabs.some(t => t.active && t.label.includes('جديد')), state);

  console.log("== 8c. save failure keeps the tab and shows an error ==");
  const typed2 = await evaluate(cdp, setQty('11'));
  check("quantity typed for save test", typed2.ok && typed2.value === '11', typed2);
  await sleep(400);
  await evaluate(cdp, `window.__ordersPostFail = true`);
  await evaluate(cdp, closeTab('جديد'));
  await sleep(500);
  modal = await evaluate(cdp, confirmVisible);
  check("confirm shown for new-order tab", !!modal, modal);
  await evaluate(cdp, clickConfirm('حفظ'));
  await sleep(1500);
  state = await evaluate(cdp, tabsState);
  const errText = await evaluate(cdp, `document.querySelector('.tab-confirm-error')?.textContent || ''`);
  check("failed save keeps the tab with an error", state.tabs.some(t => t.label.includes('جديد')) && errText.length > 0, { state, errText });
  await shot(cdp, `${OUT}\\tabs-04-save-fail.png`);

  console.log("== 9. successful save then close ==");
  await evaluate(cdp, `window.__ordersPostFail = false`);
  await evaluate(cdp, clickConfirm('حفظ'));
  await sleep(1500);
  state = await evaluate(cdp, tabsState);
  check("successful save closes the tab", !state.tabs.some(t => t.label.includes('جديد')), state);
  await shot(cdp, `${OUT}\\tabs-05-after-save.png`);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\tabs-99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
