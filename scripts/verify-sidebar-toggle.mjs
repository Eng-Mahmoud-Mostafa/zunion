import { launch, connect, evaluate, cleanup } from "./cdp.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:5195";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, cdp;
const check = (name, pass, extra) => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
  if (!pass) process.exitCode = 1;
};
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  const page = (expression) => evaluate(cdp, expression);
  const clickMenuAtScreen = async () => {
    const point = await page(`(() => { const button = [...document.querySelectorAll('.hamburger-btn')].find(x => getComputedStyle(x).display !== 'none' && getComputedStyle(x).visibility !== 'hidden'); const r = button.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), target: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.hamburger-btn') === button }; })()`);
    check("mobile menu receives pointer", point.target, point);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: base });
  await sleep(700);
  const id = await page(`(() => {
    const orders = JSON.parse(localStorage.getItem('zunion-local-orders-v2') || '[]');
    const draft = { ...orders[0], id: 'sidebar-test-draft', order_number: 'DRAFT-SIDEBAR', draft: true, details: '' };
    localStorage.setItem('zunion-local-orders-v2', JSON.stringify([draft]));
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master', expiresAt: new Date(Date.now() + 86400000).toISOString() }));
    return draft.id;
  })()`);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const originalFetch = window.fetch.bind(window); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url.startsWith('/api/')) return new Response(JSON.stringify({ message: 'offline mock' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); return originalFetch(input, init); }; })();` });
  await cdp.send("Page.navigate", { url: `${base}/#draftEdit/${id}` });
  await cdp.send("Page.reload", { ignoreCache: true });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await page(`!!document.querySelector('.nf-card-details textarea')`)) break;
    await sleep(150);
  }
  const state = () => page(`(() => { const side = document.querySelector('.sidebar'); const main = document.querySelector('.content'); const menu = [...document.querySelectorAll('.hamburger-btn')].find(x => getComputedStyle(x).display !== 'none' && getComputedStyle(x).visibility !== 'hidden'); return { open: document.querySelector('.app').classList.contains('sidebar-open'), sideRight: side.getBoundingClientRect().right, sideLeft: side.getBoundingClientRect().left, mainWidth: main.getBoundingClientRect().width, menuVisible: !!menu && menu.getBoundingClientRect().width > 0, menuTop: menu?.getBoundingClientRect().top, menuRight: menu?.getBoundingClientRect().right, hash: location.hash, value: document.querySelector('.nf-card-details textarea')?.value, sectionOpen: document.querySelector('.sidebar-section.open')?.className }; })()`);
  check("desktop sidebar initially open", (await state()).open);
  await page(`(() => { const e = document.querySelector('.nf-card-details textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(e, 'keep form entry'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page(`document.querySelector('.sidebar-toggle')?.click()`);
  const submenuBefore = await page(`document.querySelector('.sidebar-section')?.classList.contains('open')`);
  await page(`document.querySelector('.topbar .hamburger-btn')?.click()`);
  await sleep(350);
  const desktopClosed = await state();
  check("desktop header button closes sidebar", !desktopClosed.open && desktopClosed.sideLeft >= 1440 && desktopClosed.menuVisible, desktopClosed);
  check("desktop content uses freed width", desktopClosed.mainWidth >= 1430, desktopClosed.mainWidth);
  check("desktop form and submenu preserved", desktopClosed.hash.includes('draftEdit') && desktopClosed.value === 'keep form entry' && await page(`document.querySelector('.sidebar-section')?.classList.contains('open') === ${submenuBefore}`));
  await page(`document.querySelector('.topbar .hamburger-btn')?.click()`);
  await sleep(350);
  check("desktop header button reopens sidebar", (await state()).open);
  await page(`document.querySelector('.sidebar-close')?.click()`);
  await sleep(350);
  check("desktop close button closes sidebar", !(await state()).open);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(350);
  const mobileClosed = await state();
  check("mobile closed sidebar leaves content visible", mobileClosed.mainWidth >= 385 && mobileClosed.menuVisible);
  await page(`document.querySelector('.topbar .hamburger-btn')?.click()`);
  await sleep(350);
  const mobileOpen = await state();
  check("mobile header button opens overlay", mobileOpen.open && await page(`getComputedStyle(document.querySelector('.sidebar-overlay')).display !== 'none'`));
  check("mobile submenu remains expanded", await page(`document.querySelector('.sidebar-section')?.classList.contains('open') === ${submenuBefore}`));
  check("mobile menu stays visible", mobileOpen.menuVisible && mobileOpen.menuRight <= 390 && mobileOpen.menuTop >= 0, mobileOpen);
  await clickMenuAtScreen();
  await sleep(350);
  check("mobile header button closes overlay", !(await state()).open);
  await page(`document.querySelector('.topbar .hamburger-btn')?.click()`);
  check("mobile outside area receives overlay", await page(`document.elementFromPoint(20, 200)?.classList.contains('sidebar-overlay')`));
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 20, y: 200, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 20, y: 200, button: "left", clickCount: 1 });
  await sleep(350);
  check("mobile outside tap closes sidebar", !(await state()).open);
  await page(`document.querySelector('.topbar .hamburger-btn')?.click()`);
  await page(`document.querySelector('.sidebar-close')?.click()`);
  await sleep(350);
  check("mobile close button closes sidebar", !(await state()).open);
  check("mobile form entry and page preserved", await page(`location.hash.includes('draftEdit') && document.querySelector('.nf-card-details textarea')?.value === 'keep form entry'`));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child) cleanup(child);
}
