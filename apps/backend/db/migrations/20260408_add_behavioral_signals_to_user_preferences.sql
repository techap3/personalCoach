do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_preferences'
  ) then
    alter table public.user_preferences
      add column if not exists skip_pattern jsonb default '{}'::jsonb,
      add column if not exists consistency_score double precision default 0,
      add column if not exists last_active timestamp;
  end if;
end
$$;
