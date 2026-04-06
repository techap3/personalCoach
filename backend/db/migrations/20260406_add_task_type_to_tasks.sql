alter table if exists tasks
  add column if not exists task_type text;

do $$
begin
  if to_regclass('tasks') is not null then
    update tasks
    set task_type = 'learn'
    where task_type is null
       or task_type not in ('action', 'learn', 'reflect', 'review');
  end if;
end $$;

alter table if exists tasks
  alter column task_type set default 'learn';

alter table if exists tasks
  alter column task_type set not null;

alter table if exists tasks
  drop constraint if exists tasks_task_type_check;

alter table if exists tasks
  add constraint tasks_task_type_check
  check (task_type in ('action', 'learn', 'reflect', 'review'));
