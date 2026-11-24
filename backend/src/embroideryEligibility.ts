/** One database rule for the embroidery table, machine board, picker and writes. */
export const ACTIVE_EMBROIDERY_SQL = `
 o.type = 'تطريز' and o.draft = false
 and o.work_stage in ('new','operation')
 and (o.work_stage = 'operation' or o.status::text in ('SENT_TO_WORKER','WORKER_STARTED'))
 and o.status::text in ('NEW','SENT_TO_WORKER','WORKER_STARTED')
 and not exists (select 1 from production_stage_completions c where c.order_id=o.id and c.stage='embroidery')
`;
