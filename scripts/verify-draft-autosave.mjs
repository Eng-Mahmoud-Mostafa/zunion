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
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: base });
  await sleep(800);
  const id = await page(`(() => {
    const orders = JSON.parse(localStorage.getItem('zunion-local-orders-v2') || '[]');
    const draft = { ...orders[0], id: 'autosave-draft', order_number: 'DRAFT-100', draft: true, details: '', client_name: '', operationItems: [{ method: '', logoImage: '', workOrderImage: '/zunion-logo.png' }] };
    localStorage.setItem('zunion-local-orders-v2', JSON.stringify([draft]));
    localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master', expiresAt: new Date(Date.now() + 86400000).toISOString() }));
    return draft.id;
  })()`);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init?.method || 'GET').toUpperCase();
      if (url.includes('/api/orders') && method !== 'GET') {
        if (sessionStorage.getItem('draft-fail') === '1') return new Response(JSON.stringify({ message: 'offline mock' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        const log = JSON.parse(sessionStorage.getItem('draft-writes') || '[]');
        log.push({ url, method, body: JSON.parse(init.body) });
        sessionStorage.setItem('draft-writes', JSON.stringify(log));
        return new Response(JSON.stringify({ id: 'autosave-draft', order_number: 'DRAFT-100' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/uploads')) return new Response(JSON.stringify({ url: '/zunion-logo.png' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/api/')) return new Response(JSON.stringify({ message: 'offline mock' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      return originalFetch(input, init);
    };
  })();` });
  await cdp.send("Page.navigate", { url: `${base}/#draftEdit/${id}` });
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(1100);
  check("existing incomplete draft opened", await page(`!!document.querySelector('.nf-card-details textarea')`));
  await page(`(() => { const e = document.querySelector('.nf-card-details textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(e, 'autosaved immediately'); e.dispatchEvent(new Event('input', { bubbles: true })); const nav = [...document.querySelectorAll('.sidebar-subitem')].find(x => x.textContent.trim() === 'حفظ مؤقت'); nav?.click(); })()`);
  await sleep(1300);
  const state = await page(`({ hash: location.hash, popup: !!document.querySelector('.tab-confirm'), writes: JSON.parse(sessionStorage.getItem('draft-writes') || '[]'), orders: JSON.parse(localStorage.getItem('zunion-local-orders-v2') || '[]') })`);
  check("navigated without unsaved popup", state.hash === "#drafts" && !state.popup, state.hash);
  check("updated existing draft only", state.writes.length === 1 && state.writes[0].method === "PUT" && state.writes[0].url.endsWith(id), state.writes.map((x) => [x.method, x.url]));
  check("draft number and status retained", state.orders.length === 1 && state.orders[0].order_number === "DRAFT-100" && state.orders[0].draft === true);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  await page(`document.querySelector('.drafts-row-actions button')?.click()`);
  await sleep(500);
  check("latest edits survive refresh", await page(`document.querySelector('.nf-card-details textarea')?.value === 'autosaved immediately'`));
  check("attachment survives refresh", await page(`!!document.querySelector('.image-clipboard-field .attachment-thumb img')`));
  await page(`(() => { const e = document.querySelector('.nf-card-details textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(e, 'autosaved in background'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1600);
  check("background autosave updates same record", await page(`(() => { const writes = JSON.parse(sessionStorage.getItem('draft-writes') || '[]'); return writes.length === 2 && writes[1].method === 'PUT' && writes[1].url.endsWith('autosave-draft'); })()`));
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  check("background save survives refresh", await page(`document.querySelector('.nf-card-details textarea')?.value === 'autosaved in background'`));
  await page(`(() => { sessionStorage.setItem('draft-fail', '1'); const e = document.querySelector('.nf-card-details textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(e, 'retry this edit'); e.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('.sidebar-subitem')].find(x => x.textContent.trim() === 'حفظ مؤقت')?.click(); })()`);
  await sleep(1700);
  check("failed save keeps draft open", await page(`location.hash.includes('draftEdit') && document.querySelector('.nf-card-details textarea')?.value === 'retry this edit'`));
  check("failed save shows retry", await page(`!!document.querySelector('.draft-autosave-error button')`));
  await page(`(() => { sessionStorage.removeItem('draft-fail'); document.querySelector('.draft-autosave-error button')?.click(); })()`);
  await sleep(800);
  check("retry completes navigation", await page(`location.hash === '#drafts'`));
  await page(`document.querySelector('.drafts-row-actions button')?.click()`);
  await sleep(350);
  const beforeNoChange = await page(`JSON.parse(sessionStorage.getItem('draft-writes') || '[]').length`);
  await page(`[...document.querySelectorAll('.sidebar-subitem')].find(x => x.textContent.trim() === 'حفظ مؤقت')?.click()`);
  await sleep(350);
  check("unchanged draft navigates without another save", await page(`location.hash === '#drafts' && JSON.parse(sessionStorage.getItem('draft-writes') || '[]').length === ${beforeNoChange}`));
  await page(`document.querySelector('.drafts-row-actions button')?.click()`);
  await sleep(350);
  await page(`(() => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'new-work.png', { type: 'image/png' }));
    const field = [...document.querySelectorAll('.image-clipboard-field')].find(x => x.textContent.includes('أمر الشغل'));
    field?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    [...document.querySelectorAll('.sidebar-subitem')].find(x => x.textContent.trim() === 'حفظ مؤقت')?.click();
  })()`);
  await sleep(1600);
  check("pending attachment saved before navigation", await page(`(() => { const writes = JSON.parse(sessionStorage.getItem('draft-writes') || '[]'); return location.hash === '#drafts' && writes.at(-1)?.method === 'PUT'; })()`));
  check("attachment URL sent to database", await page(`(() => { const writes = JSON.parse(sessionStorage.getItem('draft-writes') || '[]'); return writes.at(-1)?.body?.operation_attachments?.some(x => x.workOrderUrl === '/zunion-logo.png'); })()`));
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(700);
  await page(`document.querySelector('.drafts-row-actions button')?.click()`);
  await sleep(350);
  check("new attachment survives refresh", await page(`document.querySelector('.image-clipboard-field .image-file-meta')?.textContent.includes('new-work.png')`));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child) cleanup(child);
}
