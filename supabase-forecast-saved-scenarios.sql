-- Persisted scenario snapshots for NET ARR forecast report.
create table if not exists public.forecast_saved_scenarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users(id) on delete cascade,
  year integer not null,
  title text not null,
  scenario_payload jsonb not null default '{}'::jsonb,
  report_headline text null,
  report_narrative text null,
  report_summary text[] not null default '{}'::text[]
);

create index if not exists idx_forecast_saved_scenarios_user_year_created
  on public.forecast_saved_scenarios(user_id, year, created_at desc);

create or replace function public.forecast_saved_scenarios_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_forecast_saved_scenarios_updated_at on public.forecast_saved_scenarios;
create trigger trg_forecast_saved_scenarios_updated_at
before update on public.forecast_saved_scenarios
for each row
execute function public.forecast_saved_scenarios_touch_updated_at();
