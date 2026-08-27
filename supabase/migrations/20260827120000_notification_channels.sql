-- Reach-me approvals: whether Cardea may email a person when a mission stops.
--
-- One row per person per channel kind. Today the only kind is 'email',
-- because the destination is already known and already proven: it is the
-- address the person signs in with, read from `auth.users` at send time.
--
-- There is deliberately NO address column. Storing a second copy of an email
-- address would mean a second thing to verify, a second thing to keep in sync
-- with the account, and a way to point Cardea's notifications at a mailbox
-- the account holder does not own. A row here says "yes, reach me", nothing
-- more.
--
-- What is deliberately NOT here: no address, no message history, no mission
-- content, no provider key. This table is a preference, not a mailbox.
--
-- Turning it on is explicit opt-in: a row only ever appears because the
-- signed-in person asked for it. Nothing here is provisioned on signup.
--
-- Identity: `user_id` is `auth.users.id`, the same UUID used everywhere else.

begin;

create table if not exists public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One preference per person per kind: turning notifications back on
  -- updates the existing row rather than growing a history nobody reads.
  unique (user_id, kind)
);

create index if not exists notification_channels_user_idx
  on public.notification_channels (user_id);

alter table public.notification_channels enable row level security;

-- Written only by the server on behalf of the signed-in owner; the blanket
-- revoke in 20260826000300 means these grants are the entire client surface.
grant select, insert, update, delete on table public.notification_channels to authenticated;

-- Every policy is `user_id = auth.uid()` and nothing else. Another person's
-- preference is not visible, not updatable, and not deletable.
create policy notification_channels_read_own
on public.notification_channels for select to authenticated
using (user_id = (select auth.uid()));

create policy notification_channels_insert_own
on public.notification_channels for insert to authenticated
with check (user_id = (select auth.uid()));

create policy notification_channels_update_own
on public.notification_channels for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy notification_channels_delete_own
on public.notification_channels for delete to authenticated
using (user_id = (select auth.uid()));

commit;
