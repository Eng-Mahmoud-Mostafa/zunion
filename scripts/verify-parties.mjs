// Verifies the centrally-managedطرف (parties) feature end-to-end against the
// built dist. The app runs in server-auth mode, so the backend is mocked via
// fetch interception: /api/parties is a stateful in-session store; all other
// /api/* endpoints fail so the app keeps its local cache. Checks settings
// management (add/rename/deactivate), persistence across reload, propagation
// into the order + customer dropdowns, and the rename cascade on a customer.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = `
(() => {
  try {
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false }));
    if (!sessionStorage.getItem('__zparties')) {
      sessionStorage.setItem('__zparties', JSON.stringify([
        { id: 'p1', name: '\\u0623\\u062d\\u0645\\u062f', position: 1, active: true },
        { id: 'p2', name: '\\u062d\\u0633\\u0646', position: 2, active: true },
        { id: 'p3', name: '\\u062e\\u0644\\u064a\\u0641\\u0629', position: 3, active: true },
        { id: 'p4', name: '\\u0623\\u062e\\u0631\\u0649', position: 4, active: true }
      ]));
    }
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

const SETVAL = `const setVal = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };`;

const clickByText = (text, selectors = "button, a, .action-card, .settings-nav-item, .sidebar-item, .sidebar-subitem, .sidebar-parent-nav") => `(() => {
  const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();
  const target = norm(${JSON.stringify(text)});
  const all = [...document.querySelectorAll(${JSON.stringify(selectors)})];
  let el = all.find(e => norm(e.textContent) === target);
  if (!el) el = all.find(e => norm(e.textContent).includes(target));
  if (!el) return { clicked: false, have: all.map(e => norm(e.textContent).slice(0,25)) };
  el.click();
  return { clicked: true, cls: el.className, text: norm(el.textContent).slice(0, 40) };
})()`;

const partiesCardRows = `(() => {
  const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
  if (!card) return { found: false };
  const rows = [...card.querySelectorAll('tbody tr')].map(tr => ({
    name: tr.querySelector('input')?.value ?? tr.querySelector('strong')?.textContent?.trim(),
    status: tr.querySelector('.badge')?.textContent?.trim(),
    editing: !!tr.querySelector('input'),
  }));
  return { found: true, rows };
})()`;

const findRow = (name) => `(() => {
  const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
  if (!card) return null;
  return [...card.querySelectorAll('tbody tr')].find(tr => {
    const strong = tr.querySelector('strong'); const inp = tr.querySelector('input');
    return (strong && strong.textContent.trim() === ${JSON.stringify(name)}) || (inp && inp.value === ${JSON.stringify(name)});
  }) || null;
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

  console.log("== 1. create a customer bound to a party ==");
  await evaluate(cdp, `window.location.hash = '#/addCustomer'`);
  await sleep(1500);
  const addCustomer = await evaluate(cdp, `(() => {
    ${SETVAL}
    const norm = (s) => (s || '').replace(/\\s+/g,' ').trim();
    const labels = [...document.querySelectorAll('label')];
    const partyLabel = labels.find(l => norm(l.textContent).includes('طرف') && l.querySelector('select'));
    const nameInput = labels.find(l => norm(l.textContent).includes('اسم') && l.querySelector('input'))?.querySelector('input');
    if (!partyLabel || !nameInput) return { ok: false, labels: labels.map(l => norm(l.textContent).slice(0,30)) };
    const sel = partyLabel.querySelector('select');
    setVal(sel, 'أخرى');
    setVal(nameInput, 'عميل اختبار الطرف');
    return { ok: true, party: sel.value, name: nameInput.value, options: [...sel.options].map(o => o.textContent.trim()) };
  })()`);
  check("add-customer nav + form", addCustomer.ok, addCustomer);
  check("customer party select lists default parties", addCustomer.options && addCustomer.options.includes('أخرى') && addCustomer.options.includes('أحمد'), addCustomer.options);
  await evaluate(cdp, clickByText("حفظ العميل"));
  await sleep(1200);
  await shot(cdp, `${OUT}\\parties-01-customer.png`);

  console.log("== 2. open settings > إدارة الأطراف ==");
  const setNav = await evaluate(cdp, clickByText("الإعدادات"));
  await sleep(1600);
  const openParties = await evaluate(cdp, clickByText("إدارة الأطراف", ".settings-nav-item"));
  await sleep(1000);
  check("parties section opened", setNav.clicked && openParties.clicked, { setNav, openParties });
  await shot(cdp, `${OUT}\\parties-02-section.png`);

  const initial = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    if (!card) return { found: false };
    return { found: true, rows: [...card.querySelectorAll('tbody tr')].map(tr => tr.querySelector('strong')?.textContent?.trim() || (tr.querySelector('input')||{}).value) };
  })()`);
  check("default parties listed (4)", initial.found && initial.rows.length === 4, initial);

  console.log("== 3. add a party ==");
  await evaluate(cdp, `(() => {
    ${SETVAL}
    const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const input = card.querySelector('.settings-toolbar input');
    const btn = [...card.querySelectorAll('button')].find(b => (b.textContent||'').includes('إضافة طرف'));
    setVal(input, 'مصنع النور');
    btn.click();
  })()`);
  await sleep(1000);
  const afterAdd = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    return { rows: [...card.querySelectorAll('tbody tr')].map(tr => tr.querySelector('strong')?.textContent?.trim() || (tr.querySelector('input')||{}).value), notice: document.querySelector('.settings-alert')?.textContent || '' };
  })()`);
  check("party added", afterAdd.rows.includes('مصنع النور'), afterAdd);

  console.log("== 4. rename أخرى -> متفرقات ==");
  await evaluate(cdp, `(() => { const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const row = [...card.querySelectorAll('tbody tr')].find(tr => tr.querySelector('strong')?.textContent?.trim() === 'أخرى');
    [...row.querySelectorAll('button')].find(b => (b.textContent||'').includes('تعديل')).click(); })()`);
  await sleep(600);
  await evaluate(cdp, `(() => { const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const row = [...card.querySelectorAll('tbody tr')].find(tr => tr.querySelector('input') && tr.querySelector('input').value === 'أخرى');
    ${SETVAL}
    setVal(row.querySelector('input'), 'متفرقات');
    [...row.querySelectorAll('button')].find(b => (b.textContent||'').includes('حفظ')).click(); })()`);
  await sleep(1000);
  const afterRename = await evaluate(cdp, `(() => { const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    return { rows: [...card.querySelectorAll('tbody tr')].map(tr => tr.querySelector('strong')?.textContent?.trim() || (tr.querySelector('input')||{}).value) }; })()`);
  check("party renamed", afterRename.rows.includes('متفرقات') && !afterRename.rows.includes('أخرى'), afterRename);

  console.log("== 5. deactivate حسن ==");
  await evaluate(cdp, `(() => { const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const row = [...card.querySelectorAll('tbody tr')].find(tr => tr.querySelector('strong')?.textContent?.trim() === 'حسن');
    [...row.querySelectorAll('button')].find(b => (b.textContent||'').includes('إيقاف')).click(); })()`);
  await sleep(1000);
  const afterDeactivate = await evaluate(cdp, `(() => { const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const row = [...card.querySelectorAll('tbody tr')].find(tr => tr.querySelector('strong')?.textContent?.trim() === 'حسن');
    return { status: row ? row.querySelector('.badge')?.textContent?.trim() : null }; })()`);
  check("party deactivated", !!afterDeactivate.status && afterDeactivate.status !== 'مفعل', afterDeactivate);
  await shot(cdp, `${OUT}\\parties-03-managed.png`);

  console.log("== 5b. duplicate + empty validation ==");
  const dup = await evaluate(cdp, `(() => {
    ${SETVAL}
    const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    const input = card.querySelector('.settings-toolbar input');
    setVal(input, 'مصنع النور');
    [...card.querySelectorAll('button')].find(b => (b.textContent||'').includes('إضافة طرف')).click();
    return true;
  })()`);
  await sleep(700);
  const dupNotice = await evaluate(cdp, `document.querySelector('.settings-alert')?.textContent || ''`);
  check("duplicate party rejected", dupNotice.includes('موجود'), dupNotice);

  console.log("== 6. dropdown propagation (اوردر جديد) ==");
  await evaluate(cdp, `window.location.hash = '#/new'`);
  await sleep(1600);
  const orderParty = await evaluate(cdp, `(() => {
    const labels = [...document.querySelectorAll('.nf-row-order > label')];
    const target = labels.find(l => (l.querySelector('span')||{}).textContent?.trim() === 'طرف');
    if (!target) return { found: false, labels: labels.map(l => (l.querySelector('span')||{}).textContent) };
    const sel = target.querySelector('select');
    return { found: true, value: sel.value, options: [...sel.options].map(o => o.textContent.trim()) };
  })()`);
  check("order party select shows active parties", orderParty.found && orderParty.options.includes('مصنع النور') && orderParty.options.includes('متفرقات') && !orderParty.options.includes('حسن'), orderParty);
  await shot(cdp, `${OUT}\\parties-04-order-dropdown.png`);

  console.log("== 7. persistence after reload ==");
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(3500);
  await evaluate(cdp, clickByText("الإعدادات"));
  await sleep(1600);
  await evaluate(cdp, clickByText("إدارة الأطراف", ".settings-nav-item"));
  await sleep(1000);
  const persisted = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.settings-card')].find(c => (c.querySelector('h2')||{}).textContent === 'إدارة الأطراف');
    return [...card.querySelectorAll('tbody tr')].map(tr => ({ name: tr.querySelector('strong')?.textContent?.trim() || (tr.querySelector('input')||{}).value, status: tr.querySelector('.badge')?.textContent?.trim() }));
  })()`);
  check("added party persisted", persisted.some(r => r.name === 'مصنع النور'), persisted);
  check("rename persisted", persisted.some(r => r.name === 'متفرقات') && !persisted.some(r => r.name === 'أخرى'), persisted);
  check("deactivation persisted", persisted.find(r => r.name === 'حسن')?.status !== 'مفعل', persisted);

  console.log("== 8. cascade rename onto customer ==");
  await evaluate(cdp, `window.location.hash = '#/customers'`);
  await sleep(1600);
  const accounts = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.accounts-table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    return { rows };
  })()`);
  const customerRow = accounts.rows.find(r => r.some(c => c === 'عميل اختبار الطرف'));
  check("renamed party cascaded to customer", !!customerRow && customerRow.includes('متفرقات'), { accounts: accounts.rows, nav: dup });
  await shot(cdp, `${OUT}\\parties-05-accounts.png`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\parties-99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
