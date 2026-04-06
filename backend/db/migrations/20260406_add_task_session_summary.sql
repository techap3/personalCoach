alter table if exists task_sessions
  add column if not exists summary_json jsonb;
