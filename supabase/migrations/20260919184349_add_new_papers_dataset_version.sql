-- Register the 2023-2025 paper release without invalidating progress recorded
-- against earlier immutable question identifiers.

alter table public.question_progress
  alter column dataset_version set default '2026-09-19-new-papers-v1';

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.import_local_progress(text,text,jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    '''2026-07-28-v1'',''2026-08-22-expanded-topicals-v1'',''2026-08-23-computer-science-v1''',
    '''2026-07-28-v1'',''2026-08-22-expanded-topicals-v1'',''2026-08-23-computer-science-v1'',''2026-09-19-new-papers-v1'''
  );
  execute v_definition;
end;
$migration$;

revoke all on function public.import_local_progress(text,text,jsonb) from public,anon;
grant execute on function public.import_local_progress(text,text,jsonb) to authenticated;
