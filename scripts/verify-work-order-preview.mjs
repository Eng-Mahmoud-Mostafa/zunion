import { launch, connect, evaluate, cleanup } from "./cdp.mjs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.BASE_URL || "http://127.0.0.1:5195";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, cdp;
const downloads = mkdtempSync(join(tmpdir(), "zunion-preview-download-"));
const check = (name, pass) => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass) process.exitCode = 1;
};
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  const page = (expression) => evaluate(cdp, expression);
  await cdp.send("Page.navigate", { url: base });
  await sleep(1200);
  const orderId = await page(`(() => {
    const orders = JSON.parse(localStorage.getItem('zunion-local-orders-v2') || '[]');
    if (!orders.length) return null;
    const order = orders[0];
    order.operationItems = [{ method: 'test', workOrderImage: '/zunion-logo.png', workOrderFileName: 'work.png', logoImage: '' }];
    orders[0] = order;
    localStorage.setItem('zunion-local-orders-v2', JSON.stringify(orders));
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'test@example.com', username: 'mahmoud', fullName: 'Test', role: 'Master', expiresAt: new Date(Date.now() + 86400000).toISOString() }));
    return order.id;
  })()`);
  if (!orderId) throw new Error("No demo order available");
  await cdp.send("Page.navigate", { url: `${base}/#editOrder/${encodeURIComponent(orderId)}` });
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(1700);
  for (const [label, width, height, mobile] of [["desktop", 1400, 900, false], ["mobile", 390, 844, true]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await sleep(200);
    const details = await page(`!!document.querySelector('.odv-attachments')`);
    check(`${label} order details`, details);
    const scrollBefore = await page(`(() => { window.scrollTo(0, 250); return scrollY; })()`);
    const open = await page(`(() => { const b = document.querySelector('.odv-attach-actions button'); b?.click(); return !!b; })()`);
    check(`${label} show button and preview`, open && await page(`!!document.querySelector('.odv-preview-window')`));
    check(`${label} original source`, await page(`document.querySelector('.odv-preview-stage img')?.getAttribute('src') === '/zunion-logo.png'`));
    const clickControl = (text) => page(`(() => { const b = [...document.querySelectorAll('.odv-preview-controls button')].find(x => x.textContent === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);
    await clickControl("تكبير");
    check(`${label} maximize`, await page(`!!document.querySelector('.odv-preview-window.maximized')`));
    await clickControl("استعادة الحجم");
    check(`${label} restore`, await page(`!!document.querySelector('.odv-preview-window:not(.maximized)')`));
    await clickControl("تصغير");
    check(`${label} minimize`, await page(`!!document.querySelector('.odv-preview-bar') && !document.querySelector('.odv-preview-window')`));
    await page(`document.querySelector('.odv-preview-bar')?.click()`);
    check(`${label} reopen`, await page(`!!document.querySelector('.odv-preview-window')`));
    await clickControl("إغلاق");
    check(`${label} close on same order`, await page(`!document.querySelector('.odv-preview-window') && !!document.querySelector('.odv-attachments')`));
    check(`${label} scroll preserved`, await page(`scrollY`) === scrollBefore);
    check(`${label} download action`, await page(`document.querySelector('.odv-attach-actions a')?.getAttribute('download') === 'work.png'`));
    await page(`document.querySelector('.odv-attach-actions a')?.click()`);
    await sleep(300);
    check(`${label} download completed`, readdirSync(downloads).some((name) => name.startsWith("work")));
    await page(`document.querySelector('.odv-attach-card .attachment-thumb img')?.click()`);
    check(`${label} thumbnail opens`, await page(`!!document.querySelector('.odv-preview-window')`));
    check(`${label} controls fit viewport`, await page(`(() => { const r = document.querySelector('.odv-preview-toolbar')?.getBoundingClientRect(); return !!r && r.right <= innerWidth && r.left >= 0 && r.bottom <= innerHeight; })()`));
    await clickControl("إغلاق");
  }
  await page(`(() => { const orders = JSON.parse(localStorage.getItem('zunion-local-orders-v2') || '[]'); orders[0].operationItems = []; localStorage.setItem('zunion-local-orders-v2', JSON.stringify(orders)); })()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(1200);
  check("no attachment message", await page(`[...document.querySelectorAll('.odv-empty')].some(x => x.textContent === 'لا يوجد مرفق')`));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child) cleanup(child);
  rmSync(downloads, { recursive: true, force: true });
}
