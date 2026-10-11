// End-to-end check for the "حفظ مؤقت" (drafts) flow + send-to-production behaviour.
// Seeds one normal order + one draft, mocks the backend API via fetch interception,
// then drives the real UI with CDP.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DRAFT_ID = "seed-draft-1";
const DRAFT_NUM = "26-6-8-900001";
const NORMAL_ID = "seed-normal-1";
const NORMAL_NUM = "26-6-8-900002";

const SEED = `
(() => {
  try {
    const now = new Date().toISOString();
    const op = [{ method: "صدر", logoImage: "https://cdn.example.com/logo.jpg", workOrderImage: "https://cdn.example.com/work.jpg", logoFileName: "logo.jpg", workOrderFileName: "work.jpg", logoImageSource: "url", workOrderImageSource: "url" }];
    const base = {
      id: "", created_by: "mahmoud", order_number: "", source_person: "أحمد",
      client_name: "", client_code: "", phone: "", delivery_date: "2026-12-31",
      price: 50, quantity: 3, total: 150, paid: 0, remaining: 150, old_balance: 0, net_balance: 150,
      order_type: "تطريز", productId: "", productName: "", paymentMethod: "cash",
      customPaymentMethod: "", customParty: "", materialsStatus: "available", machineName: "",
      worker_name: "", sewing_worker: "", sewing_status: "", printing_worker: "", printing_status: "",
      finishing_worker: "", operationWorkers: [], operationSupervisors: [],
      operationMethods: ["صدر"], operationItems: op,
      operationAttachments: [], logoFileName: "", workOrderFileName: "",
      details: "", logo_place: "", items: [], logo_status: "موجود",
      logo_image_url: "", work_order_image_url: "", quality_notes: "", damaged_pieces: 0,
      operation_status: "not_started", finishing_status: "not_started", production_notes: "",
      finishing_notes: "", draft: true, order_status: "جديد", workStage: "new",
      workflow_stage: "أوردر جديد", client_message: "", notes: "", internal_notes: "",
      created_at: now, updated_at: now, completedAt: ""
    };
    const draft = { ...base, id: "${DRAFT_ID}", order_number: "${DRAFT_NUM}", client_name: "عميل مسودة", client_code: "901" };
    const normal = { ...base, id: "${NORMAL_ID}", order_number: "${NORMAL_NUM}", client_name: "عميل عادي", client_code: "902", draft: false, order_status: "جديد", workStage: "new" };
    const seedKey = "__zunion_seed_done";
    if (!sessionStorage.getItem(seedKey)) {
      sessionStorage.setItem(seedKey, "1");
      localStorage.setItem("zunion-local-session", JSON.stringify({ email: "mahmoudmostafa3104@gmail.com", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      localStorage.setItem("zunion-local-orders-v2", JSON.stringify([normal, draft]));
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
      if (url.indexOf("/api/orders") !== -1) {
        if (method === "GET") return json({ message: "offline mock" }, 503);
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) {}
        return json({ id: body.id || "srv-id", order_number: body.order_number || "" }, 200);
      }
      if (url.indexOf("/api/uploads") !== -1) return json({ url: "https://cdn.example.com/uploaded.jpg" }, 200);
      if (url.indexOf("/api/") !== -1) return json({ message: "offline mock" }, 503);
      return originalFetch(input, init);
    };
  } catch (e) {}
})();
`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`);
}

const pageText = `document.querySelector('.page') ? document.querySelector('.page').innerText : document.body.innerText`;

let cdp, child;
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  const ev = (expr) => evaluate(cdp, expr);
  const clickSubitem = (label) => ev(`(() => {
    const btns = [...document.querySelectorAll('.sidebar-subitem')];
    const b = btns.find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const countOccurrences = (num) => ev(`((t) => t.split(${JSON.stringify(num)}).length - 1)(${pageText})`);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(2500);

  // Expand الرئيسية and inspect submenu ordering.
  await ev(`(() => { const p = [...document.querySelectorAll('.sidebar-parent')].find((x) => x.textContent.includes('الرئيسية')); if (p) p.click(); return !!p; })()`);
  await sleep(400);
  const submenu = await ev(`(() => {
    const items = [...document.querySelectorAll('.sidebar-submenu .sidebar-subitem')].map((b) => b.textContent.trim());
    return items;
  })()`);
  check("sidebar has حفظ مؤقت right after اوردر جديد", submenu.indexOf("حفظ مؤقت") !== -1 && submenu.indexOf("حفظ مؤقت") === submenu.indexOf("اوردر جديد") + 1, submenu);
  await shot(cdp, `${OUT}\\drafts-sidebar.png`);

  // متابعة أوردرات must NOT show the draft.
  await clickSubitem("متابعة أوردرات");
  await sleep(600);
  const ordersHasDraft = await countOccurrences(DRAFT_NUM);
  const ordersHasNormal = await countOccurrences(NORMAL_NUM);
  check("draft excluded from متابعة أوردرات", ordersHasDraft === 0, { occurrences: ordersHasDraft });
  check("normal order visible in متابعة أوردرات", ordersHasNormal >= 1, { occurrences: ordersHasNormal });

  // حفظ مؤقت page lists the draft with the required columns.
  await clickSubitem("حفظ مؤقت");
  await sleep(600);
  const draftsInfo = await ev(`(() => {
    const table = document.querySelector('.drafts-table');
    if (!table) return { hasTable: false };
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim());
    const resumeBtn = [...document.querySelectorAll('.drafts-table button')].map((b) => b.textContent.trim());
    return { hasTable: true, headers, rows, resumeBtn };
  })()`);
  check("drafts page shows draft", draftsInfo.hasTable && draftsInfo.rows.some((r) => r.includes(DRAFT_NUM)), draftsInfo.rows);
  check("drafts page has required columns", draftsInfo.headers && ["رقم الأوردر", "اسم العميل", "نوع الأوردر", "آخر حفظ"].every((h) => draftsInfo.headers.includes(h)), draftsInfo.headers);
  check("drafts page has استكمال الأوردر button", draftsInfo.resumeBtn && draftsInfo.resumeBtn.includes("استكمال الأوردر"), draftsInfo.resumeBtn);
  await shot(cdp, `${OUT}\\drafts-page.png`);

  // Resume the draft.
  await ev(`(() => { const b = [...document.querySelectorAll('.drafts-table button')].find((x) => x.textContent.trim() === 'استكمال الأوردر'); if (b) b.click(); return !!b; })()`);
  await sleep(700);
  const resumeInfo = await ev(`(() => {
    const h3 = document.querySelector('.order-form h3');
    const form = document.querySelector('.order-form');
    const btns = [...document.querySelectorAll('.nf-actionbar button')].map((b) => b.textContent.trim());
    return { heading: h3 ? h3.textContent.trim() : null, readonly: form ? form.classList.contains('nf-readonly') : null, actionBtns: btns };
  })()`);
  check("resume opens editable form with correct heading", resumeInfo.heading && resumeInfo.heading.includes("استكمال الأوردر") && resumeInfo.heading.includes(DRAFT_NUM) && resumeInfo.readonly === false, resumeInfo);
  check("resume form shows حفظ مؤقت + اذهب للتشغيل", resumeInfo.actionBtns.includes("حفظ مؤقت") && resumeInfo.actionBtns.includes("اذهب للتشغيل"), resumeInfo.actionBtns);
  await shot(cdp, `${OUT}\\draft-resume.png`);

  // Send to production.
  await ev(`(() => { const b = [...document.querySelectorAll('.nf-actionbar button')].find((x) => x.textContent.trim() === 'اذهب للتشغيل'); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
  const afterSend = await ev(`(() => {
    const h3 = document.querySelector('.order-form h3');
    const banner = [...document.querySelectorAll('.created-order-panel h2')].map((h) => h.textContent.trim());
    const err = [...document.querySelectorAll('.field-error')].map((e) => e.textContent.trim());
    return { heading: h3 ? h3.textContent.trim() : null, banner, err };
  })()`);
  check("after send stayed on أوردر جديد", afterSend.heading === "أوردر جديد", afterSend.heading);
  check("success banner shown", afterSend.banner.some((b) => b.includes("تم حفظ الأوردر وإرساله للتشغيل بنجاح")), afterSend.banner);
  await shot(cdp, `${OUT}\\draft-sent.png`);

  // Draft removed from drafts page.
  await clickSubitem("حفظ مؤقت");
  await sleep(500);
  const draftStillThere = await countOccurrences(DRAFT_NUM);
  check("draft removed from حفظ مؤقت after send", draftStillThere === 0, { occurrences: draftStillThere });

  // Now appears once in متابعة أوردرات.
  await clickSubitem("متابعة أوردرات");
  await sleep(500);
  const sentInOrders = await countOccurrences(DRAFT_NUM);
  check("sent order appears exactly once in متابعة أوردرات", sentInOrders === 1, { occurrences: sentInOrders });

  // Appears in تشغيل تطريز (worker) local spread.
  await ev(`window.location.hash = '#/worker'`);
  await sleep(700);
  const inWorker = await countOccurrences(DRAFT_NUM);
  check("sent order appears in تشغيل تطريز", inWorker >= 1, { occurrences: inWorker });

  // Refresh and ensure no duplicates.
  await ev(`window.location.hash = '#/orders'`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  const afterReloadOrders = await countOccurrences(DRAFT_NUM);
  const afterReloadDraftList = await (async () => { await clickSubitem("حفظ مؤقت"); await sleep(500); return countOccurrences(DRAFT_NUM); })();
  check("no duplicate after refresh (متابعة أوردرات)", afterReloadOrders === 1, { occurrences: afterReloadOrders });
  check("draft still absent after refresh (حفظ مؤقت)", afterReloadDraftList === 0, { occurrences: afterReloadDraftList });
  await shot(cdp, `${OUT}\\drafts-after-reload.png`);

  const failed = results.filter((r) => !r.pass);
  console.log("\nSUMMARY: " + (results.length - failed.length) + "/" + results.length + " passed");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err && err.message ? err.message : err);
  try { await shot(cdp, `${OUT}\\drafts-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (child) cleanup(child);
}
