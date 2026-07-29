create table if not exists public.question_catalog (
  question_id text primary key,
  dataset_version text not null,
  subject text not null check (subject in ('physics','chemistry','biology','math')),
  topic_id text not null,
  paper_type text not null default 'UNKNOWN',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.question_catalog enable row level security;
revoke all on public.question_catalog from anon, authenticated;

create policy question_catalog_no_direct_client_access
on public.question_catalog
for all
to anon, authenticated
using (false)
with check (false);

create index if not exists question_catalog_dataset_subject_idx on public.question_catalog(dataset_version,subject) where active;
create index if not exists pet_progress_pet_id_idx on public.pet_progress(pet_id);
create index if not exists user_achievements_achievement_id_idx on public.user_achievements(achievement_id);
create index if not exists user_inventory_item_id_idx on public.user_inventory(item_id);

create or replace function private.validate_question_catalog_row()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1 from public.question_catalog q
    where q.question_id=new.question_id
      and q.subject=new.subject
      and q.dataset_version=new.dataset_version
      and q.active
  ) then
    raise exception 'Question is not part of the active website catalog' using errcode='22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_question_catalog_before_write on public.question_progress;
create trigger validate_question_catalog_before_write
before insert or update of question_id,subject,dataset_version on public.question_progress
for each row execute function private.validate_question_catalog_row();

revoke execute on function private.validate_question_catalog_row() from public,anon,authenticated;
