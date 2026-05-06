create table if not exists public.forecast_enterprise_deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users(id) on delete cascade,
  year integer not null check (year >= 2020 and year <= 2100),
  target_month integer not null check (target_month between 1 and 12),
  expected_go_lives numeric(10,2) not null check (expected_go_lives >= 0),
  arr_per_go_live numeric(14,2) not null check (arr_per_go_live >= 0),
  oak_id bigint null,
  account_name text null,
  is_active boolean not null default true,
  notes text null,
  constraint forecast_enterprise_deals_link_check check (oak_id is not null or account_name is not null)
);

create index if not exists idx_forecast_enterprise_deals_user_year
  on public.forecast_enterprise_deals(user_id, year, target_month);

create index if not exists idx_forecast_enterprise_deals_oak
  on public.forecast_enterprise_deals(oak_id)
  where oak_id is not null;

create or replace function public.set_forecast_enterprise_deals_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_forecast_enterprise_deals_updated_at on public.forecast_enterprise_deals;
create trigger trg_forecast_enterprise_deals_updated_at
before update on public.forecast_enterprise_deals
for each row
execute function public.set_forecast_enterprise_deals_updated_at();
