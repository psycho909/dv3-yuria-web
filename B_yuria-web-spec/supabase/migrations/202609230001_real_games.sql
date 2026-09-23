create table if not exists public.real_games (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version = 1),
  revision integer not null check (revision >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists real_games_owner_updated_idx on public.real_games (user_id, updated_at desc);

alter table public.real_games enable row level security;

revoke all on public.real_games from anon;
grant select, insert, update on public.real_games to authenticated;

create policy "players can read own real games"
  on public.real_games for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "players can insert own real games"
  on public.real_games for insert to authenticated
  with check ((select auth.uid()) = user_id and (payload->>'source') = 'real_manual' and (payload->>'status') = 'recorded');

create policy "players can update own real games"
  on public.real_games for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (payload->>'source') = 'real_manual' and (payload->>'status') = 'recorded');
