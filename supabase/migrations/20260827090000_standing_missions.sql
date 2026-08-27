-- Standing missions: a mandate someone approved once, on a schedule.
--
-- A standing mission is not a running mission and holds no state of its own
-- beyond the schedule. It is the durable record of one thing a person already
-- decided: "open this same mission, with this same authority, on this cadence."
-- The spawner reads it, opens an ordinary mission, and the ordinary mission
-- rules apply from that point on.
--
-- Recurrence never widens authority. `authority` here is the exact
-- AuthorityPolicy the owner approved when they created the row, and every run
-- carries a copy of it. Node-level hard stops and approvals still fire on
-- every run, because the spawned mission is an ordinary mission.
--
-- Identity: `user_id` is `auth.users.id`, matching composio_connections.
-- Standing missions are personal, not shared with everyone who can read the
-- tenant, so RLS is owner-only rather than tenant-scoped. `tenant_id` is kept
-- because the spawned mission needs one and it must not be re-derived (or
-- guessed) at spawn time.
--
-- Guests and judges cannot own a row: those doors exist precisely so no
-- account is involved, and an unattended recurring job needs an account to
-- charge quota to and an owner to stop for.

begin;

create table if not exists public.standing_missions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 8000),
  title text not null check (char_length(title) between 1 and 160),
  -- The captured AuthorityPolicy, the captured BudgetLimits, and the context
  -- cards the owner had selected. Copied onto every run verbatim.
  authority jsonb not null default '{}'::jsonb check (jsonb_typeof(authority) = 'object'),
  budget_limits jsonb not null default '{}'::jsonb check (jsonb_typeof(budget_limits) = 'object'),
  selected_context_card_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(selected_context_card_ids) = 'array'),
  cadence text not null check (cadence in ('daily', 'weekdays', 'weekly')),
  hour_utc smallint not null check (hour_utc between 0 and 23),
  enabled boolean not null default true,
  -- The start of the last run window this row was claimed for, not the moment
  -- the claim happened. That is what makes the claim a compare-and-set: a
  -- second sweep in the same window sees a stamp that is already >= this
  -- window's start and claims nothing. See `claimStandingWindow`.
  last_spawned_at timestamptz,
  -- Honest, bounded record of how the last claimed window actually ended:
  -- 'opened', 'quota_exhausted', 'failed', or 'opening' while in flight.
  -- Without it a skipped run is indistinguishable from a run that happened.
  last_run_note text check (last_run_note is null or char_length(last_run_note) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The sweep asks one question every 30 minutes: which enabled rows are due?
create index if not exists standing_missions_due_idx
  on public.standing_missions (enabled, hour_utc);

create index if not exists standing_missions_user_idx
  on public.standing_missions (user_id);

alter table public.standing_missions enable row level security;

-- The blanket revoke in 20260826000300 means these grants are the entire
-- client surface. Insert is deliberately absent: a row is only ever created by
-- the server through /api/standing-missions, which sets `user_id` from the
-- session and `tenant_id` from ensure_user_tenant. A browser cannot phrase an
-- insert that names another user or another tenant because it cannot insert.
grant select, delete on table public.standing_missions to authenticated;

-- Column-level update grant, not a table-level one. RLS decides *which rows* a
-- caller may write; only a column grant decides *which columns*. The owner may
-- pause, resume, and rename their schedule. They may not touch
-- `last_spawned_at`: that column is the spawner's compare-and-set claim, and an
-- owner who could rewind it could re-claim a window whose quota debit is
-- already recorded under that window's idempotency key, which would hand
-- themselves an unmetered run.
grant update (enabled, title, updated_at) on table public.standing_missions to authenticated;

-- Every policy is `user_id = auth.uid()` and nothing else, so another owner's
-- row reads as absent rather than as forbidden and a foreign id is a 404.
create policy standing_missions_read_own
on public.standing_missions for select to authenticated
using (user_id = (select auth.uid()));

-- Row scope for the column-limited update grant above: the owner's own rows,
-- and they may not move a row to another user.
create policy standing_missions_update_own
on public.standing_missions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy standing_missions_delete_own
on public.standing_missions for delete to authenticated
using (user_id = (select auth.uid()));

commit;
