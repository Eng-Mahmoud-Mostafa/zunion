-- One-time rollout: existing Master administrators already administer all machines.
-- Custom roles receive no new access; assign these keys in Roles & Permissions.
-- Run against each configured permission store. Never run on every app startup.
begin;
update public.roles
set permissions = permissions
  || case when permissions ? 'machines.create' then '[]'::jsonb else '["machines.create"]'::jsonb end
  || case when permissions ? 'machines.edit' then '[]'::jsonb else '["machines.edit"]'::jsonb end
where name = 'Master' and status = 'active';
commit;
