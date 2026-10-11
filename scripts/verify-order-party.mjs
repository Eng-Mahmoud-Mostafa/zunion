// Verifies the restored طرف field in the أوردر جديد form.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  await evaluate(cdp, `(() => {
    const session = { email: 'mahmoud@zunion.local', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false };
    localStorage.setItem('zunion-local-session', JSON.stringify(session));
    return true;
  })()`);
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3500);

  const nav = await evaluate(cdp, `(() => {
    const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').trim();
    const b = [...document.querySelectorAll('.action-card, .sidebar-item, .sidebar-subitem, .sidebar-parent-nav, button, a')]
      .find(el => norm(el.textContent) === 'اوردر جديد');
    if (b) { b.click(); return { found: true, cls: b.className }; }
    const diag = {
      stillLogin: !!document.querySelector('input[type="password"]'),
      sidebarItems: [...document.querySelectorAll('.sidebar-item, .sidebar-subitem, .sidebar-parent-nav')].map(e => (e.textContent||'').trim().slice(0,20)),
      bodyStart: document.body.innerText.slice(0, 300),
    };
    return { found: false, diag };
  })()`);
  console.log("nav to new order:", JSON.stringify(nav));
  await sleep(2000);
  await shot(cdp, `${OUT}\\party-01-form.png`);

  const inspect = await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    if (!row) return { found: false };
    const labels = [...row.querySelectorAll(':scope > label')].map(l => {
      const span = l.querySelector('span');
      const r = l.getBoundingClientRect();
      const input = l.querySelector('select, input');
      return {
        label: span ? span.textContent.replace(/\\s+/g,' ').trim() : '',
        tag: input ? input.tagName : '',
        value: input ? input.value : '',
        w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y),
      };
    });
    const target = [...row.querySelectorAll(':scope > label')].find(l => l.querySelector('span') && l.querySelector('span').textContent.trim() === 'طرف');
    let options = [];
    let customInput = null;
    if (target) {
      const sel = target.querySelector('select');
      options = sel ? [...sel.options].map(o => ({ v: o.value, t: o.textContent.trim() })) : [];
      customInput = !!target.querySelector('input');
    }
    return {
      found: true,
      rowColumns: getComputedStyle(row).gridTemplateColumns,
      labels,
      hasParty: !!target,
      options,
      customInputVisible: customInput,
    };
  })()`);
  console.log("FORM INSPECT:\n" + JSON.stringify(inspect, null, 2));

  // select "other" to reveal custom input
  const custom = await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    const target = [...row.querySelectorAll(':scope > label')].find(l => l.querySelector('span') && l.querySelector('span').textContent.trim() === 'طرف');
    if (!target) return { ok: false };
    const sel = target.querySelector('select');
    sel.value = 'other';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await sleep(800);
  const customState = await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    const target = [...row.querySelectorAll(':scope > label')].find(l => l.querySelector('span') && l.querySelector('span').textContent.trim() === 'طرف');
    const input = target ? target.querySelector('input') : null;
    if (!input) return { customInputVisible: false };
    input.value = 'طرف مخصص تجريبي';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { customInputVisible: true, placeholder: input.placeholder, value: input.value };
  })()`);
  console.log("custom select:", JSON.stringify(custom), "state:", JSON.stringify(customState));
  await shot(cdp, `${OUT}\\party-02-custom.png`);

  // check for clipping / overlap within the field
  const layout = await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    const labels = [...row.querySelectorAll(':scope > label')];
    return {
      rowWidth: Math.round(row.getBoundingClientRect().width),
      children: labels.length,
      clipped: labels.map(l => {
        const need = l.scrollWidth, have = l.clientWidth;
        return need > have + 1 ? { label: (l.querySelector('span')||{}).textContent, need, have } : null;
      }).filter(Boolean),
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  console.log("LAYOUT:\n" + JSON.stringify(layout, null, 2));
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\party-99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
