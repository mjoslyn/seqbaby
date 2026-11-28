-- Requests for the pro plan (lib/plans.js), made from /pro and answered on
-- /admin. There is no payment flow: an admin approves a request, which puts
-- the account on pro (profiles.plan) and is logged in admin_log.
--
-- At most one pending request per account (the partial unique index): asking
-- again while one waits updates nothing and says it is waiting.

create table pro_requests (
  id          text primary key,
  user_id     text not null references "user" (id) on delete cascade,
  message     text,                        -- what they make, in their words (500 chars)
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at  text,
  decided_by  text                         -- the admin's user id (no foreign key: kept after either goes)
);
create unique index pro_requests_one_pending on pro_requests (user_id) where status = 'pending';
create index pro_requests_status_idx on pro_requests (status, created_at desc);
