-- Preserve explicit clicked slots without changing existing orders or historical assignments.
alter table machine_assignments add column if not exists queue_position integer check (queue_position > 0);
