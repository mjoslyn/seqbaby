-- Subscription levels, suspensions, and what admins did.
--
-- A plan is a name from lib/plans.js (free, pro), validated there rather than
-- by a CHECK so a new level is a code change, not a migration. `plan_until`
-- is when a granted plan lapses back to free (null: it does not). Both are
-- set from the admin page only (app/admin), never by the account itself.
--
-- `suspended` stops the account signing in (lib/auth/config.js's session
-- hook) and its sessions are deleted when it is set.

alter table profiles add column plan text not null default 'free';
alter table profiles add column plan_until text;
alter table profiles add column suspended integer not null default 0;

create table admin_log (
  id        integer primary key autoincrement,
  at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  admin_id  text,                 -- who did it (no foreign key: kept after either account goes)
  target_id text,                 -- whose account
  target    text,                 -- their email at the time, so the log still reads after a delete
  action    text not null,        -- plan | suspend | unsuspend | signout | delete
  detail    text
);
create index admin_log_at_idx on admin_log (at desc);
