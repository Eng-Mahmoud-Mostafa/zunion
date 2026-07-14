create extension if not exists pgcrypto;

do $$ begin
  create type user_role as enum ('Master', 'Helper', 'Worker', 'Finish');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'NEW',
    'SENT_TO_WORKER',
    'WORKER_STARTED',
    'WORKER_DONE',
    'SENT_TO_FINISH',
    'FINISH_STARTED',
    'FINISH_DONE',
    'READY',
    'CUSTOMER_MESSAGED',
    'DELIVERED',
    'CANCELLED'
  );
exception when duplicate_object then null; end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role user_role not null,
  username text unique,
  full_name text,
  password_hash text,
  password_salt text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  permission_overrides jsonb not null default '{"allow":[],"deny":[]}'::jsonb,
  token_version integer not null default 0,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists username text unique;
alter table users add column if not exists full_name text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists password_salt text;
alter table users add column if not exists is_active boolean not null default true;
alter table users add column if not exists must_change_password boolean not null default false;
alter table users add column if not exists permission_overrides jsonb not null default '{"allow":[],"deny":[]}'::jsonb;
alter table users add column if not exists token_version integer not null default 0;
alter table users add column if not exists last_login_at timestamptz;

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  permissions jsonb not null default '[]'::jsonb,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table roles add column if not exists description text not null default '';
alter table roles add column if not exists status text not null default 'active';
alter table roles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table roles add column if not exists is_system_role boolean not null default false;
alter table roles add column if not exists updated_at timestamptz not null default now();
alter table roles drop constraint if exists roles_status_check;
alter table roles add constraint roles_status_check check (status in ('active', 'inactive'));

create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  phone text not null,
  email text default '',
  address text default '',
  source_party text,
  old_balance numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table customers add column if not exists email text default '';
alter table customers add column if not exists address text default '';

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  details text,
  logo_placement text,
  default_quantity integer not null default 1 check (default_quantity >= 1),
  default_price numeric not null default 0 check (default_price >= 0),
  default_total numeric generated always as (default_quantity * default_price) stored,
  quality text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  product_image text,
  logo_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists logo_placement text;
alter table products add column if not exists default_quantity integer not null default 1;
alter table products add column if not exists default_price numeric not null default 0;
alter table products add column if not exists quality text;
alter table products add column if not exists status text not null default 'active';
alter table products add column if not exists product_image text;
alter table products add column if not exists logo_image text;
alter table products drop constraint if exists products_status_check;
alter table products add constraint products_status_check check (status in ('active', 'inactive'));
alter table products drop constraint if exists products_default_quantity_check;
alter table products add constraint products_default_quantity_check check (default_quantity >= 1);
alter table products drop constraint if exists products_default_price_check;
alter table products add constraint products_default_price_check check (default_price >= 0);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_id uuid references customers(id) on delete set null,
  source_party text,
  customer_name_snapshot text not null,
  customer_code_snapshot text,
  phone_snapshot text not null,
  delivery_date date,
  type text,
  product_id uuid,
  product_name_snapshot text,
  payment_method text not null default 'cash',
  custom_payment_method text,
  materials_status text not null default 'available',
  operation_methods jsonb not null default '[]'::jsonb,
  quantity integer not null default 1,
  price numeric not null default 0,
  total numeric not null default 0,
  paid numeric not null default 0,
  remaining numeric not null default 0,
  old_account numeric not null default 0,
  net_account numeric not null default 0,
  status order_status not null default 'NEW',
  work_stage text not null default 'new' check (work_stage in ('new', 'operation', 'finishing', 'completed', 'cancelled')),
  notes text,
  message_text text,
  quality_notes text,
  damaged_pieces integer not null default 0,
  production_notes text,
  finishing_notes text,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders add column if not exists work_stage text not null default 'new';
alter table orders add column if not exists product_id uuid;
alter table orders add column if not exists product_name_snapshot text;
alter table orders add column if not exists payment_method text not null default 'cash';
alter table orders add column if not exists custom_payment_method text;
alter table orders add column if not exists materials_status text not null default 'available';
alter table orders add column if not exists operation_methods jsonb not null default '[]'::jsonb;
alter table orders drop constraint if exists orders_work_stage_check;
alter table orders add constraint orders_work_stage_check check (work_stage in ('new', 'operation', 'finishing', 'completed', 'cancelled'));
update orders
set work_stage = case
  when status = 'NEW' then 'new'
  when status in ('SENT_TO_WORKER', 'WORKER_STARTED', 'WORKER_DONE') then 'operation'
  when status in ('SENT_TO_FINISH', 'FINISH_STARTED', 'FINISH_DONE') then 'finishing'
  when status in ('READY', 'CUSTOMER_MESSAGED', 'DELIVERED') then 'completed'
  when status = 'CANCELLED' then 'cancelled'
  else 'new'
end
where work_stage is null or work_stage = 'new';

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_name text not null,
  details text,
  logo_place text,
  quantity integer not null default 1,
  price numeric not null default 0,
  total numeric not null default 0,
  quality text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id) on delete cascade,
  file_type text not null,
  original_name text not null,
  stored_name text not null,
  mime_type text not null,
  size integer not null,
  path text not null,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists monthly_periods (
  id uuid primary key default gen_random_uuid(),
  month integer not null,
  year integer not null,
  opened_by uuid references users(id) on delete set null,
  opened_at timestamptz not null default now(),
  notes text,
  unique(month, year)
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  monthly_period_id uuid not null references monthly_periods(id) on delete cascade,
  type text not null,
  quantity numeric not null default 1,
  price numeric not null default 0,
  total numeric not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists incomes (
  id uuid primary key default gen_random_uuid(),
  monthly_period_id uuid not null references monthly_periods(id) on delete cascade,
  from_name text not null,
  value numeric not null default 0,
  reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  user_email text,
  user_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value_json jsonb,
  new_value_json jsonb,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function calculate_order_financials()
returns trigger language plpgsql as $$
begin
  new.price = coalesce(new.price, 0);
  new.quantity = coalesce(new.quantity, 0);
  new.paid = coalesce(new.paid, 0);
  new.old_account = coalesce(new.old_account, 0);
  new.total = new.price * new.quantity;
  new.remaining = new.total - new.paid;
  new.net_account = new.remaining + new.old_account;
  return new;
end;
$$;

create or replace function calculate_order_item_total()
returns trigger language plpgsql as $$
begin
  new.quantity = coalesce(new.quantity, 0);
  new.price = coalesce(new.price, 0);
  new.total = new.quantity * new.price;
  return new;
end;
$$;

create or replace function calculate_expense_total()
returns trigger language plpgsql as $$
begin
  new.quantity = coalesce(new.quantity, 0);
  new.price = coalesce(new.price, 0);
  new.total = new.quantity * new.price;
  return new;
end;
$$;

drop trigger if exists set_customers_updated_at on customers;
create trigger set_customers_updated_at before update on customers for each row execute function set_updated_at();

drop trigger if exists set_products_updated_at on products;
create trigger set_products_updated_at before update on products for each row execute function set_updated_at();

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at before update on users for each row execute function set_updated_at();

drop trigger if exists set_roles_updated_at on roles;
create trigger set_roles_updated_at before update on roles for each row execute function set_updated_at();

drop trigger if exists set_orders_updated_at on orders;
create trigger set_orders_updated_at before update on orders for each row execute function set_updated_at();

drop trigger if exists calculate_orders_financials on orders;
create trigger calculate_orders_financials before insert or update on orders for each row execute function calculate_order_financials();

drop trigger if exists set_order_items_updated_at on order_items;
create trigger set_order_items_updated_at before update on order_items for each row execute function set_updated_at();

drop trigger if exists calculate_order_items_total on order_items;
create trigger calculate_order_items_total before insert or update on order_items for each row execute function calculate_order_item_total();

drop trigger if exists calculate_expenses_total on expenses;
create trigger calculate_expenses_total before insert or update on expenses for each row execute function calculate_expense_total();

insert into users (email, role) values
  ('mahmoudmostafa3104@gmail.com', 'Master'),
  ('mahmoudelwensh2007@gmail.com', 'Helper'),
  ('mahmoudodo20072021@gmail.com', 'Worker'),
  ('mahmoud.foly.2007@gmail.com', 'Finish')
on conflict (email) do update set role = excluded.role;

with default_permissions(name, description, permissions) as (
  values
    ('Master', 'Full system access', array[
      'dashboard.view','orders.view','orders.create','orders.edit','orders.delete','orders.print',
      'customers.view','customers.create','customers.edit','customers.delete','customers.print',
      'products.view','products.create','products.edit','products.delete','products.print',
      'search.use','expenses.view','expenses.create','expenses.print','revenues.view','revenues.create','revenues.print',
      'operation.view','operation.update','operation.upload','operation.print',
      'finishing.view','finishing.update','finishing.upload','finishing.print',
      'reports.view','reports.print','import.export',
      'users.view','users.create','users.edit','users.deactivate','users.delete','users.resetPassword',
      'roles.view','roles.create','roles.edit','roles.delete','permissions.manage','audit.view','settings.view'
    ]::text[]),
    ('Helper', 'Order and customer helper access', array[
      'dashboard.view','orders.view','orders.create','orders.edit','orders.print',
      'customers.view','customers.create','customers.edit','customers.print',
      'products.view','search.use','import.export'
    ]::text[]),
    ('Operator', 'Operation team access', array[
      'dashboard.view','orders.view','orders.edit','orders.print',
      'customers.view','products.view','search.use',
      'operation.view','operation.update','operation.upload','operation.print'
    ]::text[]),
    ('Supervisor', 'Supervisor access', array[
      'dashboard.view','orders.view','orders.create','orders.edit','orders.print',
      'customers.view','customers.create','customers.edit','customers.print',
      'products.view','products.create','products.edit','products.print',
      'search.use','operation.view','operation.update','operation.print',
      'finishing.view','finishing.update','finishing.print','reports.view','reports.print'
    ]::text[]),
    ('Finishing', 'Finishing team access', array[
      'dashboard.view','orders.view','orders.edit','orders.print',
      'customers.view','products.view','search.use',
      'finishing.view','finishing.update','finishing.upload','finishing.print'
    ]::text[]),
    ('Worker', 'Worker access', array[
      'dashboard.view','orders.view','orders.edit','orders.print',
      'products.view','operation.view','operation.update','operation.upload','operation.print'
    ]::text[]),
    ('Finish', 'Legacy finishing role', array[
      'dashboard.view','orders.view','orders.edit','orders.print',
      'products.view','finishing.view','finishing.update','finishing.upload','finishing.print'
    ]::text[])
)
insert into roles (name, description, status, permissions, is_system_role)
select name, description, 'active', to_jsonb(permissions), true
from default_permissions
on conflict (name) do update set
  description = excluded.description,
  status = excluded.status,
  permissions = excluded.permissions,
  is_system_role = true;

with customer as (
  insert into customers (name, code, phone, source_party, old_balance, notes)
  values ('احمد عصام', '115', '1111577055', 'احمد', 2000, 'Seeded from Excel sample')
  on conflict do nothing
  returning id
), existing_customer as (
  select id from customer
  union all
  select id from customers where phone = '1111577055' limit 1
), master_user as (
  select id from users where email = 'mahmoudmostafa3104@gmail.com'
)
insert into orders (
  order_number,
  customer_id,
  source_party,
  customer_name_snapshot,
  customer_code_snapshot,
  phone_snapshot,
  delivery_date,
  type,
  quantity,
  price,
  paid,
  old_account,
  status,
  notes,
  created_by,
  updated_by
)
select
  '26-6-8-000112',
  (select id from existing_customer limit 1),
  'احمد',
  'احمد عصام',
  '115',
  '1111577055',
  '2026-10-06',
  'كتابه',
  50,
  52,
  1600,
  2000,
  'NEW',
  'هنسلم بكره ان شاء الله',
  (select id from master_user),
  (select id from master_user)
on conflict (order_number) do nothing;

insert into order_items (order_id, product_name, details, logo_place, quantity, price, quality, status)
select id, 'ظƒطھط§ط¨ظ‡', 'ظ‡ظ†ط³ظ„ظ… ط¨ظƒط±ظ‡ ط§ظ† ط´ط§ط، ط§ظ„ظ„ظ‡', '', 50, 52, '', 'NEW'
from orders
where order_number = '26-6-8-000112'
and not exists (
  select 1 from order_items where order_items.order_id = orders.id
);
