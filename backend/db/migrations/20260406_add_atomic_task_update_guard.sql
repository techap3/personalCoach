create or replace function public.update_task_if_session_not_completed(
  p_task_id text,
  p_status text,
  p_completed_at timestamptz,
  p_skipped_at timestamptz
)
returns setof public.tasks
language sql
security definer
set search_path = public
as $$
  update public.tasks t
  set
    status = p_status,
    completed_at = p_completed_at,
    skipped_at = p_skipped_at
  from public.task_sessions s
  where t.id::text = p_task_id
    and t.session_id = s.id
    and s.status <> 'completed'
  returning t.*;
$$;
