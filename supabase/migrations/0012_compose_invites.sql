-- Invite codes: composing on the site's key without an account.
--
-- The compose panel could be paid for two ways and neither suits handing the
-- thing to somebody. The deploy's key needs an ACCOUNT, which is a signup in
-- front of a demo; a key of your own needs a console and a card. A code is
-- the third way in: minted by the site's owner, typed into the panel by
-- whoever was given it, good for a bounded number of turns on the deploy's
-- key and nothing else.
--
-- The whole design is in what a code can and cannot do:
--
--   * it buys TURNS, because a turn is what costs money. `max_turns` is the
--     budget the code was minted with, and a code that leaks costs that and
--     stops -- which is the only reason it is safe to hand one to a stranger.
--   * it buys compose and nothing else. It is not an account, it signs nobody
--     in, and it reaches no row in any other table here.
--   * it can be turned off (`revoked_at`) and it can run out (`expires_at`),
--     both without touching the deploy's key, which is the alternative and
--     would cut off everyone at once.
--
-- NOBODY READS THIS TABLE THROUGH THE API. There are no policies below, and
-- RLS with no policy denies everything -- so `anon` and `authenticated` get
-- nothing at all, not even a count, and a code cannot be enumerated by the
-- browser that is about to type one. The two ways in are the SECURITY DEFINER
-- function below, which answers about ONE code that the asker already knows,
-- and the secret key (`scripts/compose-invite.mjs`), which bypasses RLS and
-- is what minting requires. That is deliberate: a table any signed-in account
-- could write would let any account mint spend against the site's key.
--
-- The code is stored as typed rather than hashed. Hashing would mean a code
-- exists only in the moment it is printed, and the thing the owner actually
-- does with these is look up which one they gave to whom and read it out
-- again; with no reader but the service key, the hash buys little.

create table if not exists public.compose_invites (
  -- The code itself, normalized (lower case, no hyphens -- see
  -- lib/composeInvite.js, which is the one place that spelling lives).
  code         text primary key,
  -- Who it was minted for, in the minter's own words. Never shown to the
  -- visitor typing it: it is a note to the person who handed it out.
  label        text,
  -- The account that minted it, when there was one. Null for a code minted by
  -- the script with nothing but the secret key, which is the ordinary case --
  -- hence ON DELETE SET NULL rather than CASCADE: deleting an account must
  -- not silently cut off codes that are out in the world.
  created_by   uuid references auth.users (id) on delete set null,
  -- The budget, in turns. Null means uncapped, which is a thing to mint
  -- knowingly and is why the script asks for a number unless told otherwise.
  max_turns    integer check (max_turns is null or max_turns > 0),
  turns_used   integer not null default 0,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- Which codes are still worth anything, for the script's listing. Partial, so
-- a pile of spent codes costs nothing to keep.
create index if not exists compose_invites_live_idx
  on public.compose_invites (created_at desc)
  where revoked_at is null;

alter table public.compose_invites enable row level security;
-- and deliberately no policies. See the header.

-- The one way a code is checked or spent.
--
-- SECURITY DEFINER because the table is unreadable by the roles that call
-- this; it answers about the ONE code it was handed and never reveals that
-- any other exists. `p_consume` is what makes it two operations in one
-- function rather than two functions that could disagree about what "valid"
-- means:
--
--   false  the panel's typo check, and the route's look before it starts a
--          job -- a code that is expired or spent should be told so without
--          a job record being written for it
--   true   the turn is starting; spend one
--
-- The route does both, in that order, because the alternative orderings are
-- each wrong in their own way: spending first burns a turn whenever the
-- site's own rate limit then refuses the job, and never spending at the start
-- leaves the budget to be enforced by something that runs after the money
-- does.
create or replace function public.redeem_compose_invite(p_code text, p_consume boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.compose_invites;
  v_code text := lower(replace(replace(coalesce(trim(p_code), ''), '-', ''), ' ', ''));
  left_after integer;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'no code');
  end if;

  -- FOR UPDATE, so two turns started at once on the last remaining turn of a
  -- code cannot both read the same `turns_used` and both spend it.
  select * into inv from public.compose_invites where compose_invites.code = v_code for update;

  -- The same answer for a code that was never minted as for one that was
  -- deleted, and nothing about which. Guessing is not a strategy against 31^12
  -- codes, and saying more would only help someone trying.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'that code isn''t one this site knows');
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'that code has been turned off');
  end if;
  if inv.expires_at is not null and inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'that code has expired');
  end if;
  if inv.max_turns is not null and inv.turns_used >= inv.max_turns then
    return jsonb_build_object('ok', false, 'reason', 'that code has been used up');
  end if;

  if p_consume then
    update public.compose_invites
       set turns_used = turns_used + 1, last_used_at = now()
     where compose_invites.code = inv.code;
  end if;

  left_after := case
    when inv.max_turns is null then null
    else inv.max_turns - inv.turns_used - (case when p_consume then 1 else 0 end)
  end;
  return jsonb_build_object('ok', true, 'remaining', left_after);
end;
$$;

revoke all on function public.redeem_compose_invite(text, boolean) from public;
grant execute on function public.redeem_compose_invite(text, boolean) to anon, authenticated;
