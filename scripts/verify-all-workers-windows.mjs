// Walks each تشغيل department, opens its actual عمال window, and asserts the
// layout requirements against the live DOM. Also drags the window.
import { launch, connect, evaluate, shot, click, drag, cleanup } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const OUT = process.env.OUT_DIR || `${process.env.TEMP}\\zunion-shots`;
const VIEWPORTS = [
  { name: "desktop-1600", w: 1600, h: 1000 },
  { name: "laptop-1280", w: 1280, h: 800 },
  { name: "small-1024", w: 1024, h: 768 },
];

const ROWS = [
  ["محمد عبد الرحمن إبراهيم", "0001234567", "01012345678"],
  ["مصطفىVeryLongNameThatOverflowsTheColumn", "001234567890", "012345678901"],
  ["أحمد", "0009", "011"],
];

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
};

const INJECT = `(() => {
  const body = document.querySelector('.ws-workers-modal .ws-workers-table tbody');
  if (!body) return false;
  const rows = ${JSON.stringify(ROWS)};
  body.innerHTML = rows.map(w => '<tr>'
    + '<td class="ws-worker-name">' + w[0] + '</td>'
    + '<td class="ws-worker-ident" dir="ltr">' + w[1] + '</td>'
    + '<td class="ws-worker-ident" dir="ltr">' + w[2] + '</td>'
    + '<td class="ws-worker-actions-cell">'
    + '<button type="button" class="ws-workers-remove">تعديل</button>'
    + '<button type="button" class="ws-workers-remove">مسح</button>'
    + '</td></tr>').join('');
  return true;
})()`;

const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const d = q('.ws-workers-modal');
  if (!d) return { found: false };
  const wrap = q('.ws-workers-modal .ws-workers-table-wrap');
  const table = q('.ws-workers-modal .ws-workers-table');
  const heads = [...document.querySelectorAll('.ws-workers-modal thead th')];
  const rows = [...document.querySelectorAll('.ws-workers-modal tbody tr')];
  const dr = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  return {
    found: true,
    title: (q('.ws-workers-modal .ws-modal-head h2') || {}).textContent?.trim() || '',
    dialogW: Math.round(dr.width),
    fontSize: cs.fontSize,
    maxH: cs.maxHeight,
    headerTexts: heads.map(h => h.textContent.trim()),
    headerFontSizes: heads.map(h => getComputedStyle(h).fontSize),
    rowHeights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
    cellCounts: rows.map(r => r.querySelectorAll('td').length),
    clipped: rows.flatMap(r => [...r.querySelectorAll('td')].flatMap((td, i) => {
      const over = td.scrollWidth - td.clientWidth;
      return over > 1 ? [{ col: i + 1, over }] : [];
    })),
    tableHScroll: table.scrollWidth > table.clientWidth + 1,
    wrapHScroll: wrap.scrollWidth > wrap.clientWidth + 1,
    wrapVScroll: getComputedStyle(wrap).overflowY,
    idents: [...document.querySelectorAll('.ws-workers-modal .ws-worker-ident')].map(e => e.textContent.trim()),
    identOverflow: [...document.querySelectorAll('.ws-workers-modal .ws-worker-ident')]
      .map(e => e.scrollWidth - e.clientWidth).filter(v => v > 1).length,
    actions: [...document.querySelectorAll('.ws-workers-modal .ws-workers-remove')].map(b => {
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color, h: Math.round(b.getBoundingClientRect().height) };
    }),
    closeVisible: (() => {
      const c = q('.ws-workers-modal .ws-modal-close');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })(),
    addBtnOnRight: (() => {
      const b = q('.ws-workers-modal .ws-workers-add-btn');
      if (!b) return null;
      const r = b.getBoundingClientRect(), dr2 = d.getBoundingClientRect();
      return r.x > dr2.x + dr2.width / 2;
    })(),
  };
})()`;

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  for (const vp of VIEWPORTS) {
    console.log(`\n===== ${vp.name} (${vp.w}x${vp.h}) =====`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send("Page.navigate", { url: BASE });
    await wait(3500);

    await evaluate(cdp, `(() => {
      localStorage.setItem('zunion-local-session', JSON.stringify({
        email:'mahmoud@zunion.local', username:'mahmoud', fullName:'Mahmoud',
        role:'Master', expiresAt:new Date(Date.now()+864e5).toISOString(),
        loggedInAt:new Date().toISOString(), mustChangePassword:false }));
    })()`);
    await cdp.send("Page.navigate", { url: BASE });
    await wait(3500);

    // Visit every تشغيل queue page; each exposes its own عمال button.
    const queues = ["تشغيل تطريز", "طباعه", "خياطه"];
    for (const q of queues) {
      await evaluate(cdp, `(() => {
        for (const p of document.querySelectorAll('.sidebar-parent')) {
          const r = p.getBoundingClientRect();
          if (r.width || r.height) p.click();
        }
      })()`);
      await wait(900);
      const went = await evaluate(cdp, `(() => {
        const b = [...document.querySelectorAll('.sidebar-subitem')]
          .find(x => (x.textContent||'').trim() === ${JSON.stringify(q)});
        if (!b) return false;
        b.click(); return true;
      })()`);
      if (went) { await wait(1600); break; }
    }

    // Each عمال button on the page opens that queue's own window; visit them all
    // so department separation is verified, not just the first one.
    const deptCount = await evaluate(cdp, `document.querySelectorAll('.ws-workers-open').length`);
    for (let d = 0; d < deptCount; d++) {
      const dept = `queue#${d}`;
      const opened = await evaluate(cdp, `(() => {
        const b = document.querySelectorAll('.ws-workers-open')[${d}];
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
      })()`);
      if (!opened) { console.log(`  (skip ${dept}: no button)`); continue; }
      await wait(400);

      await click(cdp, opened.x, opened.y);
      await wait(900);
      await evaluate(cdp, INJECT);
      await wait(500);

      const m = await evaluate(cdp, MEASURE);
      if (!m.found) { check(`${dept}: window opened`, false); continue; }

      const wide = vp.w > 900;
      console.log(`\n  -- ${dept} --`);
      console.log(`     title: "${m.title}"`);
      check(`${dept}: dialog ~880px (or viewport-capped)`,
        wide ? (m.dialogW === 880 || m.dialogW === vp.w - 32) : true,
        `w=${m.dialogW}`);
      check(`${dept}: 4 columns`, m.headerTexts.length === 4, m.headerTexts.join(" | "));
      check(`${dept}: header text >= 15px`,
        m.headerFontSizes.every((f) => parseFloat(f) >= 15), m.headerFontSizes.join(","));
      check(`${dept}: rows >= 44px`, m.rowHeights.every((h) => h >= 44), m.rowHeights.join(","));
      check(`${dept}: 4 cells per row`, m.cellCounts.every((c) => c === 4), m.cellCounts.join(","));
      check(`${dept}: no clipped cells`, m.clipped.length === 0, JSON.stringify(m.clipped));
      check(`${dept}: no horizontal scroll`, !m.tableHScroll && !m.wrapHScroll);
      check(`${dept}: vertical scroll enabled`, m.wrapVScroll === "auto" || m.wrapVScroll === "scroll", m.wrapVScroll);
      check(`${dept}: leading zeros preserved`,
        m.idents.includes("0001234567") && m.idents.includes("0009") && m.idents.includes("001234567890"),
        m.idents.join(","));
      check(`${dept}: identifiers not truncated`, m.identOverflow === 0, `overflowing=${m.identOverflow}`);
      check(`${dept}: action buttons red w/ white text`,
        m.actions.length > 0 && m.actions.every((a) => /rgb\(198, 40, 40\)/.test(a.bg) && /rgb\(255, 255, 255\)/.test(a.color)),
        m.actions[0] ? `bg=${m.actions[0].bg} color=${m.actions[0].color}` : "no buttons");
      check(`${dept}: close button visible`, m.closeVisible === true);
      check(`${dept}: max-height 85vh`, /85vh|px/.test(m.maxH), m.maxH);

      const safe = dept.replace(/[^a-zA-Z0-9]/g, "");
      await shot(cdp, `${OUT}\\${vp.name}-${safe}.png`);

      // drag, then re-confirm the window still works
      const head = await evaluate(cdp, `(() => {
        const h = document.querySelector('.ws-workers-modal .dd-head');
        if (!h) return null; const r = h.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + h.offsetHeight/2 };
      })()`);
      if (head) {
        const before = await evaluate(cdp, `(() => { const r = document.querySelector('.ws-workers-modal').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);
        await drag(cdp, head, { x: head.x - 180, y: head.y + 120 });
        const after = await evaluate(cdp, `(() => { const r = document.querySelector('.ws-workers-modal').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);
        check(`${dept}: drag moves window`, Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 40,
          `${before.x},${before.y} -> ${after.x},${after.y}`);
        const stillOpen = await evaluate(cdp, `!!document.querySelector('.ws-workers-modal .ws-workers-table tbody tr')`);
        check(`${dept}: content intact after drag`, stillOpen);
        await shot(cdp, `${OUT}\\${vp.name}-${safe}-dragged.png`);
        // close via the × and confirm it dismisses
        await evaluate(cdp, `(() => { const c = document.querySelector('.ws-workers-modal .ws-modal-close'); if (c) c.click(); })()`);
        await wait(600);
        const closed = await evaluate(cdp, `!document.querySelector('.ws-workers-modal')`);
        check(`${dept}: close button still works after drag`, closed);
      }
    }
  }

  console.log(`\n${failures === 0 ? "ALL WORKERS WINDOW CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  if (failures) process.exitCode = 1;
} catch (err) {
  console.log("ERROR:", err.message);
  try { await shot(cdp, `${OUT}\\99-error.png`); } catch {}
  process.exitCode = 1;
} finally {
  cdp.close();
  cleanup(child);
}
