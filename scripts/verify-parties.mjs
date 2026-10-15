// End-to-end verification of the centrally-managed طرف (parties) interaction.
// Runs against the built dist in server-auth mode with the backend mocked via
// fetch interception: /api/parties is a stateful in-session store (Master-only
// writes), all other /api/* endpoints fail so the app keeps its local cache.
//
// Covers the exact requested flow:
//   Master:  أوردر جديد → طرف → أخرى  opens the draggable "إدارة الأطراف" popup
//            (أخرى is an action, selection is preserved), add a name, confirm it
//            shows up in إضافة عميل → طرف.
//   Normal:  sees the new name but no أخرى and no way to manage.
import { launch, connect, evaluate, shot, cleanup, drag as mouseDrag } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MASTER = { email: "mahmoudmostafa3104@gmail.com", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false };
const NORMAL = { email: "omar@zunion.local", username: "omar", fullName: "Omar", role: "Operator", expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false };

const SEED = `
(() => {
  try {
    if (!localStorage.getItem('zunion-local-session')) localStorage.setItem('zunion-local-session', JSON.stringify(${JSON.stringify(MASTER)}));
    if (!sessionStorage.getItem('__zparties')) {
      sessionStorage.setItem('__zparties', JSON.stringify([
        { id: 'p1', name: '\\u0623\\u062d\\u0645\\u062f', position: 1, active: true },
        { id: 'p2', name: '\\u062d\\u0633\\u0646', position: 2, active: true },
        { id: 'p3', name: '\\u062e\\u0644\\u064a\\u0641\\u0629', position: 3, active: true },
        { id: 'p4', name: '\\u0623\\u062e\\u0631\\u0649', position: 4, active: true }
      ]));
    }
    window.__zpartySetSession = (s) => localStorage.setItem('zunion-local-session', JSON.stringify(s));
    const getStore = () => { try { return JSON.parse(sessionStorage.getItem('__zparties') || '[]'); } catch { return []; } };
    const setStore = (list) => sessionStorage.setItem('__zparties', JSON.stringify(list));
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (url.indexOf('/api/parties') !== -1) {
        const store = getStore();
        const idMatch = url.match(/\\/api\\/parties\\/([^/?]+)/);
        if (method === 'GET') return Promise.resolve(json({ parties: store }));
        if (method === 'POST') {
          let body = {}; try { body = JSON.parse(init.body); } catch {}
          const party = { id: 'p' + Date.now(), name: String(body.name || '').trim(), position: store.length + 1, active: true };
          setStore([...store, party]);
          return Promise.resolve(json({ party }));
        }
        if (method === 'PATCH' && idMatch) {
          const id = decodeURIComponent(idMatch[1]);
          let body = {}; try { body = JSON.parse(init.body); } catch {}
          const next = store.map((p) => p.id === id ? { ...p, ...body } : p);
          setStore(next);
          return Promise.resolve(json({ party: next.find((p) => p.id === id) }));
        }
      }
      if (url.indexOf('/api/uploads') !== -1) return Promise.resolve(json({ url: 'https://cdn.example.com/uploaded.jpg' }));
      if (url.indexOf('/api/') !== -1) return Promise.resolve(json({ message: 'offline mock' }, 503));
      return original(input, init);
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

const HELPERS = `const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();
const setVal = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const findPartySelect = (root) => { const labels = [...(root || document).querySelectorAll('label')]; const l = labels.find(x => norm(x.textContent).includes('طرف') && x.querySelector('select')); return l ? l.querySelector('select') : null; };`;

const readOptions = (scope) => `(() => {
  ${HELPERS}
  const sel = findPartySelect(${scope});
  if (!sel) return { found: false };
  return { found: true, value: sel.value, options: [...sel.options].map(o => ({ text: o.textContent.trim(), value: o.value, disabled: o.disabled })) };
})()`;

const ORDER_SCOPE = `document.querySelector('.nf-row-order') || document`;
const CUSTOMER_SCOPE = `document.querySelector('.add-product-form') || document`;

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  console.log("== A1. Master · أوردر جديد → طرف · أخرى is the final option ==");
  await evaluate(cdp, `window.location.hash = '#/new'`);
  await sleep(1600);
  const masterOptions = await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${ORDER_SCOPE}); if (!sel) return { found: false }; return { found: true, value: sel.value, options: [...sel.options].map(o => ({ text: o.textContent.trim(), value: o.value })) }; })()`);
  const optValues = (masterOptions.options || []).map((o) => o.value);
  check("party dropdown found in order form", masterOptions.found, masterOptions);
  check("master dropdown lists active names", masterOptions.found && optValues.includes('أحمد') && optValues.includes('خليفة'), optValues);
  check("master dropdown ends with أخرى (action)", masterOptions.found && optValues[optValues.length - 1] === 'أخرى', optValues);
  const valueBefore = masterOptions.value;

  console.log("== A2. choose أخرى → draggable إدارة الأطراف popup opens, selection preserved ==");
  await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${ORDER_SCOPE}); setVal(sel, 'أخرى'); })()`);
  await sleep(700);
  const popup = await evaluate(cdp, `(() => {
    ${HELPERS}
    const modal = document.querySelector('.party-modal');
    const head = modal ? modal.querySelector('.party-modal-head h2') : null;
    const sel = findPartySelect(${ORDER_SCOPE});
    const cs = modal ? getComputedStyle(modal) : null;
    return {
      open: !!modal,
      title: head ? head.textContent.trim() : null,
      hasClose: !!document.querySelector('.party-modal-close'),
      value: sel ? sel.value : null,
      bg: cs ? cs.backgroundColor : null,
      border: cs ? cs.borderTopColor : null,
      headers: modal ? [...modal.querySelectorAll('.party-manager-table thead th')].map(th => th.textContent.trim()) : [],
      directions: modal ? [...modal.querySelectorAll('.party-manager-toolbar button')].map(b => b.textContent.trim()) : [],
    };
  })()`);
  check("popup titled إدارة الأطراف with × close", popup.open && popup.title === 'إدارة الأطراف' && popup.hasClose, popup);
  check("أخرى is an action: previous selection preserved", popup.value === masterOptions.value && popup.value !== 'أخرى', { before: masterOptions.value, after: popup.value });
  check("popup table columns الاسم/الحالة/الإجراءات", JSON.stringify(popup.headers) === JSON.stringify(['الاسم', 'الحالة', 'الإجراءات']), popup.headers);
  check("popup shows إضافة طرف", popup.directions.some((b) => b.includes('إضافة طرف')), popup.directions);
  check("white window + thin red border", popup.bg === 'rgb(255, 255, 255)' && /rgb\(237, 21, 37\)/.test(popup.border || ''), { bg: popup.bg, border: popup.border });
  await shot(cdp, `${OUT}\\parties-popup.png`);

  console.log("== A2b. the popup is draggable ==");
  const handle = await evaluate(cdp, `(() => {
    const head = document.querySelector('.party-modal-head');
    const modal = document.querySelector('.party-modal');
    if (!head || !modal) return null;
    const rect = head.getBoundingClientRect();
    return { x: Math.round(rect.left + 30), y: Math.round(rect.top + 12), left: Math.round(modal.getBoundingClientRect().left) };
  })()`);
  await mouseDrag(cdp, { x: handle.x, y: handle.y }, { x: handle.x + 180, y: handle.y + 80 });
  await sleep(300);
  const movedLeft = await evaluate(cdp, `Math.round(document.querySelector('.party-modal').getBoundingClientRect().left)`);
  check("popup is draggable", typeof movedLeft === "number" && movedLeft > handle.left + 100, { before: handle.left, after: movedLeft });

  console.log("== A2c. add a party from the popup ==");
  await evaluate(cdp, `(() => {
    ${HELPERS}
    const modal = document.querySelector('.party-modal');
    const input = modal.querySelector('.party-manager-toolbar input');
    setVal(input, 'مصنع النور');
    [...modal.querySelectorAll('.party-manager-toolbar button')].find(b => b.textContent.includes('إضافة طرف')).click();
  })()`);
  await sleep(900);
  const afterAdd = await evaluate(cdp, `(() => {
    const modal = document.querySelector('.party-modal');
    return [...modal.querySelectorAll('.party-manager-table tbody tr')].map(tr => ({ name: tr.querySelector('.party-manager-name')?.textContent?.trim(), status: tr.querySelector('.party-status')?.textContent?.trim() }));
  })()`);
  check("party added via popup", afterAdd.some(r => r.name === 'مصنع النور'), afterAdd);
  await shot(cdp, `${OUT}\\parties-popup.png`);

  console.log("== A3. rename + إيقاف inside the popup ==");
  await evaluate(cdp, `(() => { const modal = document.querySelector('.party-modal'); const row = [...modal.querySelectorAll('.party-manager-table tbody tr')].find(tr => tr.querySelector('.party-manager-name')?.textContent?.trim() === 'حسن'); [...row.querySelectorAll('button')].find(b => b.textContent.includes('تعديل')).click(); })()`);
  await sleep(500);
  await evaluate(cdp, `(() => {
    ${HELPERS}
    const modal = document.querySelector('.party-modal');
    const row = [...modal.querySelectorAll('.party-manager-table tbody tr')].find(tr => tr.querySelector('input') && tr.querySelector('input').value === 'حسن');
    setVal(row.querySelector('input'), 'حسن علي');
    [...row.querySelectorAll('button')].find(b => b.textContent.includes('حفظ')).click();
  })()`);
  await sleep(900);
  const renamed = await evaluate(cdp, `(() => { const modal = document.querySelector('.party-modal'); return [...modal.querySelectorAll('.party-manager-table tbody tr')].map(tr => tr.querySelector('.party-manager-name')?.textContent?.trim()); })()`);
  check("party renamed via popup", renamed.includes('حسن علي') && !renamed.includes('حسن'), renamed);

  await evaluate(cdp, `(() => { const modal = document.querySelector('.party-modal'); const row = [...modal.querySelectorAll('.party-manager-table tbody tr')].find(tr => tr.querySelector('.party-manager-name')?.textContent?.trim() === 'حسن علي'); [...row.querySelectorAll('button')].find(b => b.textContent.includes('إيقاف')).click(); })()`);
  await sleep(900);
  const toggled = await evaluate(cdp, `(() => { const modal = document.querySelector('.party-modal'); const row = [...modal.querySelectorAll('.party-manager-table tbody tr')].find(tr => tr.querySelector('.party-manager-name')?.textContent?.trim() === 'حسن علي'); return row ? row.querySelector('.party-status')?.textContent?.trim() : null; })()`);
  check("party toggled to موقوف", toggled === 'موقوف', toggled);

  console.log("== A4. × closes the popup, preserves the selection, updates options ==");
  await evaluate(cdp, `document.querySelector('.party-modal-close').click()`);
  await sleep(500);
  const afterClose = await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${ORDER_SCOPE}); return { closed: !document.querySelector('.party-modal'), value: sel ? sel.value : null, options: [...sel.options].map(o => o.value) }; })()`);
  check("× closes the popup", afterClose.closed, afterClose);
  check("selection preserved after close", afterClose.value === masterOptions.value, { before: masterOptions.value, after: afterClose.value });
  check("new name propagated without clearing the form", afterClose.options.includes('مصنع النور') && !afterClose.options.includes('حسن علي'), afterClose.options);

  console.log("== A5. إضافة عميل → طرف shares the same list (Master) ==");
  await evaluate(cdp, `window.location.hash = '#/addCustomer'`);
  await sleep(1600);
  const custMaster = await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${CUSTOMER_SCOPE}); if (!sel) return { found: false }; return { found: true, options: [...sel.options].map(o => o.value) }; })()`);
  check("add-customer dropdown uses shared list", custMaster.found && custMaster.options.includes('مصنع النور') && custMaster.options.includes('أحمد'), custMaster.options);
  check("inactive name unavailable for new selections", custMaster.found && !custMaster.options.includes('حسن علي'), custMaster.options);
  await shot(cdp, `${OUT}\\parties-addcustomer.png`);

  console.log("== B. Normal user: sees the new name, no أخرى, no management ==");
  await evaluate(cdp, `window.__zpartySetSession(${JSON.stringify(NORMAL)})`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(3500);
  await evaluate(cdp, `window.location.hash = '#/new'`);
  await sleep(1600);
  const normalOrder = await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${ORDER_SCOPE}); if (!sel) return { found: false }; return { found: true, options: [...sel.options].map(o => o.value) }; })()`);
  check("normal order dropdown shows the shared/new names", normalOrder.found && normalOrder.options.includes('مصنع النور') && normalOrder.options.includes('أحمد'), normalOrder.options);
  check("normal order dropdown hides أخرى", normalOrder.found && !normalOrder.options.includes('أخرى'), normalOrder.options);

  await evaluate(cdp, `window.location.hash = '#/addCustomer'`);
  await sleep(1600);
  const normalCust = await evaluate(cdp, `(() => { ${HELPERS} const sel = findPartySelect(${CUSTOMER_SCOPE}); if (!sel) return { found: false }; return { found: true, options: [...sel.options].map(o => o.value) }; })()`);
  check("normal add-customer dropdown shares list", normalCust.found && normalCust.options.includes('مصنع النور'), normalCust.options);
  check("normal add-customer dropdown hides أخرى", normalCust.found && !normalCust.options.includes('أخرى'), normalCust.options);
  await shot(cdp, `${OUT}\\parties-normal.png`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  fail++;
  console.log(`\nFAILED with error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try { cdp.close(); } catch {}
  cleanup(child);
  process.exit(fail ? 1 : 0);
}
