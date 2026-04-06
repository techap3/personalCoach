do $$
begin
  if to_regclass('task_sessions') is not null then
    delete from task_sessions
    where ctid in (
      select ctid
      from (
        select
          ctid,
          row_number() over (
            partition by goal_id, plan_step_id, session_date
            order by
              case
                when status = 'active' then 0
                when status = 'failed' then 1
                when status = 'completed' then 2
                else 3
              end,
              created_at asc,
              id asc
          ) as rn
        from task_sessions
      ) duplicates
      where duplicates.rn > 1
    );
  end if;
end $$;

alter table if exists task_sessions
  drop constraint if exists task_sessions_goal_step_day_key;

alter table if exists task_sessions
  add constraint task_sessions_goal_step_day_key
  unique (goal_id, plan_step_id, session_date);
