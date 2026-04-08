do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_preferences'
  ) then
    alter table public.user_preferences
      add column if not exists current_streak integer default 0,
      add column if not exists last_completed_date date;
  end if;
end
$$;
