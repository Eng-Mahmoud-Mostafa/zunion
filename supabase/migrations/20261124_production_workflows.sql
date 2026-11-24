-- Additive migration; no business rows are updated or deleted.

create table if not exists production_queues (
 stage text primary key check(stage in ('embroidery','printing','sewing')),
 revision integer not null default 0,
 order_ids jsonb not null default '[]'::jsonb
);
create table if not exists production_stage_completions (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references orders(id) on delete restrict,
 stage text not null check(stage in ('embroidery','printing','sewing')),
 completed_at timestamptz not null default now(),
 completed_by uuid references users(id) on delete set null,
 worker_name text not null default '',
 priority integer,
 snapshot jsonb not null,
 unique(order_id, stage)
);
alter table production_queues enable row level security;
alter table production_stage_completions enable row level security;
insert into production_queues(stage) values ('embroidery'),('printing'),('sewing') on conflict do nothing;
