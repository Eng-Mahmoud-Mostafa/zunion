import { build } from "../backend/node_modules/esbuild/lib/main.js";

const orders = new Map([
  ["sewing-existing", { id: "sewing-existing", type: "خياطه", draft: false, work_stage: "operation", status: "SENT_TO_WORKER", sewing_status: "done", attachments: ["work-order.png"], history: ["created"] }],
  ["printing-existing", { id: "printing-existing", type: "طباعه", draft: false, work_stage: "operation", status: "SENT_TO_WORKER", printing_status: "done", attachments: ["print.png"], history: ["created"] }],
]);
let updates = 0;
let failNext = false;
globalThis.__productionTest = {
  loadOrder: async (id) => orders.get(id) ? { ...orders.get(id) } : null,
  query: async (sql, [id]) => {
    if (failNext) { failNext = false; throw new Error("database unavailable"); }
    const order = orders.get(id);
    if (!order || !["new", "operation"].includes(order.work_stage)) return { rows: [] };
    updates++;
    const stage = sql.includes("sewing_status='done'") ? "sewing" : "printing";
    const next = { ...order, work_stage: "finishing", status: "WORKER_DONE", [`${stage}_status`]: "done" };
    orders.set(id, next);
    return { rows: [{ ...next }] };
  },
};
const bundle = await build({ entryPoints: ["backend/src/productionCompletion.ts"], bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "fake-db", setup(api) {
    api.onResolve({ filter: /^\.\/(db|orders)\.js$/ }, (args) => ({ path: args.path, namespace: "fake" }));
    api.onLoad({ filter: /.*/, namespace: "fake" }, (args) => ({ contents: args.path.includes("orders")
      ? "export const loadOrder = (...args) => globalThis.__productionTest.loadOrder(...args)"
      : "export const query = (...args) => globalThis.__productionTest.query(...args)", loader: "js" }));
  } }],
});
const { completeProductionOrder } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const check = (name, pass) => { console.log(`${pass ? "PASS" : "FAIL"} ${name}`); if (!pass) process.exitCode = 1; };

for (const stage of ["sewing", "printing"]) {
  const id = `${stage}-existing`;
  const before = orders.get(id);
  const first = await completeProductionOrder(id, stage, "worker-id");
  const repeat = await completeProductionOrder(id, stage, "worker-id");
  check(`${stage}: existing done order transfers once`, first.outcome === "transferred" && repeat.outcome === "already-transferred" && orders.get(id).work_stage === "finishing" && orders.get(id).status === "WORKER_DONE");
  check(`${stage}: attachments and history survive`, orders.get(id).attachments === before.attachments && orders.get(id).history === before.history);
  const retryId = `${stage}-retry`;
  orders.set(retryId, { ...before, id: retryId, work_stage: "operation" });
  failNext = true;
  let failed = false;
  try { await completeProductionOrder(retryId, stage, "worker-id"); } catch { failed = true; }
  check(`${stage}: failed transfer keeps order active`, failed && orders.get(retryId).work_stage === "operation");
  const retry = await completeProductionOrder(retryId, stage, "worker-id");
  check(`${stage}: retry completes same order`, retry.outcome === "transferred" && orders.get(retryId).work_stage === "finishing");
}
check("one database transfer per successful order", updates === 4);
