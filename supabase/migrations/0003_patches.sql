-- Phase 3: shareable patches. `config` is the same Tone.js patch JSON the engine
-- keeps in localStorage (seqbaby.patches.v1: { [name]: config }).

create table if not exists public.patches (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  engine_type text,
  config      jsonb not null,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists patches_owner_idx on public.patches (owner_id, updated_at desc);
create index if not exists patches_public_idx on public.patches (created_at desc) where is_public;

alter table public.patches enable row level security;

drop policy if exists "patches_owner_all" on public.patches;
create policy "patches_owner_all"
  on public.patches for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "patches_public_read" on public.patches;
create policy "patches_public_read"
  on public.patches for select
  using (is_public = true);

drop trigger if exists patches_touch_updated_at on public.patches;
create trigger patches_touch_updated_at
  before update on public.patches
  for each row execute function public.touch_updated_at();
