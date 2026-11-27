import { query } from "./db.js";
export const CREATOR_NAME_SQL = "coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.username), ''), nullif(btrim(cs.creator_name), ''), 'مستخدم غير معروف')";
export const CREATOR_NAME_JOIN = "left join users u on u.id=o.created_by left join order_creator_names cs on cs.order_id=o.id";
/** Separate snapshots avoid updating order timestamps, financial triggers or creator relationships. */
export const ORDER_CREATOR_DDL = `create table if not exists order_creator_names (
 order_id uuid primary key references orders(id) on delete cascade,
 creator_id uuid,
 creator_name text not null,
 captured_at timestamptz not null default now()
);
alter table order_creator_names enable row level security;
insert into order_creator_names(order_id,creator_id,creator_name)
 select o.id,o.created_by,coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.username),''))
 from orders o join users u on u.id=o.created_by
 where coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.username),'')) is not null and not exists(select 1 from order_creator_names c where c.order_id=o.id)
 on conflict(order_id) do nothing;
create or replace function capture_order_creator_name() returns trigger language plpgsql as $$
begin
 insert into order_creator_names(order_id,creator_id,creator_name)
 select new.id,new.created_by,coalesce(nullif(btrim(full_name),''),nullif(btrim(username),'')) from users where id=new.created_by and coalesce(nullif(btrim(full_name),''),nullif(btrim(username),'')) is not null
 on conflict(order_id) do nothing;
 return new;
end $$;
drop trigger if exists orders_capture_creator_name on orders;
create trigger orders_capture_creator_name after insert on orders for each row execute function capture_order_creator_name();
create or replace function capture_deleted_creator_names() returns trigger language plpgsql as $$
begin
 insert into order_creator_names(order_id,creator_id,creator_name)
 select id,created_by,coalesce(nullif(btrim(old.full_name),''),nullif(btrim(old.username),'')) from orders where created_by=old.id and coalesce(nullif(btrim(old.full_name),''),nullif(btrim(old.username),'')) is not null
 on conflict(order_id) do nothing;
 return old;
end $$;
drop trigger if exists users_capture_order_creator_names on users;
create trigger users_capture_order_creator_names before delete on users for each row execute function capture_deleted_creator_names();`;
/** One batched lookup for a production response; no administrative user-directory access. */
export async function resolveOrderCreators<T extends Record<string,unknown>>(orders:T[]):Promise<Array<T & {creator_name:string}>> {
 const ids=[...new Set(orders.map(o=>o.id).filter((id):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))];
 const names=ids.length?(await query<{id:string;creator_name:string}>(`select o.id,${CREATOR_NAME_SQL} as creator_name from orders o ${CREATOR_NAME_JOIN} where o.id=any($1::uuid[])`,[ids])).rows:[];
 const byId=new Map(names.map(row=>[row.id,row.creator_name]));
 return orders.map(o=>({...o,creator_name:[byId.get(String(o.id)),o.creator_name,o.creator_name_snapshot].map(v=>String(v??'').trim()).find(v=>v&&v!=='مستخدم غير معروف'&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v))||'مستخدم غير معروف'}));
}

/** Archive payloads retain their original snapshots; only creator metadata is resolved. */
export async function resolveArchivedCreators<T extends Record<string,unknown>>(completions:T[]) {
 const snapshots=completions.map(row=>row.snapshot&&typeof row.snapshot==='object'?row.snapshot as Record<string,unknown>:{});
 const resolved=await resolveOrderCreators(completions.map((row,index)=>({id:String(row.order_id),creator_name:snapshots[index].creator_name,creator_name_snapshot:snapshots[index].creator_name_snapshot})));
 return completions.map((row,index)=>({...row,creator_name:resolved[index].creator_name,snapshot:{...snapshots[index],creator_name:resolved[index].creator_name}}));
}
