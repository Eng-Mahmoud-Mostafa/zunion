import { launch, connect, evaluate, cleanup } from "./cdp.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:5195";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, cdp;
const check = (name, pass) => { console.log(`${pass ? "PASS" : "FAIL"} ${name}`); if (!pass) process.exitCode = 1; };
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  const page = (expression) => evaluate(cdp, expression);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    if (!sessionStorage.getItem('notification-seed')) {
      sessionStorage.setItem('notification-seed', '1');
      localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master', expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      localStorage.setItem('notification-fixtures', JSON.stringify([
        { id: 'n1', kind: 'operation', title: 'أوردر جديد في التشغيل', body: 'الأوردر 100 جاهز للتشغيل', target_kind: 'operation', target_id: 'o1', created_at: new Date().toISOString(), read_at: null },
        { id: 'n2', kind: 'finance', title: 'دفعة عميل جديدة', body: 'تم تسجيل دفعة', target_kind: 'finance', target_id: 'p1', created_at: new Date().toISOString(), read_at: null }
      ]));
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init?.method || 'GET').toUpperCase();
      const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/notifications' && method === 'GET') {
        const notifications = JSON.parse(localStorage.getItem('notification-fixtures') || '[]');
        return response({ notifications, unreadCount: notifications.filter(n => !n.read_at).length });
      }
      if (url === '/api/notifications/read-all' && method === 'PATCH') {
        const notifications = JSON.parse(localStorage.getItem('notification-fixtures') || '[]');
        notifications.forEach(n => n.read_at = new Date().toISOString());
        localStorage.setItem('notification-fixtures', JSON.stringify(notifications));
        return response({ ok: true });
      }
      if (url.startsWith('/api/notifications/') && method === 'PATCH') {
        const id = url.split('/')[3];
        const notifications = JSON.parse(localStorage.getItem('notification-fixtures') || '[]');
        const notification = notifications.find(n => n.id === id);
        if (notification) notification.read_at = new Date().toISOString();
        localStorage.setItem('notification-fixtures', JSON.stringify(notifications));
        return response({ ok: true });
      }
      if (url.startsWith('/api/')) return new Response(JSON.stringify({ message: 'offline mock' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      return originalFetch(input, init);
    };
  })();` });
  await cdp.send("Page.navigate", { url: base });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await page(`!!document.querySelector('.topbar-bell')`)) break;
    await sleep(150);
  }
  check("unread count appears on bell", await page(`document.querySelector('.topbar-notification-count')?.textContent === '2'`));
  await page(`document.querySelector('.topbar-bell')?.click()`);
  check("Arabic notification panel opens", await page(`document.querySelector('.notification-panel')?.getAttribute('dir') === 'rtl' && document.querySelector('.notification-panel h2')?.textContent.includes('الإشعارات')`));
  check("recent alerts appear", await page(`document.querySelectorAll('.notification-item').length === 2`));
  await page(`document.querySelector('.notification-panel-head button')?.click()`);
  await sleep(150);
  check("mark all read clears count", await page(`!document.querySelector('.topbar-notification-count') && document.querySelectorAll('.notification-item.unread').length === 0`));
  await page(`document.querySelector('.notification-item')?.click()`);
  await sleep(150);
  check("clicking alert opens queue", await page(`location.hash === '#worker' && !document.querySelector('.notification-panel')`));
  await page(`localStorage.setItem('notification-fixtures', '[]')`);
  await page(`document.querySelector('.topbar-bell')?.click()`);
  await sleep(150);
  check("empty state appears", await page(`document.querySelector('.notification-empty')?.textContent === 'لا توجد إشعارات'`));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  check("mobile panel fits viewport", await page(`(() => { const r = document.querySelector('.notification-panel')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child) cleanup(child);
}
