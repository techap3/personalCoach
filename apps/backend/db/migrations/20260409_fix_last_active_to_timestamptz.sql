do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_preferences'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_preferences'
      and column_name = 'last_active'
      and data_type = 'timestamp without time zone'
  ) then
    alter table public.user_preferences
      alter column last_active type timestamp with time zone
      using last_active at time zone 'UTC';
  end if;
end
$$;
