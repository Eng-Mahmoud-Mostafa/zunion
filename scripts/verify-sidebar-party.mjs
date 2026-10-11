// Definitive check: navigate strictly via the SIDEBAR (expand الرئيسية -> اوردر جديد)
// and inspect the طرف dropdown's live geometry + computed visibility + options.
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
  await sleep(3000);
  await evaluate(cdp, `(() => { localStorage.setItem('zunion-local-session', JSON.stringify({ email:'mahmoud@zunion.local', username:'mahmoud', fullName:'Mahmoud', role:'Master', expiresAt:new Date(Date.now()+86400000).toISOString(), loggedInAt:new Date().toISOString(), mustChangePassword:false })); return true; })()`);
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(3000);

  const nav = await evaluate(cdp, `(() => {
    const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();
    const parent = [...document.querySelectorAll('.sidebar-parent')].find(el => norm(el.textContent).includes('الرئيسية'));
    if (parent) parent.click();
    return { expanded: !!parent };
  })()`);
  await sleep(900);
  const click = await evaluate(cdp, `(() => {
    const norm = (s) => (s || '').replace(/[\\u0623\\u0625\\u0622]/g, 'ا').replace(/\\s+/g,' ').trim();
    const item = [...document.querySelectorAll('.sidebar-subitem')].find(el => norm(el.textContent) === 'اوردر جديد');
    if (!item) return { found: false };
    item.click();
    return { found: true };
  })()`);
  console.log("SIDEBAR NAV:", JSON.stringify(nav), JSON.stringify(click));
  await sleep(2000);
  await shot(cdp, `${OUT}\\sidebar-party-form.png`);

  const inspect = await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    const heading = (document.querySelector('.nf-card-order h3') || {}).textContent;
    if (!row) return { foundRow: false, heading };
    const target = [...row.querySelectorAll(':scope > label')].find(l => (l.querySelector('span')||{}).textContent && l.querySelector('span').textContent.trim() === 'طرف');
    let result = { foundRow: true, heading, hasParty: !!target };
    if (target) {
      const sel = target.querySelector('select');
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      const csSel = getComputedStyle(sel);
      result = {
        ...result,
        labelText: target.querySelector('span').textContent.trim(),
        tag: sel.tagName,
        options: [...sel.options].map(o => o.textContent.trim()),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        fieldDisplay: cs.display, fieldVisibility: cs.visibility, fieldOpacity: cs.opacity,
        selectHeight: Math.round(sel.getBoundingClientRect().height),
        selectColor: csSel.color, selectBg: csSel.backgroundColor,
        visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.y < window.innerHeight && r.y + r.height > 0 && r.x < window.innerWidth && r.x + r.width > 0,
      };
      // position relative to siblings
      const labels = [...row.querySelectorAll(':scope > label')];
      const names = labels.map(l => (l.querySelector('span')||{}).textContent && l.querySelector('span').textContent.trim());
      result.index = names.indexOf('طرف');
      result.order = names;
    }
    return result;
  })()`);
  console.log("INSPECT:\n" + JSON.stringify(inspect, null, 2));

  // Open the dropdown so all options are visibly rendered, then screenshot.
  await evaluate(cdp, `(() => {
    const row = document.querySelector('.nf-row-order');
    const t = [...row.querySelectorAll(':scope > label')].find(l => (l.querySelector('span')||{}).textContent && l.querySelector('span').textContent.trim() === 'طرف');
    const sel = t.querySelector('select');
    sel.size = 6;
    sel.focus();
    return true;
  })()`);
  await sleep(400);
  await shot(cdp, `${OUT}\\sidebar-party-open.png`);
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\sidebar-party-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
