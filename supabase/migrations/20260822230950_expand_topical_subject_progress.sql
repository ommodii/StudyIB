-- Expand account-backed progression to every topical subject in the
-- 2026-08-22 website dataset. Existing question IDs and progress remain valid.

alter table public.study_sessions drop constraint if exists study_sessions_subject_check;
alter table public.study_sessions add constraint study_sessions_subject_check
  check (subject is null or subject in ('physics','chemistry','biology','math','math_ai','business','economics'));

alter table public.question_progress drop constraint if exists question_progress_subject_check;
alter table public.question_progress add constraint question_progress_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics'));
alter table public.question_progress alter column dataset_version set default '2026-08-22-expanded-topicals-v1';

alter table public.mock_test_results drop constraint if exists mock_test_results_subject_check;
alter table public.mock_test_results add constraint mock_test_results_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics'));

alter table public.subject_statistics drop constraint if exists subject_statistics_subject_check;
alter table public.subject_statistics add constraint subject_statistics_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics'));

alter table public.progression_events drop constraint if exists progression_events_subject_check;
alter table public.progression_events add constraint progression_events_subject_check
  check (subject is null or subject in ('physics','chemistry','biology','math','math_ai','business','economics'));

alter table public.question_catalog drop constraint if exists question_catalog_subject_check;
alter table public.question_catalog add constraint question_catalog_subject_check
  check (subject in ('physics','chemistry','biology','math','math_ai','business','economics'));

insert into public.achievement_catalog (id,name,description,icon,xp_reward,coin_reward,sort_order,active)
values
  ('math_ai_25','Mathematics AI Explorer','Complete 25 Mathematics AI questions.','calculator',125,30,135,true),
  ('business_25','Business Builder','Complete 25 Business Management questions.','briefcase',125,30,136,true),
  ('economics_25','Economics Analyst','Complete 25 Economics questions.','trending-up',125,30,137,true)
on conflict (id) do update set
  name=excluded.name, description=excluded.description, icon=excluded.icon,
  xp_reward=excluded.xp_reward, coin_reward=excluded.coin_reward,
  sort_order=excluded.sort_order, active=excluded.active;

insert into public.subject_statistics (user_id,subject)
select a.user_id,s.subject
from public.progression_accounts a
cross join unnest(array['math_ai','business','economics']) as s(subject)
on conflict (user_id,subject) do nothing;

create or replace function private.ensure_user_rows(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.progression_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  insert into public.user_settings(user_id) values(p_user_id) on conflict(user_id) do nothing;
  insert into public.user_cosmetics(user_id) values(p_user_id) on conflict(user_id) do nothing;
  insert into public.subject_statistics(user_id,subject)
    select p_user_id,s from unnest(array['physics','chemistry','biology','math','math_ai','business','economics']) s
    on conflict(user_id,subject) do nothing;
end;
$$;

create or replace function public.set_question_completion(
  p_question_id text,
  p_subject text,
  p_completed boolean,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_dataset_version text;
  v_was_completed boolean:=false;
  v_new_reward boolean:=false;
  v_inserted integer:=0;
  v_xp integer:=0;
  v_coins integer:=0;
  v_achievements text[]:='{}';
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_subject not in ('physics','chemistry','biology','math','math_ai','business','economics') then
    raise exception 'Invalid subject' using errcode='22023';
  end if;
  select q.dataset_version into v_dataset_version
  from public.question_catalog q
  where q.question_id=p_question_id and q.subject=p_subject and q.active;
  if not found then raise exception 'Question is not part of the active website catalog' using errcode='22023'; end if;

  perform private.ensure_user_rows(v_user);
  select completed_at is not null into v_was_completed
  from public.question_progress where user_id=v_user and question_id=p_question_id for update;
  if not found then
    insert into public.question_progress(user_id,question_id,dataset_version,subject,completed_at)
    values(v_user,p_question_id,v_dataset_version,p_subject,case when p_completed then now() else null end);
  else
    update public.question_progress
    set completed_at=case when p_completed then coalesce(completed_at,now()) else null end,
        last_viewed_at=now(),
        attempt_count=attempt_count+case when p_completed and not v_was_completed then 1 else 0 end,
        updated_at=now()
    where user_id=v_user and question_id=p_question_id;
  end if;

  if p_completed and not v_was_completed then
    update public.subject_statistics set questions_completed=questions_completed+1,last_activity_at=now(),updated_at=now()
    where user_id=v_user and subject=p_subject;
    update public.progression_accounts set total_questions_completed=total_questions_completed+1,updated_at=now()
    where user_id=v_user;
    v_xp:=case when p_question_id~'_p1_' then 10 else 50 end;
    v_coins:=floor(v_xp/5.0)::integer;
    insert into public.progression_events(user_id,event_key,event_type,subject,source_id,xp_delta,coins_delta)
    values(v_user,'question:'||p_question_id,'question',p_subject,p_question_id,v_xp,v_coins)
    on conflict(user_id,event_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted=1 then
      v_new_reward:=true;
      perform private.apply_progression_delta(v_user,v_xp,v_coins);
      perform private.advance_equipped_pet(v_user,v_xp);
    else
      v_xp:=0; v_coins:=0;
    end if;
    perform private.touch_streak(v_user,p_local_date);
    v_achievements:=private.evaluate_achievements(v_user,null);
  elsif not p_completed and v_was_completed then
    update public.subject_statistics set questions_completed=greatest(0,questions_completed-1),updated_at=now()
    where user_id=v_user and subject=p_subject;
    update public.progression_accounts set total_questions_completed=greatest(0,total_questions_completed-1),updated_at=now()
    where user_id=v_user;
  end if;
  return jsonb_build_object('completed',p_completed,'new_reward',v_new_reward,'xp_awarded',v_xp,'coins_awarded',v_coins,'achievements',v_achievements);
end;
$$;

create or replace function public.record_mock_result(
  p_client_event_id text,p_subject text,p_paper_type text,p_total_questions integer,
  p_completed_questions integer,p_score_percent numeric,p_duration_seconds integer,
  p_topic_ids text[] default '{}',p_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_inserted integer; v_rewarded_today integer; v_xp integer:=0; v_coins integer:=0; v_achievements text[];
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_client_event_id) not between 8 and 160
     or p_subject not in ('physics','chemistry','biology','math','math_ai','business','economics')
     or p_total_questions not between 1 and 200
     or p_completed_questions not between 0 and p_total_questions
     or p_score_percent not between 0 and 100
     or p_duration_seconds not between 0 and 86400 then
    raise exception 'Invalid mock result' using errcode='22023';
  end if;
  perform private.ensure_user_rows(v_user);
  insert into public.mock_test_results(user_id,client_event_id,subject,paper_type,total_questions,completed_questions,score_percent,duration_seconds,topic_ids)
  values(v_user,p_client_event_id,p_subject,left(coalesce(p_paper_type,'mixed'),32),p_total_questions,p_completed_questions,p_score_percent,p_duration_seconds,coalesce(p_topic_ids,'{}'))
  on conflict(user_id,client_event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return jsonb_build_object('duplicate',true,'xp_awarded',0,'coins_awarded',0,'achievements','[]'::jsonb); end if;
  select count(*) into v_rewarded_today from public.progression_events
  where user_id=v_user and event_type='mock' and created_at>=date_trunc('day',now());
  if v_rewarded_today<3 and p_duration_seconds>=30 then
    v_xp:=least(1000,p_completed_questions*25); v_coins:=floor(v_xp/5.0)::integer;
    insert into public.progression_events(user_id,event_key,event_type,subject,source_id,xp_delta,coins_delta,metadata)
    values(v_user,'mock:'||p_client_event_id,'mock',p_subject,p_client_event_id,v_xp,v_coins,jsonb_build_object('score_percent',p_score_percent));
    perform private.apply_progression_delta(v_user,v_xp,v_coins);
    perform private.advance_equipped_pet(v_user,v_xp);
  end if;
  update public.progression_accounts set total_mock_tests=total_mock_tests+1,updated_at=now() where user_id=v_user;
  update public.subject_statistics set mock_tests_completed=mock_tests_completed+1,
    best_mock_percent=greatest(coalesce(best_mock_percent,0),p_score_percent),
    total_study_seconds=total_study_seconds+p_duration_seconds,last_activity_at=now(),updated_at=now()
  where user_id=v_user and subject=p_subject;
  perform private.touch_streak(v_user,p_local_date);
  v_achievements:=private.evaluate_achievements(v_user,p_score_percent);
  return jsonb_build_object('duplicate',false,'reward_limited',v_rewarded_today>=3 or p_duration_seconds<30,'xp_awarded',v_xp,'coins_awarded',v_coins,'achievements',v_achievements);
end;
$$;

create or replace function public.record_study_reward(p_event_type text,p_source_id text,p_subject text default null,p_local_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_key text; v_xp integer; v_bonus integer; v_count integer; v_inserted integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_event_type not in ('annotation','markscheme','timer','daily','blitz') then raise exception 'Unsupported reward type' using errcode='22023'; end if;
  if p_subject is not null and p_subject not in ('physics','chemistry','biology','math','math_ai','business','economics') then raise exception 'Invalid subject' using errcode='22023'; end if;
  if length(coalesce(p_source_id,'')) not between 1 and 512 then raise exception 'Invalid reward source' using errcode='22023'; end if;
  select count(*) into v_count from public.progression_events where user_id=v_user and event_type=p_event_type and created_at>=date_trunc('day',now());
  if v_count>=(case p_event_type when 'annotation' then 3 when 'markscheme' then 5 else 1 end) then
    return jsonb_build_object('duplicate',true,'xp_awarded',0,'coins_awarded',0,'reason','daily_limit');
  end if;
  v_xp:=case p_event_type when 'annotation' then 15 when 'markscheme' then 20 when 'timer' then 15 when 'daily' then 50 else 100 end;
  v_bonus:=case p_event_type when 'daily' then 15 when 'blitz' then 25 else 0 end;
  v_key:=p_event_type||':'||p_source_id;
  insert into public.progression_events(user_id,event_key,event_type,subject,source_id,xp_delta,coins_delta)
  values(v_user,v_key,p_event_type,p_subject,p_source_id,v_xp,floor(v_xp/5.0)::integer+v_bonus)
  on conflict(user_id,event_key) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return jsonb_build_object('duplicate',true,'xp_awarded',0,'coins_awarded',0); end if;
  perform private.apply_progression_delta(v_user,v_xp,floor(v_xp/5.0)::integer+v_bonus);
  perform private.advance_equipped_pet(v_user,v_xp);
  perform private.touch_streak(v_user,p_local_date);
  return jsonb_build_object('duplicate',false,'xp_awarded',v_xp,'coins_awarded',floor(v_xp/5.0)::integer+v_bonus,'achievements',private.evaluate_achievements(v_user,null));
end;
$$;

create or replace function public.save_study_session(
  p_client_session_id text,p_subject text,p_activity_type text,p_started_at timestamptz,p_ended_at timestamptz,
  p_duration_seconds integer,p_questions_completed integer,p_metadata jsonb default '{}'
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_id bigint;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_client_session_id) not between 8 and 160
     or p_activity_type not in ('question','mock','review','notes','timer','other')
     or (p_subject is not null and p_subject not in ('physics','chemistry','biology','math','math_ai','business','economics'))
     or p_duration_seconds not between 0 and 86400 or p_questions_completed not between 0 and 1000 then
    raise exception 'Invalid study session' using errcode='22023';
  end if;
  insert into public.study_sessions(user_id,client_session_id,subject,activity_type,started_at,ended_at,duration_seconds,questions_completed,metadata)
  values(v_user,p_client_session_id,p_subject,p_activity_type,p_started_at,p_ended_at,p_duration_seconds,p_questions_completed,coalesce(p_metadata,'{}'))
  on conflict(user_id,client_session_id) do update set ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,questions_completed=excluded.questions_completed,metadata=excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.import_local_progress(p_import_key text,p_dataset_version text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid(); v_question text; v_subject text; v_catalog_version text;
  v_count integer:=0; v_items integer:=0; v_item text; v_claimed_xp bigint; v_claimed_coins bigint;
  v_calc_xp bigint:=0; v_existing integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_import_key) not between 8 and 160
     or p_dataset_version not in ('2026-07-28-v1','2026-08-22-expanded-topicals-v1')
     or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid import payload' using errcode='22023'; end if;
  perform private.ensure_user_rows(v_user);
  select count(*) into v_existing from public.local_imports where user_id=v_user;
  if v_existing>0 then return jsonb_build_object('imported',false,'already_imported',true); end if;
  for v_question in select jsonb_array_elements_text(coalesce(p_payload->'completed','[]')) loop
    select q.subject,q.dataset_version into v_subject,v_catalog_version
    from public.question_catalog q where q.question_id=v_question and q.active;
    if found then
      insert into public.question_progress(user_id,question_id,dataset_version,subject,completed_at)
      values(v_user,v_question,v_catalog_version,v_subject,now()) on conflict(user_id,question_id) do nothing;
      get diagnostics v_existing=row_count;
      if v_existing=1 then
        v_count:=v_count+1; v_calc_xp:=v_calc_xp+case when v_question~'_p1_' then 10 else 50 end;
        update public.subject_statistics set questions_completed=questions_completed+1,last_activity_at=now(),updated_at=now()
        where user_id=v_user and subject=v_subject;
      end if;
    end if;
  end loop;
  foreach v_item in array array['purchasedThemes','purchasedPets','purchasedTitles'] loop
    for v_question in select jsonb_array_elements_text(coalesce(p_payload->v_item,'[]')) loop
      insert into public.user_inventory(user_id,item_id,acquisition_type)
      select v_user,c.id,'import' from public.cosmetic_catalog c where c.id=v_question and c.active
      on conflict(user_id,item_id) do nothing;
      get diagnostics v_existing=row_count; v_items:=v_items+v_existing;
    end loop;
  end loop;
  v_claimed_xp:=greatest(0,least(coalesce((p_payload->>'xp')::bigint,0),v_calc_xp));
  v_claimed_coins:=greatest(0,least(coalesce((p_payload->>'coins')::bigint,50),50+floor(v_calc_xp/5.0)::bigint));
  update public.progression_accounts set xp=greatest(xp,v_claimed_xp),
    coins=case when total_questions_completed=0 then v_claimed_coins else coins end,
    total_questions_completed=total_questions_completed+v_count,
    level=private.level_from_xp(greatest(xp,v_claimed_xp)),updated_at=now() where user_id=v_user;
  update public.user_cosmetics set
    equipped_theme=case when exists(select 1 from public.user_inventory where user_id=v_user and item_id=p_payload->>'activeTheme') then p_payload->>'activeTheme' else equipped_theme end,
    equipped_pet=case when exists(select 1 from public.user_inventory where user_id=v_user and item_id=p_payload->>'activePet') then p_payload->>'activePet' else equipped_pet end,
    equipped_title=case when exists(select 1 from public.user_inventory where user_id=v_user and item_id=p_payload->>'activeTitle') then p_payload->>'activeTitle' else equipped_title end,
    updated_at=now() where user_id=v_user;
  insert into public.local_imports(user_id,import_key,dataset_version,imported_question_count,imported_item_count,summary)
  values(v_user,p_import_key,p_dataset_version,v_count,v_items,jsonb_build_object('calculated_xp',v_calc_xp,'accepted_xp',v_claimed_xp));
  perform private.touch_streak(v_user,current_date);
  perform private.evaluate_achievements(v_user,null);
  return jsonb_build_object('imported',true,'questions',v_count,'items',v_items,'accepted_xp',v_claimed_xp,'coins',v_claimed_coins);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid numeric values in import payload' using errcode='22023';
end;
$$;

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
