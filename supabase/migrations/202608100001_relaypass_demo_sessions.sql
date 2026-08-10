create table if not exists public.relaypass_demo_sessions (
  session_id text primary key,
  generation integer not null default 0 check (generation >= 0),
  revision bigint not null default 0 check (revision >= 0),
  actions jsonb not null default '[]'::jsonb,
  clock_origin timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint relaypass_demo_session_id_shape
    check (session_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint relaypass_demo_session_expiry_order
    check (expires_at > clock_origin),
  constraint relaypass_demo_session_timestamp_order
    check (clock_origin >= created_at and updated_at >= created_at and expires_at > updated_at),
  constraint relaypass_demo_session_actions_array
    check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 9),
  constraint relaypass_demo_session_actions_allowlist
    check (
      actions <@ '[
        "request_consent",
        "approve",
        "derive",
        "verify_flight",
        "forbidden_context",
        "over_budget_hotel",
        "dinner_disclosure",
        "revoke",
        "retry_revoked_flight"
      ]'::jsonb
    )
);

create index if not exists relaypass_demo_sessions_expires_at_idx
  on public.relaypass_demo_sessions (expires_at);

alter table public.relaypass_demo_sessions enable row level security;

revoke all on table public.relaypass_demo_sessions from public, anon, authenticated;
grant select, insert, update on table public.relaypass_demo_sessions to service_role;

comment on table public.relaypass_demo_sessions is
  'Server-only RelayPass presentation sessions. session_id is a SHA-256 lookup digest, not the browser bearer. Stores fixed demo action names only; never Passport values, credentials, JWS proofs, or signing keys.';

-- Retention operator contract: delete expired rows on an hourly schedule. Supabase Cron may run
-- this exact SQL after the operator enables it; the application does not expose a cleanup RPC:
--   delete from public.relaypass_demo_sessions where expires_at <= now();
