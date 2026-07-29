-- StudyIB account-backed progression and cosmetics.
-- This migration is additive: the two legacy profile tables are preserved.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  db_data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  appearance text not null default 'dark' check (appearance in ('dark', 'light', 'system')),
  reduced_motion boolean not null default false,
  sound_enabled boolean not null default true,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progression_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  level smallint not null default 1 check (level between 1 and 45),
  coins bigint not null default 50 check (coins >= 0),
  streak_count integer not null default 0 check (streak_count >= 0),
  streak_best integer not null default 0 check (streak_best >= 0),
  last_activity_date date,
  total_questions_completed integer not null default 0 check (total_questions_completed >= 0),
  total_mock_tests integer not null default 0 check (total_mock_tests >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_session_id text not null,
  subject text check (subject is null or subject in ('physics', 'chemistry', 'biology', 'math')),
  activity_type text not null check (activity_type in ('question', 'mock', 'review', 'notes', 'timer', 'other')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 86400),
  questions_completed integer not null default 0 check (questions_completed between 0 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_session_id)
);

create table if not exists public.question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  dataset_version text not null default '2026-07-28-v1',
  subject text not null check (subject in ('physics', 'chemistry', 'biology', 'math')),
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  completed_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count between 0 and 100000),
  mastery smallint not null default 0 check (mastery between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.mock_test_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  subject text not null check (subject in ('physics', 'chemistry', 'biology', 'math')),
  paper_type text not null default 'mixed',
  total_questions integer not null check (total_questions between 1 and 200),
  completed_questions integer not null check (completed_questions between 0 and total_questions),
  score_percent numeric(5,2) not null check (score_percent between 0 and 100),
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 86400),
  topic_ids text[] not null default '{}',
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create table if not exists public.subject_statistics (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('physics', 'chemistry', 'biology', 'math')),
  questions_completed integer not null default 0 check (questions_completed >= 0),
  mock_tests_completed integer not null default 0 check (mock_tests_completed >= 0),
  best_mock_percent numeric(5,2),
  total_study_seconds bigint not null default 0 check (total_study_seconds >= 0),
  last_activity_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, subject)
);

create table if not exists public.progression_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  event_type text not null check (event_type in ('question', 'mock', 'annotation', 'markscheme', 'timer', 'daily', 'blitz', 'achievement', 'import')),
  subject text check (subject is null or subject in ('physics', 'chemistry', 'biology', 'math')),
  source_id text,
  xp_delta integer not null default 0 check (xp_delta >= 0),
  coins_delta integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create table if not exists public.achievement_catalog (
  id text primary key,
  name text not null,
  description text not null,
  icon text not null,
  xp_reward integer not null default 0 check (xp_reward >= 0),
  coin_reward integer not null default 0 check (coin_reward >= 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_catalog(id),
  unlocked_at timestamptz not null default now(),
  reward_claimed_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table if not exists public.cosmetic_catalog (
  id text primary key,
  item_type text not null check (item_type in ('theme', 'pet', 'title')),
  name text not null,
  description text not null,
  cost integer not null check (cost >= 0),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.user_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.cosmetic_catalog(id),
  acquired_at timestamptz not null default now(),
  acquisition_type text not null default 'purchase' check (acquisition_type in ('purchase', 'achievement', 'import', 'grant')),
  primary key (user_id, item_id)
);

create table if not exists public.user_cosmetics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  equipped_theme text not null default 'default',
  equipped_pet text not null default 'none',
  equipped_title text not null default 'IB Student',
  pet_size numeric(4,2) not null default 1 check (pet_size between 0.60 and 1.80),
  pet_position jsonb not null default '{"x":null,"y":null}'::jsonb,
  pet_animations boolean not null default true,
  pet_draggable boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pet_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  pet_id text not null references public.cosmetic_catalog(id),
  friendship_xp bigint not null default 0 check (friendship_xp >= 0),
  friendship_level integer not null default 1 check (friendship_level between 1 and 100),
  last_reaction_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, pet_id)
);

create table if not exists public.local_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  import_key text not null,
  dataset_version text not null,
  imported_question_count integer not null default 0,
  imported_item_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (user_id),
  unique (user_id, import_key)
);

create index if not exists study_sessions_user_id_idx on public.study_sessions (user_id, started_at desc);
create index if not exists question_progress_user_subject_idx on public.question_progress (user_id, subject, completed_at);
create index if not exists mock_results_user_subject_idx on public.mock_test_results (user_id, subject, completed_at desc);
create index if not exists subject_statistics_user_id_idx on public.subject_statistics (user_id);
create index if not exists progression_events_user_created_idx on public.progression_events (user_id, created_at desc);
create index if not exists user_achievements_user_id_idx on public.user_achievements (user_id, unlocked_at desc);
create index if not exists user_inventory_user_id_idx on public.user_inventory (user_id, acquired_at desc);
create index if not exists pet_progress_user_id_idx on public.pet_progress (user_id);
create index if not exists local_imports_user_id_idx on public.local_imports (user_id);

insert into public.achievement_catalog (id, name, description, icon, xp_reward, coin_reward, sort_order) values
  ('first_question', 'First Step', 'Complete your first question.', 'spark', 25, 10, 10),
  ('first_mock', 'Dress Rehearsal', 'Finish your first mock test.', 'clipboard', 50, 15, 20),
  ('physics_25', 'Physics Momentum', 'Complete 25 Physics questions.', 'atom', 75, 25, 30),
  ('chemistry_25', 'Reaction Started', 'Complete 25 Chemistry questions.', 'flask', 75, 25, 31),
  ('biology_25', 'Life Learner', 'Complete 25 Biology questions.', 'leaf', 75, 25, 32),
  ('math_25', 'Proof of Progress', 'Complete 25 Mathematics questions.', 'sigma', 75, 25, 33),
  ('questions_100', 'Century', 'Complete 100 questions.', 'medal', 150, 50, 40),
  ('questions_500', 'Question Architect', 'Complete 500 questions.', 'trophy', 400, 120, 41),
  ('streak_3', 'Three-Day Rhythm', 'Study for three consecutive local days.', 'flame', 50, 15, 50),
  ('streak_7', 'Weekly Consistency', 'Study for seven consecutive local days.', 'flame', 125, 40, 51),
  ('mock_90', 'Exam Ready', 'Score at least 90% on a mock test.', 'star', 200, 75, 60)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  xp_reward = excluded.xp_reward,
  coin_reward = excluded.coin_reward,
  sort_order = excluded.sort_order,
  active = true;

insert into public.cosmetic_catalog (id, item_type, name, description, cost, metadata, sort_order) values
  ('galaxy', 'theme', 'Event Horizon', 'A drifting starfield and deep-space violet surfaces.', 300, '{"animated":true,"accent":"#818cf8"}', 10),
  ('nordic', 'theme', 'Polar Aurora', 'Slow aurora ribbons over cool arctic surfaces.', 240, '{"animated":true,"accent":"#2dd4bf"}', 11),
  ('cyberpunk', 'theme', 'Neon Grid', 'A restrained moving perspective grid.', 260, '{"animated":true,"accent":"#ec4899"}', 12),
  ('retro', 'theme', 'Terminal Matrix', 'Green phosphor accents and a scan-line texture.', 180, '{"animated":true,"accent":"#22c55e"}', 13),
  ('gold', 'theme', 'Solar Flare', 'Warm solar gradients and a subtle corona.', 220, '{"animated":true,"accent":"#f59e0b"}', 14),
  ('orbit', 'pet', 'Orbit', 'A curious satellite study companion.', 120, '{"color":"#818cf8"}', 20),
  ('quark', 'pet', 'Quark Fox', 'A tiny particle fox with excess energy.', 220, '{"color":"#fb7185"}', 21),
  ('axi', 'pet', 'Astro Axolotl', 'A zero-gravity companion from the cosmic pond.', 280, '{"color":"#2dd4bf"}', 22),
  ('comet', 'pet', 'Comet Cat', 'A stellar cat with a soft comet trail.', 340, '{"color":"#fbbf24"}', 23),
  ('survivor', 'title', 'IB Survivor', 'For students braving the diploma core.', 50, '{}', 30),
  ('conqueror', 'title', 'Syllabus Conqueror', 'For topic perfectionists.', 150, '{}', 31),
  ('elite', 'title', '7-Score Elite', 'For students pursuing the highest score.', 300, '{}', 32),
  ('quantum', 'title', 'Quantum Overlord', 'For complete science mastery.', 500, '{}', 33)
on conflict (id) do update set
  item_type = excluded.item_type,
  name = excluded.name,
  description = excluded.description,
  cost = excluded.cost,
  metadata = excluded.metadata,
  sort_order = excluded.sort_order,
  active = true;

create or replace function private.level_from_xp(p_xp bigint)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_level integer := 1;
  v_exponent numeric;
  v_needed bigint;
begin
  while v_level < 45 loop
    v_exponent := case when v_level + 1 > 37 then 2.15 when v_level + 1 > 24 then 1.75 else 1.45 end;
    v_needed := floor(120 * power(v_level::numeric, v_exponent));
    exit when greatest(p_xp, 0) < v_needed;
    v_level := v_level + 1;
  end loop;
  return v_level::smallint;
end;
$$;

create or replace function private.normalized_local_date(p_local_date date)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when p_local_date between current_date - 1 and current_date + 1 then p_local_date
    else current_date
  end;
$$;

create or replace function private.ensure_user_rows(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.progression_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.user_settings (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.user_cosmetics (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.subject_statistics (user_id, subject)
    select p_user_id, s from unnest(array['physics','chemistry','biology','math']) s
    on conflict (user_id, subject) do nothing;
end;
$$;

create or replace function private.touch_streak(p_user_id uuid, p_local_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := private.normalized_local_date(p_local_date);
  v_previous date;
  v_streak integer;
begin
  perform private.ensure_user_rows(p_user_id);
  select last_activity_date, streak_count into v_previous, v_streak
  from public.progression_accounts where user_id = p_user_id for update;
  if v_previous = v_date then return; end if;
  if v_previous = v_date - 1 then v_streak := v_streak + 1; else v_streak := 1; end if;
  update public.progression_accounts
  set streak_count = v_streak,
      streak_best = greatest(streak_best, v_streak),
      last_activity_date = v_date,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function private.apply_progression_delta(p_user_id uuid, p_xp integer, p_coins integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_user_rows(p_user_id);
  update public.progression_accounts
  set xp = greatest(0, xp + greatest(p_xp, 0)),
      coins = greatest(0, coins + p_coins),
      level = private.level_from_xp(greatest(0, xp + greatest(p_xp, 0))),
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function private.advance_equipped_pet(p_user_id uuid, p_xp integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_pet text;
begin
  select equipped_pet into v_pet from public.user_cosmetics where user_id = p_user_id;
  if v_pet is null or v_pet = 'none' then return; end if;
  insert into public.pet_progress (user_id, pet_id, friendship_xp, friendship_level, last_reaction_at)
  values (p_user_id, v_pet, greatest(1, p_xp / 5), 1, now())
  on conflict (user_id, pet_id) do update
  set friendship_xp = public.pet_progress.friendship_xp + excluded.friendship_xp,
      friendship_level = least(100, 1 + floor(sqrt((public.pet_progress.friendship_xp + excluded.friendship_xp)::numeric) / 10)::integer),
      last_reaction_at = now(), updated_at = now();
end;
$$;

create or replace function private.unlock_achievement(p_user_id uuid, p_achievement_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_xp integer; v_coins integer; v_inserted integer;
begin
  insert into public.user_achievements (user_id, achievement_id)
  values (p_user_id, p_achievement_id)
  on conflict (user_id, achievement_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;
  select xp_reward, coin_reward into v_xp, v_coins from public.achievement_catalog where id = p_achievement_id and active;
  if not found then return false; end if;
  insert into public.progression_events (user_id, event_key, event_type, source_id, xp_delta, coins_delta)
  values (p_user_id, 'achievement:' || p_achievement_id, 'achievement', p_achievement_id, v_xp, v_coins)
  on conflict (user_id, event_key) do nothing;
  perform private.apply_progression_delta(p_user_id, v_xp, v_coins);
  return true;
end;
$$;

create or replace function private.evaluate_achievements(p_user_id uuid, p_latest_mock numeric default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare v_total integer; v_streak integer; v_mocks integer; v_subject text; v_count integer; v_unlocked text[] := '{}'; v_id text;
begin
  select total_questions_completed, streak_count, total_mock_tests into v_total, v_streak, v_mocks
  from public.progression_accounts where user_id = p_user_id;
  foreach v_id in array array['first_question','questions_100','questions_500','streak_3','streak_7','first_mock'] loop
    if (v_id='first_question' and v_total >= 1)
      or (v_id='questions_100' and v_total >= 100)
      or (v_id='questions_500' and v_total >= 500)
      or (v_id='streak_3' and v_streak >= 3)
      or (v_id='streak_7' and v_streak >= 7)
      or (v_id='first_mock' and v_mocks >= 1) then
      if private.unlock_achievement(p_user_id, v_id) then v_unlocked := array_append(v_unlocked, v_id); end if;
    end if;
  end loop;
  for v_subject, v_count in select subject, questions_completed from public.subject_statistics where user_id=p_user_id loop
    if v_count >= 25 then
      v_id := v_subject || '_25';
      if private.unlock_achievement(p_user_id, v_id) then v_unlocked := array_append(v_unlocked, v_id); end if;
    end if;
  end loop;
  if p_latest_mock is not null and p_latest_mock >= 90 and private.unlock_achievement(p_user_id, 'mock_90') then
    v_unlocked := array_append(v_unlocked, 'mock_90');
  end if;
  return v_unlocked;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'IB Student'), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  ) on conflict (id) do update set email = excluded.email;
  perform private.ensure_user_rows(new.id);
  return new;
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
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_expected_subject text;
  v_was_completed boolean := false;
  v_new_reward boolean := false;
  v_xp integer := 0;
  v_coins integer := 0;
  v_achievements text[] := '{}';
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_question_id !~ '^Content/TopicQuestionBank/2026-07-28-v1/(physics|chemistry|biology|math)/questions/[A-Za-z0-9_.-]+[.]pdf$' then
    raise exception 'Question is not part of the current website dataset' using errcode='22023';
  end if;
  v_expected_subject := substring(p_question_id from '^Content/TopicQuestionBank/2026-07-28-v1/([^/]+)/');
  if p_subject not in ('physics','chemistry','biology','math') or p_subject <> v_expected_subject then
    raise exception 'Question subject does not match the dataset path' using errcode='22023';
  end if;
  perform private.ensure_user_rows(v_user);
  select completed_at is not null into v_was_completed from public.question_progress
  where user_id=v_user and question_id=p_question_id for update;
  if not found then
    insert into public.question_progress (user_id, question_id, subject, completed_at)
    values (v_user, p_question_id, p_subject, case when p_completed then now() else null end);
    v_was_completed := false;
  else
    update public.question_progress
    set completed_at = case when p_completed then coalesce(completed_at, now()) else null end,
        last_viewed_at = now(),
        attempt_count = attempt_count + case when p_completed and not v_was_completed then 1 else 0 end,
        updated_at = now()
    where user_id=v_user and question_id=p_question_id;
  end if;
  if p_completed and not v_was_completed then
    update public.subject_statistics set questions_completed=questions_completed+1,last_activity_at=now(),updated_at=now()
    where user_id=v_user and subject=p_subject;
    update public.progression_accounts set total_questions_completed=total_questions_completed+1,updated_at=now() where user_id=v_user;
    v_xp := case when p_question_id ~ '_p1_' then 10 else 50 end;
    v_coins := floor(v_xp / 5.0)::integer;
    insert into public.progression_events (user_id,event_key,event_type,subject,source_id,xp_delta,coins_delta)
    values (v_user,'question:'||p_question_id,'question',p_subject,p_question_id,v_xp,v_coins)
    on conflict (user_id,event_key) do nothing;
    get diagnostics v_xp = row_count;
    if v_xp = 1 then
      v_new_reward := true;
      v_xp := case when p_question_id ~ '_p1_' then 10 else 50 end;
      v_coins := floor(v_xp / 5.0)::integer;
      perform private.apply_progression_delta(v_user,v_xp,v_coins);
      perform private.advance_equipped_pet(v_user,v_xp);
    else v_xp:=0; v_coins:=0; end if;
    perform private.touch_streak(v_user,p_local_date);
    v_achievements := private.evaluate_achievements(v_user,null);
  elsif not p_completed and v_was_completed then
    update public.subject_statistics set questions_completed=greatest(0,questions_completed-1),updated_at=now()
    where user_id=v_user and subject=p_subject;
    update public.progression_accounts set total_questions_completed=greatest(0,total_questions_completed-1),updated_at=now() where user_id=v_user;
  end if;
  return jsonb_build_object('completed',p_completed,'new_reward',v_new_reward,'xp_awarded',v_xp,'coins_awarded',v_coins,'achievements',v_achievements);
end;
$$;

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
declare v_user uuid:=auth.uid(); v_inserted integer; v_xp integer; v_coins integer; v_achievements text[];
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_client_event_id) not between 8 and 160 or p_subject not in ('physics','chemistry','biology','math')
     or p_total_questions not between 1 and 200 or p_completed_questions not between 0 and p_total_questions
     or p_score_percent not between 0 and 100 or p_duration_seconds not between 0 and 86400 then
    raise exception 'Invalid mock result' using errcode='22023';
  end if;
  perform private.ensure_user_rows(v_user);
  insert into public.mock_test_results(user_id,client_event_id,subject,paper_type,total_questions,completed_questions,score_percent,duration_seconds,topic_ids)
  values(v_user,p_client_event_id,p_subject,left(coalesce(p_paper_type,'mixed'),32),p_total_questions,p_completed_questions,p_score_percent,p_duration_seconds,coalesce(p_topic_ids,'{}'))
  on conflict(user_id,client_event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return jsonb_build_object('duplicate',true,'xp_awarded',0,'coins_awarded',0,'achievements','[]'::jsonb); end if;
  v_xp:=least(1000,p_completed_questions*25); v_coins:=floor(v_xp/5.0)::integer;
  insert into public.progression_events(user_id,event_key,event_type,subject,source_id,xp_delta,coins_delta,metadata)
  values(v_user,'mock:'||p_client_event_id,'mock',p_subject,p_client_event_id,v_xp,v_coins,jsonb_build_object('score_percent',p_score_percent));
  perform private.apply_progression_delta(v_user,v_xp,v_coins);
  perform private.advance_equipped_pet(v_user,v_xp);
  update public.progression_accounts set total_mock_tests=total_mock_tests+1,updated_at=now() where user_id=v_user;
  update public.subject_statistics set mock_tests_completed=mock_tests_completed+1,best_mock_percent=greatest(coalesce(best_mock_percent,0),p_score_percent),total_study_seconds=total_study_seconds+p_duration_seconds,last_activity_at=now(),updated_at=now()
  where user_id=v_user and subject=p_subject;
  perform private.touch_streak(v_user,p_local_date);
  v_achievements:=private.evaluate_achievements(v_user,p_score_percent);
  return jsonb_build_object('duplicate',false,'xp_awarded',v_xp,'coins_awarded',v_coins,'achievements',v_achievements);
end;
$$;

create or replace function public.record_study_reward(
  p_event_type text,
  p_source_id text,
  p_subject text default null,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid:=auth.uid(); v_key text; v_xp integer; v_bonus integer; v_count integer; v_inserted integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_event_type not in ('annotation','markscheme','timer','daily','blitz') then raise exception 'Unsupported reward type' using errcode='22023'; end if;
  if p_subject is not null and p_subject not in ('physics','chemistry','biology','math') then raise exception 'Invalid subject' using errcode='22023'; end if;
  if length(coalesce(p_source_id,'')) not between 1 and 512 then raise exception 'Invalid reward source' using errcode='22023'; end if;
  select count(*) into v_count from public.progression_events where user_id=v_user and event_type=p_event_type and created_at>=date_trunc('day',now());
  if v_count >= (case p_event_type when 'annotation' then 3 when 'markscheme' then 5 else 1 end) then
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
  p_client_session_id text,p_subject text,p_activity_type text,p_started_at timestamptz,p_ended_at timestamptz,p_duration_seconds integer,p_questions_completed integer,p_metadata jsonb default '{}'
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_id bigint;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_client_session_id) not between 8 and 160 or p_activity_type not in ('question','mock','review','notes','timer','other') or (p_subject is not null and p_subject not in ('physics','chemistry','biology','math')) or p_duration_seconds not between 0 and 86400 or p_questions_completed not between 0 and 1000 then raise exception 'Invalid study session' using errcode='22023'; end if;
  insert into public.study_sessions(user_id,client_session_id,subject,activity_type,started_at,ended_at,duration_seconds,questions_completed,metadata)
  values(v_user,p_client_session_id,p_subject,p_activity_type,p_started_at,p_ended_at,p_duration_seconds,p_questions_completed,coalesce(p_metadata,'{}'))
  on conflict(user_id,client_session_id) do update set ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,questions_completed=excluded.questions_completed,metadata=excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.purchase_cosmetic(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_cost integer; v_type text; v_balance bigint; v_inserted integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform private.ensure_user_rows(v_user);
  select cost,item_type into v_cost,v_type from public.cosmetic_catalog where id=p_item_id and active;
  if not found then raise exception 'Unknown cosmetic' using errcode='22023'; end if;
  if exists(select 1 from public.user_inventory where user_id=v_user and item_id=p_item_id) then
    select coins into v_balance from public.progression_accounts where user_id=v_user;
    return jsonb_build_object('purchased',false,'already_owned',true,'coins',v_balance,'item_type',v_type);
  end if;
  select coins into v_balance from public.progression_accounts where user_id=v_user for update;
  if v_balance<v_cost then raise exception 'Not enough coins' using errcode='P0001'; end if;
  insert into public.user_inventory(user_id,item_id,acquisition_type) values(v_user,p_item_id,'purchase') on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then update public.progression_accounts set coins=coins-v_cost,updated_at=now() where user_id=v_user returning coins into v_balance; end if;
  return jsonb_build_object('purchased',v_inserted=1,'already_owned',v_inserted=0,'coins',v_balance,'item_type',v_type);
end;
$$;

create or replace function public.equip_cosmetic(p_item_type text,p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_catalog_type text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform private.ensure_user_rows(v_user);
  if (p_item_type='theme' and p_item_id='default') or (p_item_type='pet' and p_item_id='none') or (p_item_type='title' and p_item_id='IB Student') then null;
  else
    select item_type into v_catalog_type from public.cosmetic_catalog c join public.user_inventory i on i.item_id=c.id where i.user_id=v_user and c.id=p_item_id and c.active;
    if not found or v_catalog_type<>p_item_type then raise exception 'Cosmetic is not owned' using errcode='42501'; end if;
  end if;
  update public.user_cosmetics set
    equipped_theme=case when p_item_type='theme' then p_item_id else equipped_theme end,
    equipped_pet=case when p_item_type='pet' then p_item_id else equipped_pet end,
    equipped_title=case when p_item_type='title' then p_item_id else equipped_title end,
    updated_at=now()
  where user_id=v_user;
  return (select to_jsonb(c) from public.user_cosmetics c where c.user_id=v_user);
end;
$$;

create or replace function public.update_pet_preferences(p_size numeric,p_position jsonb,p_animations boolean,p_draggable boolean)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_size not between .60 and 1.80 or jsonb_typeof(coalesce(p_position,'{}'))<>'object' then raise exception 'Invalid pet preferences' using errcode='22023'; end if;
  perform private.ensure_user_rows(v_user);
  update public.user_cosmetics set pet_size=p_size,pet_position=coalesce(p_position,'{"x":null,"y":null}'),pet_animations=coalesce(p_animations,true),pet_draggable=coalesce(p_draggable,true),updated_at=now() where user_id=v_user;
  return (select to_jsonb(c) from public.user_cosmetics c where c.user_id=v_user);
end;
$$;

create or replace function public.import_local_progress(p_import_key text,p_dataset_version text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_question text; v_subject text; v_count integer:=0; v_items integer:=0; v_item text; v_claimed_xp bigint; v_claimed_coins bigint; v_calc_xp bigint:=0; v_existing integer;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if length(p_import_key) not between 8 and 160 or p_dataset_version<>'2026-07-28-v1' or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid import payload' using errcode='22023'; end if;
  perform private.ensure_user_rows(v_user);
  select count(*) into v_existing from public.local_imports where user_id=v_user;
  if v_existing>0 then return jsonb_build_object('imported',false,'already_imported',true); end if;
  for v_question in select jsonb_array_elements_text(coalesce(p_payload->'completed','[]')) loop
    if v_question ~ '^Content/TopicQuestionBank/2026-07-28-v1/(physics|chemistry|biology|math)/questions/[A-Za-z0-9_.-]+[.]pdf$' then
      v_subject:=substring(v_question from '^Content/TopicQuestionBank/2026-07-28-v1/([^/]+)/');
      insert into public.question_progress(user_id,question_id,subject,completed_at) values(v_user,v_question,v_subject,now()) on conflict(user_id,question_id) do nothing;
      get diagnostics v_existing=row_count;
      if v_existing=1 then
        v_count:=v_count+1; v_calc_xp:=v_calc_xp+case when v_question~'_p1_' then 10 else 50 end;
        update public.subject_statistics set questions_completed=questions_completed+1,last_activity_at=now(),updated_at=now() where user_id=v_user and subject=v_subject;
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
  update public.progression_accounts set xp=greatest(xp,v_claimed_xp),coins=case when total_questions_completed=0 then v_claimed_coins else coins end,total_questions_completed=total_questions_completed+v_count,level=private.level_from_xp(greatest(xp,v_claimed_xp)),updated_at=now() where user_id=v_user;
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

create or replace function public.get_account_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'profile',(select to_jsonb(p) from public.profiles p where p.id=auth.uid()),
    'settings',(select to_jsonb(s) from public.user_settings s where s.user_id=auth.uid()),
    'progression',(select to_jsonb(a) from public.progression_accounts a where a.user_id=auth.uid()),
    'subject_statistics',coalesce((select jsonb_agg(to_jsonb(ss) order by ss.subject) from public.subject_statistics ss where ss.user_id=auth.uid()),'[]'::jsonb),
    'question_progress',coalesce((select jsonb_agg(to_jsonb(q)) from public.question_progress q where q.user_id=auth.uid()),'[]'::jsonb),
    'mock_results',coalesce((select jsonb_agg(to_jsonb(m) order by m.completed_at desc) from public.mock_test_results m where m.user_id=auth.uid()),'[]'::jsonb),
    'achievements',coalesce((select jsonb_agg(to_jsonb(ua)||jsonb_build_object('definition',to_jsonb(ac)) order by ua.unlocked_at desc) from public.user_achievements ua join public.achievement_catalog ac on ac.id=ua.achievement_id where ua.user_id=auth.uid()),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('item',to_jsonb(c)) order by i.acquired_at desc) from public.user_inventory i join public.cosmetic_catalog c on c.id=i.item_id where i.user_id=auth.uid()),'[]'::jsonb),
    'cosmetics',(select to_jsonb(c) from public.user_cosmetics c where c.user_id=auth.uid()),
    'pets',coalesce((select jsonb_agg(to_jsonb(pp)) from public.pet_progress pp where pp.user_id=auth.uid()),'[]'::jsonb),
    'local_import',(select to_jsonb(li) from public.local_imports li where li.user_id=auth.uid())
  ) end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  delete from auth.users where id=v_user;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.progression_accounts enable row level security;
alter table public.study_sessions enable row level security;
alter table public.question_progress enable row level security;
alter table public.mock_test_results enable row level security;
alter table public.subject_statistics enable row level security;
alter table public.progression_events enable row level security;
alter table public.achievement_catalog enable row level security;
alter table public.user_achievements enable row level security;
alter table public.cosmetic_catalog enable row level security;
alter table public.user_inventory enable row level security;
alter table public.user_cosmetics enable row level security;
alter table public.pet_progress enable row level security;
alter table public.local_imports enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

drop policy if exists "Users can insert their own profile." on public.user_profiles;
drop policy if exists "Users can update their own profile." on public.user_profiles;
drop policy if exists "Users can view their own profile." on public.user_profiles;
create policy legacy_profiles_select_own on public.user_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy legacy_profiles_insert_own on public.user_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy legacy_profiles_update_own on public.user_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create policy user_settings_select_own on public.user_settings for select to authenticated using ((select auth.uid())=user_id);
create policy user_settings_update_own on public.user_settings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy progression_select_own on public.progression_accounts for select to authenticated using ((select auth.uid())=user_id);
create policy study_sessions_select_own on public.study_sessions for select to authenticated using ((select auth.uid())=user_id);
create policy question_progress_select_own on public.question_progress for select to authenticated using ((select auth.uid())=user_id);
create policy mock_results_select_own on public.mock_test_results for select to authenticated using ((select auth.uid())=user_id);
create policy subject_statistics_select_own on public.subject_statistics for select to authenticated using ((select auth.uid())=user_id);
create policy progression_events_select_own on public.progression_events for select to authenticated using ((select auth.uid())=user_id);
create policy achievements_catalog_read on public.achievement_catalog for select to anon,authenticated using (active);
create policy user_achievements_select_own on public.user_achievements for select to authenticated using ((select auth.uid())=user_id);
create policy cosmetics_catalog_read on public.cosmetic_catalog for select to anon,authenticated using (active);
create policy inventory_select_own on public.user_inventory for select to authenticated using ((select auth.uid())=user_id);
create policy user_cosmetics_select_own on public.user_cosmetics for select to authenticated using ((select auth.uid())=user_id);
create policy pet_progress_select_own on public.pet_progress for select to authenticated using ((select auth.uid())=user_id);
create policy local_imports_select_own on public.local_imports for select to authenticated using ((select auth.uid())=user_id);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.achievement_catalog, public.cosmetic_catalog to anon, authenticated;
grant select on public.profiles,public.user_profiles,public.user_settings,public.progression_accounts,public.study_sessions,public.question_progress,public.mock_test_results,public.subject_statistics,public.progression_events,public.user_achievements,public.user_inventory,public.user_cosmetics,public.pet_progress,public.local_imports to authenticated;
grant update(display_name,avatar_url,updated_at) on public.profiles to authenticated;
grant update(appearance,reduced_motion,sound_enabled,timezone,locale,updated_at) on public.user_settings to authenticated;
grant select,insert,update on public.user_profiles to authenticated;
grant usage,select on all sequences in schema public to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.set_question_completion(text,text,boolean,date) to authenticated;
grant execute on function public.record_mock_result(text,text,text,integer,integer,numeric,integer,text[],date) to authenticated;
grant execute on function public.record_study_reward(text,text,text,date) to authenticated;
grant execute on function public.save_study_session(text,text,text,timestamptz,timestamptz,integer,integer,jsonb) to authenticated;
grant execute on function public.purchase_cosmetic(text) to authenticated;
grant execute on function public.equip_cosmetic(text,text) to authenticated;
grant execute on function public.update_pet_preferences(numeric,jsonb,boolean,boolean) to authenticated;
grant execute on function public.import_local_progress(text,text,jsonb) to authenticated;
grant execute on function public.get_account_snapshot() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Make the current trigger function reachable by the auth trigger only.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
