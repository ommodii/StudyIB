-- Allow authenticated users to create their own settings row if an older
-- account predates the account-scaffolding trigger. RLS still prevents access
-- to every other user's settings.

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
on public.user_settings
for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant insert(user_id, appearance, reduced_motion, sound_enabled, timezone, locale, updated_at)
on public.user_settings
to authenticated;
