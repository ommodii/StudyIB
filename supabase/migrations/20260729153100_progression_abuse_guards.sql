create or replace function public.record_mock_result(
  p_client_event_id text,
  p_subject text,
  p_paper_type text,
  p_total_questions integer,
  p_completed_questions integer,
  p_score_percent numeric,
  p_duration_seconds integer,
  p_topic_ids text[] default '{}',
  p_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inserted integer;
  v_rewarded_today integer;
  v_xp integer := 0;
  v_coins integer := 0;
  v_achievements text[];
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if length(p_client_event_id) not between 8 and 160
     or p_subject not in ('physics', 'chemistry', 'biology', 'math')
     or p_total_questions not between 1 and 200
     or p_completed_questions not between 0 and p_total_questions
     or p_score_percent not between 0 and 100
     or p_duration_seconds not between 0 and 86400 then
    raise exception 'Invalid mock result' using errcode = '22023';
  end if;

  perform private.ensure_user_rows(v_user);

  insert into public.mock_test_results (
    user_id, client_event_id, subject, paper_type, total_questions,
    completed_questions, score_percent, duration_seconds, topic_ids
  )
  values (
    v_user, p_client_event_id, p_subject, left(coalesce(p_paper_type, 'mixed'), 32),
    p_total_questions, p_completed_questions, p_score_percent, p_duration_seconds,
    coalesce(p_topic_ids, '{}')
  )
  on conflict (user_id, client_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'duplicate', true,
      'xp_awarded', 0,
      'coins_awarded', 0,
      'achievements', '[]'::jsonb
    );
  end if;

  select count(*)
  into v_rewarded_today
  from public.progression_events
  where user_id = v_user
    and event_type = 'mock'
    and created_at >= date_trunc('day', now());

  if v_rewarded_today < 3 and p_duration_seconds >= 30 then
    v_xp := least(1000, p_completed_questions * 25);
    v_coins := floor(v_xp / 5.0)::integer;

    insert into public.progression_events (
      user_id, event_key, event_type, subject, source_id,
      xp_delta, coins_delta, metadata
    )
    values (
      v_user, 'mock:' || p_client_event_id, 'mock', p_subject,
      p_client_event_id, v_xp, v_coins,
      jsonb_build_object('score_percent', p_score_percent)
    );

    perform private.apply_progression_delta(v_user, v_xp, v_coins);
    perform private.advance_equipped_pet(v_user, v_xp);
  end if;

  update public.progression_accounts
  set total_mock_tests = total_mock_tests + 1,
      updated_at = now()
  where user_id = v_user;

  update public.subject_statistics
  set mock_tests_completed = mock_tests_completed + 1,
      best_mock_percent = greatest(coalesce(best_mock_percent, 0), p_score_percent),
      total_study_seconds = total_study_seconds + p_duration_seconds,
      last_activity_at = now(),
      updated_at = now()
  where user_id = v_user and subject = p_subject;

  perform private.touch_streak(v_user, p_local_date);
  v_achievements := private.evaluate_achievements(v_user, p_score_percent);

  return jsonb_build_object(
    'duplicate', false,
    'reward_limited', v_rewarded_today >= 3 or p_duration_seconds < 30,
    'xp_awarded', v_xp,
    'coins_awarded', v_coins,
    'achievements', v_achievements
  );
end;
$$;

revoke all on function public.record_mock_result(text, text, text, integer, integer, numeric, integer, text[], date) from public, anon;
grant execute on function public.record_mock_result(text, text, text, integer, integer, numeric, integer, text[], date) to authenticated;
