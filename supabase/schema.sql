create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.users_profile (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  full_name text not null,
  email text,
  role text not null,
  password_hash text not null,
  password_salt text not null,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  permission_overrides jsonb not null default '{"allow":[],"deny":[]}'::jsonb,
  token_version integer not null default 0,
  last_login_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.users_profile drop constraint if exists users_profile_role_check;
alter table public.users_profile add column if not exists permission_overrides jsonb not null default '{"allow":[],"deny":[]}'::jsonb;
alter table public.users_profile add column if not exists token_version integer not null default 0;
alter table public.users_profile add column if not exists last_login_at timestamptz;
alter table public.users_profile add column if not exists updated_at timestamptz not null default now();
alter table public.users_profile add column if not exists is_active boolean not null default true;
alter table public.users_profile add column if not exists must_change_password boolean not null default false;
alter table public.users_profile alter column must_change_password set default false;
update public.users_profile set must_change_password = false where must_change_password = true;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  permissions jsonb not null default '[]'::jsonb,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roles add column if not exists description text not null default '';
alter table public.roles add column if not exists status text not null default 'active';
alter table public.roles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table public.roles add column if not exists is_system_role boolean not null default false;
alter table public.roles add column if not exists updated_at timestamptz not null default now();
alter table public.roles drop constraint if exists roles_status_check;
alter table public.roles add constraint roles_status_check check (status in ('active', 'inactive'));

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text default '',
  address text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.customers add column if not exists email text default '';
alter table public.customers add column if not exists address text default '';

create table if not exists public.products (
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

alter table public.products add column if not exists logo_placement text;
alter table public.products add column if not exists default_quantity integer not null default 1;
alter table public.products add column if not exists default_price numeric not null default 0;
alter table public.products add column if not exists quality text;
alter table public.products add column if not exists status text not null default 'active';
alter table public.products add column if not exists product_image text;
alter table public.products add column if not exists logo_image text;
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('active', 'inactive'));
alter table public.products drop constraint if exists products_default_quantity_check;
alter table public.products add constraint products_default_quantity_check check (default_quantity >= 1);
alter table public.products drop constraint if exists products_default_price_check;
alter table public.products add constraint products_default_price_check check (default_price >= 0);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint unique,
  customer_id uuid references public.customers(id),
  customer_name text,
  phone text,
  party text,
  service_type text,
  product_id uuid,
  product_name_snapshot text,
  payment_method text not null default 'cash',
  custom_payment_method text,
  materials_status text not null default '',
  operation_methods jsonb not null default '[]'::jsonb,
  pieces_count int not null default 1,
  received_date date,
  delivery_date date,
  total numeric not null default 0,
  paid numeric not null default 0,
  remaining numeric generated always as (coalesce(total, 0) - coalesce(paid, 0)) stored,
  operation_status text,
  finishing_status text,
  delivery_status text,
  work_stage text not null default 'new' check (work_stage in ('new', 'operation', 'finishing', 'completed', 'cancelled')),
  notes text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists work_stage text not null default 'new';
alter table public.orders add column if not exists product_id uuid;
alter table public.orders add column if not exists product_name_snapshot text;
alter table public.orders add column if not exists payment_method text not null default 'cash';
alter table public.orders add column if not exists custom_payment_method text;
alter table public.orders add column if not exists materials_status text not null default '';
alter table public.orders alter column materials_status set default '';
alter table public.orders add column if not exists operation_methods jsonb not null default '[]'::jsonb;
alter table public.orders drop constraint if exists orders_work_stage_check;
alter table public.orders add constraint orders_work_stage_check check (work_stage in ('new', 'operation', 'finishing', 'completed', 'cancelled'));
update public.orders
set work_stage = case
  when operation_status in ('تشغيل', 'التشغيل', 'قيد التشغيل') or delivery_status in ('في التشغيل') then 'operation'
  when finishing_status in ('تشطيب', 'التشطيب', 'قيد التشطيب') or delivery_status in ('في التشطيب') then 'finishing'
  when delivery_status in ('مكتمل', 'تم التسليم', 'جاهز') then 'completed'
  when work_stage in ('operation', 'finishing', 'completed', 'cancelled') then work_stage
  else 'new'
end;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('إيراد', 'الإيراد', 'مصروف', 'income', 'expense')),
  date date not null default current_date,
  description text,
  amount numeric not null default 0,
  expense_type text,
  account_destination text,
  customer_id uuid references public.customers(id),
  order_id uuid references public.orders(id),
  added_by uuid references public.users_profile(id),
  created_at timestamptz not null default now()
);

create table if not exists public.operation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users_profile(id),
  username text,
  role text,
  action text not null,
  page text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default 'Zunion',
  logo_url text default 'src/assets/logo.png',
  primary_color text default '#D90416',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists set_users_profile_updated_at on public.users_profile;
create trigger set_users_profile_updated_at
  before update on public.users_profile
  for each row execute function public.set_updated_at();

drop trigger if exists set_roles_updated_at on public.roles;
create trigger set_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

alter table public.users_profile enable row level security;
alter table public.roles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;
alter table public.operation_logs enable row level security;
alter table public.password_reset_codes enable row level security;
alter table public.company_settings enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['customers', 'products', 'orders', 'transactions', 'operation_logs', 'company_settings']
  loop
    execute format('drop policy if exists "server authenticated read %1$s" on public.%1$I', table_name);
    execute format('create policy "server authenticated read %1$s" on public.%1$I for select to authenticated using (true)', table_name);
    execute format('drop policy if exists "server authenticated insert %1$s" on public.%1$I', table_name);
    execute format('create policy "server authenticated insert %1$s" on public.%1$I for insert to authenticated with check (true)', table_name);
    execute format('drop policy if exists "server authenticated update %1$s" on public.%1$I', table_name);
    execute format('create policy "server authenticated update %1$s" on public.%1$I for update to authenticated using (true) with check (true)', table_name);
    execute format('drop policy if exists "server authenticated delete %1$s" on public.%1$I', table_name);
    execute format('create policy "server authenticated delete %1$s" on public.%1$I for delete to authenticated using (true)', table_name);
  end loop;
end $$;

revoke all on public.users_profile, public.roles, public.password_reset_codes from anon, authenticated;
grant select, insert, update, delete on public.customers, public.products, public.orders, public.transactions, public.operation_logs, public.company_settings to authenticated;
revoke all on public.customers, public.products, public.orders, public.transactions, public.operation_logs, public.company_settings from anon;

insert into storage.buckets (id, name, public)
values ('order-files', 'order-files', false)
on conflict (id) do update set public = false;

drop policy if exists "authenticated users can read order files" on storage.objects;
create policy "authenticated users can read order files"
  on storage.objects for select to authenticated
  using (bucket_id = 'order-files');

drop policy if exists "authenticated users can upload order files" on storage.objects;
create policy "authenticated users can upload order files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files');

drop policy if exists "authenticated users can update order files" on storage.objects;
create policy "authenticated users can update order files"
  on storage.objects for update to authenticated
  using (bucket_id = 'order-files')
  with check (bucket_id = 'order-files');

drop policy if exists "authenticated users can delete order files" on storage.objects;
create policy "authenticated users can delete order files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'order-files');

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
      'users.view','users.create','users.edit','users.deactivate','users.delete','users.resetPassword','users.resetAllPasswords',
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
insert into public.roles (name, description, status, permissions, is_system_role)
select name, description, 'active', to_jsonb(permissions), true
from default_permissions
on conflict (name) do update set
  description = excluded.description,
  status = excluded.status,
  permissions = excluded.permissions,
  is_system_role = true;

insert into public.users_profile (username, full_name, email, role, password_salt, password_hash, must_change_password)
values
  ('mahmoud', 'Mahmoud', 'mahmoud@zunion.local', 'Master', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('reda', 'Reda', 'reda@zunion.local', 'Master', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('hassan', 'Hassan', 'hassan@zunion.local', 'Master', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('omar', 'Omar', 'omar@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('youssef', 'Youssef', 'youssef@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('khalifa', 'Khalifa', 'khalifa@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('opr 1', 'Opr 1', 'opr1@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('opr 2', 'Opr 2', 'opr2@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('opr 3', 'Opr 3', 'opr3@zunion.local', 'Operator', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('supervisor 1', 'Supervisor 1', 'supervisor1@zunion.local', 'Supervisor', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('supervisor 2', 'Supervisor 2', 'supervisor2@zunion.local', 'Supervisor', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('supervisor 3', 'Supervisor 3', 'supervisor3@zunion.local', 'Supervisor', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('finishing 1', 'Finishing 1', 'finishing1@zunion.local', 'Finishing', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false),
  ('finishing 2', 'Finishing 2', 'finishing2@zunion.local', 'Finishing', 'zunion-default', encode(digest('zunion-default:1234', 'sha256'), 'hex'), false)
on conflict (username) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  must_change_password = false,
  is_active = true;

insert into public.company_settings (company_name, logo_url, primary_color)
values ('Zunion', 'src/assets/logo.png', '#D90416')
on conflict do nothing;
