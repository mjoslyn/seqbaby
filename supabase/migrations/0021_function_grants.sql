-- Three functions the security advisor flags, and why each was open.
--
-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon and authenticated DIRECTLY, not through PUBLIC. So the
-- `revoke all ... from public` in 0005 never took anon's grant away, and a
-- definer function in `public` is an /rpc endpoint for whoever holds one.

-- Account deletion is for a signed-in user deleting themselves. Signed out,
-- auth.uid() is null and it deletes nothing, but it has no business being
-- callable. authenticated keeps it: that is the feature (app/account/actions.ts),
-- and the advisor's authenticated_security_definer_function_executable warning
-- for it is the intended state.
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- A trigger function. Postgres refuses to run one as a plain call, but it was
-- still listed as /rpc/handle_new_user. Nobody needs EXECUTE on it: the
-- privilege is checked when a trigger is CREATED, not when it fires, so signup
-- (supabase_auth_admin inserting into auth.users) is unaffected.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The one function with a mutable search_path. It calls only now(), and
-- pg_catalog is searched whatever the path says, so empty is safe.
alter function public.touch_updated_at() set search_path = '';
