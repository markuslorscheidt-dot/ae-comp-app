-- 4-Wochen-Snapshots fuer LLM-Report-Historie (Delta vs. letzter Snapshot).
create table if not exists public.forecast_scenario_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null references public.users(id) on delete set null,
  year integer not null,
  forecast_net_arr double precision not null default 0,
  target_net_arr double precision not null default 0,
  forecast_subs_arr double precision not null default 0,
  forecast_pay_arr double precision not null default 0,
  forecast_churn_arr double precision not null default 0,
  forecast_weighted_pipeline_arr double precision not null default 0,
  snapshot_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_forecast_scenario_snapshots_user_year_created
  on public.forecast_scenario_snapshots(user_id, year, created_at desc);
