-- Waitlist storage for landing-page signups.
-- Direct client access is blocked by RLS; writes should come from Edge Functions only.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  source text not null default 'website',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referral text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  signups_count integer not null default 1,
  turnstile_score numeric,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_signups_created_at_idx on public.waitlist_signups (created_at desc);
create index if not exists waitlist_signups_source_idx on public.waitlist_signups (source);
create index if not exists waitlist_signups_ip_hash_first_seen_idx on public.waitlist_signups (ip_hash, first_seen_at desc);

create or replace function public.set_waitlist_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists waitlist_signups_set_updated_at on public.waitlist_signups;
create trigger waitlist_signups_set_updated_at
before update on public.waitlist_signups
for each row
execute function public.set_waitlist_updated_at();

alter table public.waitlist_signups enable row level security;

-- No INSERT/UPDATE/SELECT policies by design:
-- anonymous/authenticated clients should not read or write waitlist rows directly.
