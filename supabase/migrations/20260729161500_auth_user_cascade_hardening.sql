alter table public.profiles
  drop constraint if exists profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users(id) on delete cascade;

alter table public.user_profiles
  drop constraint if exists user_profiles_user_id_fkey,
  add constraint user_profiles_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
