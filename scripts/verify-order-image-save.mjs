// Verifies the image preview never hangs on "جارٍ التحميل":
//  - a valid (data URL) image renders (has-image)
//  - a broken image (local /api/photos that 503s) shows "تعذر تحميل الصورة" + retry
//  - pasting an image resolves the preview
// Mocks /api/* via fetch interception (images load through the browser network directly).
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC";
const BROKEN = "http://127.0.0.1:5195/api/photos/does-not-exist";

const SEED = `
(() => {
  try {
    window.alert = function () { window.__lastAlert = arguments[0]; };
    const now = new Date().toISOString();
    const mk2 = (id, num, workImg) => ({
      id, created_by: "mahmoud", order_number: num, source_person: "أحمد",
      client_name: "عميل صور", client_code: "905", phone: "", delivery_date: "2026-12-31",
      price: 50, quantity: 3, total: 150, paid: 0, remaining: 150, old_balance: 0, net_balance: 150,
      order_type: "تطريز", productId: "", productName: "", paymentMethod: "cash",
      customPaymentMethod: "", customParty: "", materialsStatus: "available", machineName: "",
      worker_name: "", sewing_worker: "", sewing_status: "", printing_worker: "", printing_status: "",
      finishing_worker: "", operationWorkers: [], operationSupervisors: [],
      operationMethods: ["صدر"],
      operationItems: [{ method: "صدر", logoImage: ${JSON.stringify(PNG)}, workOrderImage: workImg, logoFileName: "logo.png", workOrderFileName: "work.png", logoImageSource: "url", workOrderImageSource: "url" }],
      operationAttachments: [], logoFileName: "", workOrderFileName: "",
      details: "", logo_place: "", items: [], logo_status: "موجود",
      logo_image_url: "", work_order_image_url: "", quality_notes: "", damaged_pieces: 0,
      operation_status: "not_started", finishing_status: "not_started", production_notes: "",
      finishing_notes: "", draft: true, order_status: "جديد", workStage: "new",
      workflow_stage: "أوردر جديد", client_message: "", notes: "", internal_notes: "",
      created_at: now, updated_at: now, completedAt: ""
    });
    const broken = mk2("img-broken", "26-6-8-910001", ${JSON.stringify(BROKEN)});
    const ok = mk2("img-ok", "26-6-8-910002", ${JSON.stringify(PNG)});
    const seedKey = "__zunion_img_seed";
    if (!sessionStorage.getItem(seedKey)) {
      sessionStorage.setItem(seedKey, "1");
      localStorage.setItem("zunion-local-session", JSON.stringify({ email: "mahmoudmostafa3104@gmail.com", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString() }));
      localStorage.setItem("zunion-local-orders-v2", JSON.stringify([broken, ok]));
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });
      if (url.indexOf("/api/orders") !== -1) return json({ message: "offline" }, 503);
      if (url.indexOf("/api/uploads") !== -1) return json({ url: "https://cdn.example.com/uploaded.jpg" }, 200);
      if (url.indexOf("/api/") !== -1) return json({ message: "offline" }, 503);
      return originalFetch(input, init);
    };
  } catch (e) {}
})();
`;

const results = [];
const check = (name, cond, extra) => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); };

const watchdog = setTimeout(() => { console.log("WATCHDOG: forcing exit after 90s"); process.exit(1); }, 90000);
watchdog.unref?.();

let cdp, child, page;
try {
  const launched = await launch();
  child = launched.child;
  cdp = await connect(launched.target.webSocketDebuggerUrl);
  page = (expr) => evaluate(cdp, expr);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(2500);

  const clickSubitem = (label) => page(`(() => { const b = [...document.querySelectorAll('.sidebar-subitem')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return !!b; })()`);
  const resumeDraft = (num) => page(`(() => {
    const rows = [...document.querySelectorAll('.drafts-table tbody tr')];
    const row = rows.find((r) => r.innerText.includes(${JSON.stringify(num)}));
    if (!row) return false;
    const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === 'استكمال الأوردر');
    if (!b) return false; b.click(); return true;
  })()`);
  const imgState = () => page(`(() => {
    const thumbs = [...document.querySelectorAll('.operation-card-images .attachment-thumb, .image-clipboard-field .attachment-thumb')];
    return thumbs.map((t) => ({
      cls: t.className,
      loading: !!t.querySelector('.attachment-loading'),
      retry: t.querySelector('.attachment-retry') ? t.querySelector('.attachment-retry').innerText.trim() : null,
      hasImg: !!t.querySelector('img'),
    }));
  })()`);

  await page(`(() => { const p = [...document.querySelectorAll('.sidebar-parent')].find((x) => x.textContent.includes('الرئيسية')); if (p) p.click(); return !!p; })()`);
  await sleep(400);

  // ---- Paste flow: a pasted image resolves its preview (no stuck spinner) ----
  await clickSubitem("اوردر جديد");
  await sleep(900);
  await page(`(() => { const f = document.querySelector('.operation-card-images .image-clipboard-field') || document.querySelector('.image-clipboard-field'); if (f) f.click(); return !!f; })()`);
  await sleep(500);
  const pasteResult = await page(`(() => {
    const PNG = ${JSON.stringify(PNG)};
    const field = document.querySelector('.operation-card-images .image-clipboard-field') || document.querySelector('.image-clipboard-field');
    if (!field) return 'nofield';
    const bin = atob(PNG.split(',')[1]);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'paste.png', { type: 'image/png' }));
    field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    return 'ok';
  })()`);
  await sleep(2500);
  const pasted = await imgState();
  check("pasted image preview loads (not stuck on جارٍ التحميل)", pasteResult === "ok" && pasted.some((s) => (s.cls || "").includes("has-image")) && pasted.every((s) => !s.loading), { pasteResult, pasted });
  await shot(cdp, `${OUT}\\img-paste.png`);

  // ---- Broken image: resumes to error/retry, never stuck on loading ----
  await clickSubitem("حفظ مؤقت");
  await sleep(600);
  await resumeDraft("26-6-8-910001");
  await sleep(6000); // allow probe + timeout window to resolve
  const broken = await imgState();
  check("broken image shows retry (تعذر تحميل الصورة)", broken.some((s) => s.retry && s.retry.includes("تعذر تحميل الصورة")), broken);
  check("broken image not stuck on جارٍ التحميل", broken.some((s) => s.loading) === false || broken.every((s) => !s.loading), broken);
  check("valid logo data URL loads (has-image present)", broken.some((s) => (s.cls || "").includes("has-image")), broken);
  await shot(cdp, `${OUT}\\img-broken.png`);

  // ---- Valid image: loads ----
  await page(`window.location.hash = '#/drafts'`);
  await sleep(600);
  await clickSubitem("حفظ مؤقت");
  await sleep(500);
  await resumeDraft("26-6-8-910002");
  await sleep(2000);
  const okState = await imgState();
  check("valid image loads (has-image, no spinner)", okState.some((s) => (s.cls || "").includes("has-image")) && okState.every((s) => !s.loading), okState);
  await shot(cdp, `${OUT}\\img-ok.png`);

  const failed = results.filter((r) => !r.pass);
  console.log("\nSUMMARY: " + (results.length - failed.length) + "/" + results.length + " passed");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err && err.message ? err.message : err);
  try { await shot(cdp, `${OUT}\\img-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (child) cleanup(child);
}
