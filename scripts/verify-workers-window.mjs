// Opens the real workers management window in Chrome and measures the rendered
// layout, then verifies header dragging actually moves it.
import { launch, connect, evaluate, shot, click, drag, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const VIEWPORT = { w: 1600, h: 1000 };

const log = (...a) => console.log(...a);

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  log(`viewport: ${VIEWPORT.w}x${VIEWPORT.h}`);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.w, height: VIEWPORT.h, deviceScaleFactor: 1, mobile: false,
  });

  log(`navigating to ${BASE} ...`);
  await cdp.send("Page.navigate", { url: BASE });
  await new Promise((r) => setTimeout(r, 4000));

  // ---- log in: seed the browser-only session directly, then reload ----
  const seeded = await evaluate(cdp, `(() => {
    const session = {
      email: 'mahmoud@zunion.local',
      username: 'mahmoud',
      fullName: 'Mahmoud',
      role: 'Master',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      loggedInAt: new Date().toISOString(),
      mustChangePassword: false,
    };
    localStorage.setItem('zunion-local-session', JSON.stringify(session));
    return !!localStorage.getItem('zunion-local-session');
  })()`);
  log("session seeded:", JSON.stringify(seeded));

  await cdp.send("Page.navigate", { url: BASE });
  await new Promise((r) => setTimeout(r, 4000));
  await shot(cdp, `${OUT}\\02-after-login.png`);

  const loggedIn = await evaluate(cdp, `(() => ({
    hasWorkersBtn: !!document.querySelector('.ws-workers-open'),
    stillLogin: !!document.querySelector('input[type="password"]'),
    bodyLen: document.body.innerText.length,
  }))()`);
  log("after login:", JSON.stringify(loggedIn));

  if (loggedIn.stillLogin) throw new Error("login did not complete");

  // ---- navigate to the تشغيل area that owns the workers button ----
  // Expand every collapsed sidebar parent, then locate the تشغيل subitem.
  const expanded = await evaluate(cdp, `(() => {
    const clicked = [];
    for (const p of document.querySelectorAll('.sidebar-parent')) {
      const r = p.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      p.click();
      clicked.push((p.textContent || '').trim().slice(0, 20));
    }
    return clicked;
  })()`);
  log("expanded parents:", JSON.stringify(expanded));
  await new Promise((r) => setTimeout(r, 1500));

  // The عمال button lives on a تشغيل sub-page; click the right one if needed.
  const gotoOperation = await evaluate(cdp, `(() => {
    if (document.querySelector('.ws-workers-open')) return 'already on a workers page';
    const t = [...document.querySelectorAll('.sidebar-subitem, .sidebar-item')]
      .find(b => (b.textContent || '').trim().startsWith('تشغيل'));
    if (t) { t.click(); return 'clicked ' + (t.textContent || '').trim(); }
    return 'no تشغيل subitem';
  })()`);
  log("goto:", JSON.stringify(gotoOperation));
  await new Promise((r) => setTimeout(r, 2000));

  // Each تشغيل قسم has its own عمال button, one per department.
  const workersButtons = await evaluate(cdp, `(() =>
    [...document.querySelectorAll('.ws-workers-open')].map(b => {
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })
  )()`);
  log("workers buttons found:", workersButtons.length, JSON.stringify(workersButtons));

  if (!workersButtons.length) {
    const nav = await evaluate(cdp, `(() => {
      const out = [];
      for (const b of document.querySelectorAll('button, a')) {
        const t = (b.textContent || '').trim();
        if (t) out.push({ t: t.slice(0, 28), c: (b.className || '').slice(0, 40) });
      }
      return out;
    })()`);
    log(JSON.stringify(nav).slice(0, 3000));
    await shot(cdp, `${OUT}\\03-no-workers-button.png`);
    throw new Error("workers button (.ws-workers-open) not found");
  }

  // ---- open the workers management window ----
  const btnBox = workersButtons[0];
  log("workers button:", JSON.stringify(btnBox));
  await click(cdp, btnBox.x, btnBox.y);
  await new Promise((r) => setTimeout(r, 1200));
  await shot(cdp, `${OUT}\\04-workers-open.png`);

  // ---- inject realistic worker rows ----
  // Browser-only mode has no worker records (they come from /api/workers), so the
  // table renders its empty state and the 4-column layout is never exercised.
  // Push rows straight into the DOM with long names/IDs to measure real layout.
  const injected = await evaluate(cdp, `(() => {
    const table = document.querySelector('.ws-workers-modal .ws-workers-table');
    const body = table && table.querySelector('tbody');
    if (!body) return { ok: false, reason: 'no tbody' };

    const samples = [
      ['محمد عبد الرحمن إبراهيم Schwarzenegger', '0001234567', '01012345678'],
      ['أحمد', '0009', '01000000000'],
      ['مصطفىVeryLongNameThatOverflowsTheColumn', '001234567890', '012345678901'],
      ['علي', '0042', '011'],
    ];
    body.innerHTML = samples.map((w, i) => \`
      <tr class="\${i === 3 ? 'ws-worker-inactive' : ''}">
        <td class="ws-worker-name">\${w[0]}\${i === 3 ? '<span class="ws-worker-disabled-badge">معطل</span>' : ''}</td>
        <td class="ws-worker-ident" dir="ltr">\${w[1]}</td>
        <td class="ws-worker-ident" dir="ltr">\${w[2]}</td>
        <td class="ws-worker-actions-cell">
          <button type="button" class="ws-workers-remove">تعديل</button>
          <button type="button" class="ws-workers-remove">مسح</button>
        </td>
      </tr>\`).join('');
    return { ok: true, rows: body.querySelectorAll('tr').length };
  })()`);
  log("injected rows:", JSON.stringify(injected));
  await new Promise((r) => setTimeout(r, 600));
  await shot(cdp, `${OUT}\\04b-workers-with-data.png`);

  // ---- measure the rendered window ----
  const metrics = await evaluate(cdp, `(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => { if(!el) return null; const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
    const cs = (el, ...props) => { if(!el) return null; const c = getComputedStyle(el);
      return Object.fromEntries(props.map(p => [p, c[p]])); };

    const dialog = q('.ws-workers-modal');
    const table = q('.ws-workers-modal .ws-workers-table');
    const wrap = q('.ws-workers-modal .ws-workers-table-wrap');
    const overlay = q('.ws-staff-overlay, .ws-modal-overlay');
    const heads = [...document.querySelectorAll('.ws-workers-modal .ws-workers-table thead th')];
    const firstRow = q('.ws-workers-modal .ws-workers-table tbody tr');
    const cells = [...document.querySelectorAll('.ws-workers-modal .ws-workers-table tbody tr:first-child td')];

    return {
      found: !!dialog,
      overlayBox: box(overlay),
      dialogBox: box(dialog),
      dialogStyle: cs(dialog, 'width','maxWidth','minWidth','padding','overflow','maxHeight','fontSize'),
      tableBox: box(table),
      tableStyle: cs(table, 'width','minWidth','tableLayout','fontSize'),
      wrapBox: box(wrap),
      wrapStyle: cs(wrap, 'overflowX','overflowY','maxHeight','height'),
      headerTexts: heads.map(h => h.textContent.trim()),
      headerWidths: heads.map(h => Math.round(h.getBoundingClientRect().width)),
      headerFontSizes: heads.map(h => getComputedStyle(h).fontSize),
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      tableScrollsHorizontally: table ? table.scrollWidth > table.clientWidth + 1 : null,
      tableScrollWidth: table ? table.scrollWidth : null,
      tableClientWidth: table ? table.clientWidth : null,

      // per-row checks across every data row
      rowHeights: [...document.querySelectorAll('.ws-workers-modal .ws-workers-table tbody tr')].map(r => Math.round(r.getBoundingClientRect().height)),
      rowsUnder44px: [...document.querySelectorAll('.ws-workers-modal .ws-workers-table tbody tr')]
        .filter(r => r.getBoundingClientRect().height < 44).length,
      cellCounts: [...document.querySelectorAll('.ws-workers-modal .ws-workers-table tbody tr')]
        .map(r => r.querySelectorAll('td').length),
      // any cell whose content is wider than the cell => clipped / spilling
      clippedCells: [...document.querySelectorAll('.ws-workers-modal .ws-workers-table tbody tr')].map(r => {
        const out = [];
        r.querySelectorAll('td').forEach((td, i) => {
          const need = td.scrollWidth;
          const have = td.clientWidth;
          if (need > have + 1) out.push({ col: i + 1, need, have, over: need - have, text: (td.textContent || '').trim().slice(0, 30) });
        });
        return out;
      }).flat(),
      identValues: [...document.querySelectorAll('.ws-workers-modal .ws-worker-ident')].map(e => e.textContent.trim()),
      identVisibleWidths: [...document.querySelectorAll('.ws-workers-modal .ws-worker-ident')].map(e => Math.round(e.getBoundingClientRect().width)),
      wrapScrollsHorizontally: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null,
      wrapScrollW: wrap ? wrap.scrollWidth : null,
      wrapClientW: wrap ? wrap.clientWidth : null,
    };
  })()`);

  log("\n--- WORKERS WINDOW METRICS ---");
  log(JSON.stringify(metrics, null, 2));
  await shot(cdp, `${OUT}\\05-workers-measured.png`);

  // ---- verify dragging moves the window ----
  const headBox = await evaluate(cdp, `(() => {
    const h = document.querySelector('.ws-workers-modal .ws-modal-head, .ws-workers-modal .dd-head');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + 24, w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  log("\nheader box:", JSON.stringify(headBox));

  if (headBox) {
    const before = await evaluate(cdp, `(() => { const r = document.querySelector('.ws-workers-modal').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), transform: getComputedStyle(document.querySelector('.ws-workers-modal')).transform }; })()`);
    log("before drag:", JSON.stringify(before));
    await drag(cdp, { x: headBox.x, y: headBox.y }, { x: headBox.x - 260, y: headBox.y + 190 });
    const after = await evaluate(cdp, `(() => { const r = document.querySelector('.ws-workers-modal').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), transform: getComputedStyle(document.querySelector('.ws-workers-modal')).transform }; })()`);
    log("after drag: ", JSON.stringify(after));
    const moved = Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 40;
    log(moved ? "DRAG OK: window moved" : "DRAG FAILED: window did not move");
    await shot(cdp, `${OUT}\\06-workers-dragged.png`);
  }
} catch (err) {
  log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}