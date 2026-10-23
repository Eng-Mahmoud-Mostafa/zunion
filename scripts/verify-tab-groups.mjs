// Verifies the grouped internal tab bar (top tabs grouped by sidebar section).
// Requires the built app served at BASE (scripts/serve-local.cjs on :5195).
// Covers: one top tab per section, dropdown with red circles per open subpage,
// active-row highlight, switching preserves unsaved data, grouping under تشغيل,
// and closing an individual subpage (removing the section when its last closes).
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ORDER = {
  phone: "", paid: 0, old_balance: 0, order_type: "new", details: "", logo_place: "", logo_status: "",
  workflow_stage: "", items: [], logo_image_url: "", work_order_image_url: "", notes: "",
  id: "ord-g1", order_number: "910001", client_name: "عميل تجريبي", client_code: "تجريب-0001",
  source_person: "طرف تجريبي", productName: "بدلة", quantity: 2, price: 100, materialsStatus: "متوفرة",
  delivery_date: "2026-12-01", order_status: "جديد", workStage: "new",
  operation_status: "not_started", finishing_status: "not_started",
  operationItems: [{ method: "تطريز", logoImage: "https://cdn.example.com/l.jpg", workOrderImage: "https://cdn.example.com/w.jpg" }],
  created_by: "mahmoudmostafa3104@gmail.com", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", draft: false,
};

const SEED = `
(() => {
  try {
    window.alert = function () {};
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false }));
    localStorage.setItem('zunion-local-orders-v2', JSON.stringify(${JSON.stringify([ORDER])}));
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = (input && input.url) || String(input || '');
      const json = (body, status) => Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } }));
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

const NORM = `const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();`;
const SETVAL = `const setVal = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };`;

const topState = `(() => {
  const standalone = [...document.querySelectorAll('.tabbar .tab')].filter(t => t.querySelector('.tab-main')).map(t => ({
    label: t.querySelector('.tab-label')?.textContent?.trim() || '',
    active: t.classList.contains('active'),
  }));
  const sections = [...document.querySelectorAll('.tabbar .tab-section-btn')].map(b => ({
    label: b.querySelector('.tab-label')?.textContent?.trim() || '',
    containsActive: b.classList.contains('contains-active'),
    open: b.classList.contains('open'),
  }));
  return { standalone, sections };
})()`;

const openSection = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const btn = [...document.querySelectorAll('.tabbar .tab-section-btn')].find(b => norm(b.querySelector('.tab-label')?.textContent || '').includes(want));
  if (!btn) return { ok:false, have:[...document.querySelectorAll('.tabbar .tab-section-btn')].map(b=>norm(b.querySelector('.tab-label')?.textContent || '')) };
  if (!btn.classList.contains('open')) btn.click();
  return { ok:true };
})()`;

const menuRows = `(() => [...document.querySelectorAll('.tab-section-menu .tab-menu-row')].map(r => ({
  label: r.querySelector('.tab-menu-label')?.textContent?.trim() || '',
  open: !!r.querySelector('.tab-menu-dot'),
  dirty: !!r.querySelector('.tab-menu-dirty'),
  active: r.classList.contains('active'),
  canClose: !!r.querySelector('.tab-menu-close'),
})))()`;

const clickRow = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const row = [...document.querySelectorAll('.tab-section-menu .tab-menu-row')].find(r => norm(r.querySelector('.tab-menu-label')?.textContent || '').includes(want));
  if (!row) return { ok:false, have:[...document.querySelectorAll('.tab-section-menu .tab-menu-label')].map(e=>norm(e.textContent)) };
  row.querySelector('.tab-menu-main').click();
  return { ok:true };
})()`;

const closeRow = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const row = [...document.querySelectorAll('.tab-section-menu .tab-menu-row')].find(r => norm(r.querySelector('.tab-menu-label')?.textContent || '').includes(want));
  if (!row || !row.querySelector('.tab-menu-close')) return { ok:false, have:[...document.querySelectorAll('.tab-section-menu .tab-menu-label')].map(e=>norm(e.textContent)) };
  row.querySelector('.tab-menu-close').click();
  return { ok:true };
})()`;

const confirmVisible = `(() => { const el = document.querySelector('.tab-confirm'); return el ? { text: el.textContent.replace(/\\s+/g,' ').trim() } : null; })()`;

const clickConfirm = (text) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(text)});
  const box = document.querySelector('.tab-confirm');
  if (!box) return { ok:false };
  const btn = [...box.querySelectorAll('button')].find(b => norm(b.textContent).includes(want));
  if (!btn) return { ok:false, have:[...box.querySelectorAll('button')].map(b=>norm(b.textContent)) };
  btn.click();
  return { ok:true };
})()`;

const styleState = `(() => {
  const btn = document.querySelector('.tabbar .tab-section-btn');
  const menu = document.querySelector('.tab-section-menu');
  const dot = document.querySelector('.tab-section-menu .tab-menu-dot');
  const caret = document.querySelector('.tab-section-btn .tab-section-caret');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const b = cs(btn), m = cs(menu), d = cs(dot);
  return {
    btnBg: b?.backgroundColor, btnColor: b?.color,
    menuBg: m?.backgroundColor,
    dotBg: d?.backgroundColor, dotRadius: d?.borderRadius,
    hasCaret: !!caret,
  };
})()`;

const openSidebarSection = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const parent = [...document.querySelectorAll('.sidebar-parent')].find(b => norm(b.textContent).includes(want));
  if (!parent) return { ok:false };
  parent.click();
  return { ok:true };
})()`;

const openSidebarChild = (label) => `(() => {
  ${NORM}
  const want = norm(${JSON.stringify(label)});
  const child = [...document.querySelectorAll('.sidebar-subitem')].find(b => norm(b.textContent).includes(want));
  if (!child) return { ok:false, have:[...document.querySelectorAll('.sidebar-subitem')].map(b=>norm(b.textContent)) };
  child.click();
  return { ok:true };
})()`;

const setQty = (value) => `(() => {
  ${SETVAL}${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return { ok:false, reason:'no pane' };
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('العدد') && l.querySelector('input:not([readonly])'));
  const input = label ? label.querySelector('input:not([readonly])') : null;
  if (!input) return { ok:false };
  setVal(input, ${JSON.stringify(value)});
  return { ok:true, value: input.value };
})()`;

const setMethod = (value) => `(() => {
  ${SETVAL}${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return { ok:false, reason:'no pane' };
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('طريقة التشغيل') && l.querySelector('input'));
  const input = label ? label.querySelector('input') : null;
  if (!input) return { ok:false };
  setVal(input, ${JSON.stringify(value)});
  return { ok:true, placeholder: input.getAttribute('placeholder'), value: input.value };
})()`;

const readMethod = `(() => {
  ${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return null;
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('طريقة التشغيل') && l.querySelector('input'));
  return label ? label.querySelector('input').value : null;
})()`;

const readQty = `(() => {
  ${NORM}
  const pane = document.querySelector('.tab-pane:not([hidden])');
  if (!pane) return null;
  const label = [...pane.querySelectorAll('label')].find(l => norm(l.textContent).includes('العدد') && l.querySelector('input'));
  return label ? label.querySelector('input').value : null;
})()`;

async function openSubpage(cdp, sectionLabel, childLabel) {
  const exists = await evaluate(cdp, openSidebarChild(childLabel));
  if (exists && exists.ok) { await sleep(900); return; }
  await evaluate(cdp, openSidebarSection(sectionLabel));
  await sleep(500);
  await evaluate(cdp, openSidebarChild(childLabel));
  await sleep(900);
}

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  console.log("== 1. open أوردر جديد (under الرئيسية) ==");
  await openSubpage(cdp, "الرئيسية", "اوردر جديد");
  let top = await evaluate(cdp, topState);
  check("one top section tab labeled الرئيسية", top.sections.length === 1 && top.sections[0].label.includes("الرئيسية"), top);
  check("no standalone tab for أوردر جديد", !top.standalone.some(t => t.label.includes("جديد")), top);
  check("الرئيسية contains the active page", top.sections[0]?.containsActive === true, top);
  await evaluate(cdp, openSection("الرئيسية"));
  await sleep(400);
  let rows = await evaluate(cdp, menuRows);
  check("dropdown lists أوردر جديد with a red circle", rows.some(r => r.label.includes("جديد") && r.open), rows);
  check("opened subpage row is highlighted", rows.some(r => r.label.includes("جديد") && r.active), rows);
  await shot(cdp, `${OUT}\\groups-01-new.png`);

  console.log("== 2. طريقة التشغيل placeholder + typed value ==");
  const typed = await evaluate(cdp, setQty("7"));
  check("quantity typed", typed.ok && typed.value === "7", typed);
  const method = await evaluate(cdp, setMethod("صدر شمال"));
  check("طريقة التشغيل placeholder is empty", method.ok && method.placeholder === "", method);
  check("طريقة التشغيل accepts typing", method.ok && method.value === "صدر شمال", method);
  await sleep(400);

  console.log("== 3. open إضافة عميل (same section) ==");
  await openSubpage(cdp, "الرئيسية", "إضافة عميل");
  top = await evaluate(cdp, topState);
  check("still a single الرئيسية top tab", top.sections.filter(s => s.label.includes("الرئيسية")).length === 1, top);
  await evaluate(cdp, openSection("الرئيسية"));
  await sleep(400);
  rows = await evaluate(cdp, menuRows);
  const openRows = rows.filter(r => r.open);
  check("two red circles (أوردر جديد + إضافة عميل)", openRows.length === 2 && openRows.some(r => r.label.includes("جديد")) && openRows.some(r => r.label.includes("إضافة عميل")), rows);
  check("إضافة عميل row is active, أوردر جديد is not", rows.some(r => r.label.includes("إضافة عميل") && r.active) && rows.some(r => r.label.includes("جديد") && !r.active), rows);
  const styles = await evaluate(cdp, styleState);
  check("main-section button is red with white text and an arrow", styles.btnBg === "rgb(237, 21, 37)" && styles.btnColor === "rgb(255, 255, 255)" && styles.hasCaret, styles);
  check("dropdown is white with a red circular dot", styles.menuBg === "rgb(255, 255, 255)" && styles.dotBg === "rgb(237, 21, 37)" && styles.dotRadius === "50%", styles);
  await shot(cdp, `${OUT}\\groups-02-two-open.png`);

  console.log("== 4. switch back to أوردر جديد, data preserved ==");
  await evaluate(cdp, clickRow("جديد"));
  await sleep(900);
  top = await evaluate(cdp, topState);
  const qty = await evaluate(cdp, readQty);
  const methodValue = await evaluate(cdp, readMethod);
  check("dropdown closed after selecting", !(top.sections.find(s => s.label.includes("الرئيسية"))?.open), top);
  check("unsaved quantity preserved after switching", qty === "7", qty);
  check("entered طريقة التشغيل preserved after switching", methodValue === "صدر شمال", methodValue);

  console.log("== 5. تشغيل grouping ==");
  await openSubpage(cdp, "تشغيل", "تشغيل تطريز");
  top = await evaluate(cdp, topState);
  check("تشغيل section tab appears", top.sections.some(s => s.label.includes("تشغيل")), top);
  check("تشغيل contains the active page", top.sections.find(s => s.label.includes("تشغيل"))?.containsActive === true, top);
  await evaluate(cdp, openSection("تشغيل"));
  await sleep(400);
  rows = await evaluate(cdp, menuRows);
  check("تشغيل dropdown shows تشغيل تطريز with a red circle", rows.some(r => r.label.includes("تطريز") && r.open), rows);
  await shot(cdp, `${OUT}\\groups-03-operation.png`);

  console.log("== 6. close one subpage inside the dropdown ==");
  await evaluate(cdp, openSection("الرئيسية"));
  await sleep(400);
  const closed = await evaluate(cdp, closeRow("إضافة عميل"));
  check("clicked close on إضافة عميل", closed.ok, closed);
  await sleep(700);
  rows = await evaluate(cdp, menuRows);
  check("إضافة عميل circle removed", !rows.some(r => r.label.includes("إضافة عميل") && r.open), rows);
  check("أوردر جديد circle remains", rows.some(r => r.label.includes("جديد") && r.open), rows);
  top = await evaluate(cdp, topState);
  check("الرئيسية section still present (other subpage open)", top.sections.some(s => s.label.includes("الرئيسية")), top);
  await shot(cdp, `${OUT}\\groups-04-closed-one.png`);

  console.log("== 7. close the last subpage removes the section ==");
  await evaluate(cdp, openSection("الرئيسية"));
  await sleep(400);
  await evaluate(cdp, closeRow("جديد"));
  await sleep(600);
  const modal = await evaluate(cdp, confirmVisible);
  check("unsaved-changes confirmation shown when closing a dirty subpage", !!modal, modal);
  await evaluate(cdp, clickConfirm("تجاهل"));
  await sleep(800);
  top = await evaluate(cdp, topState);
  check("الرئيسية section removed after its last subpage closes", !top.sections.some(s => s.label.includes("الرئيسية")), top);

  await evaluate(cdp, openSection("تشغيل"));
  await sleep(400);
  await evaluate(cdp, closeRow("تطريز"));
  await sleep(800);
  top = await evaluate(cdp, topState);
  check("تشغيل section removed after its last subpage closes", !top.sections.some(s => s.label.includes("تشغيل")), top);
  await shot(cdp, `${OUT}\\groups-05-empty.png`);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\groups-99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
