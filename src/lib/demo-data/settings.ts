// Demo AE Settings - Realistische Targets für 2026
import { AESettings } from '../types';

// Monatliche Targets (typisches Ramp-up Pattern)
const STANDARD_MONTHLY_SUBS_TARGETS = [
  30000,  // Jan
  32000,  // Feb
  35000,  // Mar
  38000,  // Apr
  40000,  // May
  42000,  // Jun
  40000,  // Jul (Sommerloch)
  38000,  // Aug (Sommerloch)
  45000,  // Sep
  48000,  // Oct
  50000,  // Nov
  45000,  // Dec (Jahresende)
];

const STANDARD_MONTHLY_PAY_TARGETS = [
  8000,   // Jan
  9000,   // Feb
  10000,  // Mar
  11000,  // Apr
  12000,  // May
  13000,  // Jun
  12000,  // Jul
  11000,  // Aug
  14000,  // Sep
  15000,  // Oct
  16000,  // Nov
  14000,  // Dec
];

const STANDARD_MONTHLY_GO_LIVE_TARGETS = [
  15, 16, 18, 20, 21, 22, 21, 20, 24, 25, 26, 24
];

// Standard Provisions-Stufen
const STANDARD_SUBS_TIERS = [
  { label: '0-50%', min: 0, max: 0.5, rate: 0.05 },
  { label: '50-100%', min: 0.5, max: 1, rate: 0.10 },
  { label: '100-120%', min: 1, max: 1.2, rate: 0.12 },
  { label: '>120%', min: 1.2, max: Infinity, rate: 0.15 },
];

const STANDARD_PAY_TIERS = [
  { label: '0-50%', min: 0, max: 0.5, rate: 0.03 },
  { label: '50-100%', min: 0.5, max: 1, rate: 0.05 },
  { label: '100-120%', min: 1, max: 1.2, rate: 0.07 },
  { label: '>120%', min: 1.2, max: Infinity, rate: 0.10 },
];

// Basis-Settings Template
const createDemoSettings = (
  id: string,
  userId: string,
  ote: number,
  subsMultiplier: number,
  payMultiplier: number
): AESettings => ({
  id,
  user_id: userId,
  year: 2026,
  region: 'DACH',
  ote,
  monthly_go_live_targets: STANDARD_MONTHLY_GO_LIVE_TARGETS.map(t => Math.round(t * subsMultiplier)),
  avg_subs_bill: 155,
  avg_pay_bill: 162,
  pay_arr_factor: 0.75,
  monthly_subs_targets: STANDARD_MONTHLY_SUBS_TARGETS.map(t => Math.round(t * subsMultiplier)),
  monthly_pay_targets: STANDARD_MONTHLY_PAY_TARGETS.map(t => Math.round(t * payMultiplier)),
  terminal_base: 30,
  terminal_bonus: 50,
  terminal_penetration_threshold: 0.70,
  subs_tiers: STANDARD_SUBS_TIERS,
  pay_tiers: STANDARD_PAY_TIERS,
  created_at: '2025-12-01T10:00:00Z',
  updated_at: '2025-12-01T10:00:00Z',
});

export const DEMO_SETTINGS: Map<string, AESettings> = new Map([
  // Lisa Schmidt - Erfahrene AE, höhere Targets
  ['demo-user-1', createDemoSettings('demo-settings-1', 'demo-user-1', 85000, 1.1, 1.1)],
  
  // Max Weber - Standard AE
  ['demo-user-2', createDemoSettings('demo-settings-2', 'demo-user-2', 75000, 1.0, 1.0)],
  
  // Anna Müller - Neuere AE, etwas niedrigere Targets
  ['demo-user-3', createDemoSettings('demo-settings-3', 'demo-user-3', 70000, 0.9, 0.9)],
]);

// Helper um Settings als Array zu bekommen
export const DEMO_SETTINGS_ARRAY = Array.from(DEMO_SETTINGS.values());
