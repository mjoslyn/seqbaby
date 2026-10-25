-- The whole schema, for D1 (SQLite). It replaces supabase/migrations/0001..0024,
-- which built the same tables on Postgres with Row Level Security doing the
-- authorization. D1 has no RLS: every read and write goes through server code
-- (lib/data/*), and that code is where "only the owner" and "only if public"
-- are said now. test/data.test.js holds it to the rules the RLS tests held.
--
-- Conventions:
--   ids          text, a uuid from crypto.randomUUID() (Supabase's ids carry over)
--   timestamps   text, ISO-8601 UTC with milliseconds, so they sort as strings
--   booleans     integer 0 / 1 (lib/data/rows.ts turns them back into booleans)
--   json         text. A value too big for a D1 row (2MB) is kept in R2 and the
--                column holds {"$r2": "<key>"} instead (lib/data/blob.ts)

-- ---- auth (Better Auth's own tables, as its migration generator writes them) ----

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
create index "session_userId_idx" on "session" ("userId");

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index "account_userId_idx" on "account" ("userId");

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);
create index "verification_identifier_idx" on "verification" ("identifier");

-- ---- profiles: one per user, made when the user is (lib/auth.ts) -----------

create table profiles (
  id             text primary key references "user" (id) on delete cascade,
  -- The username is the name (Supabase migration 0013); display_name is kept
  -- equal to it for any reader still on that column.
  username       text not null,
  username_lower text generated always as (lower(username)) stored,
  display_name   text,
  avatar_url     text,
  -- A 16x16 step grid, one character a cell (app/profile/avatarGrid.js).
  avatar_grid    text check (
    avatar_grid is null or (length(avatar_grid) = 256 and avatar_grid not glob '*[^0-9a-d]*')
  ),
  bio            text,
  is_public      integer not null default 1,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create unique index profiles_username_lower_key on profiles (username_lower);

-- `update of` everything but updated_at: a write of updated_at alone (the
-- Supabase import putting an old row's date back) is left as written.
create trigger profiles_touch_updated_at
  after update of username, display_name, avatar_url, avatar_grid, bio, is_public on profiles
  for each row when new.updated_at is old.updated_at
begin
  update profiles set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = old.id;
end;

-- ---- songs -----------------------------------------------------------------

create table songs (
  id                  text primary key,
  owner_id            text not null references "user" (id) on delete cascade,
  title               text not null default 'untitled' check (length(title) <= 200),
  -- The serialized session, samples lifted out (app/songs/sampleStore.js).
  data                text not null,
  -- What the lists read without pulling `data` out, written with it
  -- (lib/data/songs.ts songColumns). Supabase computed these on read
  -- (`data->bpm`, preview(), engines()); here they are columns.
  bpm                 real,
  preview             text,
  engines             text not null default '[]',
  is_public           integer not null default 0,
  share_slug          text unique,
  forked_from         text references songs (id) on delete set null,
  current_version_id  text references song_versions (id) on delete set null,
  is_template         integer not null default 0,
  is_default_template integer not null default 0 check (not is_default_template or is_template),
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index songs_owner_idx on songs (owner_id, updated_at desc);
create index songs_public_idx on songs (is_public, updated_at desc);
-- At most one default template per account: setDefaultTemplate clears then
-- sets, and a second tab racing it can only fail its own write.
create unique index songs_one_default_template on songs (owner_id) where is_default_template;
create index songs_forked_from_idx on songs (forked_from) where forked_from is not null;

create trigger songs_touch_updated_at
  after update of owner_id, title, data, bpm, preview, engines, is_public, share_slug, forked_from,
                  current_version_id, is_template, is_default_template on songs
  for each row when new.updated_at is old.updated_at
begin
  update songs set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = old.id;
end;

-- ---- song versions: a tree, not a list ---------------------------------------

create table song_versions (
  id         text primary key,
  song_id    text not null references songs (id) on delete cascade,
  owner_id   text not null references "user" (id) on delete cascade,
  parent_id  text references song_versions (id) on delete cascade,
  data       text not null,
  data_hash  text not null default '',
  seq        integer not null,
  label      text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (song_id, seq)
);
create index song_versions_song_idx on song_versions (song_id, created_at);
create index song_versions_parent_idx on song_versions (parent_id);

-- ---- the compose conversation, one per song, its author's alone -------------

create table song_chats (
  song_id    text primary key references songs (id) on delete cascade,
  owner_id   text not null references "user" (id) on delete cascade,
  messages   text not null default '[]',
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---- likes -------------------------------------------------------------------

create table song_likes (
  song_id    text not null references songs (id) on delete cascade,
  user_id    text not null references "user" (id) on delete cascade,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (song_id, user_id)
);
create index song_likes_user_idx on song_likes (user_id, song_id);

-- ---- patches -------------------------------------------------------------------

create table patches (
  id          text primary key,
  owner_id    text not null references "user" (id) on delete cascade,
  name        text not null check (length(name) <= 120),
  engine_type text,
  config      text not null,
  -- Read out of `config` on write, so the cards and the bay index never pull
  -- a config (a sampler patch carries its sample as base64).
  engine_key  text,
  kind        text,
  drum        text,
  sample      text,
  is_public   integer not null default 0,
  saved_from  text references patches (id) on delete set null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index patches_owner_idx on patches (owner_id, created_at desc);
create index patches_public_idx on patches (is_public, created_at desc);
create index patches_saved_from_idx on patches (owner_id, saved_from) where saved_from is not null;

create trigger patches_touch_updated_at
  after update of owner_id, name, engine_type, config, engine_key, kind, drum, sample, is_public, saved_from on patches
  for each row when new.updated_at is old.updated_at
begin
  update patches set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = old.id;
end;

create table patch_likes (
  patch_id   text not null references patches (id) on delete cascade,
  user_id    text not null references "user" (id) on delete cascade,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (patch_id, user_id)
);
create index patch_likes_user_idx on patch_likes (user_id, patch_id);

-- ---- anonymous share links (the top bar's `share`) ------------------------------
--
-- Was Netlify Blobs (lib/api.js). The session itself is in R2 under
-- shares/<id>; this row is what a link preview reads without fetching it.

create table shares (
  id         text primary key,
  title      text,
  owner_id   text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---- small site-wide flags (the compose budget switch) ----------------------------

create table site_flags (
  key   text primary key,
  value integer not null default 0
);
