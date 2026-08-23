-- Add Computer Science HL to the account-backed progression system while
-- preserving every existing subject and question identifier.

alter table public.study_sessions drop constraint if exists study_sessions_subject_check;
alter table public.study_sessions add constraint study_sessions_subject_check
  check (subject is null or subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));

alter table public.question_progress drop constraint if exists question_progress_subject_check;
alter table public.question_progress add constraint question_progress_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));
alter table public.question_progress alter column dataset_version set default '2026-08-23-computer-science-v1';

alter table public.mock_test_results drop constraint if exists mock_test_results_subject_check;
alter table public.mock_test_results add constraint mock_test_results_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));

alter table public.subject_statistics drop constraint if exists subject_statistics_subject_check;
alter table public.subject_statistics add constraint subject_statistics_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));

alter table public.progression_events drop constraint if exists progression_events_subject_check;
alter table public.progression_events add constraint progression_events_subject_check
  check (subject is null or subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));

alter table public.question_catalog drop constraint if exists question_catalog_subject_check;
alter table public.question_catalog add constraint question_catalog_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics','computer_science'));

insert into public.achievement_catalog (id,name,description,icon,xp_reward,coin_reward,sort_order,active)
values ('computer_science_25','Code Breaker','Complete 25 Computer Science questions.','code-2',125,30,138,true)
on conflict (id) do update set
  name=excluded.name, description=excluded.description, icon=excluded.icon,
  xp_reward=excluded.xp_reward, coin_reward=excluded.coin_reward,
  sort_order=excluded.sort_order, active=excluded.active;

insert into public.subject_statistics (user_id,subject)
select a.user_id,'computer_science'
from public.progression_accounts a
on conflict (user_id,subject) do nothing;

-- The progression functions validate subjects internally. Recreate the current
-- definitions with Computer Science added, retaining all existing abuse guards.
do $migration$
declare
  v_signature regprocedure;
  v_definition text;
  v_old_subjects constant text := '''physics'',''chemistry'',''biology'',''math'',''math_ai'',''business'',''economics''';
  v_new_subjects constant text := '''physics'',''chemistry'',''biology'',''math'',''math_ai'',''business'',''economics'',''computer_science''';
begin
  foreach v_signature in array array[
    'private.ensure_user_rows(uuid)'::regprocedure,
    'public.set_question_completion(text,text,boolean,date)'::regprocedure,
    'public.record_mock_result(text,text,text,integer,integer,numeric,integer,text[],date)'::regprocedure,
    'public.record_study_reward(text,text,text,date)'::regprocedure,
    'public.save_study_session(text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,jsonb)'::regprocedure,
    'public.import_local_progress(text,text,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature::oid) into v_definition;
    v_definition := replace(v_definition, v_old_subjects, v_new_subjects);
    v_definition := replace(
      v_definition,
      '''2026-07-28-v1'',''2026-08-22-expanded-topicals-v1''',
      '''2026-07-28-v1'',''2026-08-22-expanded-topicals-v1'',''2026-08-23-computer-science-v1'''
    );
    execute v_definition;
  end loop;
end;
$migration$;

revoke all on function public.set_question_completion(text,text,boolean,date) from public,anon;
revoke all on function public.record_mock_result(text,text,text,integer,integer,numeric,integer,text[],date) from public,anon;
revoke all on function public.record_study_reward(text,text,text,date) from public,anon;
revoke all on function public.save_study_session(text,text,text,timestamptz,timestamptz,integer,integer,jsonb) from public,anon;
revoke all on function public.import_local_progress(text,text,jsonb) from public,anon;
grant execute on function public.set_question_completion(text,text,boolean,date) to authenticated;
grant execute on function public.record_mock_result(text,text,text,integer,integer,numeric,integer,text[],date) to authenticated;
grant execute on function public.record_study_reward(text,text,text,date) to authenticated;
grant execute on function public.save_study_session(text,text,text,timestamptz,timestamptz,integer,integer,jsonb) to authenticated;
grant execute on function public.import_local_progress(text,text,jsonb) to authenticated;
