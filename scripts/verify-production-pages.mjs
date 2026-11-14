import { launch, connect, evaluate, cleanup } from "./cdp.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:5195";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, pass) => { console.log(`${pass ? "PASS" : "FAIL"} ${name}`); if (!pass) process.exitCode = 1; };
let child, cdp;
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  const page = (expression) => evaluate(cdp, expression);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    if (!sessionStorage.getItem('production-test-seed')) {
      sessionStorage.setItem('production-test-seed', '1');
      localStorage.setItem('zunion-local-session', JSON.stringify({ email: 'mahmoudmostafa3104@gmail.com', username: 'mahmoud', fullName: 'Mahmoud', role: 'Master', expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      const rows = ['sewing', 'printing'].flatMap(stage => [
        { id: stage + '-existing', order_number: stage + '-1', type: stage === 'sewing' ? 'خياطه' : 'طباعه', work_stage: 'operation', draft: false, status: 'SENT_TO_WORKER', [stage + '_status']: 'done', customer_name_snapshot: 'عميل الاختبار', delivery_date: '2026-11-20' },
        { id: stage + '-fail', order_number: stage + '-2', type: stage === 'sewing' ? 'خياطه' : 'طباعه', work_stage: 'operation', draft: false, status: 'SENT_TO_WORKER', [stage + '_status']: '', customer_name_snapshot: 'عميل الاختبار', delivery_date: '2026-11-20' },
        { id: stage + '-transferred', order_number: stage + '-3', type: stage === 'sewing' ? 'خياطه' : 'طباعه', work_stage: 'finishing', draft: false, status: 'WORKER_DONE', customer_name_snapshot: 'عميل الاختبار', delivery_date: '2026-11-20' }
      ]);
      localStorage.setItem('production-test-orders', JSON.stringify(rows));
      localStorage.setItem('production-test-calls', JSON.stringify({}));
    }
    const realFetch = window.fetch.bind(window);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init?.method || 'GET').toUpperCase();
      if (url === '/api/notifications') return reply({ notifications: [], unreadCount: 0 });
      if (url.startsWith('/api/orders?') && method === 'GET') {
        const rows = JSON.parse(localStorage.getItem('production-test-orders') || '[]');
        const params = new URL(url, location.origin).searchParams;
        const type = params.get('type');
        const workStage = params.get('workStage');
        return reply({ orders: rows.filter(row => (!type || row.type === type) && (!workStage || row.work_stage === workStage)) });
      }
      if (url.endsWith('/complete-production') && method === 'PATCH') {
        const id = url.split('/')[3];
        const stage = JSON.parse(init.body).stage;
        const calls = JSON.parse(localStorage.getItem('production-test-calls') || '{}');
        calls[id] = (calls[id] || 0) + 1;
        localStorage.setItem('production-test-calls', JSON.stringify(calls));
        if (id.endsWith('-fail') && calls[id] === 1) return reply({ message: 'فشل النقل' }, 503);
        const rows = JSON.parse(localStorage.getItem('production-test-orders') || '[]');
        const row = rows.find(item => item.id === id);
        if (row && row.work_stage !== 'finishing') Object.assign(row, { work_stage: 'finishing', status: 'WORKER_DONE', [stage + '_status']: 'done' });
        localStorage.setItem('production-test-orders', JSON.stringify(rows));
        return reply({ ok: true, order: row });
      }
      if (url.startsWith('/api/')) return reply({ message: 'offline mock' }, 503);
      return realFetch(input, init);
    };
  })();` });

  for (const [stage, hash] of [["sewing", "sewing"], ["printing", "print"]]) {
    await cdp.send("Page.navigate", { url: `${base}/#${hash}` });
    for (let i = 0; i < 30; i++) {
      if (await page(`!!document.querySelector('[data-order-row-id="${stage}-existing"]')`)) break;
      await sleep(200);
    }
    check(`${stage}: existing done row has Finish action`, await page(`document.querySelector('[data-order-row-id="${stage}-existing"] .ws-hd-end')?.textContent.trim() === 'إنهاء'`));
    check(`${stage}: transferred row excluded`, await page(`!document.querySelector('[data-order-row-id="${stage}-transferred"]')`));
    await page(`document.querySelector('[data-order-row-id="${stage}-existing"] .ws-hd-end')?.click()`);
    await sleep(250);
    check(`${stage}: successful transfer removes row and stays on page`, await page(`!document.querySelector('[data-order-row-id="${stage}-existing"]') && location.hash === '#${hash}' && document.body.textContent.includes('تم إنهاء التشغيل وتحويل الأوردر إلى التشطيب بنجاح')`));
    await page(`document.querySelector('[data-order-row-id="${stage}-fail"] .ws-hd-end')?.click()`);
    await sleep(250);
    check(`${stage}: failed transfer keeps row and shows Arabic error`, await page(`!!document.querySelector('[data-order-row-id="${stage}-fail"]') && document.querySelector('[data-order-row-id="${stage}-fail"] .ws-error')?.textContent.includes('تعذر نقل الأوردر')`));
    await page(`document.querySelector('[data-order-row-id="${stage}-fail"] .ws-hd-end')?.click(); document.querySelector('[data-order-row-id="${stage}-fail"] .ws-hd-end')?.click()`);
    await sleep(250);
    check(`${stage}: retry and double click transfer once`, await page(`!document.querySelector('[data-order-row-id="${stage}-fail"]') && JSON.parse(localStorage.getItem('production-test-calls'))['${stage}-fail'] === 2`));
    await cdp.send("Page.navigate", { url: `${base}/#finish` });
    for (let i = 0; i < 25; i++) {
      if (await page(`!!document.querySelector('[data-order-row-id="${stage}-existing"]')`)) break;
      await sleep(200);
    }
    check(`${stage}: transferred order appears in finishing`, await page(`!!document.querySelector('[data-order-row-id="${stage}-existing"]')`));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (child) cleanup(child);
}
