do $$
begin
  if to_regclass('task_sessions') is not null then
    alter table task_sessions
      add column if not exists session_type text;

    update task_sessions
    set session_type = 'primary'
    where session_type is null
       or lower(session_type) not in ('primary', 'bonus');

    alter table task_sessions
      alter column session_type set default 'primary';

    alter table task_sessions
      alter column session_type set not null;

    alter table task_sessions
      drop constraint if exists task_sessions_session_type_check;

    alter table task_sessions
      add constraint task_sessions_session_type_check
      check (session_type in ('primary', 'bonus'));

    create temporary table if not exists _session_dedup_map (
      duplicate_id uuid primary key,
      canonical_id uuid not null
    ) on commit drop;

    truncate table _session_dedup_map;

    insert into _session_dedup_map (duplicate_id, canonical_id)
    select
      ranked.id as duplicate_id,
      ranked.canonical_id as canonical_id
    from (
      select
        id,
        first_value(id) over (
          partition by goal_id, session_date, session_type
          order by
            case
              when status = 'active' then 0
              when status = 'failed' then 1
              when status = 'completed' then 2
              else 3
            end,
            created_at asc,
            id asc
        ) as canonical_id,
        row_number() over (
          partition by goal_id, session_date, session_type
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
    ) ranked
    where ranked.rn > 1;

    if to_regclass('tasks') is not null then
      update tasks t
      set session_id = mapping.canonical_id
      from _session_dedup_map mapping
      where t.session_id = mapping.duplicate_id
        and t.session_id <> mapping.canonical_id;
    end if;

    delete from task_sessions sessions
    using _session_dedup_map mapping
    where sessions.id = mapping.duplicate_id;

    if to_regclass('tasks') is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tasks'
          and column_name = 'status'
      ) then
      update task_sessions s
      set status = 'active'
      where s.status = 'completed'
        and exists (
          select 1 from tasks t
          where t.session_id = s.id
            and t.status = 'pending'
        );
    end if;
  end if;
end $$;

alter table if exists task_sessions
  drop constraint if exists task_sessions_goal_step_day_key;

alter table if exists task_sessions
  drop constraint if exists task_sessions_goal_session_date_key;

alter table if exists task_sessions
  drop constraint if exists task_sessions_goal_session_date_type_key;

alter table if exists task_sessions
  add constraint task_sessions_goal_session_date_type_key
  unique (goal_id, session_date, session_type);
