-- Composio connection metadata.
--
-- Composio owns the Google credentials. This table exists so Cardea can name
-- which of its own users has connected which toolkit without asking the
-- provider on every render, and so a disconnect leaves a visible record.
--
-- What is deliberately NOT here: no access token, no refresh token, no
-- authorization code, no scope grant, no provider email address, no auth
-- config secret. Those live with Composio and must never be copied into
-- Postgres, into a log, or into a response body. The only provider-issued
-- value stored is `connected_account_id`, an opaque Composio handle that is
-- useless without the operator's server-side COMPOSIO_API_KEY.
--
-- Identity: `user_id` is `auth.users.id`, the same UUID used as the Composio
-- entity id. There is no profiles table and no second user vocabulary.

begin;

create table if not exists public.composio_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  toolkit text not null check (toolkit in ('gmail', 'googlecalendar')),
  connected_account_id text not null check (char_length(connected_account_id) between 1 and 120),
  status text not null check (status in ('connected', 'pending', 'disconnected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per user per toolkit: Cardea offers a single personal account per
  -- integration, so a reconnect updates the existing row rather than growing
  -- a history nobody reads.
  unique (user_id, toolkit)
);

create index if not exists composio_connections_user_idx
  on public.composio_connections (user_id);

alter table public.composio_connections enable row level security;

-- Written only by the server on behalf of the signed-in owner; the blanket
-- revoke in 20260826000300 means these grants are the entire client surface.
grant select, insert, update, delete on table public.composio_connections to authenticated;

-- Every policy is `user_id = auth.uid()` and nothing else. A row belonging to
-- another user is not visible, not updatable, and not deletable, so a foreign
-- connected-account id reads as absent rather than as forbidden.
create policy composio_connections_read_own
on public.composio_connections for select to authenticated
using (user_id = (select auth.uid()));

create policy composio_connections_insert_own
on public.composio_connections for insert to authenticated
with check (user_id = (select auth.uid()));

create policy composio_connections_update_own
on public.composio_connections for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy composio_connections_delete_own
on public.composio_connections for delete to authenticated
using (user_id = (select auth.uid()));

commit;
