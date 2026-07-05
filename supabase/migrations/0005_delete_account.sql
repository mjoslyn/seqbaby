-- Self-service account deletion. A SECURITY DEFINER function (owned by a
-- privileged role) that only ever deletes the *calling* user's own auth row.
-- Deleting the auth.users row cascades to profiles, songs, and patches
-- (all FKs are ON DELETE CASCADE).

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
