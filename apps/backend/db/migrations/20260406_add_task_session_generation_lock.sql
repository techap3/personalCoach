do $$
begin
  if to_regclass('task_sessions') is null then
    return;
  end if;

  alter table task_sessions
    add column if not exists generation_locked boolean;

  update task_sessions
  set generation_locked = false
  where generation_locked is null;

  alter table task_sessions
    alter column generation_locked set default false;

  alter table task_sessions
    alter column generation_locked set not null;
end $$;
