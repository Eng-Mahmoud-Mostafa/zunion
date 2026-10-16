// Focused verification of the إدارة الأطراف popup fix:
//   - rendered through a portal, backdrop covers the whole viewport
//   - centered once on open, then perfectly stationary while typing/editing/
//     saving/refreshing the list and while scrolling it
//   - dragging starts ONLY from an empty area of the title bar
//   - dragging ends on release / blur, and listeners are cleaned on close
//   - width ~640px capped at viewport-32px, no horizontal scrollbar
//   - header + × stay reachable; internal vertical scroll keeps the header
//   - order-form data and the selected طرف survive open/close
//   - no uncaught browser exceptions
import { launch, connect, evaluate, shot, cleanup, drag as mouseDrag } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MASTER = { email: "m@zunion.local", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false };

const SEED = `
(() => {
  try {
    if (!localStorage.getItem('zunion-local-session')) localStorage.setItem('zunion-local-session', JSON.stringify(${JSON.stringify(MASTER)}));
    sessionStorage.setItem('__zpparties', JSON.stringify([
      { id: 'p1', name: '\\u0623\\u062d\\u0645\\u062f', position: 1, active: true },
      { id: 'p2', name: '\\u062d\\u0633\\u0646', position: 2, active: true },
      { id: 'p3', name: '\\u062e\\u0644\\u064a\\u0641\\u0629', position: 3, active: true },
      { id: 'p4', name: '\\u0623\\u062e\\u0631\\u0649', position: 4, active: true }
    ]));
    window.__zerr = [];
    window.addEventListener('error', (e) => window.__zerr.push({ t: 'error', m: String((e && (e.message || e.error)) || '') }));
    window.addEventListener('unhandledrejection', (e) => window.__zerr.push({ t: 'reject', m: String((e && e.reason && e.reason.message) || (e && e.reason) || '') }));
    const ce = console.error.bind(console);
    console.error = (...a) => {
      let m = ''; try { m = a.map((x) => (typeof x === 'string' ? x : (x && x.message) || String(x))).join(' '); } catch {}
      if (/Minified React error|The above error occurred|Cannot read propert|is not a function|undefined is not an object/i.test(m)) window.__zerr.push({ t: 'console', m });
      ce(...a);
    };
    const getStore = () => { try { return JSON.parse(sessionStorage.getItem('__zpparties') || '[]'); } catch { return []; } };
    const setStore = (l) => sessionStorage.setItem('__zpparties', JSON.stringify(l));
    const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (url.indexOf('/api/parties') !== -1) {
        const store = getStore();
        const idMatch = url.match(/\\/api\\/parties\\/([^/?]+)/);
        if (method === 'GET') return Promise.resolve(json({ parties: store }));
        if (method === 'POST') { let b = {}; try { b = JSON.parse(init.body); } catch {} const p = { id: 'p' + Date.now(), name: String(b.name || '').trim(), position: store.length + 1, active: true }; setStore([...store, p]); return Promise.resolve(json({ party: p })); }
        if (method === 'PATCH' && idMatch) { const id = decodeURIComponent(idMatch[1]); let b = {}; try { b = JSON.parse(init.body); } catch {} const next = store.map((p) => p.id === id ? { ...p, ...b } : p); setStore(next); return Promise.resolve(json({ party: next.find((p) => p.id === id) })); }
      }
      if (url.indexOf('/api/uploads') !== -1) return Promise.resolve(json({ url: 'https://cdn.example.com/u.jpg' }));
      if (url.indexOf('/api/') !== -1) return Promise.resolve(json({ message: 'offline mock' }, 503));
      return original(input, init);
    };
  } catch (e) {}
})();
`;

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const HELPERS = `const norm=(s)=>(s||'').replace(/[\\u0623\\u0625\\u0622]/g,'ا').replace(/\\s+/g,' ').trim();
const setVal=(el,v)=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
const findPartySelect=(root)=>{const labels=[...(root||document).querySelectorAll('label')];const l=labels.find(x=>norm(x.textContent).includes('طرف')&&x.querySelector('select'));return l?l.querySelector('select'):null;};
const R=(el)=>{const r=el.getBoundingClientRect();return{left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};};`;

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  await evaluate(cdp, `window.location.hash = '#/new'`);
  await sleep(1600);

  console.log("== 1. open popup from the order form ==");
  const FIELD = `const ins=[...scope.querySelectorAll('input')].filter((i)=>!i.readOnly&&i.type!=='checkbox'&&i.type!=='radio');const el=ins.find((i)=>i.type==='text'||i.type==='number'||i.type==='date'||!i.type);`;
  const probe = await evaluate(cdp, `(() => { ${HELPERS}
    const scope = document.querySelector('.nf-row-order') || document;
    ${FIELD}
    if (el) setVal(el, el.type === 'date' ? '2026-11-20' : 'بيانات تجريبية');
    const sel = findPartySelect(scope);
    setVal(sel, 'أحمد');
    return { found: !!el, field: el ? el.value : null, party: sel ? sel.value : null };
  })()`);
  check("order form has a writable field + party select", probe.found && !!probe.party, probe);

  await evaluate(cdp, `(() => { ${HELPERS} setVal(findPartySelect(document.querySelector('.nf-row-order') || document), 'أخرى'); })()`);
  await sleep(700);

  const snap = await evaluate(cdp, `(() => { ${HELPERS}
    const overlay = document.querySelector('.party-modal-overlay');
    const modal = document.querySelector('.party-modal');
    const head = document.querySelector('.party-modal-head');
    const close = document.querySelector('.party-modal-close');
    const mgr = document.querySelector('.party-manager');
    const wrap = document.querySelector('.party-manager-tablewrap');
    const sel = findPartySelect(document.querySelector('.nf-row-order') || document);
    return {
      open: !!modal,
      overlayParentIsBody: overlay ? overlay.parentElement === document.body : false,
      overlayPos: overlay ? getComputedStyle(overlay).position : null,
      overlayRect: overlay ? R(overlay) : null,
      modalRect: modal ? R(modal) : null,
      headRect: head ? R(head) : null,
      closeRect: close ? R(close) : null,
      vw: window.innerWidth, vh: window.innerHeight,
      mgrScrollW: mgr ? mgr.scrollWidth : null, mgrClientW: mgr ? mgr.clientWidth : null,
      wrapScrollW: wrap ? wrap.scrollWidth : null, wrapClientW: wrap ? wrap.clientWidth : null,
      party: sel ? sel.value : null
    };
  })()`);
  check("popup opened", snap.open, snap);
  check("popup is portaled to document.body", snap.overlayParentIsBody && snap.overlayPos === 'fixed', { parent: snap.overlayParentIsBody, pos: snap.overlayPos });
  check("backdrop covers the whole viewport", snap.overlayRect && snap.overlayRect.left === 0 && snap.overlayRect.top === 0 && near(snap.overlayRect.width, snap.vw, 1) && near(snap.overlayRect.height, snap.vh, 1), { overlay: snap.overlayRect, vw: snap.vw, vh: snap.vh });
  check("width ~640px capped at viewport-32px", near(snap.modalRect.width, Math.min(640, snap.vw - 32), 1), { width: snap.modalRect.width, expected: Math.min(640, snap.vw - 32) });
  check("no horizontal scrollbar in the list", snap.mgrScrollW <= snap.mgrClientW + 1 && snap.wrapScrollW <= snap.wrapClientW + 1, { mgr: [snap.mgrScrollW, snap.mgrClientW], wrap: [snap.wrapScrollW, snap.wrapClientW] });
  check("header + × reachable inside the viewport", snap.headRect.top >= 0 && snap.headRect.top + snap.headRect.height <= snap.vh && snap.closeRect.left >= 0 && snap.closeRect.left + snap.closeRect.width <= snap.vw, { head: snap.headRect, close: snap.closeRect });
  check("selection preserved when opening (أخرى is an action)", snap.party === 'أحمد', { party: snap.party });
  await shot(cdp, `${OUT}\\party-popup-fix.png`);

  const baseHead = snap.headRect;
  const baseModal = snap.modalRect;
  const stationary = async (label) => {
    const r = await evaluate(cdp, `(() => { const m = document.querySelector('.party-modal'); const h = document.querySelector('.party-modal-head'); return { modal: m ? { left: Math.round(m.getBoundingClientRect().left), top: Math.round(m.getBoundingClientRect().top) } : null, head: h ? { left: Math.round(h.getBoundingClientRect().left), top: Math.round(h.getBoundingClientRect().top) } : null }; })()`);
    check(`stationary while ${label}`, r.modal && near(r.modal.left, baseModal.left) && near(r.modal.top, baseModal.top) && near(r.head.left, baseHead.left) && near(r.head.top, baseHead.top), { baseModal: { left: baseModal.left, top: baseModal.top }, nowModal: r.modal, baseHead: { left: baseHead.left, top: baseHead.top }, nowHead: r.head });
  };

  console.log("== 2. window stays put while typing / editing / saving / refreshing ==");
  await evaluate(cdp, `(() => { ${HELPERS} setVal(document.querySelector('.party-manager-toolbar input'), 'مصنع'); })()`);
  await sleep(400);
  await stationary("typing in the add-name field");

  await evaluate(cdp, `document.querySelector('.party-manager-toolbar button').click()`);
  await sleep(900);
  await stationary("adding a party (list refresh)");

  await evaluate(cdp, `(() => { const row = document.querySelector('.party-manager-table tbody tr'); [...row.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل')).click(); })()`);
  await sleep(400);
  await stationary("starting an inline edit");

  await evaluate(cdp, `(() => { ${HELPERS} const row = document.querySelector('.party-manager-table tbody tr'); setVal(row.querySelector('input'), 'مصنع النور'); })()`);
  await sleep(400);
  await stationary("editing the name text");

  await evaluate(cdp, `(() => { const row = document.querySelector('.party-manager-table tbody tr'); [...row.querySelectorAll('button')].find((b) => b.textContent.includes('حفظ')).click(); })()`);
  await sleep(900);
  await stationary("saving the edit");

  console.log("== 3. drag starts only from an empty title-bar area ==");
  const emptyPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouseDrag(cdp, emptyPt, { x: emptyPt.x + 150, y: emptyPt.y + 90 });
  await sleep(300);
  const afterDrag = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("dragging the empty header area moves the window", afterDrag.left > baseModal.left + 80 && afterDrag.top > baseModal.top + 40, { before: { left: baseModal.left, top: baseModal.top }, after: afterDrag });

  const beforeTitle = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  const titlePt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal-head h2').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouseDrag(cdp, titlePt, { x: titlePt.x + 150, y: titlePt.y + 90 });
  await sleep(250);
  const afterTitle = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("dragging the title TEXT does NOT move the window", afterTitle.left === beforeTitle.left && afterTitle.top === beforeTitle.top, { before: beforeTitle, after: afterTitle });

  const btnPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-manager-toolbar button').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouseDrag(cdp, btnPt, { x: btnPt.x + 150, y: btnPt.y + 90 });
  await sleep(250);
  const afterBtn = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("dragging a button does NOT move the window", afterBtn.left === afterTitle.left && afterBtn.top === afterTitle.top, { before: afterTitle, after: afterBtn });

  const rowPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-manager-table tbody tr td').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouseDrag(cdp, rowPt, { x: rowPt.x + 150, y: rowPt.y + 90 });
  await sleep(250);
  const afterRow = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("dragging a table row does NOT move the window", afterRow.left === afterBtn.left && afterRow.top === afterBtn.top, { before: afterBtn, after: afterRow });

  console.log("== 3b. primary button only, and no movement after release ==");
  const rightPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const beforeRight = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rightPt.x, y: rightPt.y, button: "right", clickCount: 1, buttons: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rightPt.x + 160, y: rightPt.y + 90, button: "right", buttons: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rightPt.x + 160, y: rightPt.y + 90, button: "right", clickCount: 1, buttons: 0 });
  await sleep(200);
  const afterRight = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("secondary (right) button does NOT start a drag", afterRight.left === beforeRight.left && afterRight.top === beforeRight.top, { before: beforeRight, after: afterRight });

  const grabPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouseDrag(cdp, grabPt, { x: grabPt.x + 120, y: grabPt.y + 60 });
  await sleep(200);
  const afterRelease = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 50, y: 50 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1550, y: 950 });
  await sleep(200);
  const afterStray = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  check("moving the mouse after release does NOT move the window", afterStray.left === afterRelease.left && afterStray.top === afterRelease.top, { released: afterRelease, afterStray });

  console.log("== 4. internal vertical scroll keeps the header pinned ==");
  const scrollBefore = await evaluate(cdp, `(() => { const m = document.querySelector('.party-modal'); const h = document.querySelector('.party-modal-head'); const mgr = document.querySelector('.party-manager'); mgr.scrollTop = 9999; return { modalTop: Math.round(m.getBoundingClientRect().top), headTop: Math.round(h.getBoundingClientRect().top), scrollTop: mgr.scrollTop, scrollH: mgr.scrollHeight, clientH: mgr.clientHeight }; })()`);
  await sleep(150);
  const scrollAfter = await evaluate(cdp, `(() => { const m = document.querySelector('.party-modal'); const h = document.querySelector('.party-modal-head'); return { modalTop: Math.round(m.getBoundingClientRect().top), headTop: Math.round(h.getBoundingClientRect().top) }; })()`);
  check("list scrolls internally without moving the window/header", scrollBefore.scrollTop > 0 || scrollBefore.scrollH <= scrollBefore.clientH, { scroll: scrollBefore });
  check("header stays put during scroll", scrollAfter.modalTop === scrollBefore.modalTop && scrollAfter.headTop === scrollBefore.headTop, { before: scrollBefore, after: scrollAfter });

  console.log("== 5. drag ends on window blur ==");
  const blurPt = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: blurPt.x, y: blurPt.y, button: "left", clickCount: 1, buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: blurPt.x + 40, y: blurPt.y + 20, button: "left", buttons: 1 });
  await sleep(120);
  await evaluate(cdp, `window.dispatchEvent(new Event('blur'))`);
  const atBlur = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: blurPt.x + 400, y: blurPt.y + 300, button: "left", buttons: 1 });
  await sleep(150);
  const afterBlur = await evaluate(cdp, `(() => { const r = document.querySelector('.party-modal').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: blurPt.x + 400, y: blurPt.y + 300, button: "left", clickCount: 1, buttons: 0 });
  await sleep(150);
  check("window stops following the pointer after blur", afterBlur.left === atBlur.left && afterBlur.top === atBlur.top, { atBlur, afterBlur });

  console.log("== 6. close, reopen → recentered; form data preserved ==");
  const beforeClose = await evaluate(cdp, `(() => { ${HELPERS} const scope = document.querySelector('.nf-row-order') || document; const sel = findPartySelect(scope); ${FIELD} return { party: sel ? sel.value : null, field: el ? el.value : null }; })()`);
  await evaluate(cdp, `document.querySelector('.party-modal-close').click()`);
  await sleep(500);
  const closed = await evaluate(cdp, `!document.querySelector('.party-modal')`);
  check("× closes the popup", closed, closed);
  const afterClose = await evaluate(cdp, `(() => { ${HELPERS} const scope = document.querySelector('.nf-row-order') || document; const sel = findPartySelect(scope); ${FIELD} return { party: sel ? sel.value : null, field: el ? el.value : null }; })()`);
  check("selected طرف preserved after close", afterClose.party === beforeClose.party && afterClose.party === 'أحمد', { before: beforeClose, after: afterClose });
  check("order form data preserved after close", afterClose.field === beforeClose.field && afterClose.field === probe.field && !!probe.field, { expected: probe.field, before: beforeClose.field, after: afterClose.field });

  await evaluate(cdp, `(() => { ${HELPERS} setVal(findPartySelect(document.querySelector('.nf-row-order') || document), 'أخرى'); })()`);
  await sleep(700);
  const reopened = await evaluate(cdp, `(() => { const m = document.querySelector('.party-modal'); if (!m) return null; const r = m.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), centerY: Math.round(r.top + r.height / 2) }; })()`);
  check("reopen works", !!reopened, reopened);
  // The list grew during the test, so the re-centered top legitimately differs;
  // what must hold is that it is centered again (horizontally on the same axis,
  // and vertically centered for its own current height).
  check("reopen is recentered (vertically centered for its size)", reopened && near(reopened.left, baseModal.left, 2) && near(reopened.width, baseModal.width, 2) && near(reopened.centerY, Math.round(snap.vh / 2), 2), { vh: snap.vh, base: { left: baseModal.left, width: baseModal.width }, reopened });

  console.log("== 7. no uncaught browser exceptions ==");
  const errors = await evaluate(cdp, `window.__zerr || []`);
  check("no uncaught exceptions / React errors", Array.isArray(errors) && errors.length === 0, errors);

  await shot(cdp, `${OUT}\\party-popup-fix.png`);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (error) {
  fail++;
  console.log(`\nFAILED with error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try { cdp.close(); } catch {}
  cleanup(child);
  process.exit(fail ? 1 : 0);
}
