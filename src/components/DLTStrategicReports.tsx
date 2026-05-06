'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { User, GoLive, isPlannable, canReceiveGoLives, MONTH_NAMES, DEFAULT_SETTINGS } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import {
  useAllUsers,
  useMultiUserData,
  usePaymarginImportedCohortKeys,
  useUpDownsellsMonthly,
  useSmsMonthly,
  usePhorestPayMonthly,
} from '@/lib/hooks';
import {
  calculateYearSummary,
  formatCurrency,
  formatPercent,
  getAchievementColor,
  getEffectivePayArrForReporting,
  paymarginCohortKey,
  type PayArrReportingOptions,
} from '@/lib/calculations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ComposedChart, Bar } from 'recharts';
import PDFExportButton from './PDFExportButton';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScenarioReport, ScenarioReportInput } from '@/lib/forecastScenarioReport';
import { exportToPDFBlob, formatPDFFilename } from '@/lib/pdf-export';

/** Form für YTD-Monatsdaten (IST + Plan, wie Jahresübersicht) */
interface YtdMonthlyRow {
  month: number;
  go_lives_count: number;
  go_lives_target: number;
  terminals_count: number;
  terminal_penetration: number;
  subs_actual: number;
  subs_target: number;
  pay_actual: number;
  pay_target: number;
}

interface ChurnEventRow {
  id?: string;
  churn_month: string | null;
  gl_month?: string | null;
  scheduled: boolean | null;
  total_arr_lost: number | null;
  subs_revenue_lost?: number | null;
  pay_revenue_lost?: number | null;
  oak_id?: number | string | null;
  customer_name?: string | null;
  coo?: string | null;
  churn_reason?: string | null;
  package_name?: string | null;
}

interface MonthlyChurnRow {
  month: number;
  scheduledCount: number;
  nonScheduledCount: number;
  scheduledArrLost: number;
  nonScheduledArrLost: number;
  totalCount: number;
  totalArrLost: number;
}

/** Entspricht „Total ARR Lost“ in Churn pro Monat: total_arr_lost, sonst Subs + Pay. */
function effectiveTotalArrLost(event: ChurnEventRow): number {
  const raw = event.total_arr_lost;
  if (raw !== null && raw !== undefined && raw !== '') {
    const t = Number(raw);
    if (Number.isFinite(t) && Math.abs(t) > 0.005) return Math.abs(t);
  }
  const subs = Math.abs(Number(event.subs_revenue_lost) || 0);
  const pay = Math.abs(Number(event.pay_revenue_lost) || 0);
  return subs + pay;
}

interface SalespipeEventRow {
  id: string;
  opportunity_id: string;
  oak_id: number | null;
  opportunity_name: string;
  rating: string | null;
  next_step: string | null;
  stage: string | null;
  estimated_arr: number | null;
  probability: number | null;
  close_date: string | null;
  created_date: string | null;
  opportunity_owner: string | null;
  lead_source: string | null;
  source_tab: string | null;
}

interface SignupsEventRow {
  id: string;
  account_id: string;
  oak_id: number | null;
  account_name: string;
  account_owner: string | null;
  signup_package: string | null;
  signup_date: string | null;
  go_live_date: string | null;
  customer_info_stage: string | null;
}

interface LeadsEventRow {
  id: string;
  lead_id: string;
  opportunity_id: string | null;
  opportunity_account: string | null;
  company_account: string;
  lead_source: string | null;
  lead_owner: string | null;
  lead_status: string | null;
  lead_sub_status: string | null;
  demo_or_quote: string | null;
  created_date: string | null;
  conversion_date: string | null;
  opportunity_amount: number | null;
}

interface LookerLeadsMetricRow {
  csv_entry_name: string;
  payload: Record<string, unknown> | null;
}

type PipelineStageKey =
  | 'sql'
  | 'not_converted_new'
  | 'working'
  | 'converted'
  | 'demo_booked'
  | 'demo_completed'
  | 'sent_quote'
  | 'close_won'
  | 'close_lost'
  | 'signups'
  | 'go_live';

interface PipelineRow {
  id: string;
  source: 'salespipe' | 'leads' | 'signups';
  sourceTab: string | null;
  stageKey: PipelineStageKey;
  leadId: string | null;
  opportunityId: string | null;
  name: string;
  owner: string | null;
  leadSource: string | null;
  oakId: number | null;
  arr: number;
  probability: number | null;
  weightedArr: number;
  filterDate: string | null;
  closeDate: string | null;
  leadCreatedDate: string | null;
  matchedSignupName: string | null;
}

type PipelineSourceFilter = 'all' | 'salespipe2_only';

interface DLTStrategicReportsProps {
  user: User;
}

interface SavedForecastScenario {
  id: string;
  created_at: string;
  updated_at?: string | null;
  user_id: string;
  year: number;
  title: string;
  scenario_payload: Record<string, unknown> | null;
  report_headline?: string | null;
  report_narrative?: string | null;
  report_summary?: string[] | null;
}

interface ForecastEnterpriseDeal {
  id: string;
  user_id: string;
  year: number;
  target_month: number;
  expected_go_lives: number;
  arr_per_go_live: number;
  oak_id: number | null;
  account_name: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface DLTPlanzahlen {
  year: number;
  region: string;
  business_inbound: number[];
  business_outbound: number[];
  business_partnerships: number[];
  business_terminal_sales: number[];
  business_tipping: number[];
  avg_subs_bill: number;
  avg_pay_bill_terminal: number;
  avg_pay_bill_tipping: number;
  churn_arr_data?: unknown;
  new_clients_data?: unknown;
  expanding_arr_data?: {
    nrr_basis?: {
      arr_basis_dec?: number;
      arr_basis_jan_end?: number;
      sms_mrr_basis_dec?: number;
      pay_basis_dec?: number;
    };
  };
}

interface SalesCyclePlanRules {
  lead_to_demo_booked_days: number;
  demo_booked_to_sent_quote_20_days: number;
  sent_quote_20_to_sent_quote_50_days: number;
  sent_quote_50_to_sent_quote_70_days: number;
  sent_quote_70_to_sent_quote_90_days: number;
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const SALES_CYCLE_DEFAULTS: SalesCyclePlanRules = {
  lead_to_demo_booked_days: 10,
  demo_booked_to_sent_quote_20_days: 21,
  sent_quote_20_to_sent_quote_50_days: 14,
  sent_quote_50_to_sent_quote_70_days: 10,
  sent_quote_70_to_sent_quote_90_days: 7,
};

function normalizeMonthlyPlanValues(value: unknown): number[] {
  if (!Array.isArray(value)) return Array.from({ length: 12 }, () => 0);
  const values = value.slice(0, 12).map((entry) => {
    const n = Number(entry);
    return Number.isFinite(n) ? n : 0;
  });
  if (values.length < 12) {
    return [...values, ...Array.from({ length: 12 - values.length }, () => 0)];
  }
  return values;
}

function parseSalesCyclePlanRules(raw: unknown): SalesCyclePlanRules {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const readInt = (key: keyof SalesCyclePlanRules, fallback: number) => {
    const value = Number(data[key]);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  };
  return {
    lead_to_demo_booked_days: readInt(
      'lead_to_demo_booked_days',
      SALES_CYCLE_DEFAULTS.lead_to_demo_booked_days
    ),
    demo_booked_to_sent_quote_20_days: readInt(
      'demo_booked_to_sent_quote_20_days',
      SALES_CYCLE_DEFAULTS.demo_booked_to_sent_quote_20_days
    ),
    sent_quote_20_to_sent_quote_50_days: readInt(
      'sent_quote_20_to_sent_quote_50_days',
      SALES_CYCLE_DEFAULTS.sent_quote_20_to_sent_quote_50_days
    ),
    sent_quote_50_to_sent_quote_70_days: readInt(
      'sent_quote_50_to_sent_quote_70_days',
      SALES_CYCLE_DEFAULTS.sent_quote_50_to_sent_quote_70_days
    ),
    sent_quote_70_to_sent_quote_90_days: readInt(
      'sent_quote_70_to_sent_quote_90_days',
      SALES_CYCLE_DEFAULTS.sent_quote_70_to_sent_quote_90_days
    ),
  };
}

const PIPELINE_STAGE_CONFIG: Array<{ key: PipelineStageKey; label: string; color: string; bg: string }> = [
  { key: 'sql', label: 'SQL', color: 'text-blue-700', bg: 'bg-blue-50' },
  { key: 'converted', label: 'Converted', color: 'text-fuchsia-700', bg: 'bg-fuchsia-50' },
  { key: 'not_converted_new', label: 'Not converted', color: 'text-slate-700', bg: 'bg-slate-50' },
  { key: 'working', label: 'Working', color: 'text-violet-700', bg: 'bg-violet-50' },
  { key: 'demo_booked', label: 'Demo Booked', color: 'text-indigo-700', bg: 'bg-indigo-50' },
  { key: 'demo_completed', label: 'Demo Completed', color: 'text-purple-700', bg: 'bg-purple-50' },
  { key: 'sent_quote', label: 'Sent Quote', color: 'text-amber-700', bg: 'bg-amber-50' },
  { key: 'close_won', label: 'Close Won', color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { key: 'close_lost', label: 'Close Lost', color: 'text-rose-700', bg: 'bg-rose-50' },
  { key: 'signups', label: 'Sign-ups', color: 'text-cyan-700', bg: 'bg-cyan-50' },
  { key: 'go_live', label: 'Go-Live', color: 'text-teal-700', bg: 'bg-teal-50' },
];

const PIPELINE_STAGE_CONFIG_VISIBLE = PIPELINE_STAGE_CONFIG.filter(
  (stage) => stage.key !== 'signups' && stage.key !== 'go_live'
);

const ACTIVE_PIPELINE_STAGES: PipelineStageKey[] = [
  'sql',
  'not_converted_new',
  'working',
  'converted',
  'demo_booked',
  'demo_completed',
  'sent_quote',
];
const OPEN_PIPELINE_KPI_STAGES: PipelineStageKey[] = ['demo_booked', 'demo_completed', 'sent_quote'];
const PROBABILITY_BUCKET_DEFS = [
  { key: 'p10', label: '10%', min: 0.1, max: 0.2 },
  { key: 'p20', label: '20%', min: 0.2, max: 0.35 },
  { key: 'p35', label: '35%', min: 0.35, max: 0.5 },
  { key: 'p50', label: '50%', min: 0.5, max: 0.7 },
  { key: 'p70', label: '70%', min: 0.7, max: 0.9 },
  { key: 'p90', label: '90%+', min: 0.9, max: 1.01 },
] as const;
const FORECAST_WEIGHTED_ACV_PER_OPPORTUNITY = 3288;
// Tage von Probability-Stage bis Close Won (empirisch) + Close Won bis Go-Live (Ø 23.8d → 24d)
const PROBABILITY_TO_DAYS_TO_CLOSE_WON: Array<{ minProbability: number; days: number }> = [
  { minProbability: 0.9, days: 7 },
  { minProbability: 0.7, days: 14 },
  { minProbability: 0.5, days: 21 },
  { minProbability: 0.35, days: 28 },
  { minProbability: 0.2, days: 35 },
  { minProbability: 0, days: 42 },
];
const CLOSE_WON_TO_GO_LIVE_DAYS = 24;
const EXCLUDED_ACCOUNT_NAMES_FOR_WEIGHTING = ['ryf gmbh'];

const SALESPIPE_MAIN_COLUMN_WIDTHS_DEFAULT = [80, 280, 110, 75, 120, 130, 90, 90, 110, 140, 120, 120, 130];
const SALESPIPE_MAIN_COLUMN_MIN_WIDTH = [70, 180, 90, 70, 100, 100, 70, 70, 90, 110, 100, 110, 110];

function normalizeSalespipeStage(stage: string | null): PipelineStageKey | null {
  const normalized = String(stage || '').toLowerCase().trim().replace(/[-\s]+/g, '_');
  if (normalized === 'sql') return 'sql';
  if (normalized === 'demo_booked') return 'demo_booked';
  if (normalized === 'demo_completed') return 'demo_completed';
  if (normalized === 'sent_quote') return 'sent_quote';
  if (normalized === 'close_won' || normalized === 'closed_won') return 'close_won';
  if (normalized === 'close_lost' || normalized === 'closed_lost') return 'close_lost';
  return null;
}

function normalizeLeadsStage(
  leadStatus: string | null,
  leadSubStatus: string | null,
  demoOrQuote: string | null,
  leadId: string | null,
  opportunityId: string | null,
  opportunityAccount: string | null
): PipelineStageKey | null {
  const status = `${leadStatus || ''} ${leadSubStatus || ''} ${demoOrQuote || ''}`
    .toLowerCase()
    .replace(/[-\s]+/g, ' ')
    .trim();

  const hasLeadId = normalizeId(leadId) !== null;
  const hasOpportunityId = normalizeId(opportunityId) !== null;
  // leads_events hat derzeit keine account_id-Spalte; opportunity_account ist der beste verfügbare Proxy.
  const hasAccountLink = normalizeId(opportunityAccount) !== null;

  if (hasLeadId && hasOpportunityId && hasAccountLink) return 'converted';

  const isNewOrNotConverted =
    status === 'new' ||
    status === 'not converted' ||
    status.includes('not converted');
  if (!hasAccountLink && isNewOrNotConverted) return 'not_converted_new';

  const isWorking = status === 'working' || status.includes('working');
  if (!hasOpportunityId && !hasAccountLink && isWorking) return 'working';

  // Converted-Basis: Lead + Opportunity vorhanden (Account-Link optional, da Feldlage je Import variiert).
  if (hasLeadId && hasOpportunityId) return 'converted';

  if (status.includes('sql') || status.includes('sales qualified')) return 'sql';

  // Fallback für alle übrigen/unklaren Leads.
  return 'sql';
}

function getDefaultProbability(stage: PipelineStageKey): number {
  if (stage === 'sql') return 0.2;
  if (stage === 'not_converted_new') return 0.2;
  if (stage === 'working') return 0.25;
  if (stage === 'converted') return 0.35;
  if (stage === 'demo_booked') return 0.35;
  if (stage === 'demo_completed') return 0.5;
  if (stage === 'sent_quote') return 0.7;
  if (stage === 'close_won') return 1;
  if (stage === 'close_lost') return 0;
  if (stage === 'signups') return 1;
  if (stage === 'go_live') return 1;
  return 0;
}

function getWeightedArrFromOpportunity(
  stage: PipelineStageKey,
  probabilityRaw: number | null | undefined,
  opportunityId: string | null | undefined
): number {
  const normalizedOpportunityId = normalizeId(opportunityId);
  if (!normalizedOpportunityId) return 0;

  const hasExplicitProbability =
    probabilityRaw !== null &&
    probabilityRaw !== undefined &&
    String(probabilityRaw).trim() !== '';
  const probability = hasExplicitProbability && Number.isFinite(Number(probabilityRaw))
    ? (Number(probabilityRaw) > 1 ? Number(probabilityRaw) / 100 : Number(probabilityRaw))
    : getDefaultProbability(stage);
  const clampedProbability = Math.max(0, Math.min(1, probability));

  return FORECAST_WEIGHTED_ACV_PER_OPPORTUNITY * clampedProbability;
}

function normalizeId(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function isExcludedAccountName(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return EXCLUDED_ACCOUNT_NAMES_FOR_WEIGHTING.some((blocked) => normalized.includes(blocked));
}

function buildSalesforceOpportunityUrl(opportunityId: string | null | undefined): string | null {
  const id = String(opportunityId || '').trim();
  if (!id) return null;
  const configuredBase = (process.env.NEXT_PUBLIC_SALESFORCE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configuredBase) {
    if (configuredBase.includes('lightning.force.com')) {
      return `${configuredBase}/lightning/r/Opportunity/${encodeURIComponent(id)}/view`;
    }
    return `${configuredBase}/${encodeURIComponent(id)}`;
  }
  return `https://login.salesforce.com/${encodeURIComponent(id)}`;
}

function calculateDaysBetween(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateDaysUntil(endDate: string | null): number | null {
  if (!endDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  if (Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseMetricNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/[%,$€\s]/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPayloadNumber(payload: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!payload) return null;
  for (const key of keys) {
    if (!(key in payload)) continue;
    const parsed = parseMetricNumber(payload[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readPayloadString(payload: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!payload) return null;
  for (const key of keys) {
    if (!(key in payload)) continue;
    const value = String(payload[key] ?? '').trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function parseYesNo(value: unknown): boolean | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['yes', 'y', 'true', 'ja', '1'].includes(raw)) return true;
  if (['no', 'n', 'false', 'nein', '0'].includes(raw)) return false;
  return null;
}

function readPayloadBoolean(payload: Record<string, unknown> | null | undefined, keys: string[]): boolean | null {
  if (!payload) return null;
  for (const key of keys) {
    if (!(key in payload)) continue;
    const parsed = parseYesNo(payload[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pickPayloadMetric(
  payload: Record<string, unknown> | null | undefined,
  preferredKeys: string[],
  options?: { excludePercent?: boolean }
): number | null {
  const direct = readPayloadNumber(payload, preferredKeys);
  if (direct !== null) return direct;
  if (!payload) return null;
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes('month') || normalizedKey.includes('date')) continue;
    if (options?.excludePercent && normalizedKey.includes('%')) continue;
    const parsed = parseMetricNumber(value);
    if (parsed === null) continue;
    return parsed;
  }
  return null;
}

function parsePayloadMonthIndex(payload: Record<string, unknown> | null | undefined, keys: string[], selectedYear: number): number | null {
  if (!payload) return null;
  for (const key of keys) {
    const raw = String(payload[key] ?? '').trim();
    if (!raw) continue;
    const parsed = new Date(raw.length === 7 ? `${raw}-01` : raw);
    if (Number.isNaN(parsed.getTime())) continue;
    if (parsed.getFullYear() !== selectedYear) continue;
    const idx = parsed.getMonth();
    if (idx < 0 || idx > 11) continue;
    return idx;
  }
  return null;
}

function isScenarioReportSnapshot(value: unknown): value is ScenarioReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.headline === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.actions) &&
    Array.isArray(candidate.summaryLines)
  );
}

function parseScenarioNarrativeSections(narrative: string | null | undefined) {
  const text = String(narrative || '').replace(/\r/g, '').trim();
  if (!text) {
    return {
      executiveSummary: '',
      ctaLines: [] as string[],
      elevatorPitch: '',
      hebeleffekt: '',
    };
  }

  const headingRegex =
    /(?:^|\n)\s*(?:##\s*)?(Executive Summary|Hebelwirkung|CTA|Call to Action|Call to Actions|Elevator Pitch)\s*:?\s*(?:\n|$)/gi;
  const sections: Record<string, string> = {};
  const matches: Array<{ key: string; start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    matches.push({ key: String(match[1] || '').toLowerCase(), start: match.index, end: headingRegex.lastIndex });
  }

  for (let idx = 0; idx < matches.length; idx += 1) {
    const current = matches[idx];
    const next = matches[idx + 1];
    const content = text.slice(current.end, next ? next.start : text.length).trim();
    sections[current.key] = content;
  }

  const ctaRaw = sections.cta || sections['call to action'] || sections['call to actions'] || '';
  const ctaLines = ctaRaw
    ? ctaRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return {
    executiveSummary: sections['executive summary'] || text,
    hebeleffekt: sections.hebelwirkung || '',
    ctaLines,
    elevatorPitch: sections['elevator pitch'] || '',
  };
}

export default function DLTStrategicReports({ user }: DLTStrategicReportsProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  // ========== EXPANDING ARR: Import-Daten ==========
  const { data: upDownsellsData } = useUpDownsellsMonthly(selectedYear);
  const { data: smsData } = useSmsMonthly(selectedYear);
  const { data: phorestPayData } = usePhorestPayMonthly(selectedYear);

  const defaultYtdMonths = useMemo(
    () => Array.from(
      { length: selectedYear < currentYear ? 12 : currentMonth + 1 },
      (_, idx) => idx + 1
    ),
    [selectedYear, currentYear, currentMonth]
  );
  const visibleYtdMonths = useMemo(
    () => Array.from({ length: 12 }, (_, idx) => idx + 1),
    []
  );
  const [reportCategory, setReportCategory] = useState<'new_sales_arr' | 'expanding_arr' | 'total_business_arr'>('new_sales_arr');
  const [reportType, setReportType] = useState<'forecast' | 'ytd' | 'salespipe'>('forecast');
  const [leadToGoLiveForecastPercent, setLeadToGoLiveForecastPercent] = useState(16);
  const [futureLeadVolumeScenarioMonthlyLeads, setFutureLeadVolumeScenarioMonthlyLeads] = useState(0);
  const [futureChurnScenarioFactorPercent, setFutureChurnScenarioFactorPercent] = useState(100);
  const [forecastSettingsCollapsed, setForecastSettingsCollapsed] = useState(false);
  const [enterpriseDealsCollapsed, setEnterpriseDealsCollapsed] = useState(false);
  const [enterpriseForecastEnabled, setEnterpriseForecastEnabled] = useState(true);
  const [enterpriseDeals, setEnterpriseDeals] = useState<ForecastEnterpriseDeal[]>([]);
  const [enterpriseDealsLoading, setEnterpriseDealsLoading] = useState(false);
  const [enterpriseDealsError, setEnterpriseDealsError] = useState<string | null>(null);
  const [enterpriseLookupQuery, setEnterpriseLookupQuery] = useState('');
  const [enterpriseDealExpectedGoLivesInput, setEnterpriseDealExpectedGoLivesInput] = useState(1);
  const [enterpriseDealArrPerGoLiveInput, setEnterpriseDealArrPerGoLiveInput] = useState(0);
  const [enterpriseDealTargetMonthInput, setEnterpriseDealTargetMonthInput] = useState(
    Math.max(1, Math.min(12, currentMonth + 2))
  );
  const [addingEnterpriseDeal, setAddingEnterpriseDeal] = useState(false);
  const [deletingEnterpriseDealId, setDeletingEnterpriseDealId] = useState<string | null>(null);
  const [togglingEnterpriseDealId, setTogglingEnterpriseDealId] = useState<string | null>(null);
  const [scenarioReport, setScenarioReport] = useState<ScenarioReport | null>(null);
  const [scenarioReportLoading, setScenarioReportLoading] = useState(false);
  const [scenarioReportError, setScenarioReportError] = useState<string | null>(null);
  const [scenarioReportMeta, setScenarioReportMeta] = useState<{
    llmRequested: boolean;
    llmAttempted: boolean;
    fallbackActive: boolean;
    llmProvider: string | null;
    llmError: string | null;
    mode: 'rules' | 'llm' | null;
  }>({
    llmRequested: false,
    llmAttempted: false,
    fallbackActive: false,
    llmProvider: null,
    llmError: null,
    mode: null,
  });
  const [savedScenarios, setSavedScenarios] = useState<SavedForecastScenario[]>([]);
  const [savedScenariosLoading, setSavedScenariosLoading] = useState(false);
  const [savedScenarioActionLoading, setSavedScenarioActionLoading] = useState(false);
  const [savedScenarioError, setSavedScenarioError] = useState<string | null>(null);
  const [savedScenarioConfirmation, setSavedScenarioConfirmation] = useState<string | null>(null);
  const [deletingScenarioId, setDeletingScenarioId] = useState<string | null>(null);
  const [downloadingPdfScenarioId, setDownloadingPdfScenarioId] = useState<string | null>(null);
  const [selectedYtdMonths, setSelectedYtdMonths] = useState<number[]>(defaultYtdMonths);
  const [selectedMonthDetail, setSelectedMonthDetail] = useState<number | null>(null);
  const [selectedChurnMonthDetail, setSelectedChurnMonthDetail] = useState<number | null>(null);
  const [ytdKpiSectionExpanded, setYtdKpiSectionExpanded] = useState(true);
  const [ytdMonthlyOverviewExpanded, setYtdMonthlyOverviewExpanded] = useState(true);
  const [ytdChurnOverviewExpanded, setYtdChurnOverviewExpanded] = useState(true);
  const [goLiveDetailSearch, setGoLiveDetailSearch] = useState('');
  const [churnDetailSearch, setChurnDetailSearch] = useState('');
  const [salespipeEvents, setSalespipeEvents] = useState<SalespipeEventRow[]>([]);
  const [signupsEvents, setSignupsEvents] = useState<SignupsEventRow[]>([]);
  const [leadsEvents, setLeadsEvents] = useState<LeadsEventRow[]>([]);
  const [lookerLeadsMetrics, setLookerLeadsMetrics] = useState<LookerLeadsMetricRow[]>([]);
  const [salespipeLoading, setSalespipeLoading] = useState(true);
  const [salespipeSearch, setSalespipeSearch] = useState('');
  const [salespipeStageFilter, setSalespipeStageFilter] = useState<PipelineStageKey | 'all'>('all');
  const [salespipeSourceFilter, setSalespipeSourceFilter] = useState<PipelineSourceFilter>('all');
  const [selectedProbabilityBucketKey, setSelectedProbabilityBucketKey] = useState<string | null>(null);
  const defaultSalespipeYtdRange = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromDate = new Date(selectedYear, 0, 1);
    const toDate = selectedYear === currentYear ? today : new Date(selectedYear, 11, 31);
    return {
      from: formatDateForInput(fromDate),
      to: formatDateForInput(toDate),
    };
  }, [selectedYear, currentYear]);
  const [salespipeDateFromInput, setSalespipeDateFromInput] = useState(defaultSalespipeYtdRange.from);
  const [salespipeDateToInput, setSalespipeDateToInput] = useState(defaultSalespipeYtdRange.to);
  const [salespipeDateFrom, setSalespipeDateFrom] = useState(defaultSalespipeYtdRange.from);
  const [salespipeDateTo, setSalespipeDateTo] = useState(defaultSalespipeYtdRange.to);
  const [salespipeRelativeDaysInput, setSalespipeRelativeDaysInput] = useState<string>('none');
  const [salespipeRelativeDays, setSalespipeRelativeDays] = useState<number | null>(null);
  const [salespipeOverviewExpanded, setSalespipeOverviewExpanded] = useState(true);
  const [salespipeWhatIfExpanded, setSalespipeWhatIfExpanded] = useState(false);
  const [salespipeDatasetExpanded, setSalespipeDatasetExpanded] = useState(true);
  const [salespipeWhatIfDatasetExpanded, setSalespipeWhatIfDatasetExpanded] = useState(false);
  const [overdueOpportunitiesExpanded, setOverdueOpportunitiesExpanded] = useState(true);
  const [whatIfConvertedRatePct, setWhatIfConvertedRatePct] = useState(0);
  const [whatIfWinRatePct, setWhatIfWinRatePct] = useState(0);
  const [disabledPipelineRowKeys, setDisabledPipelineRowKeys] = useState<string[]>([]);
  const [churnEvents, setChurnEvents] = useState<ChurnEventRow[]>([]);
  const [churnLoading, setChurnLoading] = useState(true);
  const [payIstInputsByGoLiveId, setPayIstInputsByGoLiveId] = useState<Record<string, string>>({});
  const [savingPayIstByGoLiveId, setSavingPayIstByGoLiveId] = useState<Record<string, boolean>>({});
  const [payIstErrorByGoLiveId, setPayIstErrorByGoLiveId] = useState<Record<string, string>>({});
  const exportRef = useRef<HTMLDivElement>(null);
  const scenarioReportExportRef = useRef<HTMLDivElement>(null);
  const skipScenarioReportResetRef = useRef(false);
  const totalBusinessTopScrollRef = useRef<HTMLDivElement>(null);
  const totalBusinessBottomScrollRef = useRef<HTMLDivElement>(null);
  const totalBusinessScrollSyncSourceRef = useRef<'top' | 'bottom' | null>(null);
  const [salespipeMainColWidths, setSalespipeMainColWidths] = useState<number[]>([
    ...SALESPIPE_MAIN_COLUMN_WIDTHS_DEFAULT,
  ]);
  const resizingSalespipeColRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const salespipeMainTopScrollRef = useRef<HTMLDivElement>(null);
  const salespipeMainBottomScrollRef = useRef<HTMLDivElement>(null);
  const salespipeScrollSyncSourceRef = useRef<'top' | 'bottom' | null>(null);
  const salespipeMainTableMinWidth = useMemo(
    () => salespipeMainColWidths.reduce((sum, width) => sum + width, 0),
    [salespipeMainColWidths]
  );

  const handleTopScroll = useCallback(() => {
    if (salespipeScrollSyncSourceRef.current === 'bottom') return;
    salespipeScrollSyncSourceRef.current = 'top';
    const topEl = salespipeMainTopScrollRef.current;
    const bottomEl = salespipeMainBottomScrollRef.current;
    if (topEl && bottomEl) bottomEl.scrollLeft = topEl.scrollLeft;
    requestAnimationFrame(() => {
      if (salespipeScrollSyncSourceRef.current === 'top') salespipeScrollSyncSourceRef.current = null;
    });
  }, []);

  const handleBottomScroll = useCallback(() => {
    if (salespipeScrollSyncSourceRef.current === 'top') return;
    salespipeScrollSyncSourceRef.current = 'bottom';
    const topEl = salespipeMainTopScrollRef.current;
    const bottomEl = salespipeMainBottomScrollRef.current;
    if (topEl && bottomEl) topEl.scrollLeft = bottomEl.scrollLeft;
    requestAnimationFrame(() => {
      if (salespipeScrollSyncSourceRef.current === 'bottom') salespipeScrollSyncSourceRef.current = null;
    });
  }, []);

  const handleTotalBusinessTopScroll = useCallback(() => {
    if (totalBusinessScrollSyncSourceRef.current === 'bottom') return;
    totalBusinessScrollSyncSourceRef.current = 'top';
    const topEl = totalBusinessTopScrollRef.current;
    const bottomEl = totalBusinessBottomScrollRef.current;
    if (topEl && bottomEl) bottomEl.scrollLeft = topEl.scrollLeft;
    requestAnimationFrame(() => {
      if (totalBusinessScrollSyncSourceRef.current === 'top') totalBusinessScrollSyncSourceRef.current = null;
    });
  }, []);

  const handleTotalBusinessBottomScroll = useCallback(() => {
    if (totalBusinessScrollSyncSourceRef.current === 'top') return;
    totalBusinessScrollSyncSourceRef.current = 'bottom';
    const topEl = totalBusinessTopScrollRef.current;
    const bottomEl = totalBusinessBottomScrollRef.current;
    if (topEl && bottomEl) topEl.scrollLeft = bottomEl.scrollLeft;
    requestAnimationFrame(() => {
      if (totalBusinessScrollSyncSourceRef.current === 'bottom') totalBusinessScrollSyncSourceRef.current = null;
    });
  }, []);

  const pipelineDisableStorageKey = useMemo(
    () => `dltStrategicReports.disabledPipelineRows.${user.id}.${selectedYear}`,
    [user.id, selectedYear]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pipelineDisableStorageKey);
      if (!raw) {
        setDisabledPipelineRowKeys([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setDisabledPipelineRowKeys([]);
        return;
      }
      setDisabledPipelineRowKeys(parsed.map((entry) => String(entry)));
    } catch {
      setDisabledPipelineRowKeys([]);
    }
  }, [pipelineDisableStorageKey]);

  useEffect(() => {
    setSelectedYtdMonths(defaultYtdMonths);
  }, [defaultYtdMonths]);

  useEffect(() => {
    setSalespipeDateFromInput(defaultSalespipeYtdRange.from);
    setSalespipeDateToInput(defaultSalespipeYtdRange.to);
    setSalespipeDateFrom(defaultSalespipeYtdRange.from);
    setSalespipeDateTo(defaultSalespipeYtdRange.to);
    setSalespipeRelativeDaysInput('none');
    setSalespipeRelativeDays(null);
  }, [defaultSalespipeYtdRange]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!resizingSalespipeColRef.current) return;
      const { index, startX, startWidth } = resizingSalespipeColRef.current;
      const delta = event.clientX - startX;
      const minWidth = SALESPIPE_MAIN_COLUMN_MIN_WIDTH[index] ?? 70;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      setSalespipeMainColWidths((prev) => prev.map((width, i) => (i === index ? nextWidth : width)));
    };

    const onMouseUp = () => {
      resizingSalespipeColRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchChurnEvents = async () => {
      setChurnLoading(true);
      const from = `${selectedYear}-01-01`;
      const to = `${selectedYear + 1}-01-01`;

      const { data, error } = await supabase
        .from('churn_events')
        .select('id, churn_month, gl_month, scheduled, total_arr_lost, subs_revenue_lost, pay_revenue_lost, oak_id, customer_name, coo, churn_reason, package_name')
        .gte('churn_month', from)
        .lt('churn_month', to);

      if (!active) return;

      if (error) {
        console.error('Churn load error:', error);
        setChurnEvents([]);
      } else {
        setChurnEvents((data as ChurnEventRow[]) || []);
      }
      setChurnLoading(false);
    };

    fetchChurnEvents();
    return () => {
      active = false;
    };
  }, [selectedYear]);

  useEffect(() => {
    let active = true;

    const fetchSalespipeAndSignups = async () => {
      setSalespipeLoading(true);

      const [salespipeRes, signupsRes, leadsRes, lookerLeadsRes] = await Promise.all([
        supabase
          .from('salespipe_events')
          .select('id, opportunity_id, oak_id, opportunity_name, rating, next_step, stage, estimated_arr, probability, close_date, created_date, opportunity_owner, lead_source, source_tab'),
        supabase
          .from('signups_events')
          .select('id, account_id, oak_id, account_name, account_owner, signup_package, signup_date, go_live_date, customer_info_stage'),
        supabase
          .from('leads_events')
          .select('id, lead_id, opportunity_id, opportunity_account, company_account, lead_source, lead_owner, lead_status, lead_sub_status, demo_or_quote, created_date, conversion_date, opportunity_amount'),
        supabase
          .from('looker_leads_events')
          .select('csv_entry_name, payload')
          .like('csv_entry_name', 'dashboard-lead/%'),
      ]);

      if (!active) return;

      if (salespipeRes.error) {
        console.error('Salespipe load error:', salespipeRes.error);
        setSalespipeEvents([]);
      } else {
        setSalespipeEvents((salespipeRes.data as SalespipeEventRow[]) || []);
      }

      if (signupsRes.error) {
        console.error('Signups load error:', signupsRes.error);
        setSignupsEvents([]);
      } else {
        setSignupsEvents((signupsRes.data as SignupsEventRow[]) || []);
      }

      if (leadsRes.error) {
        console.error('Leads load error:', leadsRes.error);
        setLeadsEvents([]);
      } else {
        setLeadsEvents((leadsRes.data as LeadsEventRow[]) || []);
      }

      if (lookerLeadsRes.error) {
        console.error('Looker Leads metrics load error:', lookerLeadsRes.error);
        setLookerLeadsMetrics([]);
      } else {
        setLookerLeadsMetrics((lookerLeadsRes.data as LookerLeadsMetricRow[]) || []);
      }

      setSalespipeLoading(false);
    };

    fetchSalespipeAndSignups();
    return () => {
      active = false;
    };
  }, [selectedYear]);
  
  // Load all users
  const { users, loading: usersLoading } = useAllUsers();

  // DLT-Settings (Planzahlen) sind die zentrale Quelle für Plan-Ziele.
  const [planzahlen, setPlanzahlen] = useState<DLTPlanzahlen | null>(null);
  const [planzahlenLoading, setPlanzahlenLoading] = useState(true);
  useEffect(() => {
    const fetchPlanzahlen = async () => {
      setPlanzahlenLoading(true);
      // Gleiche Logik wie DLTSettings: bei mehreren Zeilen pro Jahr liefert .single() PGRST116
      // und es gibt keine zuverlässige Zeile — immer die zuletzt aktualisierte Zeile nehmen.
      const { data, error } = await supabase
        .from('dlt_planzahlen')
        .select('*')
        .eq('year', selectedYear)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('DLT Planzahlen load error:', error);
        setPlanzahlen(null);
      } else {
        setPlanzahlen((data as DLTPlanzahlen) || null);
      }
      setPlanzahlenLoading(false);
    };
    fetchPlanzahlen();
  }, [selectedYear]);

  // Filter: plannable Users (für Targets) und Go-Live Empfänger (für IST)
  const plannableUsers = useMemo(
    () => users.filter(u => isPlannable(u.role)),
    [users]
  );
  const goLiveReceivers = useMemo(
    () => users.filter(u => canReceiveGoLives(u.role)),
    [users]
  );
  
  // Load multi-user data (gleiche Quelle wie Jahresübersicht / Monatliche Übersicht)
  // - Go-Lives: alle Go-Live Empfänger (IST)
  // - Settings/Targets: nur plannable Users (AEs)
  const goLiveReceiverIds = useMemo(() => goLiveReceivers.map(u => u.id), [goLiveReceivers]);
  const plannableUserIds = useMemo(() => plannableUsers.map(u => u.id), [plannableUsers]);
  const { settings: multiSettings, goLives: multiGoLives, combined, loading: dataLoading, refetch: refetchMultiData } = useMultiUserData(
    goLiveReceiverIds,
    selectedYear,
    plannableUserIds
  );

  const paymarginCohortKeys = usePaymarginImportedCohortKeys(true);
  const payArrReportingOptions = useMemo((): PayArrReportingOptions | undefined => {
    if (paymarginCohortKeys === undefined) return undefined;
    return { paymarginImportedCohortKeys: paymarginCohortKeys };
  }, [paymarginCohortKeys]);

  const planTargets = useMemo(() => {
    if (!planzahlen) return null;
    const pad = (arr: number[] = []) => Array.from({ length: 12 }, (_, i) => arr[i] ?? 0);
    const inbound = pad(planzahlen.business_inbound);
    const outbound = pad(planzahlen.business_outbound);
    const partnerships = pad(planzahlen.business_partnerships);
    const terminalSales = pad(planzahlen.business_terminal_sales);
    const tipping = pad(planzahlen.business_tipping);
    const goLivesTarget = inbound.map((v, i) => v + outbound[i] + partnerships[i]);
    const avgSubs = planzahlen.avg_subs_bill ?? DEFAULT_SETTINGS.avg_subs_bill;
    const avgPayTerminal = planzahlen.avg_pay_bill_terminal ?? DEFAULT_SETTINGS.avg_pay_bill;
    const avgPayTipping = planzahlen.avg_pay_bill_tipping ?? DEFAULT_SETTINGS.avg_pay_bill_tipping;
    const subsTarget = goLivesTarget.map((v) => v * avgSubs * 12);
    const payTarget = terminalSales.map((v, i) =>
      v * avgPayTerminal * 12 + tipping[i] * avgPayTipping * 12
    );
    return { goLivesTarget, subsTarget, payTarget };
  }, [planzahlen]);

  // Aggregation über combined (vom Hook bereits aggregiert) oder über Einzeluser
  const monthlyData = useMemo(() => {
    if (combined?.settings && combined?.goLives?.length >= 0) {
      const summary = calculateYearSummary(combined.goLives, combined.settings, payArrReportingOptions);
      let cumSubsARR = 0;
      let cumSubsTarget = 0;
      let cumPayARR = 0;
      let cumPayTarget = 0;
      return MONTH_NAMES_SHORT.map((name, idx) => {
        const r = summary.monthly_results[idx];
        if (!r) return { name, month: idx + 1, subsARR: 0, subsTarget: 0, payARR: 0, payTarget: 0, goLives: 0, goLivesTarget: 0, cumSubsARR: 0, cumSubsTarget: 0, cumPayARR: 0, cumPayTarget: 0, cumTotalARR: 0, cumTotalTarget: 0 };
        const subsTarget = planTargets ? planTargets.subsTarget[idx] : r.subs_target;
        const payTarget = planTargets ? planTargets.payTarget[idx] : r.pay_target;
        const goLivesTarget = planTargets ? planTargets.goLivesTarget[idx] : r.go_lives_target;
        cumSubsARR += r.subs_actual;
        cumSubsTarget += subsTarget;
        cumPayARR += r.pay_actual;
        cumPayTarget += payTarget;
        return {
          name,
          month: idx + 1,
          subsARR: r.subs_actual,
          subsTarget,
          // Pay IST: Finance-Actual oder Forecast (zentrale Berechnungslogik)
          payARR: r.pay_actual,
          payTarget,
          goLives: r.go_lives_count,
          goLivesTarget,
          cumSubsARR,
          cumSubsTarget,
          cumPayARR,
          cumPayTarget,
          cumTotalARR: cumSubsARR + cumPayARR,
          cumTotalTarget: cumSubsTarget + cumPayTarget
        };
      });
    }
    if (!multiSettings || !multiGoLives || goLiveReceiverIds.length === 0) return [];

    const data = MONTH_NAMES_SHORT.map((name, idx) => ({
      name,
      month: idx + 1,
      subsARR: 0,
      subsTarget: 0,
      payARR: 0,
      payTarget: 0,
      goLives: 0,
      goLivesTarget: 0,
      cumSubsARR: 0,
      cumSubsTarget: 0,
      cumPayARR: 0,
      cumPayTarget: 0,
      cumTotalARR: 0,
      cumTotalTarget: 0
    }));
    let cumSubsARR = 0;
    let cumSubsTarget = 0;
    let cumPayARR = 0;
    let cumPayTarget = 0;
    goLiveReceiverIds.forEach(uid => {
      const settings = multiSettings.get(uid);
      const goLives = multiGoLives.get(uid) ?? [];
      if (!settings) return;
      const summary = calculateYearSummary(goLives, settings, payArrReportingOptions);
      summary.monthly_results.forEach((result, idx) => {
        data[idx].subsARR += result.subs_actual;
        data[idx].subsTarget += result.subs_target;
        // Pay IST: Finance-Actual oder Forecast (zentrale Berechnungslogik)
        data[idx].payARR += result.pay_actual;
        data[idx].payTarget += result.pay_target;
        data[idx].goLives += result.go_lives_count;
        data[idx].goLivesTarget += result.go_lives_target;
      });
    });

    if (planTargets) {
      data.forEach((month, idx) => {
        month.subsTarget = planTargets.subsTarget[idx];
        month.payTarget = planTargets.payTarget[idx];
        month.goLivesTarget = planTargets.goLivesTarget[idx];
      });
    }
    data.forEach((month, idx) => {
      cumSubsARR += month.subsARR;
      cumSubsTarget += month.subsTarget;
      data[idx].cumSubsARR = cumSubsARR;
      data[idx].cumSubsTarget = cumSubsTarget;
      cumPayARR += month.payARR;
      cumPayTarget += month.payTarget;
      data[idx].cumPayARR = cumPayARR;
      data[idx].cumPayTarget = cumPayTarget;
      data[idx].cumTotalARR = cumSubsARR + cumPayARR;
      data[idx].cumTotalTarget = cumSubsTarget + cumPayTarget;
    });

    return data;
  }, [combined, multiSettings, multiGoLives, goLiveReceiverIds, planTargets, payArrReportingOptions]);

  const enterpriseDealArrByMonth = useMemo(() => {
    const byMonth = Array.from({ length: 12 }, () => 0);
    enterpriseDeals.forEach((deal) => {
      if (!deal.is_active) return;
      const monthIdx = Math.max(0, Math.min(11, Number(deal.target_month || 1) - 1));
      const expectedGoLives = Math.max(0, Number(deal.expected_go_lives) || 0);
      const arrPerGoLive = Math.max(0, Number(deal.arr_per_go_live) || 0);
      byMonth[monthIdx] += expectedGoLives * arrPerGoLive;
    });
    return byMonth;
  }, [enterpriseDeals]);

  const enterpriseDealsSummary = useMemo(() => {
    const all = enterpriseDeals.reduce(
      (sum, deal) => sum + Math.max(0, Number(deal.expected_go_lives) || 0) * Math.max(0, Number(deal.arr_per_go_live) || 0),
      0
    );
    const active = enterpriseDeals.reduce((sum, deal) => {
      if (!deal.is_active) return sum;
      return sum + Math.max(0, Number(deal.expected_go_lives) || 0) * Math.max(0, Number(deal.arr_per_go_live) || 0);
    }, 0);
    return { all, active };
  }, [enterpriseDeals]);

  const enterpriseLookupOptions = useMemo(() => {
    const goLives: GoLive[] = combined?.goLives ?? Array.from(multiGoLives?.values() ?? []).flat();
    const byKey = new Map<string, { label: string; oakId: number | null; accountName: string | null }>();
    goLives.forEach((gl) => {
      const oakId = Number.isFinite(Number(gl.oak_id)) ? Number(gl.oak_id) : null;
      const accountName = String(gl.customer_name || '').trim() || null;
      if (!oakId && !accountName) return;
      const key = `${oakId ?? 'none'}::${(accountName || '').toLowerCase()}`;
      const labelParts = [];
      if (oakId) labelParts.push(`OAK ${oakId}`);
      if (accountName) labelParts.push(accountName);
      byKey.set(key, {
        label: labelParts.join(' - '),
        oakId,
        accountName,
      });
    });
    signupsEvents.forEach((signup) => {
      const oakId = Number.isFinite(Number(signup.oak_id)) ? Number(signup.oak_id) : null;
      const accountName = String(signup.account_name || '').trim() || null;
      if (!oakId && !accountName) return;
      const key = `${oakId ?? 'none'}::${(accountName || '').toLowerCase()}`;
      if (byKey.has(key)) return;
      const labelParts = [];
      if (oakId) labelParts.push(`OAK ${oakId}`);
      if (accountName) labelParts.push(accountName);
      byKey.set(key, {
        label: labelParts.join(' - '),
        oakId,
        accountName,
      });
    });
    salespipeEvents.forEach((sales) => {
      const oakId = Number.isFinite(Number(sales.oak_id)) ? Number(sales.oak_id) : null;
      const opportunityName = String(sales.opportunity_name || '').trim() || null;
      if (!oakId && !opportunityName) return;
      const key = `${oakId ?? 'none'}::${(opportunityName || '').toLowerCase()}`;
      if (byKey.has(key)) return;
      const labelParts = [];
      if (oakId) labelParts.push(`OAK ${oakId}`);
      if (opportunityName) labelParts.push(`Opportunity: ${opportunityName}`);
      byKey.set(key, {
        label: labelParts.join(' - '),
        oakId,
        accountName: opportunityName,
      });
    });
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }, [combined, multiGoLives, signupsEvents, salespipeEvents]);

  /** Total ARR Lost pro Monat (alle Churn-Events) — wie Spalte „Total ARR Lost“ unter Churn pro Monat. */
  const churnTotalArrLostByMonth = useMemo(() => {
    const m = Array.from({ length: 12 }, () => 0);
    churnEvents.forEach((event) => {
      if (!event.churn_month) return;
      const d = new Date(event.churn_month);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== selectedYear) return;
      const idx = d.getMonth();
      if (idx < 0 || idx > 11) return;
      m[idx] += effectiveTotalArrLost(event);
    });
    return m;
  }, [churnEvents, selectedYear]);

  // Forecast data: 1) Ist-Monate, 2) Weighted Pipeline (mind. +40 Tage + Stage-Offset), 3) YTD-Conversion-Forecast als Fallback
  const forecastData = useMemo(() => {
    if (monthlyData.length === 0) return [];

    // Probability-basierte Go-Live-Projektion: heute + daysToCloseWon(probability) + CLOSE_WON_TO_GO_LIVE_DAYS
    // Datenquelle: salespipeEvents (OPEN_PIPELINE_KPI_STAGES), dedupliziert nach Opportunity (beste Probability).
    // Konsistent mit salespipeKpis.weightedArr: exakt dieselbe Datenbasis, nur zeitlich auf Monate verteilt.
    const getDaysToCloseWon = (probability: number): number => {
      for (const bucket of PROBABILITY_TO_DAYS_TO_CLOSE_WON) {
        if (probability >= bucket.minProbability) return bucket.days;
      }
      return 42;
    };

    const now = new Date();
    const nowTs = now.getTime();

    const pipelineWeightedByMonthAndOpportunity = Array.from({ length: 12 }, () => new Map<string, number>());
    const upsertWeightedPipelineValue = (monthIdx: number, opportunityId: string | null | undefined, weightedArr: number) => {
      const normalizedOpportunityId = normalizeId(opportunityId);
      if (!normalizedOpportunityId || weightedArr <= 0) return;
      const monthMap = pipelineWeightedByMonthAndOpportunity[monthIdx];
      const previous = monthMap.get(normalizedOpportunityId) || 0;
      if (weightedArr > previous) {
        monthMap.set(normalizedOpportunityId, weightedArr);
      }
    };

    // Forecast muss denselben Scope wie die Sales-Pipe-KPI verwenden:
    // Open-Stages, Jahresfilter, Date-Filter, Source-Filter, Search und Opportunity-Deduplizierung.
    type ForecastOpenRow = {
      opportunityId: string;
      probability: number;
      weightedArr: number;
      source: 'salespipe' | 'leads';
      sourceTab: string | null;
      filterDate: string | null;
      stageKey: PipelineStageKey;
      name: string | null;
      owner: string | null;
    };
    const candidateRows: ForecastOpenRow[] = [];
    salespipeEvents.forEach((row) => {
      if (isExcludedAccountName(row.opportunity_name)) return;
      const stageKey = normalizeSalespipeStage(row.stage);
      if (!stageKey || !OPEN_PIPELINE_KPI_STAGES.includes(stageKey)) return;
      const opportunityId = normalizeId(row.opportunity_id);
      if (!opportunityId) return;
      const createdYear = row.created_date ? new Date(row.created_date).getFullYear() : null;
      const closeYear = row.close_date ? new Date(row.close_date).getFullYear() : null;
      if (createdYear !== selectedYear && closeYear !== selectedYear) return;
      const probabilityRaw = Number(row.probability);
      const normalizedProbability = Number.isFinite(probabilityRaw)
        ? (probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw)
        : Number.NaN;
      const probability =
        !Number.isNaN(normalizedProbability) && normalizedProbability > 0
          ? Math.max(0, Math.min(1, normalizedProbability))
          : getDefaultProbability(stageKey);
      candidateRows.push({
        opportunityId,
        probability,
        weightedArr: getWeightedArrFromOpportunity(stageKey, probabilityRaw, opportunityId),
        source: 'salespipe',
        sourceTab: row.source_tab || null,
        filterDate: row.created_date || row.close_date || null,
        stageKey,
        name: row.opportunity_name || null,
        owner: row.opportunity_owner || null,
      });
    });
    leadsEvents.forEach((row) => {
      if (isExcludedAccountName(row.company_account) || isExcludedAccountName(row.opportunity_account)) return;
      const stageKey = normalizeLeadsStage(
        row.lead_status,
        row.lead_sub_status,
        row.demo_or_quote,
        row.lead_id,
        row.opportunity_id,
        row.opportunity_account
      );
      if (!stageKey || !OPEN_PIPELINE_KPI_STAGES.includes(stageKey)) return;
      const opportunityId = normalizeId(row.opportunity_id);
      if (!opportunityId) return;
      const createdYear = row.created_date ? new Date(row.created_date).getFullYear() : null;
      const conversionYear = row.conversion_date ? new Date(row.conversion_date).getFullYear() : null;
      if (createdYear !== selectedYear && conversionYear !== selectedYear) return;
      const probability = getDefaultProbability(stageKey);
      candidateRows.push({
        opportunityId,
        probability,
        weightedArr: getWeightedArrFromOpportunity(stageKey, null, opportunityId),
        source: 'leads',
        sourceTab: null,
        filterDate: row.conversion_date || row.created_date || null,
        stageKey,
        name: row.company_account || null,
        owner: row.lead_owner || null,
      });
    });

    const fromDate = salespipeDateFrom ? new Date(salespipeDateFrom) : null;
    const toDate = salespipeDateTo ? new Date(`${salespipeDateTo}T23:59:59`) : null;
    const relativeToDate = salespipeRelativeDays !== null ? new Date() : null;
    const relativeFromDate = salespipeRelativeDays !== null ? new Date() : null;
    if (relativeToDate) relativeToDate.setHours(23, 59, 59, 999);
    if (relativeFromDate) {
      relativeFromDate.setHours(0, 0, 0, 0);
      relativeFromDate.setDate(relativeFromDate.getDate() - Math.max(0, salespipeRelativeDays - 1));
    }
    const query = salespipeSearch.trim().toLowerCase();

    const filteredCandidates = candidateRows.filter((row) => {
      if (salespipeSourceFilter === 'salespipe2_only') {
        if (row.source === 'salespipe' && row.sourceTab !== 'drive_salespipe2_csv') return false;
      }
      if (salespipeStageFilter !== 'all' && row.stageKey !== salespipeStageFilter) return false;
      if (!row.filterDate) return false;
      const relevantDate = new Date(row.filterDate);
      if (Number.isNaN(relevantDate.getTime())) return false;
      if (fromDate && relevantDate < fromDate) return false;
      if (toDate && relevantDate > toDate) return false;
      if (relativeFromDate && relevantDate < relativeFromDate) return false;
      if (relativeToDate && relevantDate > relativeToDate) return false;
      if (query) {
        const searchValues = [
          row.name || '',
          row.owner || '',
          row.opportunityId || '',
          row.source,
        ];
        if (!searchValues.some((value) => value.toLowerCase().includes(query))) return false;
      }
      return true;
    });

    type BestOpportunityEntry = { probability: number; weightedArr: number; sourcePriority: number; sortTs: number };
    const bestByOpportunity = new Map<string, BestOpportunityEntry>();
    filteredCandidates.forEach((row) => {
      const sourcePriority = row.source === 'salespipe' ? 2 : 1;
      const ts = row.filterDate ? new Date(row.filterDate).getTime() : Number.NEGATIVE_INFINITY;
      const sortTs = Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
      const current = bestByOpportunity.get(row.opportunityId);
      if (!current) {
        bestByOpportunity.set(row.opportunityId, {
          probability: row.probability,
          weightedArr: row.weightedArr,
          sourcePriority,
          sortTs,
        });
        return;
      }
      const shouldReplace =
        row.probability > current.probability ||
        (row.probability === current.probability && sourcePriority > current.sourcePriority) ||
        (row.probability === current.probability &&
          sourcePriority === current.sourcePriority &&
          sortTs > current.sortTs);
      if (shouldReplace) {
        bestByOpportunity.set(row.opportunityId, {
          probability: row.probability,
          weightedArr: row.weightedArr,
          sourcePriority,
          sortTs,
        });
      }
    });

    // Projektion: heute + daysToCloseWon + CLOSE_WON_TO_GO_LIVE_DAYS → Forecast-Monat
    bestByOpportunity.forEach(({ probability, weightedArr }, opportunityId) => {
      const totalDays = getDaysToCloseWon(probability) + CLOSE_WON_TO_GO_LIVE_DAYS;
      const projectedGoLiveDate = new Date(now);
      projectedGoLiveDate.setDate(projectedGoLiveDate.getDate() + totalDays);
      if (projectedGoLiveDate.getFullYear() !== selectedYear) return;
      const monthIdx = projectedGoLiveDate.getMonth();
      upsertWeightedPipelineValue(monthIdx, opportunityId, weightedArr);
    });

    const pipelineWeightedByMonth = pipelineWeightedByMonthAndOpportunity.map((monthMap) =>
      Array.from(monthMap.values()).reduce((sum, value) => sum + value, 0)
    );

    const goLiveArrToDateByMonth = Array.from({ length: 12 }, () => 0);
    const goLiveArrFutureByMonth = Array.from({ length: 12 }, () => 0);
    const allGoLivesForForecast: GoLive[] =
      combined?.goLives ?? Array.from(multiGoLives?.values() ?? []).flat();
    allGoLivesForForecast.forEach((gl) => {
      if (!gl?.go_live_date) return;
      const goLiveDate = new Date(gl.go_live_date);
      if (Number.isNaN(goLiveDate.getTime())) return;
      if (goLiveDate.getFullYear() !== selectedYear) return;
      const monthIdx = goLiveDate.getMonth();
      if (monthIdx < 0 || monthIdx > 11) return;
      const settingsForGoLive = multiSettings?.get(gl.user_id) ?? combined?.settings;
      if (!settingsForGoLive) return;
      const payArr = Number(getEffectivePayArrForReporting(gl, settingsForGoLive, payArrReportingOptions)) || 0;
      const totalArr = (Number(gl.subs_arr) || 0) + payArr;
      if (!Number.isFinite(totalArr) || totalArr <= 0) return;
      if (goLiveDate.getTime() <= nowTs) {
        goLiveArrToDateByMonth[monthIdx] += totalArr;
      } else {
        goLiveArrFutureByMonth[monthIdx] += totalArr;
      }
    });

    const notBookedArrByMonth = Array.from({ length: 12 }, () => 0);
    const closeWonArrByOak = new Map<number, number>();
    const anyArrByOak = new Map<number, number>();
    salespipeEvents.forEach((row) => {
      if (row.oak_id === null) return;
      const oak = row.oak_id;
      const arr = Number(row.estimated_arr) || 0;
      if (arr <= 0) return;
      anyArrByOak.set(oak, Math.max(anyArrByOak.get(oak) || 0, arr));
      const stageKey = normalizeSalespipeStage(row.stage);
      if (stageKey === 'close_won') {
        closeWonArrByOak.set(oak, Math.max(closeWonArrByOak.get(oak) || 0, arr));
      }
    });

    const notBookedByOak = new Map<number, SignupsEventRow>();
    signupsEvents.forEach((row) => {
      if (row.oak_id === null) return;
      const stage = String(row.customer_info_stage || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
      if (stage !== 'not booked') return;
      const current = notBookedByOak.get(row.oak_id);
      if (!current) {
        notBookedByOak.set(row.oak_id, row);
        return;
      }
      const currentTs = new Date(current.signup_date || current.go_live_date || '1970-01-01').getTime();
      const nextTs = new Date(row.signup_date || row.go_live_date || '1970-01-01').getTime();
      if (nextTs >= currentTs) notBookedByOak.set(row.oak_id, row);
    });

    notBookedByOak.forEach((row, oak) => {
      const mappedArr = closeWonArrByOak.get(oak) ?? anyArrByOak.get(oak) ?? 0;
      if (mappedArr <= 0) return;
      const goLiveDateRaw = row.go_live_date ? new Date(row.go_live_date) : null;
      const hasFutureGoLive = goLiveDateRaw && !Number.isNaN(goLiveDateRaw.getTime()) && goLiveDateRaw > now;
      const projectedDate = hasFutureGoLive
        ? (goLiveDateRaw as Date)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60);
      if (projectedDate.getFullYear() !== selectedYear) return;
      const monthIdx = projectedDate.getMonth();
      if (monthIdx < 0 || monthIdx > 11) return;
      notBookedArrByMonth[monthIdx] += mappedArr;
    });

    const plannedChurnByMonth = (() => {
      const churnData =
        planzahlen?.churn_arr_data && typeof planzahlen.churn_arr_data === 'object'
          ? (planzahlen.churn_arr_data as Record<string, unknown>)
          : {};
      const invoicedChurn =
        churnData.invoiced_churn && typeof churnData.invoiced_churn === 'object'
          ? (churnData.invoiced_churn as Record<string, unknown>)
          : {};
      return normalizeMonthlyPlanValues(invoicedChurn.target_arr).map((value) => Math.abs(value));
    })();

    const actualChurnByMonth = Array.from({ length: 12 }, () => 0);
    const scheduledChurnByMonth = Array.from({ length: 12 }, () => 0);
    churnEvents.forEach((event) => {
      if (!event.churn_month) return;
      const d = new Date(event.churn_month);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== selectedYear) return;
      const idx = d.getMonth();
      if (idx < 0 || idx > 11) return;
      const arrLost = effectiveTotalArrLost(event);
      actualChurnByMonth[idx] += arrLost;
      if (event.scheduled === true) {
        scheduledChurnByMonth[idx] += arrLost;
      }
    });

    const lookerRowsForYear = lookerLeadsMetrics.filter((row) => {
      const payload = row.payload || {};
      const monthIdx = parsePayloadMonthIndex(
        payload,
        ['Lead Created Month', 'Target Month', 'Lead Created Date'],
        selectedYear
      );
      return monthIdx !== null || row.csv_entry_name === 'dashboard-lead/lead_funnel.csv';
    });

    const leadFunnelRows = lookerRowsForYear.filter((row) => row.csv_entry_name === 'dashboard-lead/lead_funnel.csv');
    const leadFunnel = leadFunnelRows.reduce(
      (best, row) => {
        const payload = row.payload || {};
        const leads = readPayloadNumber(payload, ['Leads Number of Leads']) || 0;
        if (!best || leads > best.leads) {
          return {
            leads,
            demoBooked: readPayloadNumber(payload, ['Leads Number of Lead Converted to Demo Booked']) || 0,
            demoCompleted: readPayloadNumber(payload, ['Leads Number of Lead Converted to Demo Completed']) || 0,
            signups: readPayloadNumber(payload, ['Leads Number of Lead Converted to Signup']) || 0,
            goLives: readPayloadNumber(payload, ['Leads Number of Lead Converted to Golive']) || 0,
          };
        }
        return best;
      },
      null as
        | {
            leads: number;
            demoBooked: number;
            demoCompleted: number;
            signups: number;
            goLives: number;
          }
        | null
    );

    const pLeadToDemoBooked =
      leadFunnel && leadFunnel.leads > 0 ? Math.max(0, Math.min(1, leadFunnel.demoBooked / leadFunnel.leads)) : 0;
    const pDemoBookedToDemoCompleted =
      leadFunnel && leadFunnel.demoBooked > 0
        ? Math.max(0, Math.min(1, leadFunnel.demoCompleted / leadFunnel.demoBooked))
        : 0;
    const pDemoCompletedToSignup =
      leadFunnel && leadFunnel.demoCompleted > 0
        ? Math.max(0, Math.min(1, leadFunnel.signups / leadFunnel.demoCompleted))
        : 0;
    const pSignupToGoLive =
      leadFunnel && leadFunnel.signups > 0 ? Math.max(0, Math.min(1, leadFunnel.goLives / leadFunnel.signups)) : 0;
    const pLeadToGoLiveFromFunnel =
      pLeadToDemoBooked * pDemoBookedToDemoCompleted * pDemoCompletedToSignup * pSignupToGoLive;
    const pLeadToGoLive = Math.max(
      0,
      Math.min(1, leadToGoLiveForecastPercent > 0 ? leadToGoLiveForecastPercent / 100 : pLeadToGoLiveFromFunnel)
    );

    const leadCountRows = lookerRowsForYear.filter(
      (row) => row.csv_entry_name === 'dashboard-lead/lead_count_by_month_vs_target_with_tam_fit_.csv'
    );
    const avgSignupRows = lookerRowsForYear.filter(
      (row) => row.csv_entry_name === 'dashboard-lead/_avg_day_lead_to_signup_by_lead_created_month.csv'
    );
    const avgGoLiveRows = lookerRowsForYear.filter(
      (row) => row.csv_entry_name === 'dashboard-lead/avg_day_lead_to_golive_by_lead_created_month.csv'
    );

    const leadCountByMonth = Array.from({ length: 12 }, () => 0);
    const avgLeadToSignupDaysByMonth = Array.from({ length: 12 }, () => 0);
    const avgLeadToGoLiveDaysByMonth = Array.from({ length: 12 }, () => 0);

    leadCountRows.forEach((row) => {
      const payload = row.payload || {};
      const idx = parsePayloadMonthIndex(payload, ['Target Month'], selectedYear);
      if (idx === null) return;
      leadCountByMonth[idx] = readPayloadNumber(payload, ['Number of Leads']) || 0;
    });

    avgSignupRows.forEach((row) => {
      const payload = row.payload || {};
      const idx = parsePayloadMonthIndex(payload, ['Lead Created Month'], selectedYear);
      if (idx === null) return;
      avgLeadToSignupDaysByMonth[idx] = readPayloadNumber(payload, ['Average Lead to Signup days']) || 0;
    });

    avgGoLiveRows.forEach((row) => {
      const payload = row.payload || {};
      const idx = parsePayloadMonthIndex(payload, ['Lead Created Month'], selectedYear);
      if (idx === null) return;
      avgLeadToGoLiveDaysByMonth[idx] = readPayloadNumber(payload, ['Average Lead to Golive days']) || 0;
    });

    const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
    const ytdIndices = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) => idx <= ytdMonthLimit);
    const ytdLeadCounts = ytdIndices.map((idx) => leadCountByMonth[idx]).filter((value) => value > 0);
    const ytdLeadAverage =
      ytdLeadCounts.length > 0
        ? ytdLeadCounts.reduce((sum, value) => sum + value, 0) / ytdLeadCounts.length
        : 0;
    const futureLeadScenarioMonthly = Math.max(0, futureLeadVolumeScenarioMonthlyLeads);

    const computeWeightedAverageDays = (values: number[]) => {
      let weightedSum = 0;
      let weightTotal = 0;
      ytdIndices.forEach((idx) => {
        const days = values[idx];
        const leads = leadCountByMonth[idx];
        if (days <= 0 || leads <= 0) return;
        weightedSum += days * leads;
        weightTotal += leads;
      });
      if (weightTotal > 0) return weightedSum / weightTotal;
      const fallback = ytdIndices.map((idx) => values[idx]).filter((days) => days > 0);
      return fallback.length > 0 ? fallback.reduce((sum, days) => sum + days, 0) / fallback.length : 0;
    };

    const avgLeadToSignupDaysYtd = computeWeightedAverageDays(avgLeadToSignupDaysByMonth);
    const avgLeadToGoLiveDaysYtd = computeWeightedAverageDays(avgLeadToGoLiveDaysByMonth);
    // Lag nutzt beide Metriken: direkter Lead->GoLive-Wert und Lead->Signup plus konservative Restzeit.
    const effectiveLeadToGoLiveLagDays = Math.max(avgLeadToGoLiveDaysYtd, avgLeadToSignupDaysYtd + 21);
    const leadToGoLiveLagMonths = Math.max(0, Math.round(effectiveLeadToGoLiveLagDays / 30));

    let ytdGoLiveArrSum = 0;
    let ytdGoLiveCount = 0;
    allGoLivesForForecast.forEach((gl) => {
      if (!gl?.go_live_date) return;
      const goLiveDate = new Date(gl.go_live_date);
      if (Number.isNaN(goLiveDate.getTime())) return;
      if (goLiveDate.getFullYear() !== selectedYear) return;
      if (goLiveDate.getTime() > nowTs) return;
      const settingsForGoLive = multiSettings?.get(gl.user_id) ?? combined?.settings;
      if (!settingsForGoLive) return;
      const payArr = Number(getEffectivePayArrForReporting(gl, settingsForGoLive, payArrReportingOptions)) || 0;
      const totalArr = (Number(gl.subs_arr) || 0) + payArr;
      if (!Number.isFinite(totalArr) || totalArr <= 0) return;
      ytdGoLiveArrSum += totalArr;
      ytdGoLiveCount += 1;
    });
    // Fallback: wenn in go_lives keine verlässlichen Einzelzeilen für YTD vorhanden sind,
    // Ø ARR/Go-Live aus den Monats-IST-Werten ableiten.
    if (ytdGoLiveCount === 0) {
      monthlyData.forEach((month, idx) => {
        const isYtdMonth = idx <= ytdMonthLimit;
        if (!isYtdMonth) return;
        const goLives = Number(month.goLives) || 0;
        if (goLives <= 0) return;
        const totalArr = (Number(month.subsARR) || 0) + (Number(month.payARR) || 0);
        if (totalArr <= 0) return;
        ytdGoLiveArrSum += totalArr;
        ytdGoLiveCount += goLives;
      });
    }
    const avgArrPerGoLiveYtd = ytdGoLiveCount > 0 ? ytdGoLiveArrSum / ytdGoLiveCount : 0;
    const conversionArrByMonth = Array.from({ length: 12 }, (_, monthIdx) => {
      const sourceMonthIdx = monthIdx - leadToGoLiveLagMonths;
      if (sourceMonthIdx < 0 || sourceMonthIdx > 11) return 0;
      const isFutureForecastMonth =
        selectedYear > currentYear || (selectedYear === currentYear && monthIdx > currentMonth);
      const eligibleLeads = isFutureForecastMonth ? futureLeadScenarioMonthly : ytdLeadAverage;
      if (eligibleLeads <= 0 || pLeadToGoLive <= 0 || avgArrPerGoLiveYtd <= 0) return 0;
      const expectedGoLives = eligibleLeads * pLeadToGoLive;
      const projectedArr = expectedGoLives * avgArrPerGoLiveYtd;
      return Number.isFinite(projectedArr) && projectedArr > 0 ? projectedArr : 0;
    });

    const actualRows = monthlyData.map((month, idx) => {
      const subsActual = month.subsARR || 0;
      const payActual = month.payARR || 0;
      const netActual = subsActual + payActual - actualChurnByMonth[idx];
      const hasAnyActualValue = subsActual !== 0 || payActual !== 0 || netActual !== 0;
      const isPastMonth = selectedYear < currentYear || (selectedYear === currentYear && idx <= currentMonth);
      return {
        idx,
        ...month,
        subsActual,
        payActual,
        netActual,
        hasActual: hasAnyActualValue && isPastMonth,
      };
    });

    const referenceRows = actualRows.filter((row) => row.hasActual);
    const avgSubs =
      referenceRows.length > 0
        ? referenceRows.reduce((sum, row) => sum + row.subsActual, 0) / referenceRows.length
        : 0;
    const avgPay =
      referenceRows.length > 0
        ? referenceRows.reduce((sum, row) => sum + row.payActual, 0) / referenceRows.length
        : 0;
    const shareDenominator = avgSubs + avgPay;
    const subsShare = shareDenominator > 0 ? avgSubs / shareDenominator : 0.5;
    const payShare = shareDenominator > 0 ? avgPay / shareDenominator : 0.5;

    return actualRows.map((row) => {
      const pipelineWeighted = pipelineWeightedByMonth[row.idx] || 0;
      const plannedChurn = plannedChurnByMonth[row.idx] || 0;
      const arrGoLivesToDate = goLiveArrToDateByMonth[row.idx] || 0;
      const arrGoLivesFuture = goLiveArrFutureByMonth[row.idx] || 0;
      const arrNotBookedPipeline = notBookedArrByMonth[row.idx] || 0;
      const isFutureMonth = selectedYear > currentYear || (selectedYear === currentYear && row.idx > currentMonth);
      // Bereits eingebuchter Churn (aus churn_events).
      const bookedChurnAbs = Math.max(
        0,
        isFutureMonth ? (scheduledChurnByMonth[row.idx] || 0) : (actualChurnByMonth[row.idx] || 0)
      );
      const churnScenarioFactor = Math.max(0, futureChurnScenarioFactorPercent / 100);
      const hasScenarioOverride = Math.abs(churnScenarioFactor - 1) > 0.0001;
      const ytdChurnForForecast = (() => {
        const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
        const ytdMonths = Array.from({ length: ytdMonthLimit + 1 }, (_, i) => i);
        const ytdBooked = ytdMonths.reduce((s, i) => s + (actualChurnByMonth[i] || 0), 0);
        const ytdWithChurn = ytdMonths.filter((i) => actualChurnByMonth[i] > 0).length;
        return ytdWithChurn > 0 ? ytdBooked / ytdWithChurn : 0;
      })();
      const trendChurnAbs = isFutureMonth ? ytdChurnForForecast * churnScenarioFactor : 0;
      // Standard (100%): 1 EUR Fallback für Monate ohne scheduled Churn.
      // Bei aktivem Slider-Szenario (> oder < 100%) wird stattdessen der Trend-Churn berücksichtigt.
      const churnForForecast = isFutureMonth
        ? bookedChurnAbs > 0 ? bookedChurnAbs : hasScenarioOverride ? trendChurnAbs : 1
        : bookedChurnAbs;
      const bookedWithinPlanAbs = bookedChurnAbs;
      const projectedWithinPlanAbs =
        isFutureMonth && bookedChurnAbs === 0 && hasScenarioOverride ? trendChurnAbs : 0;
      const overPlanChurnAbs = 0;
      const arrEnterpriseExpectation =
        enterpriseForecastEnabled && isFutureMonth ? Number(enterpriseDealArrByMonth[row.idx] || 0) : 0;
      const arrConversionBaseline = !row.hasActual && isFutureMonth ? (conversionArrByMonth[row.idx] || 0) : 0;
      const primaryArrWithoutConversion =
        arrGoLivesToDate + arrGoLivesFuture + pipelineWeighted + arrNotBookedPipeline + arrEnterpriseExpectation;
      const arrConversionTopUp = Math.max(0, arrConversionBaseline - primaryArrWithoutConversion);

      if (row.hasActual) {
        const arrWeightedPipeline = pipelineWeighted;
        const arrConversionBased = 0;
        const grossArr =
          arrGoLivesToDate +
          arrGoLivesFuture +
          arrWeightedPipeline +
          arrNotBookedPipeline +
          arrConversionBased +
          arrEnterpriseExpectation;
        return {
          ...row,
          subsForecast: row.subsActual,
          payForecast: row.payActual,
          netForecast: grossArr - churnForForecast,
          netTarget: row.subsTarget + row.payTarget - plannedChurn,
          arrGoLivesToDate,
          arrGoLivesFuture,
          arrWeightedPipeline,
          arrNotBookedPipeline,
          arrConversionBased,
          arrEnterpriseExpectation,
          arrChurnBookedDeduction: -bookedWithinPlanAbs,
          arrChurnProjectedDeduction: -projectedWithinPlanAbs,
          arrChurnOverPlanDeduction: -overPlanChurnAbs,
          arrChurnDeduction: -churnForForecast,
          source: 'actual',
        };
      }

      if (pipelineWeighted > 0) {
        const subsForecast = (pipelineWeighted + arrConversionTopUp) * subsShare;
        const payForecast = (pipelineWeighted + arrConversionTopUp) * payShare;
        const arrWeightedPipeline = pipelineWeighted;
        const arrConversionBased = arrConversionTopUp;
        const grossArr =
          arrGoLivesToDate +
          arrGoLivesFuture +
          arrWeightedPipeline +
          arrNotBookedPipeline +
          arrConversionBased +
          arrEnterpriseExpectation;
        return {
          ...row,
          subsForecast,
          payForecast,
          netForecast: grossArr - churnForForecast,
          netTarget: row.subsTarget + row.payTarget - plannedChurn,
          arrGoLivesToDate,
          arrGoLivesFuture,
          arrWeightedPipeline,
          arrNotBookedPipeline,
          arrConversionBased,
          arrEnterpriseExpectation,
          arrChurnBookedDeduction: -bookedWithinPlanAbs,
          arrChurnProjectedDeduction: -projectedWithinPlanAbs,
          arrChurnOverPlanDeduction: -overPlanChurnAbs,
          arrChurnDeduction: -churnForForecast,
          source: 'pipeline',
        };
      }

      const shouldUseConversionForecast = arrConversionTopUp > 0;
      const subsForecast = shouldUseConversionForecast ? arrConversionTopUp * subsShare : 0;
      const payForecast = shouldUseConversionForecast ? arrConversionTopUp * payShare : 0;
      const arrWeightedPipeline = pipelineWeighted;
      const arrConversionBased = subsForecast + payForecast;
      const grossArr =
        arrGoLivesToDate +
        arrGoLivesFuture +
        arrWeightedPipeline +
        arrNotBookedPipeline +
        arrConversionBased +
        arrEnterpriseExpectation;
      return {
        ...row,
        subsForecast,
        payForecast,
        netForecast: grossArr - churnForForecast,
        netTarget: row.subsTarget + row.payTarget - plannedChurn,
        arrGoLivesToDate,
        arrGoLivesFuture,
        arrWeightedPipeline,
        arrNotBookedPipeline,
        arrConversionBased,
        arrEnterpriseExpectation,
        arrChurnBookedDeduction: -bookedWithinPlanAbs,
        arrChurnProjectedDeduction: -projectedWithinPlanAbs,
        arrChurnOverPlanDeduction: -overPlanChurnAbs,
        arrChurnDeduction: -churnForForecast,
        source: shouldUseConversionForecast ? 'conversion_ytd' : 'component',
      };
    });
  }, [
    monthlyData,
    currentMonth,
    currentYear,
    selectedYear,
    salespipeEvents,
    leadsEvents,
    combined,
    multiGoLives,
    multiSettings,
    signupsEvents,
    lookerLeadsMetrics,
    leadToGoLiveForecastPercent,
    futureLeadVolumeScenarioMonthlyLeads,
    futureChurnScenarioFactorPercent,
    salespipeSearch,
    salespipeStageFilter,
    salespipeSourceFilter,
    salespipeDateFrom,
    salespipeDateTo,
    salespipeRelativeDays,
    enterpriseForecastEnabled,
    enterpriseDealArrByMonth,
    planzahlen,
    churnEvents,
    payArrReportingOptions,
  ]);

  const forecastSummary = useMemo(
    () => ({
      subs: forecastData.reduce((sum, row) => sum + (row.subsForecast || 0), 0),
      pay: forecastData.reduce((sum, row) => sum + (row.payForecast || 0), 0),
      net: forecastData.reduce((sum, row) => sum + (row.netForecast || 0), 0),
      enterprise: forecastData.reduce((sum, row) => sum + (Number(row.arrEnterpriseExpectation) || 0), 0),
      churn: forecastData.reduce((sum, row) => sum + Math.abs(Number(row.arrChurnDeduction || 0)), 0),
      ytdBookedSubs: forecastData.reduce(
        (sum, row) => sum + ((row.hasActual ? Number(row.subsActual || row.subsForecast || 0) : 0) || 0),
        0
      ),
      ytdBookedPay: forecastData.reduce(
        (sum, row) => sum + ((row.hasActual ? Number(row.payActual || row.payForecast || 0) : 0) || 0),
        0
      ),
      ytdBookedNet: forecastData.reduce(
        (sum, row) => sum + ((row.hasActual ? Number(row.netActual || row.netForecast || 0) : 0) || 0),
        0
      ),
    }),
    [forecastData]
  );

  const forecastTargetSummary = useMemo(
    () => ({
      subs: monthlyData.reduce((sum, row) => sum + (row.subsTarget || 0), 0),
      pay: monthlyData.reduce((sum, row) => sum + (row.payTarget || 0), 0),
      net: forecastData.reduce((sum, row) => sum + (row.netTarget || 0), 0),
    }),
    [monthlyData, forecastData]
  );

  const futureLeadScenarioSummary = useMemo(() => {
    const leadCountRows = lookerLeadsMetrics.filter(
      (row) => row.csv_entry_name === 'dashboard-lead/lead_count_by_month_vs_target_with_tam_fit_.csv'
    );
    const leadCountByMonth = Array.from({ length: 12 }, () => 0);

    leadCountRows.forEach((row) => {
      const payload = row.payload || {};
      const idx = parsePayloadMonthIndex(payload, ['Target Month'], selectedYear);
      if (idx === null) return;
      leadCountByMonth[idx] = readPayloadNumber(payload, ['Number of Leads']) || 0;
    });

    const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
    const ytdIndices = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) => idx <= ytdMonthLimit);
    const ytdLeadCounts = ytdIndices.map((idx) => leadCountByMonth[idx]).filter((value) => value > 0);
    const ytdLeadAverage =
      ytdLeadCounts.length > 0
        ? ytdLeadCounts.reduce((sum, value) => sum + value, 0) / ytdLeadCounts.length
        : 0;
    const futureMonthIndices = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) =>
      selectedYear > currentYear ? true : selectedYear < currentYear ? false : idx > currentMonth
    );

    const importedFutureLeads = futureMonthIndices.reduce((sum, idx) => sum + (leadCountByMonth[idx] || 0), 0);
    const baselineEligibleFutureLeads = futureMonthIndices.length * ytdLeadAverage;
    const scenarioEligibleFutureLeads = futureMonthIndices.length * Math.max(0, futureLeadVolumeScenarioMonthlyLeads);

    return {
      importedFutureLeads,
      baselineEligibleFutureLeads,
      scenarioEligibleFutureLeads,
      ytdLeadAverage,
      futureMonthsCount: futureMonthIndices.length,
    };
  }, [lookerLeadsMetrics, selectedYear, currentYear, currentMonth, futureLeadVolumeScenarioMonthlyLeads]);

  useEffect(() => {
    const defaultMonthlyLeads = futureLeadScenarioSummary.ytdLeadAverage > 0
      ? Math.round(futureLeadScenarioSummary.ytdLeadAverage)
      : 0;
    setFutureLeadVolumeScenarioMonthlyLeads(defaultMonthlyLeads);
  }, [selectedYear, futureLeadScenarioSummary.ytdLeadAverage]);

  const churnScenarioSummary = useMemo(() => {
    const monthlyChurn = Array.from({ length: 12 }, () => 0);
    churnEvents.forEach((event) => {
      if (!event.churn_month) return;
      const d = new Date(event.churn_month);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== selectedYear) return;
      const idx = d.getMonth();
      if (idx < 0 || idx > 11) return;
      monthlyChurn[idx] += effectiveTotalArrLost(event);
    });

    const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
    const ytdMonths = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) => idx <= ytdMonthLimit);
    const futureMonths = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) =>
      selectedYear > currentYear ? true : selectedYear < currentYear ? false : idx > currentMonth
    );

    // Basis: YTD-Ø monatlich eingebuchter Churn (symmetrisch zur ARR-Seite)
    const ytdChurnTotal = ytdMonths.reduce((sum, idx) => sum + (monthlyChurn[idx] || 0), 0);
    const ytdMonthsWithChurn = ytdMonths.filter((idx) => monthlyChurn[idx] > 0);
    const ytdMonthlyBookedAverage = ytdMonthsWithChurn.length > 0
      ? ytdChurnTotal / ytdMonthsWithChurn.length
      : 0;

    const churnScenarioFactor = Math.max(0, futureChurnScenarioFactorPercent / 100);
    // Trend-Projektion: YTD-Ø × Faktor × Anzahl Zukunftsmonate
    const trendBaseByMonth = futureMonths.map(() => ytdMonthlyBookedAverage);
    const futureBookedChurnTotal = futureMonths.reduce((sum, idx) => sum + (monthlyChurn[idx] || 0), 0);
    const futureTrendBaseTotal = futureMonths.length * ytdMonthlyBookedAverage;
    const scenarioFutureChurnTotal = futureTrendBaseTotal * churnScenarioFactor;

    return {
      defaultFactorPercent: 100,
      ytdMonthlyBookedAverage,
      trendBaseByMonth,
      futureTrendBaseTotal,
      scenarioFutureChurnTotal,
      churnScenarioFactor,
      ytdChurnTotal,
      futureBookedChurnTotal,
      futureMonthsCount: futureMonths.length,
      // Abwärtskompatible Felder für bestehende UI-Referenzen
      defaultMonthlyPlanChurn: ytdMonthlyBookedAverage,
      futurePlanBaseTotal: futureTrendBaseTotal,
      scenarioFuturePlanTotal: scenarioFutureChurnTotal,
      overPlanFutureTotal: 0,
      ytdBookedFactorPercent: 100,
    };
  }, [churnEvents, selectedYear, currentYear, currentMonth, futureChurnScenarioFactorPercent]);

  useEffect(() => {
    // Default: 100% = exakt YTD-Ø Churn-Trend
    setFutureChurnScenarioFactorPercent(100);
  }, [selectedYear]);

  const enterpriseDefaultArrPerGoLiveYtd = useMemo(() => {
    const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
    const ytdRows = monthlyData.filter((row, idx) => idx <= ytdMonthLimit);
    const ytdGoLives = ytdRows.reduce((sum, row) => sum + Math.max(0, Number(row.goLives) || 0), 0);
    if (ytdGoLives <= 0) return 0;
    const ytdArr = ytdRows.reduce((sum, row) => sum + (Number(row.subsARR) || 0) + (Number(row.payARR) || 0), 0);
    return ytdArr > 0 ? ytdArr / ytdGoLives : 0;
  }, [monthlyData, selectedYear, currentYear, currentMonth]);

  useEffect(() => {
    setEnterpriseDealTargetMonthInput(Math.max(1, Math.min(12, currentMonth + 2)));
    setEnterpriseDealExpectedGoLivesInput(1);
    setEnterpriseDealArrPerGoLiveInput(Math.max(0, Math.round(enterpriseDefaultArrPerGoLiveYtd)));
  }, [selectedYear, currentMonth, enterpriseDefaultArrPerGoLiveYtd]);

  const forecastAchievement = useMemo(
    () => ({
      subs: forecastTargetSummary.subs > 0 ? forecastSummary.subs / forecastTargetSummary.subs : 0,
      pay: forecastTargetSummary.pay > 0 ? forecastSummary.pay / forecastTargetSummary.pay : 0,
      net: forecastTargetSummary.net > 0 ? forecastSummary.net / forecastTargetSummary.net : 0,
    }),
    [forecastSummary, forecastTargetSummary]
  );

  const forecastGapSummary = useMemo(() => {
    const churnTarget = (churnScenarioSummary.ytdChurnTotal || 0) + (churnScenarioSummary.futurePlanBaseTotal || 0);
    return {
      subs: (forecastTargetSummary.subs || 0) - (forecastSummary.subs || 0),
      pay: (forecastTargetSummary.pay || 0) - (forecastSummary.pay || 0),
      net: (forecastTargetSummary.net || 0) - (forecastSummary.net || 0),
      churn: (forecastSummary.churn || 0) - churnTarget,
    };
  }, [forecastSummary, forecastTargetSummary, churnScenarioSummary]);

  const formatSignedCurrency = (value: number) => `${value > 0 ? '+' : ''}${formatCurrency(value)}`;

  const leadInsightsForScenario = useMemo(() => {
    const rows = lookerLeadsMetrics.filter((row) => row.csv_entry_name.startsWith('dashboard-lead/'));

    const sourceRows = rows.filter((row) => row.csv_entry_name.includes('lead_count_by_lead_source'));
    const sourceSummary = sourceRows
      .map((row) => {
        const payload = row.payload || {};
        return {
          source:
            readPayloadString(payload, ['Lead source (Grouping)', 'Lead source', 'Lead Source']) ||
            readPayloadString(payload, ['Salesforce Region']) ||
            'Unbekannt',
          leads: readPayloadNumber(payload, ['Number of Leads', 'Leads']) || 0,
          tamFitPercent: readPayloadNumber(payload, ['TAM FIT %', 'TAM Fit %']),
          leadToGoLivePercent: readPayloadNumber(payload, [
            'Lead to Golive conversion %',
            'Lead to GoLive conversion %',
            'Lead to golive conversion %',
          ]),
        };
      })
      .filter((row) => row.leads > 0)
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 6);

    const statusRows = rows.filter((row) => row.csv_entry_name.includes('lead_count_by_lead_status'));
    const statusSummary = statusRows.reduce(
      (acc, row) => {
        const payload = row.payload || {};
        const statusRaw = (readPayloadString(payload, ['Status', 'Lead Status']) || '').toLowerCase();
        const count = readPayloadNumber(payload, ['Number of Leads', 'Leads']) || 0;
        if (!statusRaw || count <= 0) return acc;
        if (statusRaw.includes('qualified')) acc.qualified += count;
        else if (statusRaw.includes('not converted')) acc.notConverted += count;
        else if (statusRaw.includes('working')) acc.working += count;
        else if (statusRaw.includes('new')) acc.newlyCreated += count;
        return acc;
      },
      { qualified: 0, notConverted: 0, working: 0, newlyCreated: 0 }
    );

    const cohortRows = rows.filter((row) => row.csv_entry_name.includes('lead_created_month'));
    const collectMetricValues = (namePart: string, preferredKeys: string[], options?: { excludePercent?: boolean }) =>
      cohortRows
        .filter((row) => row.csv_entry_name.toLowerCase().includes(namePart.toLowerCase()))
        .map((row) => pickPayloadMetric(row.payload || {}, preferredKeys, options))
        .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
    const average = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

    const cohortSummary = {
      leadToDemoCompletedRateYtd: average(
        collectMetricValues('lead_to_demo_completed_by_lead_created_month', ['Lead to Demo Completed conversion %'])
      ),
      leadToSignupRateYtd: average(
        collectMetricValues('lead_to_signup_by_lead_created_month', ['Lead to Signup conversion %'])
      ),
      leadToGoLiveRateYtd: average(
        collectMetricValues('lead_to_golive_by_lead_created_month', ['Lead to Golive conversion %'])
      ),
      avgLeadToDemoCompletedDays: average(
        collectMetricValues('avg_day_lead_to_demo_completed_by_lead_created_month', ['Average lead to demo'], {
          excludePercent: true,
        })
      ),
      avgLeadToSignupDays: average(
        collectMetricValues('avg_day_lead_to_signup_by_lead_created_month', ['Average lead to signup'], {
          excludePercent: true,
        })
      ),
      avgLeadToGoLiveDays: average(
        collectMetricValues('avg_day_lead_to_golive_by_lead_created_month', ['Average lead to golive'], {
          excludePercent: true,
        })
      ),
    };

    const repRows = rows.filter((row) => row.csv_entry_name.includes('sales_representative_leader_board'));
    const repSummary = repRows
      .map((row) => {
        const payload = row.payload || {};
        return {
          rep: readPayloadString(payload, ['Assigned to', 'Lead Owner', 'Sales representative']) || 'Unbekannt',
          leads: readPayloadNumber(payload, ['Number of Leads', 'Leads']) || 0,
          leadToGoLivePercent: readPayloadNumber(payload, [
            'Lead to Golive conversion %',
            'Lead to GoLive conversion %',
          ]),
        };
      })
      .filter((row) => row.leads > 0)
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 6);

    const detailRows = rows.filter((row) => row.csv_entry_name.includes('lead_level_details'));
    let qualifiedOrWorkingWithoutDemo = 0;
    let notConvertedLeads = 0;
    let validLeadKnown = 0;
    let validLeadYes = 0;

    detailRows.forEach((row) => {
      const payload = row.payload || {};
      const status = (readPayloadString(payload, ['Status', 'Lead Status']) || '').toLowerCase();
      const demoBooked = readPayloadBoolean(payload, [
        'Converted to Demo Booked (Yes / No)',
        'Converted to Demo Booked (Yes/No)',
      ]);
      const validLead = readPayloadBoolean(payload, ['Valid Lead (Yes / No)', 'Valid Lead (Yes/No)']);
      const leadCount = readPayloadNumber(payload, ['Number of Leads']) || 1;

      if ((status.includes('qualified') || status.includes('working')) && demoBooked === false) {
        qualifiedOrWorkingWithoutDemo += leadCount;
      }
      if (status.includes('not converted')) {
        notConvertedLeads += leadCount;
      }
      if (validLead !== null) {
        validLeadKnown += leadCount;
        if (validLead) validLeadYes += leadCount;
      }
    });

    const keyRisks: string[] = [];
    if (statusSummary.notConverted > statusSummary.qualified * 0.7 && statusSummary.notConverted > 0) {
      keyRisks.push('Hoher Anteil not converted vs. qualified deutet auf Funnel-Leak nach Qualifizierung hin.');
    }
    if (qualifiedOrWorkingWithoutDemo > 0) {
      keyRisks.push('Viele qualified/working Leads ohne Demo-Booking sind kurzfristiger Risikohebel für Forecast-Lücken.');
    }
    if (cohortSummary.avgLeadToGoLiveDays !== null && cohortSummary.avgLeadToGoLiveDays > 45) {
      keyRisks.push('Langer Lead->GoLive Zyklus erhöht Lag-Risiko für aktuelle Monatsziele.');
    }

    return {
      sourceSummary,
      statusSummary: {
        ...statusSummary,
        qualifiedVsNotConvertedRatio:
          statusSummary.notConverted > 0 ? statusSummary.qualified / statusSummary.notConverted : null,
      },
      cohortSummary,
      repSummary,
      leadDetailSignals: {
        qualifiedOrWorkingWithoutDemo,
        notConvertedLeads,
        validLeadSharePercent: validLeadKnown > 0 ? (validLeadYes / validLeadKnown) * 100 : null,
        keyRisks,
      },
    };
  }, [lookerLeadsMetrics]);

  const forecastScenarioInput = useMemo<ScenarioReportInput>(() => {
    const isFutureMonth = (idx: number) =>
      selectedYear > currentYear ? true : selectedYear < currentYear ? false : idx > currentMonth;
    const futureConversionArrTotal = forecastData.reduce((sum, row) => {
      if (!isFutureMonth(Number(row.idx))) return sum;
      return sum + (Number(row.arrConversionBased) || 0);
    }, 0);

    const expectedGoLivesFromLeads =
      Math.max(0, futureLeadScenarioSummary.scenarioEligibleFutureLeads) * Math.max(0, leadToGoLiveForecastPercent / 100);
    const avgArrPerExpectedGoLive =
      expectedGoLivesFromLeads > 0 ? futureConversionArrTotal / expectedGoLivesFromLeads : 0;
    const baselineLeadConversionPercent = 16;
    const baselineLeadVolumePerFutureMonth = Math.max(0, Math.round(futureLeadScenarioSummary.ytdLeadAverage));
    const baselineChurnFactorPercent = Math.max(0, churnScenarioSummary.defaultFactorPercent || 100);
    const futureMonthsCount = Math.max(0, futureLeadScenarioSummary.futureMonthsCount || 0);
    const currentConversionArr = expectedGoLivesFromLeads * avgArrPerExpectedGoLive;
    const baselineExpectedGoLivesFromLeads =
      futureMonthsCount * baselineLeadVolumePerFutureMonth * (baselineLeadConversionPercent / 100);
    const baselineConversionArr = baselineExpectedGoLivesFromLeads * avgArrPerExpectedGoLive;
    const currentFutureChurn = Math.max(0, churnScenarioSummary.scenarioFutureChurnTotal || 0);
    const baselineFutureChurn = Math.max(0, churnScenarioSummary.futurePlanBaseTotal || 0);
    const baselineForecastNetArrEstimate =
      (forecastSummary.net || 0) +
      (baselineConversionArr - currentConversionArr) -
      (baselineFutureChurn - currentFutureChurn);
    const baselineGapArr = (forecastTargetSummary.net || 0) - baselineForecastNetArrEstimate;
    const scenarioGapArr = (forecastTargetSummary.net || 0) - (forecastSummary.net || 0);
    const forecastWeightedPipelineArr = forecastData.reduce(
      (sum, row) => sum + (Number(row.arrWeightedPipeline) || 0),
      0
    );

    const leadVolumeChangePercentVsBaseline =
      baselineLeadVolumePerFutureMonth > 0
        ? ((futureLeadVolumeScenarioMonthlyLeads - baselineLeadVolumePerFutureMonth) / baselineLeadVolumePerFutureMonth) *
          100
        : futureLeadVolumeScenarioMonthlyLeads > 0
          ? 100
          : 0;
    const conversionDeltaPctPointsVsBaseline = leadToGoLiveForecastPercent - baselineLeadConversionPercent;
    const churnFactorDeltaPctPointsVsBaseline = futureChurnScenarioFactorPercent - baselineChurnFactorPercent;

    let feasibilityScore = 100;
    const absLeadDelta = Math.abs(leadVolumeChangePercentVsBaseline);
    const absConversionDelta = Math.abs(conversionDeltaPctPointsVsBaseline);
    const absChurnDelta = Math.abs(churnFactorDeltaPctPointsVsBaseline);
    if (absLeadDelta > 15) feasibilityScore -= 15;
    if (absLeadDelta > 30) feasibilityScore -= 15;
    if (absLeadDelta > 50) feasibilityScore -= 20;
    if (absConversionDelta > 2) feasibilityScore -= 20;
    if (absConversionDelta > 5) feasibilityScore -= 20;
    if (absConversionDelta > 8) feasibilityScore -= 15;
    if (absChurnDelta > 15) feasibilityScore -= 10;
    if (absChurnDelta > 30) feasibilityScore -= 20;
    if (scenarioGapArr <= 0) feasibilityScore = Math.min(100, feasibilityScore + 5);
    feasibilityScore = Math.max(0, Math.round(feasibilityScore));
    const feasibilityBand: 'high' | 'medium' | 'low' =
      feasibilityScore >= 75 ? 'high' : feasibilityScore >= 50 ? 'medium' : 'low';

    return {
      userId: user?.id ? String(user.id) : undefined,
      year: selectedYear,
      leadConversionPercent: leadToGoLiveForecastPercent,
      leadVolumePerFutureMonth: futureLeadVolumeScenarioMonthlyLeads,
      churnFactorPercent: futureChurnScenarioFactorPercent,
      futureMonthsCount: futureLeadScenarioSummary.futureMonthsCount,
      baselineFutureLeads: futureLeadScenarioSummary.baselineEligibleFutureLeads,
      scenarioFutureLeads: futureLeadScenarioSummary.scenarioEligibleFutureLeads,
      ytdAvgLeadsPerMonth: futureLeadScenarioSummary.ytdLeadAverage,
      avgArrPerExpectedGoLive,
      expectedGoLivesFromLeads,
      forecastNetArr: forecastSummary.net,
      targetNetArr: forecastTargetSummary.net,
      forecastSubsArr: forecastSummary.subs,
      targetSubsArr: forecastTargetSummary.subs,
      forecastPayArr: forecastSummary.pay,
      targetPayArr: forecastTargetSummary.pay,
      forecastChurnArr: forecastSummary.churn,
      forecastWeightedPipelineArr,
      ytdBookedNetArr: forecastSummary.ytdBookedNet,
      futurePlanChurnArr: churnScenarioSummary.futurePlanBaseTotal,
      scenarioFutureChurnArr: churnScenarioSummary.scenarioFutureChurnTotal,
      baselineDefaults: {
        leadConversionPercent: baselineLeadConversionPercent,
        leadVolumePerFutureMonth: baselineLeadVolumePerFutureMonth,
        churnFactorPercent: baselineChurnFactorPercent,
        forecastNetArr: baselineForecastNetArrEstimate,
        netGapArr: baselineGapArr,
      },
      scenarioAssessment: {
        forecastNetArr: forecastSummary.net,
        netGapArr: scenarioGapArr,
        leadVolumeChangePercentVsBaseline,
        conversionDeltaPctPointsVsBaseline,
        churnFactorDeltaPctPointsVsBaseline,
        feasibilityScore,
        feasibilityBand,
      },
      leadInsights: leadInsightsForScenario,
      tableSignals: {
        salespipeRows: salespipeEvents.length,
        signupsRows: signupsEvents.length,
        leadsRows: leadsEvents.length,
        lookerLeadsRows: lookerLeadsMetrics.length,
        churnRows: churnEvents.length,
        hasPlanzahlen: Boolean(planzahlen),
        keyRiskCount: leadInsightsForScenario.leadDetailSignals?.keyRisks?.length || 0,
      },
    };
  }, [
    selectedYear,
    currentYear,
    currentMonth,
    forecastData,
    futureLeadScenarioSummary,
    leadToGoLiveForecastPercent,
    futureLeadVolumeScenarioMonthlyLeads,
    futureChurnScenarioFactorPercent,
    forecastSummary,
    forecastTargetSummary,
    churnScenarioSummary,
    leadInsightsForScenario,
    salespipeEvents.length,
    signupsEvents.length,
    leadsEvents.length,
    lookerLeadsMetrics.length,
    churnEvents.length,
    planzahlen,
    user?.id,
  ]);

  const loadSavedScenarios = useCallback(async () => {
    if (!user?.id) return;
    setSavedScenariosLoading(true);
    setSavedScenarioError(null);
    try {
      const response = await fetch(
        `/api/forecast/scenarios?userId=${encodeURIComponent(String(user.id))}&year=${encodeURIComponent(
          String(selectedYear)
        )}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Szenarien konnten nicht geladen werden');
      }
      setSavedScenarios(Array.isArray(data.scenarios) ? (data.scenarios as SavedForecastScenario[]) : []);
    } catch (error: any) {
      setSavedScenarioError(error?.message || 'Szenarien konnten nicht geladen werden');
    } finally {
      setSavedScenariosLoading(false);
    }
  }, [selectedYear, user?.id]);

  useEffect(() => {
    if (reportType !== 'forecast') return;
    loadSavedScenarios();
  }, [reportType, loadSavedScenarios]);

  const loadEnterpriseDeals = useCallback(async () => {
    if (!user?.id) return;
    setEnterpriseDealsLoading(true);
    setEnterpriseDealsError(null);
    try {
      const response = await fetch(
        `/api/forecast/enterprise-deals?userId=${encodeURIComponent(String(user.id))}&year=${encodeURIComponent(
          String(selectedYear)
        )}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Enterprise Deals konnten nicht geladen werden');
      }
      setEnterpriseDeals(Array.isArray(data.deals) ? (data.deals as ForecastEnterpriseDeal[]) : []);
    } catch (error: any) {
      setEnterpriseDealsError(error?.message || 'Enterprise Deals konnten nicht geladen werden');
    } finally {
      setEnterpriseDealsLoading(false);
    }
  }, [selectedYear, user?.id]);

  useEffect(() => {
    if (reportType !== 'forecast') return;
    loadEnterpriseDeals();
  }, [reportType, loadEnterpriseDeals]);

  const saveScenarioRecord = useCallback(
    async ({
      title,
      scenarioPayload,
      reportHeadline,
      reportNarrative,
      reportSummary,
    }: {
      title: string;
      scenarioPayload: Record<string, unknown>;
      reportHeadline?: string | null;
      reportNarrative?: string | null;
      reportSummary?: string[];
    }) => {
      if (!user?.id) throw new Error('Benutzer nicht verfügbar');
      const response = await fetch('/api/forecast/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          year: selectedYear,
          title,
          scenarioPayload,
          reportHeadline: reportHeadline || null,
          reportNarrative: reportNarrative || null,
          reportSummary: reportSummary || [],
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Szenario konnte nicht gespeichert werden');
      }
    },
    [selectedYear, user?.id]
  );

  const buildSavedReportFallback = useCallback(
    (saved: SavedForecastScenario): ScenarioReport => {
      const payload = (saved.scenario_payload || {}) as Record<string, unknown>;
      const reportSummary = Array.isArray(saved.report_summary)
        ? saved.report_summary.map((line) => String(line)).filter(Boolean)
        : [];

      return {
        mode: 'rules',
        title: String(saved.report_headline || saved.title || 'Gespeicherter Report'),
        headline: String(saved.report_headline || saved.title || 'Gespeicherter Report'),
        status: forecastScenarioInput.targetNetArr > forecastScenarioInput.forecastNetArr ? 'gap' : 'on_track',
        year: selectedYear,
        netGapArr: Math.max(0, forecastScenarioInput.targetNetArr - forecastScenarioInput.forecastNetArr),
        assumptions: {
          futureMonthsCount: forecastScenarioInput.futureMonthsCount,
          leadConversionPercent: Number(payload.leadToGoLiveForecastPercent || forecastScenarioInput.leadConversionPercent),
          leadVolumePerFutureMonth: Number(
            payload.futureLeadVolumeScenarioMonthlyLeads || forecastScenarioInput.leadVolumePerFutureMonth
          ),
          churnFactorPercent: Number(
            payload.futureChurnScenarioFactorPercent || forecastScenarioInput.churnFactorPercent
          ),
          avgArrPerExpectedGoLive: forecastScenarioInput.avgArrPerExpectedGoLive,
          expectedGoLivesFromLeads: forecastScenarioInput.expectedGoLivesFromLeads,
        },
        leverSensitivity: {
          netArrPerAdditionalLeadPerMonth: 0,
          netArrPerConversionPoint: 0,
          netArrPerChurnPointReduction: 0,
        },
        scenarioDelta: {
          baselineNetArr: forecastScenarioInput.baselineDefaults?.forecastNetArr || forecastScenarioInput.forecastNetArr,
          scenarioNetArr: forecastScenarioInput.forecastNetArr,
          deltaNetArrVsBaseline:
            forecastScenarioInput.forecastNetArr -
            (forecastScenarioInput.baselineDefaults?.forecastNetArr || forecastScenarioInput.forecastNetArr),
          additionalLeadsPerMonthVsBaseline: 0,
          additionalLeadsTotalVsBaseline: 0,
          additionalArrFromLeadVolumeVsBaseline: 0,
          conversionDeltaPctPointsVsBaseline: 0,
          additionalLeadsFromConversionVsBaseline: 0,
          additionalArrFromConversionVsBaseline: 0,
          churnFactorDeltaPctPointsVsBaseline: 0,
          additionalArrFromChurnDeltaVsBaseline: 0,
        },
        actions: [],
        summaryLines: reportSummary,
        narrative: saved.report_narrative || undefined,
        generatedAtIso: saved.created_at,
      };
    },
    [forecastScenarioInput, selectedYear]
  );

  const handleSaveManualScenario = useCallback(async () => {
    if (!user?.id) return;
    setSavedScenarioActionLoading(true);
    setSavedScenarioError(null);
    try {
      const timestampLabel = new Date().toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      await saveScenarioRecord({
        title: `Manuelles Szenario (${timestampLabel})`,
        scenarioPayload: {
          leadToGoLiveForecastPercent,
          futureLeadVolumeScenarioMonthlyLeads,
          futureChurnScenarioFactorPercent,
          enterpriseForecastEnabled,
          enterpriseDealsCount: enterpriseDeals.length,
          enterpriseActiveArr: enterpriseDealsSummary.active,
          source: 'manual_slider_save',
          forecastScenarioInput,
          scenarioReportMeta,
        },
        reportHeadline: 'Manuelles Slider-Szenario',
        reportNarrative: null,
        reportSummary: [],
      });

      setSavedScenarioConfirmation('Manuelles Szenario gespeichert.');
      setTimeout(() => setSavedScenarioConfirmation(null), 6000);
      await loadSavedScenarios();
    } catch (error: any) {
      setSavedScenarioError(error?.message || 'Szenario konnte nicht gespeichert werden');
    } finally {
      setSavedScenarioActionLoading(false);
    }
  }, [
    user?.id,
    leadToGoLiveForecastPercent,
    futureLeadVolumeScenarioMonthlyLeads,
    futureChurnScenarioFactorPercent,
    enterpriseForecastEnabled,
    enterpriseDeals.length,
    enterpriseDealsSummary.active,
    forecastScenarioInput,
    scenarioReportMeta,
    saveScenarioRecord,
    loadSavedScenarios,
  ]);

  const handleSaveScenario = useCallback(async () => {
    if (!scenarioReport || !user?.id) return;
    setSavedScenarioActionLoading(true);
    setSavedScenarioError(null);
    try {
      const leadAction = scenarioReport.actions.find((action) => action.key === 'lead_volume');
      const conversionAction = scenarioReport.actions.find((action) => action.key === 'conversion');
      const churnAction = scenarioReport.actions.find((action) => action.key === 'churn');

      const leadDelta = Number(leadAction?.requiredDelta || 0);
      const conversionDelta = Number(conversionAction?.requiredDelta || 0);
      const churnDeltaReduction = Number(churnAction?.requiredDelta || 0);

      const nextLeadVolume = Number.isFinite(leadDelta)
        ? Math.max(0, futureLeadVolumeScenarioMonthlyLeads + leadDelta)
        : futureLeadVolumeScenarioMonthlyLeads;
      const nextConversion = Number.isFinite(conversionDelta)
        ? Math.max(0, Math.min(100, leadToGoLiveForecastPercent + conversionDelta))
        : leadToGoLiveForecastPercent;
      const nextChurnFactor = Number.isFinite(churnDeltaReduction)
        ? Math.max(0, Math.min(300, futureChurnScenarioFactorPercent - churnDeltaReduction))
        : futureChurnScenarioFactorPercent;

      const timestampLabel = new Date().toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const generatedTitle = `Szenario mit dem Ziel "Forecast Summe NET ARR ${formatCurrency(
        forecastScenarioInput.targetNetArr
      )}", Gap ${formatCurrency(scenarioReport.netGapArr)}, Maßnahmen siehe Report.`;

      await saveScenarioRecord({
        title: generatedTitle,
        scenarioPayload: {
          leadToGoLiveForecastPercent: nextConversion,
          futureLeadVolumeScenarioMonthlyLeads: nextLeadVolume,
          futureChurnScenarioFactorPercent: nextChurnFactor,
          enterpriseForecastEnabled,
          enterpriseDealsCount: enterpriseDeals.length,
          enterpriseActiveArr: enterpriseDealsSummary.active,
          source: 'report_recommendation_save',
          sourceSliderState: {
            leadToGoLiveForecastPercent,
            futureLeadVolumeScenarioMonthlyLeads,
            futureChurnScenarioFactorPercent,
            enterpriseForecastEnabled,
            enterpriseDealsCount: enterpriseDeals.length,
            enterpriseActiveArr: enterpriseDealsSummary.active,
          },
          recommendedDelta: {
            leadVolumePerMonth: leadDelta,
            conversionPctPoints: conversionDelta,
            churnFactorReductionPctPoints: churnDeltaReduction,
          },
          forecastScenarioInput,
          scenarioReportMeta,
          reportSnapshot: scenarioReport,
          savedAtLabel: timestampLabel,
        },
        reportHeadline: scenarioReport.headline,
        reportNarrative: scenarioReport.narrative || null,
        reportSummary: scenarioReport.summaryLines || [],
      });

      setFutureLeadVolumeScenarioMonthlyLeads(nextLeadVolume);
      setLeadToGoLiveForecastPercent(nextConversion);
      setFutureChurnScenarioFactorPercent(nextChurnFactor);

      const parts: string[] = [];
      if (Math.abs(leadDelta) >= 0.5) parts.push(`${leadDelta > 0 ? '+' : ''}${Math.round(leadDelta)} Leads/Monat`);
      if (Math.abs(conversionDelta) >= 0.05) parts.push(`${conversionDelta > 0 ? '+' : ''}${conversionDelta.toFixed(1)}pp Conversion`);
      if (Math.abs(churnDeltaReduction) >= 0.05)
        parts.push(`${churnDeltaReduction > 0 ? '-' : '+'}${Math.abs(churnDeltaReduction).toFixed(1)}pp Churn`);
      setSavedScenarioConfirmation(
        parts.length > 0
          ? `Szenario übernommen: ${parts.join(', ')}`
          : 'Szenario übernommen (keine Slider-Anpassung)'
      );
      setTimeout(() => setSavedScenarioConfirmation(null), 6000);

      await loadSavedScenarios();
    } catch (error: any) {
      setSavedScenarioError(error?.message || 'Szenario konnte nicht gespeichert werden');
    } finally {
      setSavedScenarioActionLoading(false);
    }
  }, [
    scenarioReport,
    user?.id,
    leadToGoLiveForecastPercent,
    futureLeadVolumeScenarioMonthlyLeads,
    futureChurnScenarioFactorPercent,
    enterpriseForecastEnabled,
    enterpriseDeals.length,
    enterpriseDealsSummary.active,
    forecastScenarioInput,
    scenarioReportMeta,
    saveScenarioRecord,
    loadSavedScenarios,
  ]);

  const handleAddEnterpriseDeal = useCallback(async () => {
    if (!user?.id) return;
    const query = enterpriseLookupQuery.trim();
    if (!query) {
      setEnterpriseDealsError('Bitte OAK ID oder Accountname auswählen.');
      return;
    }

    const lowerQuery = query.toLowerCase();
    const directMatch = enterpriseLookupOptions.find((option) => option.label.toLowerCase() === lowerQuery);
    const numericOak = Number(query.replace(/[^\d]/g, ''));
    const oakMatch =
      Number.isFinite(numericOak) && numericOak > 0
        ? enterpriseLookupOptions.find((option) => Number(option.oakId || 0) === numericOak)
        : undefined;
    const includesMatch = enterpriseLookupOptions.find((option) => option.label.toLowerCase().includes(lowerQuery));
    const matched = directMatch || oakMatch || includesMatch;

    if (!matched || (!matched.oakId && !matched.accountName)) {
      setEnterpriseDealsError('Kein passender Datensatz gefunden. Bitte OAK ID/Account aus der Vorschlagsliste wählen.');
      return;
    }

    const expectedGoLives = Math.max(0, Number(enterpriseDealExpectedGoLivesInput) || 0);
    const arrPerGoLive = Math.max(0, Number(enterpriseDealArrPerGoLiveInput) || 0);
    const targetMonth = Math.max(1, Math.min(12, Math.round(Number(enterpriseDealTargetMonthInput) || 1)));
    if (expectedGoLives <= 0 || arrPerGoLive <= 0) {
      setEnterpriseDealsError('Go-Lives und ARR pro Go-Live müssen größer als 0 sein.');
      return;
    }

    setAddingEnterpriseDeal(true);
    setEnterpriseDealsError(null);
    try {
      const response = await fetch('/api/forecast/enterprise-deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          year: selectedYear,
          targetMonth,
          expectedGoLives,
          arrPerGoLive,
          oakId: matched.oakId,
          accountName: matched.accountName,
          isActive: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Enterprise Deal konnte nicht gespeichert werden');
      }

      setEnterpriseLookupQuery('');
      setEnterpriseDealExpectedGoLivesInput(1);
      setEnterpriseDealArrPerGoLiveInput((prev) =>
        prev > 0 ? Math.max(0, Math.round(prev)) : Math.max(0, Math.round(enterpriseDefaultArrPerGoLiveYtd))
      );
      setEnterpriseForecastEnabled(true);
      await loadEnterpriseDeals();
    } catch (error: any) {
      setEnterpriseDealsError(error?.message || 'Enterprise Deal konnte nicht gespeichert werden');
    } finally {
      setAddingEnterpriseDeal(false);
    }
  }, [
    enterpriseLookupQuery,
    enterpriseLookupOptions,
    enterpriseDealExpectedGoLivesInput,
    enterpriseDealArrPerGoLiveInput,
    enterpriseDealTargetMonthInput,
    enterpriseDefaultArrPerGoLiveYtd,
    loadEnterpriseDeals,
    selectedYear,
    user?.id,
  ]);

  const handleToggleEnterpriseDeal = useCallback(
    async (deal: ForecastEnterpriseDeal) => {
      if (!user?.id) return;
      setTogglingEnterpriseDealId(deal.id);
      setEnterpriseDealsError(null);
      try {
        const response = await fetch('/api/forecast/enterprise-deals', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            dealId: deal.id,
            isActive: !deal.is_active,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Status konnte nicht aktualisiert werden');
        }
        setEnterpriseDeals((prev) =>
          prev.map((entry) => (entry.id === deal.id ? { ...entry, is_active: !deal.is_active } : entry))
        );
        if (!deal.is_active) {
          setEnterpriseForecastEnabled(true);
        }
      } catch (error: any) {
        setEnterpriseDealsError(error?.message || 'Status konnte nicht aktualisiert werden');
      } finally {
        setTogglingEnterpriseDealId(null);
      }
    },
    [user?.id]
  );

  const handleDeleteEnterpriseDeal = useCallback(
    async (deal: ForecastEnterpriseDeal) => {
      if (!user?.id) return;
      const confirmed = window.confirm(`Enterprise Deal wirklich löschen?\n\n${deal.account_name || deal.oak_id || deal.id}`);
      if (!confirmed) return;
      setDeletingEnterpriseDealId(deal.id);
      setEnterpriseDealsError(null);
      try {
        const response = await fetch('/api/forecast/enterprise-deals', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            dealId: deal.id,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Deal konnte nicht gelöscht werden');
        }
        setEnterpriseDeals((prev) => prev.filter((entry) => entry.id !== deal.id));
      } catch (error: any) {
        setEnterpriseDealsError(error?.message || 'Deal konnte nicht gelöscht werden');
      } finally {
        setDeletingEnterpriseDealId(null);
      }
    },
    [user?.id]
  );

  const handleDeleteSavedScenario = useCallback(
    async (saved: SavedForecastScenario) => {
      if (!user?.id) return;
      const isConfirmed = window.confirm(`Szenario wirklich löschen?\n\n${saved.title}`);
      if (!isConfirmed) return;

      setDeletingScenarioId(saved.id);
      setSavedScenarioError(null);
      try {
        const response = await fetch('/api/forecast/scenarios', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            scenarioId: saved.id,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Szenario konnte nicht gelöscht werden');
        }

        setSavedScenarioConfirmation(`Szenario gelöscht: ${saved.title}`);
        setTimeout(() => setSavedScenarioConfirmation(null), 6000);
        await loadSavedScenarios();
      } catch (error: any) {
        setSavedScenarioError(error?.message || 'Szenario konnte nicht gelöscht werden');
      } finally {
        setDeletingScenarioId(null);
      }
    },
    [loadSavedScenarios, user?.id]
  );

  const handleApplySavedScenario = useCallback(
    (saved: SavedForecastScenario) => {
      skipScenarioReportResetRef.current = true;
      const payload = (saved.scenario_payload || {}) as Record<string, unknown>;
      const nextLeadConversion = Number(payload.leadToGoLiveForecastPercent);
      const nextLeadVolume = Number(payload.futureLeadVolumeScenarioMonthlyLeads);
      const nextChurnFactor = Number(payload.futureChurnScenarioFactorPercent);
      const nextEnterpriseEnabled = payload.enterpriseForecastEnabled;

      if (Number.isFinite(nextLeadConversion)) setLeadToGoLiveForecastPercent(Math.max(0, Math.min(100, nextLeadConversion)));
      if (Number.isFinite(nextLeadVolume)) setFutureLeadVolumeScenarioMonthlyLeads(Math.max(0, nextLeadVolume));
      if (Number.isFinite(nextChurnFactor)) setFutureChurnScenarioFactorPercent(Math.max(0, Math.min(300, nextChurnFactor)));
      if (typeof nextEnterpriseEnabled === 'boolean') setEnterpriseForecastEnabled(nextEnterpriseEnabled);

      const snapshot = payload.reportSnapshot;
      if (isScenarioReportSnapshot(snapshot)) {
        setScenarioReport(snapshot);
      } else if (saved.report_headline || saved.report_narrative || (saved.report_summary || []).length > 0) {
        setScenarioReport(buildSavedReportFallback(saved));
      } else {
        setScenarioReport(null);
      }

      setScenarioReportError(null);
      setSavedScenarioConfirmation(`Szenario geladen: ${saved.title}`);
      setTimeout(() => setSavedScenarioConfirmation(null), 6000);
    },
    [buildSavedReportFallback]
  );

  const waitForScenarioReportRender = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }, []);

  const buildCurrentScenarioPdfBlob = useCallback(
    async (saved: SavedForecastScenario) => {
      const element = scenarioReportExportRef.current;
      if (!element) throw new Error('Report-Ansicht ist nicht bereit.');

      const filename = formatPDFFilename('szenario_report', saved.title || user?.name || 'report', saved.year || selectedYear);
      const blob = await exportToPDFBlob(element, {
        filename,
        title: 'Szenario Maßnahmen-Report',
        subtitle: saved.title,
        orientation: 'portrait',
        format: 'a4',
        margin: 10,
        quality: 2,
      });

      return { blob, filename };
    },
    [selectedYear, user?.name]
  );

  const handleDownloadSavedScenarioPdf = useCallback(
    async (saved: SavedForecastScenario) => {
      if (!user?.id) return;
      setSavedScenarioError(null);
      setDownloadingPdfScenarioId(saved.id);
      try {
        handleApplySavedScenario(saved);
        await waitForScenarioReportRender();

        const { blob, filename } = await buildCurrentScenarioPdfBlob(saved);
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);

        setSavedScenarioConfirmation(`PDF heruntergeladen: ${saved.title}`);
        setTimeout(() => setSavedScenarioConfirmation(null), 6000);
      } catch (error: any) {
        setSavedScenarioError(error?.message || 'PDF konnte nicht geladen werden');
      } finally {
        setDownloadingPdfScenarioId(null);
      }
    },
    [buildCurrentScenarioPdfBlob, handleApplySavedScenario, user?.id, waitForScenarioReportRender]
  );

  const handleGenerateScenarioReport = useCallback(async () => {
    setScenarioReportLoading(true);
    setScenarioReportError(null);

    try {
      const response = await fetch('/api/forecast/scenario-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferLlm: true,
          input: forecastScenarioInput,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data?.report) {
        throw new Error(data?.error || 'Report konnte nicht erzeugt werden');
      }
      setScenarioReport(data.report as ScenarioReport);
      setScenarioReportMeta({
        llmRequested: Boolean(data?.llmRequested),
        llmAttempted: Boolean(data?.llmAttempted),
        fallbackActive: Boolean(data?.fallbackActive),
        llmProvider: data?.llmProvider ? String(data.llmProvider) : null,
        llmError: data?.llmError ? String(data.llmError) : null,
        mode: data?.mode === 'llm' || data?.mode === 'rules' ? data.mode : null,
      });
    } catch (error: any) {
      setScenarioReport(null);
      setScenarioReportError(error?.message || 'Report konnte nicht erzeugt werden');
      setScenarioReportMeta({
        llmRequested: true,
        llmAttempted: false,
        fallbackActive: true,
        llmProvider: null,
        llmError: null,
        mode: null,
      });
    } finally {
      setScenarioReportLoading(false);
    }
  }, [forecastScenarioInput]);

  useEffect(() => {
    if (skipScenarioReportResetRef.current) {
      skipScenarioReportResetRef.current = false;
      return;
    }
    setScenarioReport(null);
    setScenarioReportError(null);
    setScenarioReportMeta({
      llmRequested: false,
      llmAttempted: false,
      fallbackActive: false,
      llmProvider: null,
      llmError: null,
      mode: null,
    });
  }, [forecastScenarioInput]);

  const forecastTooltipRows = [
    { key: 'arrGoLivesToDate', label: 'ARR aus Go-Lives bis heute', color: '#10B981' },
    { key: 'arrGoLivesFuture', label: 'ARR aus Future Go-Lives', color: '#3B82F6' },
    { key: 'arrWeightedPipeline', label: 'ARR aus Weighted Sales Pipeline', color: '#D946EF' },
    { key: 'arrNotBookedPipeline', label: 'ARR aus Sign-ups Not Booked', color: '#FACC15' },
    { key: 'arrConversionBased', label: 'ARR aus YTD Lead-Conversion Forecast', color: '#6B7280' },
    { key: 'arrEnterpriseExpectation', label: 'ARR aus Enterprise Erwartung', color: '#0EA5E9' },
    { key: 'arrChurnBookedDeduction', label: 'Churn ARR eingebucht (abgezogen)', color: '#EF4444' },
    { key: 'arrChurnProjectedDeduction', label: 'Churn ARR projektiert (abgezogen)', color: '#FCA5A5' },
    { key: 'arrChurnOverPlanDeduction', label: 'Churn ARR über Plan (abgezogen)', color: '#991B1B' },
  ] as const;

  const renderForecastTooltip = (params: { active?: boolean; payload?: Array<{ payload?: Record<string, unknown> }>; label?: string }) => {
    if (!params.active || !params.label) return null;
    const row = forecastData.find((entry) => String(entry.name) === String(params.label)) as Record<string, unknown> | undefined;
    if (!row) return null;
    const netForecast = Number(row.netForecast || 0);
    const netTarget = Number(row.netTarget || 0);
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-md text-xs">
        <div className="mb-2 font-semibold text-gray-800">{`${params.label || ''} ${selectedYear}`}</div>
        <div className="space-y-1">
          {forecastTooltipRows.map((item) => {
            const value = Number(row[item.key] || 0);
            return (
              <div key={item.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-gray-700">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
                <span className="font-medium text-gray-900">{formatCurrency(value)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 border-t border-gray-200 pt-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-700">Forecast NET ARR</span>
            <span className="font-semibold text-gray-900">{formatCurrency(netForecast)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-700">Goal NET ARR</span>
            <span className="font-semibold text-gray-900">{formatCurrency(netTarget)}</span>
          </div>
        </div>
      </div>
    );
  };

  const allGoLives = useMemo<GoLive[]>(
    () => combined?.goLives ?? Array.from(multiGoLives?.values() ?? []).flat(),
    [combined, multiGoLives]
  );

  const monthDetailGoLives = useMemo(
    () =>
      selectedMonthDetail
        ? allGoLives
            .filter((g) => g.month === selectedMonthDetail)
            .sort((a, b) => new Date(a.go_live_date).getTime() - new Date(b.go_live_date).getTime())
        : [],
    [allGoLives, selectedMonthDetail]
  );

  const userNameById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const filteredMonthDetailGoLives = useMemo(() => {
    const query = goLiveDetailSearch.trim().toLowerCase();
    if (!query) return monthDetailGoLives;
    return monthDetailGoLives.filter((gl) => {
      const assignedTo = (userNameById.get(gl.user_id) || '').toLowerCase();
      const values = [
        String(gl.oak_id ?? ''),
        gl.customer_name || '',
        new Date(gl.go_live_date).toLocaleDateString('de-DE'),
        assignedTo,
      ];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [monthDetailGoLives, goLiveDetailSearch, userNameById]);

  // Gleiche PAY-Logik wie getEffectivePayArrForReporting (pro Zeile passende AE-Settings)
  const getEffectiveGoLivePayArr = (gl: GoLive): number => {
    const userSettings = multiSettings?.get(gl.user_id) ?? combined?.settings;
    if (!userSettings) return 0;
    return getEffectivePayArrForReporting(gl, userSettings, payArrReportingOptions);
  };

  useEffect(() => {
    if (!selectedMonthDetail) return;
    const nextInputs: Record<string, string> = {};
    monthDetailGoLives.forEach((gl) => {
      if (gl.pay_arr !== null && gl.pay_arr !== undefined) {
        nextInputs[gl.id] = String(Math.round((gl.pay_arr / 12) * 100) / 100);
        return;
      }
      const cohortKey = paymarginCohortKey(gl.year, gl.month);
      const cohortImported =
        payArrReportingOptions?.paymarginImportedCohortKeys !== undefined &&
        payArrReportingOptions.paymarginImportedCohortKeys.has(cohortKey);
      if (
        gl.has_terminal &&
        !cohortImported &&
        (gl.pay_arr_target === null || gl.pay_arr_target === undefined)
      ) {
        const userSettings = multiSettings?.get(gl.user_id);
        const fallbackAvgPayBill = userSettings?.avg_pay_bill ?? combined?.settings?.avg_pay_bill ?? 0;
        if (fallbackAvgPayBill > 0) {
          nextInputs[gl.id] = String(fallbackAvgPayBill);
          return;
        }
      }
      nextInputs[gl.id] = '';
    });
    setPayIstInputsByGoLiveId(nextInputs);
    setSavingPayIstByGoLiveId({});
    setPayIstErrorByGoLiveId({});
  }, [selectedMonthDetail, monthDetailGoLives, payArrReportingOptions, multiSettings, combined?.settings]);

  useEffect(() => {
    setGoLiveDetailSearch('');
  }, [selectedMonthDetail]);

  const getDraftPayIstMonthly = (gl: GoLive): number | null => {
    const raw = (payIstInputsByGoLiveId[gl.id] ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getEffectiveGoLivePayArrForDisplay = (gl: GoLive): number => {
    const draftMonthly = getDraftPayIstMonthly(gl);
    if (draftMonthly !== null) return draftMonthly * 12;
    return getEffectiveGoLivePayArr(gl);
  };

  const handleSavePayIstForGoLive = async (gl: GoLive) => {
    const draftMonthly = getDraftPayIstMonthly(gl);
    setSavingPayIstByGoLiveId((prev) => ({ ...prev, [gl.id]: true }));
    setPayIstErrorByGoLiveId((prev) => ({ ...prev, [gl.id]: '' }));
    const nextPayArr = draftMonthly === null ? null : Math.round(draftMonthly * 12 * 100) / 100;

    const { error } = await supabase
      .from('go_lives')
      .update({ pay_arr: nextPayArr, updated_at: new Date().toISOString() })
      .eq('id', gl.id);

    if (error) {
      setPayIstErrorByGoLiveId((prev) => ({ ...prev, [gl.id]: error.message || 'Speichern fehlgeschlagen' }));
    } else {
      await refetchMultiData();
    }
    setSavingPayIstByGoLiveId((prev) => ({ ...prev, [gl.id]: false }));
  };

  // YTD: aus monthlyData (bereits aus combined oder Maps aggregiert)
  const ytdMonthlyResult = useMemo((): YtdMonthlyRow[] => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = monthlyData[i];
      const goLives = m?.goLives ?? 0;
      const terminals = allGoLives.filter(g => g.month === i + 1 && g.has_terminal).length;
      return {
        month: i + 1,
        go_lives_count: goLives,
        go_lives_target: m?.goLivesTarget ?? 0,
        terminals_count: terminals,
        terminal_penetration: goLives > 0 ? terminals / goLives : 0,
        subs_actual: m?.subsARR ?? 0,
        subs_target: m?.subsTarget ?? 0,
        // Pay IST: Finance-Actual oder Forecast
        pay_actual: m?.payARR ?? 0,
        pay_target: m?.payTarget ?? 0,
      };
    });
  }, [monthlyData, combined, multiGoLives]);

  const ytdSelectedMonthlyResult = useMemo(
    () => ytdMonthlyResult.filter((row) => selectedYtdMonths.includes(row.month)),
    [ytdMonthlyResult, selectedYtdMonths]
  );

  const ytdSummary = useMemo(() => {
    const ytdData = ytdSelectedMonthlyResult;
    const totalSubsArr = ytdData.reduce((s, r) => s + r.subs_actual, 0);
    const totalSubsTarget = ytdData.reduce((s, r) => s + r.subs_target, 0);
    const totalPayArr = ytdData.reduce((s, r) => s + r.pay_actual, 0);
    const totalPayTarget = ytdData.reduce((s, r) => s + r.pay_target, 0);
    return {
      totalSubsARR: totalSubsArr,
      totalSubsTarget,
      totalPayARR: totalPayArr,
      totalPayTarget,
      totalAllInARR: totalSubsArr + totalPayArr,
      totalAllInTarget: totalSubsTarget + totalPayTarget,
      totalGoLives: ytdData.reduce((s, r) => s + r.go_lives_count, 0),
      totalGoLivesTarget: ytdData.reduce((s, r) => s + r.go_lives_target, 0),
      totalTerminals: ytdData.reduce((s, r) => s + r.terminals_count, 0),
      monthsCompleted: ytdData.length,
    };
  }, [ytdSelectedMonthlyResult]);

  const ytdSelectedTotals = useMemo(() => ({
    totalGoLives: ytdSelectedMonthlyResult.reduce((s, r) => s + r.go_lives_count, 0),
    totalTerminals: ytdSelectedMonthlyResult.reduce((s, r) => s + r.terminals_count, 0),
    totalSubsTarget: ytdSelectedMonthlyResult.reduce((s, r) => s + r.subs_target, 0),
    totalSubsARR: ytdSelectedMonthlyResult.reduce((s, r) => s + r.subs_actual, 0),
    totalPayTarget: ytdSelectedMonthlyResult.reduce((s, r) => s + r.pay_target, 0),
    totalPayARR: ytdSelectedMonthlyResult.reduce((s, r) => s + r.pay_actual, 0),
  }), [ytdSelectedMonthlyResult]);

  const monthlyChurnData = useMemo<MonthlyChurnRow[]>(
    () =>
      Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const monthEvents = churnEvents.filter((event) => {
          if (!event.churn_month) return false;
          const d = new Date(event.churn_month);
          if (Number.isNaN(d.getTime())) return false;
          return d.getFullYear() === selectedYear && d.getMonth() + 1 === month;
        });

        const scheduledEvents = monthEvents.filter((event) => event.scheduled === true);
        const nonScheduledEvents = monthEvents.filter((event) => event.scheduled !== true);
        const scheduledArrLost = scheduledEvents.reduce((sum, event) => sum + effectiveTotalArrLost(event), 0);
        const nonScheduledArrLost = nonScheduledEvents.reduce((sum, event) => sum + effectiveTotalArrLost(event), 0);

        return {
          month,
          scheduledCount: scheduledEvents.length,
          nonScheduledCount: nonScheduledEvents.length,
          scheduledArrLost,
          nonScheduledArrLost,
          totalCount: monthEvents.length,
          totalArrLost: scheduledArrLost + nonScheduledArrLost,
        };
      }),
    [churnEvents, selectedYear]
  );

  const monthDetailChurnEvents = useMemo(
    () =>
      selectedChurnMonthDetail
        ? churnEvents
            .filter((event) => {
              if (!event.churn_month) return false;
              const d = new Date(event.churn_month);
              if (Number.isNaN(d.getTime())) return false;
              return d.getFullYear() === selectedYear && d.getMonth() + 1 === selectedChurnMonthDetail;
            })
            .sort((a, b) => effectiveTotalArrLost(b) - effectiveTotalArrLost(a))
        : [],
    [churnEvents, selectedChurnMonthDetail, selectedYear]
  );

  const filteredMonthDetailChurnEvents = useMemo(() => {
    const query = churnDetailSearch.trim().toLowerCase();
    if (!query) return monthDetailChurnEvents;
    return monthDetailChurnEvents.filter((event) => {
      const values = [
        String(event.oak_id ?? ''),
        event.customer_name || '',
        event.coo || '',
        event.package_name || '',
        event.churn_reason || '',
        event.scheduled ? 'ja' : 'nein',
      ];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [monthDetailChurnEvents, churnDetailSearch]);

  const churnDetailSummary = useMemo(
    () => ({
      totalCount: filteredMonthDetailChurnEvents.length,
      scheduledCount: filteredMonthDetailChurnEvents.filter((event) => event.scheduled === true).length,
      nonScheduledCount: filteredMonthDetailChurnEvents.filter((event) => event.scheduled !== true).length,
      totalArrLost: filteredMonthDetailChurnEvents.reduce((sum, event) => sum + effectiveTotalArrLost(event), 0),
      subsArrLost: filteredMonthDetailChurnEvents.reduce((sum, event) => sum + (Number(event.subs_revenue_lost) || 0), 0),
      payArrLost: filteredMonthDetailChurnEvents.reduce((sum, event) => sum + (Number(event.pay_revenue_lost) || 0), 0),
    }),
    [filteredMonthDetailChurnEvents]
  );

  useEffect(() => {
    setChurnDetailSearch('');
  }, [selectedChurnMonthDetail]);

  const selectedMonthlyChurnData = useMemo(
    () => monthlyChurnData.filter((row) => selectedYtdMonths.includes(row.month)),
    [monthlyChurnData, selectedYtdMonths]
  );

  const selectedChurnTotals = useMemo(
    () =>
      selectedMonthlyChurnData.reduce(
        (acc, row) => ({
          scheduledCount: acc.scheduledCount + row.scheduledCount,
          nonScheduledCount: acc.nonScheduledCount + row.nonScheduledCount,
          scheduledArrLost: acc.scheduledArrLost + row.scheduledArrLost,
          nonScheduledArrLost: acc.nonScheduledArrLost + row.nonScheduledArrLost,
          totalCount: acc.totalCount + row.totalCount,
          totalArrLost: acc.totalArrLost + row.totalArrLost,
        }),
        {
          scheduledCount: 0,
          nonScheduledCount: 0,
          scheduledArrLost: 0,
          nonScheduledArrLost: 0,
          totalCount: 0,
          totalArrLost: 0,
        }
      ),
    [selectedMonthlyChurnData]
  );

  const ytdAllInAfterChurn = useMemo(() => {
    const allInArr = ytdSummary.totalAllInARR;
    const churnArr = selectedChurnTotals.totalArrLost;
    const netArr = allInArr - churnArr;
    const retentionPct = allInArr > 0 ? netArr / allInArr : 0;
    return { allInArr, churnArr, netArr, retentionPct };
  }, [ytdSummary.totalAllInARR, selectedChurnTotals.totalArrLost]);

  const invoicedChurnTargetArrByMonth = useMemo(() => {
    const churnData =
      planzahlen?.churn_arr_data && typeof planzahlen.churn_arr_data === 'object'
        ? (planzahlen.churn_arr_data as Record<string, unknown>)
        : {};
    const invoicedChurn =
      churnData.invoiced_churn && typeof churnData.invoiced_churn === 'object'
        ? (churnData.invoiced_churn as Record<string, unknown>)
        : {};
    // In den Planzahlen wird Churn ARR als negativ gespeichert (toNegativeOrZero).
    // Für das NET-Ziel benötigen wir die absolute Verlusthöhe als positive Abzugsgröße.
    return normalizeMonthlyPlanValues(invoicedChurn.target_arr).map((value) => Math.abs(value));
  }, [planzahlen]);

  const selectedInvoicedChurnTargetArr = useMemo(
    () => selectedYtdMonths.reduce((sum, month) => sum + (invoicedChurnTargetArrByMonth[month - 1] || 0), 0),
    [selectedYtdMonths, invoicedChurnTargetArrByMonth]
  );

  const yearlyInvoicedChurnTargetArr = useMemo(
    () => invoicedChurnTargetArrByMonth.reduce((sum, value) => sum + value, 0),
    [invoicedChurnTargetArrByMonth]
  );

  const selectedTerminalsTarget = useMemo(() => {
    if (!planzahlen) return null;
    const terminalTargets = Array.from({ length: 12 }, (_, idx) => planzahlen.business_terminal_sales?.[idx] ?? 0);
    return selectedYtdMonths.reduce((sum, month) => sum + (terminalTargets[month - 1] || 0), 0);
  }, [planzahlen, selectedYtdMonths]);

  const handleToggleYtdMonth = (month: number) => {
    setSelectedYtdMonths((prev) => {
      if (prev.includes(month)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== month);
      }
      return [...prev, month].sort((a, b) => a - b);
    });
  };

  const fullYearTotals = useMemo(() => ({
    totalGoLives: ytdMonthlyResult.reduce((s, r) => s + r.go_lives_count, 0),
    totalTerminals: ytdMonthlyResult.reduce((s, r) => s + r.terminals_count, 0),
    totalSubsTarget: ytdMonthlyResult.reduce((s, r) => s + r.subs_target, 0),
    totalSubsARR: ytdMonthlyResult.reduce((s, r) => s + r.subs_actual, 0),
    totalPayTarget: ytdMonthlyResult.reduce((s, r) => s + r.pay_target, 0),
    totalPayARR: ytdMonthlyResult.reduce((s, r) => s + r.pay_actual, 0),
  }), [ytdMonthlyResult]);

  const netArrGoals = useMemo(() => {
    const netGoalYtd = ytdSummary.totalAllInTarget - selectedInvoicedChurnTargetArr;
    const netGoalYearly = (fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget) - yearlyInvoicedChurnTargetArr;
    const ytdNetActual = ytdAllInAfterChurn.netArr;
    return {
      netGoalYtd,
      netGoalYearly,
      ytdNetActual,
      ytdPct: netGoalYtd > 0 ? ytdNetActual / netGoalYtd : 0,
      yearlyPct: netGoalYearly > 0 ? ytdNetActual / netGoalYearly : 0,
    };
  }, [
    ytdSummary.totalAllInTarget,
    selectedInvoicedChurnTargetArr,
    fullYearTotals.totalSubsTarget,
    fullYearTotals.totalPayTarget,
    yearlyInvoicedChurnTargetArr,
    ytdAllInAfterChurn.netArr,
  ]);

  // Bill-KPIs basieren auf den aktuell ausgewählten Monaten (YTD-Filter).
  const selectedBillMetrics = useMemo(() => {
    if (selectedYtdMonths.length === 0) return null;
    const selectedRows = ytdMonthlyResult.filter((row) => selectedYtdMonths.includes(row.month));
    const totalGoLives = selectedRows.reduce((sum, row) => sum + row.go_lives_count, 0);
    const totalSubsArr = selectedRows.reduce((sum, row) => sum + row.subs_actual, 0);
    const totalPayArr = selectedRows.reduce((sum, row) => sum + row.pay_actual, 0);
    const totalSubsTarget = selectedRows.reduce((sum, row) => sum + row.subs_target, 0);
    const totalPayTarget = selectedRows.reduce((sum, row) => sum + row.pay_target, 0);
    const totalGoLivesTarget = selectedRows.reduce((sum, row) => sum + row.go_lives_target, 0);

    const subsBill = totalGoLives > 0 ? totalSubsArr / 12 / totalGoLives : 0;
    const payBill = totalGoLives > 0 ? totalPayArr / 12 / totalGoLives : 0;
    const subsBillTarget = totalGoLivesTarget > 0 ? totalSubsTarget / 12 / totalGoLivesTarget : 0;
    const payBillTarget = totalGoLivesTarget > 0 ? totalPayTarget / 12 / totalGoLivesTarget : 0;

    return {
      subsBill,
      payBill,
      subsBillTarget,
      payBillTarget,
      allInBill: subsBill + payBill,
      allInBillTarget: subsBillTarget + payBillTarget,
    };
  }, [ytdMonthlyResult, selectedYtdMonths]);

  const yearFilteredSalespipeEvents = useMemo(() => {
    return salespipeEvents.filter((row) => {
      const createdYear = row.created_date ? new Date(row.created_date).getFullYear() : null;
      const closeYear = row.close_date ? new Date(row.close_date).getFullYear() : null;
      return createdYear === selectedYear || closeYear === selectedYear;
    });
  }, [salespipeEvents, selectedYear]);

  const yearFilteredLeadsEvents = useMemo(() => {
    return leadsEvents.filter((row) => {
      const createdYear = row.created_date ? new Date(row.created_date).getFullYear() : null;
      const conversionYear = row.conversion_date ? new Date(row.conversion_date).getFullYear() : null;
      return createdYear === selectedYear || conversionYear === selectedYear;
    });
  }, [leadsEvents, selectedYear]);

  const yearFilteredSignupsEvents = useMemo(() => {
    return signupsEvents.filter((row) => {
      const signupYear = row.signup_date ? new Date(row.signup_date).getFullYear() : null;
      const goLiveYear = row.go_live_date ? new Date(row.go_live_date).getFullYear() : null;
      return signupYear === selectedYear || goLiveYear === selectedYear;
    });
  }, [signupsEvents, selectedYear]);

  const newestSignupByOak = useMemo(() => {
    const byOak = new Map<number, SignupsEventRow>();
    yearFilteredSignupsEvents.forEach((signup) => {
      if (!signup.oak_id) return;
      const current = byOak.get(signup.oak_id);
      if (!current) {
        byOak.set(signup.oak_id, signup);
        return;
      }
      const currentTs = new Date(current.signup_date || current.go_live_date || '1970-01-01').getTime();
      const nextTs = new Date(signup.signup_date || signup.go_live_date || '1970-01-01').getTime();
      if (nextTs >= currentTs) byOak.set(signup.oak_id, signup);
    });
    return byOak;
  }, [yearFilteredSignupsEvents]);

  const arrByOak = useMemo(() => {
    const byOak = new Map<number, number>();
    yearFilteredSalespipeEvents.forEach((row) => {
      if (!row.oak_id) return;
      const arr = Number(row.estimated_arr);
      if (!Number.isFinite(arr) || arr <= 0) return;
      byOak.set(row.oak_id, Math.max(byOak.get(row.oak_id) || 0, arr));
    });
    return byOak;
  }, [yearFilteredSalespipeEvents]);

  const opportunityToOak = useMemo(() => {
    const byOpportunity = new Map<string, number>();
    yearFilteredSalespipeEvents.forEach((row) => {
      if (!row.oak_id) return;
      const opportunityId = normalizeId(row.opportunity_id);
      if (!opportunityId) return;
      byOpportunity.set(opportunityId, row.oak_id);
    });
    return byOpportunity;
  }, [yearFilteredSalespipeEvents]);

  const leadCreatedByOpportunity = useMemo(() => {
    const byOpportunity = new Map<string, string>();
    leadsEvents.forEach((lead) => {
      const opportunityId = normalizeId(lead.opportunity_id);
      if (!opportunityId || !lead.created_date) return;
      const current = byOpportunity.get(opportunityId);
      if (!current) {
        byOpportunity.set(opportunityId, lead.created_date);
        return;
      }
      const currentTs = new Date(current).getTime();
      const nextTs = new Date(lead.created_date).getTime();
      if (!Number.isNaN(nextTs) && (Number.isNaN(currentTs) || nextTs < currentTs)) {
        byOpportunity.set(opportunityId, lead.created_date);
      }
    });
    return byOpportunity;
  }, [leadsEvents]);

  const pipelineRows = useMemo(() => {
    const salesRows: PipelineRow[] = yearFilteredSalespipeEvents.reduce<PipelineRow[]>((acc, sales) => {
        if (isExcludedAccountName(sales.opportunity_name)) return acc;
        const stageKey = normalizeSalespipeStage(sales.stage);
        if (!stageKey) return acc;
        const arr = Number(sales.estimated_arr) || 0;
        const probabilityRaw = Number(sales.probability);
        const probability = Number.isFinite(probabilityRaw)
          ? (probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw)
          : null;
        const mappedOakId = (() => {
          if (sales.oak_id) return sales.oak_id;
          const opportunityId = normalizeId(sales.opportunity_id);
          if (!opportunityId) return null;
          return opportunityToOak.get(opportunityId) ?? null;
        })();
        const matchedSignup = mappedOakId ? newestSignupByOak.get(mappedOakId) : undefined;
        const filterDate = (stageKey === 'close_won' || stageKey === 'close_lost')
          ? (sales.close_date || sales.created_date)
          : (sales.created_date || sales.close_date);
        acc.push({
          id: `sales-${sales.id}`,
          source: 'salespipe',
          sourceTab: sales.source_tab || null,
          stageKey,
          leadId: null,
          opportunityId: sales.opportunity_id || null,
          name: sales.opportunity_name || '-',
          owner: sales.opportunity_owner,
          leadSource: sales.lead_source || null,
          oakId: mappedOakId,
          arr,
          probability,
          weightedArr: getWeightedArrFromOpportunity(stageKey, probabilityRaw, sales.opportunity_id),
          filterDate,
          closeDate: sales.close_date || null,
          leadCreatedDate: normalizeId(sales.opportunity_id)
            ? (leadCreatedByOpportunity.get(normalizeId(sales.opportunity_id) as string) || null)
            : null,
          matchedSignupName: matchedSignup?.account_name || null,
        });
        return acc;
      }, []);

    const leadsRows: PipelineRow[] = yearFilteredLeadsEvents.reduce<PipelineRow[]>((acc, lead) => {
        if (isExcludedAccountName(lead.company_account) || isExcludedAccountName(lead.opportunity_account)) return acc;
        const stageKey = normalizeLeadsStage(
          lead.lead_status,
          lead.lead_sub_status,
          lead.demo_or_quote,
          lead.lead_id,
          lead.opportunity_id,
          lead.opportunity_account
        );
        if (!stageKey) return acc;
        const arr = Number(lead.opportunity_amount) || 0;
        const mappedOakId = (() => {
          const opportunityId = normalizeId(lead.opportunity_id);
          if (!opportunityId) return null;
          return opportunityToOak.get(opportunityId) ?? null;
        })();
        const matchedSignup = mappedOakId ? newestSignupByOak.get(mappedOakId) : undefined;
        acc.push({
          id: `lead-${lead.id}`,
          source: 'leads',
          sourceTab: null,
          stageKey,
          leadId: lead.lead_id || null,
          opportunityId: lead.opportunity_id || null,
          name: lead.company_account || lead.lead_id || '-',
          owner: lead.lead_owner,
          leadSource: lead.lead_source || null,
          oakId: mappedOakId,
          arr,
          probability: null,
          weightedArr: getWeightedArrFromOpportunity(stageKey, null, lead.opportunity_id),
          filterDate: lead.conversion_date || lead.created_date,
          closeDate: null,
          leadCreatedDate: lead.created_date || null,
          matchedSignupName: matchedSignup?.account_name || null,
        });
        return acc;
      }, []);

    const signupRows: PipelineRow[] = [];
    yearFilteredSignupsEvents.forEach((signup) => {
      const matchedArr = signup.oak_id ? (arrByOak.get(signup.oak_id) || 0) : 0;
      if (signup.signup_date && new Date(signup.signup_date).getFullYear() === selectedYear) {
        signupRows.push({
          id: `signup-${signup.id}`,
          source: 'signups',
          sourceTab: null,
          stageKey: 'signups',
          leadId: null,
          opportunityId: null,
          name: signup.account_name || signup.account_id || '-',
          owner: signup.account_owner,
          leadSource: null,
          oakId: signup.oak_id,
          arr: matchedArr,
          probability: null,
          weightedArr: matchedArr,
          filterDate: signup.signup_date,
          closeDate: null,
          leadCreatedDate: null,
          matchedSignupName: signup.account_name || null,
        });
      }
      if (signup.go_live_date && new Date(signup.go_live_date).getFullYear() === selectedYear) {
        signupRows.push({
          id: `golive-${signup.id}`,
          source: 'signups',
          sourceTab: null,
          stageKey: 'go_live',
          leadId: null,
          opportunityId: null,
          name: signup.account_name || signup.account_id || '-',
          owner: signup.account_owner,
          leadSource: null,
          oakId: signup.oak_id,
          arr: matchedArr,
          probability: null,
          weightedArr: matchedArr,
          filterDate: signup.go_live_date,
          closeDate: null,
          leadCreatedDate: null,
          matchedSignupName: signup.account_name || null,
        });
      }
    });

    return [...leadsRows, ...salesRows, ...signupRows];
  }, [yearFilteredSalespipeEvents, yearFilteredLeadsEvents, yearFilteredSignupsEvents, newestSignupByOak, arrByOak, selectedYear, opportunityToOak, leadCreatedByOpportunity]);

  const pipelineRowKey = useCallback((row: PipelineRow) => {
    const normalizedOpportunityId = normalizeId(row.opportunityId);
    if (normalizedOpportunityId) return `opp:${normalizedOpportunityId}`;
    return [
      'row',
      row.source,
      row.stageKey,
      normalizeId(row.leadId) || '',
      normalizeId(row.name) || '',
      normalizeId(row.owner) || '',
      normalizeId(row.sourceTab) || '',
      String(row.oakId ?? ''),
      row.filterDate || '',
      row.closeDate || '',
    ].join(':');
  }, []);
  const pipelineRowLegacyKeys = useCallback((row: PipelineRow) => {
    const keys: string[] = [];
    const normalizedOpportunityId = normalizeId(row.opportunityId);
    if (normalizedOpportunityId) keys.push(`opp:${normalizedOpportunityId}`);
    const normalizedLeadId = normalizeId(row.leadId);
    if (normalizedLeadId) keys.push(`lead:${normalizedLeadId}`);
    if (row.oakId !== null && (row.stageKey === 'signups' || row.stageKey === 'go_live')) {
      keys.push(`oak:${row.oakId}:${row.stageKey}`);
    }
    keys.push(`${row.source}:${row.id}`);
    return keys;
  }, []);
  const disabledPipelineRowKeySet = useMemo(() => new Set(disabledPipelineRowKeys), [disabledPipelineRowKeys]);
  const isPipelineRowDisabled = useCallback(
    (row: PipelineRow) => {
      const canonicalKey = pipelineRowKey(row);
      if (disabledPipelineRowKeySet.has(canonicalKey)) return true;
      return pipelineRowLegacyKeys(row).some((key) => disabledPipelineRowKeySet.has(key));
    },
    [disabledPipelineRowKeySet, pipelineRowKey, pipelineRowLegacyKeys]
  );
  const togglePipelineRowDisabled = useCallback(
    (row: PipelineRow) => {
      const rowKey = pipelineRowKey(row);
      const legacyKeys = pipelineRowLegacyKeys(row);
      setDisabledPipelineRowKeys((prev) => {
        const nextSet = new Set(prev);
        const currentlyDisabled =
          nextSet.has(rowKey) || legacyKeys.some((key) => nextSet.has(key));
        // Alte Schluessel immer aufraeumen, damit nur der stabile Key bleibt.
        legacyKeys.forEach((key) => nextSet.delete(key));
        nextSet.delete(rowKey);
        if (!currentlyDisabled) {
          nextSet.add(rowKey);
        }
        const dedupedNext = Array.from(nextSet);
        window.localStorage.setItem(pipelineDisableStorageKey, JSON.stringify(dedupedNext));
        return dedupedNext;
      });
    },
    [pipelineRowKey, pipelineRowLegacyKeys, pipelineDisableStorageKey]
  );

  const salespipeRowsInDateRange = useMemo(() => {
    const fromDate = salespipeDateFrom ? new Date(salespipeDateFrom) : null;
    const toDate = salespipeDateTo ? new Date(`${salespipeDateTo}T23:59:59`) : null;
    const relativeToDate = salespipeRelativeDays !== null ? new Date() : null;
    const relativeFromDate = salespipeRelativeDays !== null ? new Date() : null;
    if (relativeToDate) relativeToDate.setHours(23, 59, 59, 999);
    if (relativeFromDate) {
      relativeFromDate.setHours(0, 0, 0, 0);
      relativeFromDate.setDate(relativeFromDate.getDate() - Math.max(0, salespipeRelativeDays - 1));
    }
    if (!fromDate && !toDate && !relativeFromDate && !relativeToDate) return pipelineRows;
    return pipelineRows.filter((row) => {
      if (!row.filterDate) return false;
      const relevantDate = new Date(row.filterDate);
      if (Number.isNaN(relevantDate.getTime())) return false;
      if (fromDate && relevantDate < fromDate) return false;
      if (toDate && relevantDate > toDate) return false;
      if (relativeFromDate && relevantDate < relativeFromDate) return false;
      if (relativeToDate && relevantDate > relativeToDate) return false;
      return true;
    });
  }, [pipelineRows, salespipeDateFrom, salespipeDateTo, salespipeRelativeDays]);

  const baseFilteredSalespipeRows = useMemo(() => {
    const query = salespipeSearch.trim().toLowerCase();
    return salespipeRowsInDateRange.filter((row) => {
      if (salespipeSourceFilter === 'salespipe2_only') {
        // Fokus auf Salespipe2-Datensaetze plus davon getrackte Journey-Events.
        if (row.source === 'salespipe' && row.sourceTab !== 'drive_salespipe2_csv') return false;
      }
      if (!query) return true;
      const searchValues = [
        row.name || '',
        row.owner || '',
        row.leadId || '',
        row.opportunityId || '',
        String(row.oakId ?? ''),
        row.matchedSignupName || '',
        row.source || '',
      ];
      return searchValues.some((value) => value.toLowerCase().includes(query));
    });
  }, [salespipeRowsInDateRange, salespipeSearch, salespipeSourceFilter]);

  const baseFilteredSalespipeRowsStats = useMemo(
    () => baseFilteredSalespipeRows.filter((row) => !isPipelineRowDisabled(row)),
    [baseFilteredSalespipeRows, isPipelineRowDisabled]
  );

  const connectedJourneyOakSet = useMemo(() => {
    const set = new Set<number>();
    baseFilteredSalespipeRowsStats.forEach((row) => {
      // Strikte Journey-Definition:
      // Lead-ID + Opportunity-ID + daraus gemappte OAK-ID muessen vorhanden sein.
      if (row.source !== 'leads') return;
      if (!row.leadId || !row.opportunityId || row.oakId === null) return;
      set.add(row.oakId);
    });
    return set;
  }, [baseFilteredSalespipeRowsStats]);

  const filteredSalespipeRows = useMemo(() => {
    return baseFilteredSalespipeRows.filter((row) => {
      if (salespipeStageFilter !== 'all' && row.stageKey !== salespipeStageFilter) return false;
      // Nur zusammenhaengende Journey-Signups/-GoLives anzeigen.
      if ((row.stageKey === 'signups' || row.stageKey === 'go_live')) {
        if (row.oakId === null) return false;
        return connectedJourneyOakSet.has(row.oakId);
      }
      return true;
    });
  }, [baseFilteredSalespipeRows, salespipeStageFilter, connectedJourneyOakSet]);

  const filteredSalespipeRowsStats = useMemo(
    () => filteredSalespipeRows.filter((row) => !isPipelineRowDisabled(row)),
    [filteredSalespipeRows, isPipelineRowDisabled]
  );

  const journeyTrackOakSet = useMemo(() => {
    const openRows = filteredSalespipeRowsStats.filter((row) => ACTIVE_PIPELINE_STAGES.includes(row.stageKey));
    const closeWonRows = filteredSalespipeRowsStats.filter((row) => row.stageKey === 'close_won');
    const openAndWonOakSet = new Set(
      [...openRows, ...closeWonRows]
        .map((row) => row.oakId)
        .filter((oakId): oakId is number => oakId !== null)
    );
    return new Set(
      Array.from(openAndWonOakSet).filter((oakId) => connectedJourneyOakSet.has(oakId))
    );
  }, [filteredSalespipeRowsStats, connectedJourneyOakSet]);

  // Opportunity-IDs aller Leads mit Lead-ID + Opportunity-ID im gewählten Zeitraum.
  // Basis für die Einschränkung von Close Won/Lost auf Opportunities aus konvertierten Leads.
  const connectedJourneyOpportunityIds = useMemo(() => {
    const set = new Set<string>();
    baseFilteredSalespipeRowsStats.forEach((row) => {
      if (row.source !== 'leads') return;
      if (!row.leadId || !row.opportunityId) return;
      const oppId = normalizeId(row.opportunityId);
      if (oppId) set.add(oppId);
    });
    return set;
  }, [baseFilteredSalespipeRowsStats]);

  const trackedSignupsStageStats = useMemo(() => {
    const byOak = new Map<number, number>();
    filteredSalespipeRowsStats.forEach((row) => {
      if (row.stageKey !== 'signups' || row.oakId === null || !journeyTrackOakSet.has(row.oakId)) return;
      byOak.set(row.oakId, Math.max(byOak.get(row.oakId) || 0, row.arr));
    });
    return {
      count: byOak.size,
      arr: Array.from(byOak.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRowsStats, journeyTrackOakSet]);

  const trackedGoLiveStageStats = useMemo(() => {
    const byOak = new Map<number, number>();
    filteredSalespipeRowsStats.forEach((row) => {
      if (row.stageKey !== 'go_live' || row.oakId === null || !journeyTrackOakSet.has(row.oakId)) return;
      byOak.set(row.oakId, Math.max(byOak.get(row.oakId) || 0, row.arr));
    });
    return {
      count: byOak.size,
      arr: Array.from(byOak.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRowsStats, journeyTrackOakSet]);

  const trackedCloseWonStageStats = useMemo(() => {
    const byOppId = new Map<string, number>();
    filteredSalespipeRowsStats.forEach((row) => {
      if (row.stageKey !== 'close_won') return;
      const oppId = normalizeId(row.opportunityId);
      // Nur Opportunities, die aus einem konvertierten Lead im Zeitraum stammen.
      if (!oppId || !connectedJourneyOpportunityIds.has(oppId)) return;
      byOppId.set(oppId, Math.max(byOppId.get(oppId) || 0, row.arr));
    });
    return {
      count: byOppId.size,
      arr: Array.from(byOppId.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRowsStats, connectedJourneyOpportunityIds]);

  const trackedCloseLostStageStats = useMemo(() => {
    const byOppId = new Map<string, number>();
    filteredSalespipeRowsStats.forEach((row) => {
      if (row.stageKey !== 'close_lost') return;
      const oppId = normalizeId(row.opportunityId);
      // Nur Opportunities, die aus einem konvertierten Lead im Zeitraum stammen.
      if (!oppId || !connectedJourneyOpportunityIds.has(oppId)) return;
      byOppId.set(oppId, Math.max(byOppId.get(oppId) || 0, row.arr));
    });
    return {
      count: byOppId.size,
      arr: Array.from(byOppId.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRowsStats, connectedJourneyOpportunityIds]);

  const salespipeStageSummary = useMemo(() => {
    const initial = PIPELINE_STAGE_CONFIG.reduce(
      (acc, stage) => ({ ...acc, [stage.key]: { count: 0, arr: 0 } }),
      {} as Record<PipelineStageKey, { count: number; arr: number }>
    );
    filteredSalespipeRowsStats.forEach((row) => {
      initial[row.stageKey].count += 1;
      initial[row.stageKey].arr += row.arr;
    });
    // Sign-up/Go-Live folgen derselben Tracking-Logik wie die KPI-Karten oben.
    initial.close_won = trackedCloseWonStageStats;
    initial.close_lost = trackedCloseLostStageStats;
    initial.signups = trackedSignupsStageStats;
    initial.go_live = trackedGoLiveStageStats;

    // SQL soll die gesamte Lead-Basis im gewählten Zeitraum darstellen.
    const leadRows = filteredSalespipeRowsStats.filter((row) => row.source === 'leads');
    const sqlCount = leadRows.length;
    const sqlArr = leadRows.reduce((sum, row) => sum + row.arr, 0);
    initial.sql = { count: sqlCount, arr: sqlArr };

    // Nicht-konvertiert ergibt sich aus NEW/Not converted + Working.
    const nonConvertedCount = initial.not_converted_new.count + initial.working.count;
    const nonConvertedArr = initial.not_converted_new.arr + initial.working.arr;

    // Converted wird explizit aus der Lead-Basis abgeleitet.
    initial.converted = {
      count: Math.max(0, sqlCount - nonConvertedCount),
      arr: Math.max(0, sqlArr - nonConvertedArr),
    };

    return initial;
  }, [filteredSalespipeRowsStats, trackedCloseWonStageStats, trackedCloseLostStageStats, trackedSignupsStageStats, trackedGoLiveStageStats]);

  const convertedDecisionStats = useMemo(() => {
    const convertedOpportunityIds = new Set(
      filteredSalespipeRowsStats
        .filter((row) => row.source === 'leads' && row.stageKey === 'converted')
        .map((row) => normalizeId(row.opportunityId))
        .filter((id): id is string => id !== null)
    );

    if (convertedOpportunityIds.size === 0) {
      return { convertedCount: 0, closeWonCount: 0, closeLostCount: 0 };
    }

    const decisionByOpportunity = new Map<string, { stage: 'close_won' | 'close_lost'; ts: number }>();
    filteredSalespipeRowsStats.forEach((row) => {
      if (row.source !== 'salespipe') return;
      if (row.stageKey !== 'close_won' && row.stageKey !== 'close_lost') return;
      const opportunityId = normalizeId(row.opportunityId);
      if (!opportunityId || !convertedOpportunityIds.has(opportunityId)) return;
      const decisionDateRaw = row.closeDate || row.filterDate;
      const ts = decisionDateRaw ? new Date(decisionDateRaw).getTime() : Number.NEGATIVE_INFINITY;
      const current = decisionByOpportunity.get(opportunityId);
      if (!current || ts >= current.ts) {
        decisionByOpportunity.set(opportunityId, { stage: row.stageKey, ts });
      }
    });

    let closeWonCount = 0;
    let closeLostCount = 0;
    decisionByOpportunity.forEach((value) => {
      if (value.stage === 'close_won') closeWonCount += 1;
      if (value.stage === 'close_lost') closeLostCount += 1;
    });

    return {
      convertedCount: convertedOpportunityIds.size,
      closeWonCount,
      closeLostCount,
    };
  }, [filteredSalespipeRowsStats]);

  const salespipeWinRate = useMemo(() => {
    const decided = convertedDecisionStats.closeWonCount + convertedDecisionStats.closeLostCount;
    if (decided === 0) return null;
    return convertedDecisionStats.closeWonCount / decided;
  }, [convertedDecisionStats]);

  const salespipeLostRate = useMemo(() => {
    const decided = convertedDecisionStats.closeWonCount + convertedDecisionStats.closeLostCount;
    if (decided === 0) return null;
    return convertedDecisionStats.closeLostCount / decided;
  }, [convertedDecisionStats]);

  const convertedRate = useMemo(() => {
    const converted = salespipeStageSummary.converted.count;
    const notConverted = salespipeStageSummary.not_converted_new.count + salespipeStageSummary.working.count;
    const total = converted + notConverted;
    if (total === 0) return null;
    return converted / total;
  }, [salespipeStageSummary]);

  const notConvertedRate = useMemo(() => {
    const converted = salespipeStageSummary.converted.count;
    const notConverted = salespipeStageSummary.not_converted_new.count + salespipeStageSummary.working.count;
    const total = converted + notConverted;
    if (total === 0) return null;
    return notConverted / total;
  }, [salespipeStageSummary]);

  const convertedToCloseWonCycleStats = useMemo(() => {
    const toTs = (value: string | null) => {
      if (!value) return null;
      const ts = new Date(value).getTime();
      return Number.isNaN(ts) ? null : ts;
    };
    const msPerDay = 1000 * 60 * 60 * 24;
    const convertedByOpportunity = new Map<string, number>();
    const decisionByOpportunity = new Map<string, { stage: 'close_won' | 'close_lost'; ts: number }>();

    filteredSalespipeRowsStats.forEach((row) => {
      const opportunityId = normalizeId(row.opportunityId);
      if (!opportunityId) return;
      if (row.source === 'leads' && row.stageKey === 'converted') {
        const ts = toTs(row.filterDate);
        if (ts === null) return;
        const current = convertedByOpportunity.get(opportunityId);
        if (current === undefined || ts < current) convertedByOpportunity.set(opportunityId, ts);
      }
      if (row.source === 'salespipe' && (row.stageKey === 'close_won' || row.stageKey === 'close_lost')) {
        const ts = toTs(row.closeDate || row.filterDate);
        if (ts === null) return;
        const current = decisionByOpportunity.get(opportunityId);
        if (!current || ts >= current.ts) {
          decisionByOpportunity.set(opportunityId, { stage: row.stageKey, ts });
        }
      }
    });

    const dayDiffs: number[] = [];
    decisionByOpportunity.forEach((decision, opportunityId) => {
      if (decision.stage !== 'close_won') return;
      const convertedTs = convertedByOpportunity.get(opportunityId);
      if (convertedTs === undefined || decision.ts < convertedTs) return;
      dayDiffs.push(Math.round((decision.ts - convertedTs) / msPerDay));
    });

    if (dayDiffs.length === 0) return null;
    const sorted = [...dayDiffs].sort((a, b) => a - b);
    const n = sorted.length;
    const averageDays = sorted.reduce((sum, value) => sum + value, 0) / n;
    const medianDays =
      n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    return {
      averageDays,
      medianDays,
      samples: n,
    };
  }, [filteredSalespipeRowsStats]);

  const closeWonToGoLiveCycleStats = useMemo(() => {
    const toTs = (value: string | null) => {
      if (!value) return null;
      const ts = new Date(value).getTime();
      return Number.isNaN(ts) ? null : ts;
    };
    const msPerDay = 1000 * 60 * 60 * 24;
    const closeWonByOak = new Map<number, number>();
    const goLiveByOak = new Map<number, number>();

    filteredSalespipeRowsStats.forEach((row) => {
      if (row.oakId === null) return;
      if (row.source === 'salespipe' && row.stageKey === 'close_won') {
        const ts = toTs(row.closeDate || row.filterDate);
        if (ts === null) return;
        const current = closeWonByOak.get(row.oakId);
        if (current === undefined || ts > current) closeWonByOak.set(row.oakId, ts);
      }
      if (row.source === 'signups' && row.stageKey === 'go_live') {
        const ts = toTs(row.filterDate);
        if (ts === null) return;
        const current = goLiveByOak.get(row.oakId);
        if (current === undefined || ts > current) goLiveByOak.set(row.oakId, ts);
      }
    });

    const dayDiffs: number[] = [];
    goLiveByOak.forEach((goLiveTs, oakId) => {
      const closeWonTs = closeWonByOak.get(oakId);
      if (closeWonTs === undefined || goLiveTs < closeWonTs) return;
      dayDiffs.push(Math.round((goLiveTs - closeWonTs) / msPerDay));
    });

    if (dayDiffs.length === 0) return null;
    const sorted = [...dayDiffs].sort((a, b) => a - b);
    const n = sorted.length;
    const averageDays = sorted.reduce((sum, value) => sum + value, 0) / n;
    const medianDays =
      n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    return {
      averageDays,
      medianDays,
      samples: n,
    };
  }, [filteredSalespipeRowsStats]);

  useEffect(() => {
    if (convertedRate !== null) setWhatIfConvertedRatePct(convertedRate * 100);
  }, [convertedRate]);

  useEffect(() => {
    if (salespipeWinRate !== null) setWhatIfWinRatePct(salespipeWinRate * 100);
  }, [salespipeWinRate]);

  const openPipelineOpportunityRowsStats = useMemo(() => {
    type OpportunityRowCandidate = {
      row: PipelineRow;
      probability: number;
      sourcePriority: number;
      sortTs: number;
    };

    const byOpportunity = new Map<string, OpportunityRowCandidate>();
    const getRowTimestamp = (row: PipelineRow) => {
      const ts = row.filterDate ? new Date(row.filterDate).getTime() : Number.NEGATIVE_INFINITY;
      return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
    };

    filteredSalespipeRowsStats.forEach((row) => {
      if (!OPEN_PIPELINE_KPI_STAGES.includes(row.stageKey)) return;
      const opportunityId = normalizeId(row.opportunityId);
      if (!opportunityId) return;
      if (isExcludedAccountName(row.name) || isExcludedAccountName(row.matchedSignupName)) return;

      const probabilityRaw = row.probability ?? getDefaultProbability(row.stageKey);
      const probability = Math.max(0, Math.min(1, Number(probabilityRaw) || 0));
      const sourcePriority = row.source === 'salespipe' ? 2 : row.source === 'leads' ? 1 : 0;
      const sortTs = getRowTimestamp(row);

      const current = byOpportunity.get(opportunityId);
      if (!current) {
        byOpportunity.set(opportunityId, { row, probability, sourcePriority, sortTs });
        return;
      }

      const shouldReplace =
        probability > current.probability ||
        (probability === current.probability && sourcePriority > current.sourcePriority) ||
        (probability === current.probability &&
          sourcePriority === current.sourcePriority &&
          sortTs > current.sortTs);

      if (shouldReplace) {
        byOpportunity.set(opportunityId, { row, probability, sourcePriority, sortTs });
      }
    });

    return Array.from(byOpportunity.values());
  }, [filteredSalespipeRowsStats]);

  const openPipelineOpportunityRowsAll = useMemo(() => {
    type OpportunityRowCandidate = {
      row: PipelineRow;
      probability: number;
      sourcePriority: number;
      sortTs: number;
    };

    const byOpportunity = new Map<string, OpportunityRowCandidate>();
    const getRowTimestamp = (row: PipelineRow) => {
      const ts = row.filterDate ? new Date(row.filterDate).getTime() : Number.NEGATIVE_INFINITY;
      return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
    };

    filteredSalespipeRows.forEach((row) => {
      if (!OPEN_PIPELINE_KPI_STAGES.includes(row.stageKey)) return;
      const opportunityId = normalizeId(row.opportunityId);
      if (!opportunityId) return;
      if (isExcludedAccountName(row.name) || isExcludedAccountName(row.matchedSignupName)) return;

      const probabilityRaw = row.probability ?? getDefaultProbability(row.stageKey);
      const probability = Math.max(0, Math.min(1, Number(probabilityRaw) || 0));
      const sourcePriority = row.source === 'salespipe' ? 2 : row.source === 'leads' ? 1 : 0;
      const sortTs = getRowTimestamp(row);

      const current = byOpportunity.get(opportunityId);
      if (!current) {
        byOpportunity.set(opportunityId, { row, probability, sourcePriority, sortTs });
        return;
      }

      const shouldReplace =
        probability > current.probability ||
        (probability === current.probability && sourcePriority > current.sourcePriority) ||
        (probability === current.probability &&
          sourcePriority === current.sourcePriority &&
          sortTs > current.sortTs);

      if (shouldReplace) {
        byOpportunity.set(opportunityId, { row, probability, sourcePriority, sortTs });
      }
    });

    return Array.from(byOpportunity.values());
  }, [filteredSalespipeRows]);

  const salespipeKpis = useMemo(() => {
    const openRows = openPipelineOpportunityRowsStats.filter(({ row }) => OPEN_PIPELINE_KPI_STAGES.includes(row.stageKey));
    const totalPipelineArr = openRows.reduce((sum, item) => sum + item.row.arr, 0);
    const weightedArr = openRows.reduce((sum, item) => sum + item.row.weightedArr, 0);
    const closeWonCount = convertedDecisionStats.closeWonCount;
    return {
      openRows: openRows.length,
      totalPipelineArr,
      weightedArr,
      closeWonCount,
    };
  }, [openPipelineOpportunityRowsStats, convertedDecisionStats.closeWonCount]);

  const totalBusinessReport = useMemo(() => {
    const nrrBasis = planzahlen?.expanding_arr_data?.nrr_basis;
    const arrBasisDec = Number(nrrBasis?.arr_basis_dec) || 0;
    const beginningArrSeed = Number(nrrBasis?.arr_basis_jan_end) || 0;
    const hasBeginningArr = beginningArrSeed > 0;
    const pad = (values: number[] | undefined) => Array.from({ length: 12 }, (_, idx) => values?.[idx] ?? 0);

    const newSalesActual = ytdMonthlyResult.map((row) => row.subs_actual + row.pay_actual);
    const newSalesPlan = ytdMonthlyResult.map((row) => row.subs_target + row.pay_target);
    const goLivesActual = ytdMonthlyResult.map((row) => row.go_lives_count);
    const goLivesPlan = ytdMonthlyResult.map((row) => row.go_lives_target);
    const churnActual = monthlyChurnData.map((row) => -row.totalArrLost);
    const churnPlan = invoicedChurnTargetArrByMonth.map((value) => -Math.abs(value));

    const janKey = `${selectedYear}-01`;
    const janSmsMrr = smsData.find((row) => row.month === janKey)?.mrr ?? null;
    const janPayMonthly = phorestPayData.find((row) => row.month === janKey)?.dachValue ?? null;
    const janPayArr = janPayMonthly !== null ? janPayMonthly * 12 : null;

    const expandingActual = Array.from({ length: 12 }, (_, idx) => {
      if (idx === 0) return 0;
      const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      const upDown = upDownsellsData.find((row) => row.month === monthKey)?.netArr ?? 0;
      const smsMrr = smsData.find((row) => row.month === monthKey)?.mrr ?? null;
      const smsDelta = smsMrr !== null && janSmsMrr !== null ? (smsMrr - janSmsMrr) * 12 : 0;
      const payMonthly = phorestPayData.find((row) => row.month === monthKey)?.dachValue ?? null;
      const payDelta = payMonthly !== null && janPayArr !== null ? payMonthly * 12 - janPayArr : 0;
      return upDown + smsDelta + payDelta;
    });
    const expandingPlan = Array.from({ length: 12 }, () => 0);

    const beginningActual: Array<number | null> = Array.from({ length: 12 }, () => null);
    const endingActual: Array<number | null> = Array.from({ length: 12 }, () => null);
    const beginningPlan: Array<number | null> = Array.from({ length: 12 }, () => null);
    const endingPlan: Array<number | null> = Array.from({ length: 12 }, () => null);
    if (hasBeginningArr) {
      let runningActual = beginningArrSeed;
      let runningPlan = beginningArrSeed;
      beginningActual[0] = beginningArrSeed;
      beginningPlan[0] = beginningArrSeed;
      endingActual[0] = beginningArrSeed;
      endingPlan[0] = beginningArrSeed;
      for (let idx = 1; idx < 12; idx += 1) {
        beginningActual[idx] = runningActual;
        beginningPlan[idx] = runningPlan;
        runningActual += newSalesActual[idx] + expandingActual[idx] + churnActual[idx];
        runningPlan += newSalesPlan[idx] + expandingPlan[idx] + churnPlan[idx];
        endingActual[idx] = runningActual;
        endingPlan[idx] = runningPlan;
      }
    }

    const beginningCustomers = Array.from({ length: 12 }, () => null as number | null);
    const churnedCustomers = monthlyChurnData.map((row) => -row.totalCount);
    const endingCustomers = Array.from({ length: 12 }, () => null as number | null);
    const averageTotalBillActual = newSalesActual.map((value, idx) =>
      goLivesActual[idx] > 0 ? value / 12 / goLivesActual[idx] : null
    );
    const averageTotalBillPlan = newSalesPlan.map((value, idx) =>
      goLivesPlan[idx] > 0 ? value / 12 / goLivesPlan[idx] : null
    );

    const pipelineMonth = (row: PipelineRow) => {
      const rawDate = row.stageKey === 'close_won' || row.stageKey === 'close_lost' ? row.closeDate || row.filterDate : row.filterDate;
      if (!rawDate) return null;
      const d = new Date(rawDate);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== selectedYear) return null;
      return d.getMonth();
    };
    const countPipeline = (predicate: (row: PipelineRow) => boolean) => {
      const counts = Array.from({ length: 12 }, () => 0);
      pipelineRows.forEach((row) => {
        if (!predicate(row)) return;
        const idx = pipelineMonth(row);
        if (idx === null) return;
        counts[idx] += 1;
      });
      return counts;
    };
    const sqlActual = countPipeline((row) => row.source === 'leads');
    const opportunitiesActual = countPipeline((row) => row.stageKey === 'converted');
    const closedLostActual = countPipeline((row) => row.stageKey === 'close_lost');
    const closedWonActual = countPipeline((row) => row.stageKey === 'close_won');

    const revenueActual = endingActual.map((value) => (value === null ? null : value / 12));
    const revenuePlan = endingPlan.map((value) => (value === null ? null : value / 12));
    const revenueGrowthActual = revenueActual.map((value, idx) => {
      const previous = idx === 0 ? null : revenueActual[idx - 1];
      return value !== null && previous !== null && previous > 0 ? value / previous - 1 : null;
    });
    const revenueGrowthPlan = revenuePlan.map((value, idx) => {
      const previous = idx === 0 ? null : revenuePlan[idx - 1];
      return value !== null && previous !== null && previous > 0 ? value / previous - 1 : null;
    });

    const emptyCurrency = Array.from({ length: 12 }, () => null as number | null);
    const emptyPercent = Array.from({ length: 12 }, () => null as number | null);
    const nrrActual = beginningActual.map((beginning, idx) =>
      beginning && beginning > 0 ? (beginning + expandingActual[idx] + churnActual[idx]) / beginning : null
    );
    const grrActual = beginningActual.map((beginning, idx) =>
      beginning && beginning > 0 ? (beginning + churnActual[idx]) / beginning : null
    );
    const churnRateActual = beginningActual.map((beginning, idx) =>
      beginning && beginning > 0 ? Math.abs(churnActual[idx]) / beginning : null
    );
    const newClientArrGrowthActual = beginningActual.map((beginning, idx) =>
      beginning && beginning > 0 ? newSalesActual[idx] / beginning : null
    );

    type RowFormat = 'currency' | 'number' | 'percent';
    type ReportRow =
      | { type: 'section'; label: string }
      | { type: 'metric'; label: string; format: RowFormat; actual: Array<number | null>; plan: Array<number | null> };

    const metric = (
      label: string,
      format: RowFormat,
      actual: Array<number | null>,
      plan: Array<number | null> = emptyCurrency
    ): ReportRow => ({ type: 'metric', label, format, actual, plan });

    const rows: ReportRow[] = [
      { type: 'section', label: 'Total Business ARR' },
      metric('Beginning ARR', 'currency', beginningActual, beginningPlan),
      metric('New Sales ARR', 'currency', newSalesActual, newSalesPlan),
      metric('Expanding ARR', 'currency', expandingActual, expandingPlan),
      metric('Churn ARR', 'currency', churnActual, churnPlan),
      metric('Ending ARR', 'currency', endingActual, endingPlan),
      { type: 'section', label: 'Customer Summary' },
      metric('Beginning Customers', 'number', beginningCustomers, beginningCustomers),
      metric('New Customers', 'number', goLivesActual, goLivesPlan),
      metric('Churned Customers', 'number', churnedCustomers, Array.from({ length: 12 }, () => null)),
      metric('Ending Customers', 'number', endingCustomers, endingCustomers),
      { type: 'section', label: 'Average Contract Value Summary' },
      metric('Average Total Bill', 'currency', averageTotalBillActual, averageTotalBillPlan),
      { type: 'section', label: 'New Clients Acquisition' },
      metric('SQL', 'number', sqlActual, pad(planzahlen?.business_inbound).map((value, idx) => value + pad(planzahlen?.business_outbound)[idx])),
      metric('Opportunities', 'number', opportunitiesActual, Array.from({ length: 12 }, () => null)),
      metric('Closed Lost', 'number', closedLostActual, Array.from({ length: 12 }, () => null)),
      metric('Closed Win', 'number', closedWonActual, goLivesPlan),
      { type: 'section', label: 'Churned Customers Calculation' },
      metric('Historical / Forecasted Churn', 'number', churnedCustomers, Array.from({ length: 12 }, () => null)),
      metric('Churn Rate (% of total customer base)', 'percent', churnRateActual, emptyPercent),
      { type: 'section', label: 'P&L' },
      metric('Revenue', 'currency', revenueActual, revenuePlan),
      metric('Revenue Growth %', 'percent', revenueGrowthActual, revenueGrowthPlan),
      metric('COGS', 'currency', emptyCurrency, emptyCurrency),
      metric('Gross Margin', 'currency', emptyCurrency, emptyCurrency),
      metric('Gross Margin %', 'percent', emptyPercent, emptyPercent),
      metric('Staff costs', 'currency', emptyCurrency, emptyCurrency),
      metric('Staff costs %', 'percent', emptyPercent, emptyPercent),
      metric('Operating Expenses', 'currency', emptyCurrency, emptyCurrency),
      metric('Operating Exepenses %', 'percent', emptyPercent, emptyPercent),
      metric('Marketing costs', 'currency', emptyCurrency, emptyCurrency),
      metric('Marketing costs %', 'percent', emptyPercent, emptyPercent),
      metric('Total Expenses', 'currency', emptyCurrency, emptyCurrency),
      metric('Total expenses %', 'percent', emptyPercent, emptyPercent),
      metric('EBITDA', 'currency', emptyCurrency, emptyCurrency),
      metric('EBITDA Margin %', 'percent', emptyPercent, emptyPercent),
      metric('Headoffice Recharges', 'currency', emptyCurrency, emptyCurrency),
      metric('Headoffice Recharges %', 'percent', emptyPercent, emptyPercent),
      metric('EBITDA after Recharges', 'currency', emptyCurrency, emptyCurrency),
      metric('EBITDA Margin %', 'percent', emptyPercent, emptyPercent),
      { type: 'section', label: 'SaaS metrics' },
      metric('Rule of 40 local', 'percent', emptyPercent, emptyPercent),
      metric('Rule of 40', 'percent', emptyPercent, emptyPercent),
      metric('Net Retention Rate', 'percent', nrrActual, emptyPercent),
      metric('Gross Dollar Retention (GRR)', 'percent', grrActual, emptyPercent),
      metric('Churn Rate', 'percent', churnRateActual, emptyPercent),
      metric('New Client ARR Grwoth', 'percent', newClientArrGrowthActual, emptyPercent),
    ];

    return { rows, hasBeginningArr, arrBasisDec, arrBasisJanEnd: beginningArrSeed };
  }, [
    planzahlen,
    ytdMonthlyResult,
    monthlyChurnData,
    invoicedChurnTargetArrByMonth,
    selectedYear,
    smsData,
    phorestPayData,
    upDownsellsData,
    pipelineRows,
  ]);

  const whatIfScenario = useMemo(() => {
    const clampRate = (value: number) => Math.max(0, Math.min(1, value));
    const convertedBase = salespipeStageSummary.converted.count;
    const notConvertedBase =
      salespipeStageSummary.not_converted_new.count + salespipeStageSummary.working.count;
    // SQL-Basis folgt der Sales-Pipe-Übersicht (Lead-Gesamtzahl im Filterzeitraum).
    const totalSql = salespipeStageSummary.sql.count;

    const convertedRateBase = totalSql > 0 ? convertedBase / totalSql : 0;
    const winRateBase = salespipeWinRate ?? 0;

    const convertedRateWhatIf = clampRate(whatIfConvertedRatePct / 100);
    const winRateWhatIf = clampRate(whatIfWinRatePct / 100);

    const convertedCountWhatIf = Math.round(totalSql * convertedRateWhatIf);
    const notConvertedCountWhatIf = Math.max(0, totalSql - convertedCountWhatIf);
    // Anteil entschiedener Deals an Converted aus Ist-Daten als Basis beibehalten.
    const decidedBase = convertedDecisionStats.closeWonCount + convertedDecisionStats.closeLostCount;
    const decidedShareBase = convertedBase > 0 ? decidedBase / convertedBase : 0;
    const decidedCountWhatIf = Math.round(convertedCountWhatIf * decidedShareBase);
    const closeWonCountWhatIf = Math.round(decidedCountWhatIf * winRateWhatIf);
    const closeLostCountWhatIf = Math.max(0, decidedCountWhatIf - closeWonCountWhatIf);
    const openPipelineCountWhatIf = Math.max(0, convertedCountWhatIf - decidedCountWhatIf);

    const weightedPipelineArrPerDeal =
      salespipeKpis.openRows > 0 ? salespipeKpis.weightedArr / salespipeKpis.openRows : 0;
    const closeWonArrPerDeal =
      convertedDecisionStats.closeWonCount > 0
        ? salespipeStageSummary.close_won.arr / convertedDecisionStats.closeWonCount
        : 0;
    const closeLostArrPerDeal =
      convertedDecisionStats.closeLostCount > 0
        ? salespipeStageSummary.close_lost.arr / convertedDecisionStats.closeLostCount
        : 0;

    return {
      sqlCount: totalSql,
      convertedCountBase: convertedBase,
      notConvertedCountBase: notConvertedBase,
      closeWonCountBase: convertedDecisionStats.closeWonCount,
      closeLostCountBase: convertedDecisionStats.closeLostCount,
      openPipelineArrBase: salespipeKpis.weightedArr,
      closeWonArrBase: salespipeStageSummary.close_won.arr,
      closeLostArrBase: salespipeStageSummary.close_lost.arr,
      convertedRateBase,
      winRateBase,
      convertedRateWhatIf,
      winRateWhatIf,
      convertedCountWhatIf,
      notConvertedCountWhatIf,
      closeWonCountWhatIf,
      closeLostCountWhatIf,
      openPipelineArrWhatIf: weightedPipelineArrPerDeal * openPipelineCountWhatIf,
      closeWonArrWhatIf: closeWonArrPerDeal * closeWonCountWhatIf,
      closeLostArrWhatIf: closeLostArrPerDeal * closeLostCountWhatIf,
    };
  }, [
    salespipeStageSummary,
    salespipeWinRate,
    salespipeKpis,
    convertedDecisionStats.closeWonCount,
    convertedDecisionStats.closeLostCount,
    whatIfConvertedRatePct,
    whatIfWinRatePct,
  ]);

  const probabilityBuckets = useMemo(() => {
    const openRows = openPipelineOpportunityRowsStats;
    return PROBABILITY_BUCKET_DEFS.map((bucket) => {
      const rows = openRows.filter((row) => {
        const prob = row.probability;
        return prob >= bucket.min && prob < bucket.max;
      });
      return {
        ...bucket,
        count: rows.length,
        arr: rows.reduce((sum, row) => sum + row.row.weightedArr, 0),
      };
    });
  }, [openPipelineOpportunityRowsStats]);

  const selectedProbabilityBucketRows = useMemo(() => {
    if (!selectedProbabilityBucketKey) return [];
    const selectedBucket = PROBABILITY_BUCKET_DEFS.find((bucket) => bucket.key === selectedProbabilityBucketKey);
    if (!selectedBucket) return [];
    return openPipelineOpportunityRowsAll
      .filter((item) => item.probability >= selectedBucket.min && item.probability < selectedBucket.max)
      .sort((a, b) => b.row.weightedArr - a.row.weightedArr);
  }, [selectedProbabilityBucketKey, openPipelineOpportunityRowsAll]);

  const salesCyclePlanRules = useMemo(() => {
    const newClients =
      planzahlen?.new_clients_data && typeof planzahlen.new_clients_data === 'object'
        ? (planzahlen.new_clients_data as Record<string, unknown>)
        : {};
    const rawRules =
      newClients.sales_cycle_plan_rules && typeof newClients.sales_cycle_plan_rules === 'object'
        ? newClients.sales_cycle_plan_rules
        : null;
    return parseSalesCyclePlanRules(rawRules);
  }, [planzahlen]);

  const overdueCloseDaysByProbability = useMemo(() => {
    const to20 =
      salesCyclePlanRules.lead_to_demo_booked_days + salesCyclePlanRules.demo_booked_to_sent_quote_20_days;
    const to50 = to20 + salesCyclePlanRules.sent_quote_20_to_sent_quote_50_days;
    const to70 = to50 + salesCyclePlanRules.sent_quote_50_to_sent_quote_70_days;
    const to90 = to70 + salesCyclePlanRules.sent_quote_70_to_sent_quote_90_days;

    const getLimit = (probability: number | null) => {
      if (probability === null) return to20;
      if (probability >= 0.9) return to90;
      if (probability >= 0.7) return to70;
      if (probability >= 0.5) return to50;
      return to20;
    };

    return { to20, to50, to70, to90, getLimit };
  }, [salesCyclePlanRules]);

  const overdueOpportunities = useMemo(() => {
    const today = new Date();
    const openOpportunities = baseFilteredSalespipeRowsStats.filter((row) => {
      if (row.source !== 'salespipe') return false;
      if (!row.opportunityId) return false;
      if (row.stageKey === 'sql' || row.stageKey === 'close_won' || row.stageKey === 'close_lost') return false;
      if (!row.filterDate) return false;
      return true;
    });

    return openOpportunities
      .map((row) => {
        const startDate = new Date(row.filterDate as string);
        if (Number.isNaN(startDate.getTime())) return null;
        const ageDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const limitDays = overdueCloseDaysByProbability.getLimit(row.probability);
        const overdueDays = ageDays - limitDays;
        if (overdueDays <= 0) return null;
        return { row, ageDays, limitDays, overdueDays };
      })
      .filter((entry): entry is { row: PipelineRow; ageDays: number; limitDays: number; overdueDays: number } => !!entry)
      .sort((a, b) => b.overdueDays - a.overdueDays || b.row.arr - a.row.arr);
  }, [baseFilteredSalespipeRowsStats, overdueCloseDaysByProbability]);

  const startResizeSalespipeColumn = (index: number, event: any) => {
    event.preventDefault();
    event.stopPropagation();
    resizingSalespipeColRef.current = {
      index,
      startX: event.clientX,
      startWidth: salespipeMainColWidths[index] ?? SALESPIPE_MAIN_COLUMN_WIDTHS_DEFAULT[index] ?? 120,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const applySalespipeDateFilter = () => {
    setSalespipeDateFrom(salespipeDateFromInput);
    setSalespipeDateTo(salespipeDateToInput);
    const parsedRelative = parseInt(salespipeRelativeDaysInput, 10);
    setSalespipeRelativeDays(Number.isFinite(parsedRelative) ? parsedRelative : null);
  };

  const resetSalespipeDateFilter = () => {
    setSalespipeDateFromInput(defaultSalespipeYtdRange.from);
    setSalespipeDateToInput(defaultSalespipeYtdRange.to);
    setSalespipeDateFrom(defaultSalespipeYtdRange.from);
    setSalespipeDateTo(defaultSalespipeYtdRange.to);
    setSalespipeRelativeDaysInput('none');
    setSalespipeRelativeDays(null);
  };

  const applySalespipeQuickPreset = (preset: 'today' | 'this_week' | 'this_month' | 'ytd') => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    let start = new Date(today);

    if (preset === 'this_week') {
      const day = today.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      start.setDate(today.getDate() - diffToMonday);
    } else if (preset === 'this_month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === 'ytd') {
      if (selectedYear === currentYear) {
        start = new Date(currentYear, 0, 1);
      } else {
        start = new Date(selectedYear, 0, 1);
        end.setFullYear(selectedYear, 11, 31);
      }
    }

    const startValue = formatDateForInput(start);
    const endValue = formatDateForInput(end);
    setSalespipeDateFromInput(startValue);
    setSalespipeDateToInput(endValue);
    setSalespipeDateFrom(startValue);
    setSalespipeDateTo(endValue);
    setSalespipeRelativeDaysInput('none');
    setSalespipeRelativeDays(null);
  };

  const loading = usersLoading || dataLoading || planzahlenLoading || churnLoading;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500">{t('ui.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <span className="text-3xl">📈</span>
            {t('dlt.reports.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('dlt.reports.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-4">
          <PDFExportButton
            targetRef={exportRef}
            baseFilename="DLT_Strategic_Report"
            year={selectedYear}
            title={`${t('dlt.reports.title')} ${selectedYear}`}
            subtitle="DLT - Director Leadership Team"
            orientation="landscape"
            variant="secondary"
            size="md"
          />
          
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Category Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { id: 'new_sales_arr', label: 'New Sales ARR', icon: '📈' },
          { id: 'expanding_arr', label: 'Expanding ARR', icon: '📊' },
          { id: 'total_business_arr', label: 'Total Business ARR', icon: '🏢' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setReportCategory(tab.id as typeof reportCategory)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              reportCategory === tab.id
                ? 'bg-slate-800 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {reportCategory === 'new_sales_arr' && (
        <div className="flex gap-2 mb-6">
          {[
            { id: 'forecast', label: t('dlt.reports.forecast'), icon: '🔮' },
            { id: 'ytd', label: t('dlt.reports.ytdSummary'), icon: '📋' },
            { id: 'salespipe', label: 'New Sales Pipe', icon: '🧭' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setReportType(tab.id as typeof reportType)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                reportType === tab.id
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Export Container */}
      <div ref={exportRef}>
        {/* Forecast */}
        {reportCategory === 'new_sales_arr' && reportType === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <button
                type="button"
                onClick={() => setForecastSettingsCollapsed((v) => !v)}
                className="flex w-full items-center justify-between gap-2 mb-4 text-left"
              >
                <h3 className="text-lg font-semibold text-gray-800">NET ARR Forecast (Subs + Pay - Churn)</h3>
                <span className="flex-shrink-0 text-gray-400 text-xs">
                  {forecastSettingsCollapsed ? '▼ Einstellungen einblenden' : '▲ Einstellungen ausblenden'}
                </span>
              </button>
              {!forecastSettingsCollapsed && (
              <><div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700 font-medium">Lead Conversion Slider (Lead -&gt; Go-Live)</span>
                  <span className="text-gray-900 font-semibold">{leadToGoLiveForecastPercent.toFixed(1)}%</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    min={4}
                    max={30}
                    step={0.5}
                    value={leadToGoLiveForecastPercent}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setLeadToGoLiveForecastPercent(Number.isFinite(next) ? next : 16);
                    }}
                    className="w-full accent-gray-600"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={leadToGoLiveForecastPercent}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setLeadToGoLiveForecastPercent(Math.max(0, Math.min(100, next)));
                    }}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Der ARR aus YTD Lead-Conversion Forecast wird mit dieser Conversion-Rate live neu projiziert.
                </div>
              </div>
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                {(() => {
                  const leadVolumeSliderMax = Math.max(
                    50,
                    Math.ceil((futureLeadScenarioSummary.ytdLeadAverage > 0 ? futureLeadScenarioSummary.ytdLeadAverage * 3 : 150) / 10) * 10
                  );
                  const leadVolumeDefaultValue = Math.max(
                    0,
                    Math.min(leadVolumeSliderMax, Math.round(futureLeadScenarioSummary.ytdLeadAverage))
                  );
                  const leadVolumeDefaultPercent = leadVolumeSliderMax > 0
                    ? (leadVolumeDefaultValue / leadVolumeSliderMax) * 100
                    : 0;
                  return (
                    <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700 font-medium">Lead Volumen Slider (Leads pro Future-Monat)</span>
                  <span className="text-gray-900 font-semibold">{futureLeadVolumeScenarioMonthlyLeads.toFixed(0)}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="w-full">
                    <div className="relative">
                      <input
                        type="range"
                        min={0}
                        max={leadVolumeSliderMax}
                        step={1}
                        value={futureLeadVolumeScenarioMonthlyLeads}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setFutureLeadVolumeScenarioMonthlyLeads(Number.isFinite(next) ? next : 0);
                        }}
                        className="w-full accent-gray-600 relative z-10"
                      />
                      <div
                        className="pointer-events-none absolute top-1/2 -translate-y-1/2 z-0"
                        style={{ left: `${leadVolumeDefaultPercent}%` }}
                        aria-hidden
                      >
                        <div className="h-5 border-l-2 border-indigo-500 opacity-80" />
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-indigo-700">
                      Default-Markierung: {leadVolumeDefaultValue} Leads/Monat (YTD-Schnitt)
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={leadVolumeSliderMax * 2}
                    step={1}
                    value={futureLeadVolumeScenarioMonthlyLeads}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setFutureLeadVolumeScenarioMonthlyLeads(Math.max(0, Math.min(leadVolumeSliderMax * 2, next)));
                    }}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <div className="text-gray-500">Baseline Leads (Forecast-Basis)</div>
                    <div className="font-semibold text-gray-800">{futureLeadScenarioSummary.baselineEligibleFutureLeads.toFixed(0)}</div>
                  </div>
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <div className="text-gray-500">Szenario Leads (mit Slider)</div>
                    <div className="font-semibold text-gray-800">{futureLeadScenarioSummary.scenarioEligibleFutureLeads.toFixed(0)}</div>
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Standardwert basiert auf dem importierten YTD SQL-Leadschnitt.
                  Modell: Baseline = YTD SQL-Leadschnitt ({futureLeadScenarioSummary.ytdLeadAverage.toFixed(1)}) x
                  Future-Monate ({futureLeadScenarioSummary.futureMonthsCount}).
                </div>
                    </>
                  );
                })()}
              </div>
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                {(() => {
                  const churnSliderMax = 300;
                  // Default-Marker bei 100% (= YTD-Ø)
                  const defaultMarkerPercent = (100 / churnSliderMax) * 100;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-700 font-medium">Churn-Trend Slider (What-if-Szenario)</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-900 font-semibold">{futureChurnScenarioFactorPercent.toFixed(0)}%</span>
                          {futureChurnScenarioFactorPercent !== 100 && (
                            <button
                              type="button"
                              onClick={() => setFutureChurnScenarioFactorPercent(100)}
                              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                            >
                              Reset (100%)
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="w-full">
                          <div className="relative">
                            <input
                              type="range"
                              min={0}
                              max={churnSliderMax}
                              step={5}
                              value={futureChurnScenarioFactorPercent}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                setFutureChurnScenarioFactorPercent(Number.isFinite(next) ? next : 100);
                              }}
                              className="w-full accent-red-500 relative z-10"
                            />
                            <div
                              className="pointer-events-none absolute top-1/2 -translate-y-1/2 z-0"
                              style={{ left: `${defaultMarkerPercent}%` }}
                              aria-hidden
                            >
                              <div className="h-5 border-l-2 border-indigo-500 opacity-80" />
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-indigo-700">
                            Default (100%): {formatCurrency(churnScenarioSummary.ytdMonthlyBookedAverage)} / Monat (YTD-Ø)
                          </div>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={churnSliderMax}
                          step={5}
                          value={futureChurnScenarioFactorPercent}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            setFutureChurnScenarioFactorPercent(Math.max(0, Math.min(churnSliderMax, next)));
                          }}
                          className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">YTD-Ø Churn / Monat (Trend-Basis)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.ytdMonthlyBookedAverage)}</div>
                        </div>
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">Trend-Basis gesamt (Future)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.futureTrendBaseTotal)}</div>
                        </div>
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">Szenario Churn (Future)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.scenarioFutureChurnTotal)}</div>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        100% = aktueller YTD-Trend. Slider hoch → mehr Churn → NET ARR sinkt. Slider runter → weniger Churn → NET ARR steigt.
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEnterpriseDealsCollapsed((v) => !v)}
                    className="flex items-center gap-2 text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-sky-900">Enterprise Deals (optional)</div>
                      <div className="text-xs text-sky-800">
                        Jeder Deal wird mit OAK-ID/Account zugeordnet, in der DB gespeichert und monatlich in die Projektion eingerechnet.
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-sky-400 text-xs ml-1">
                      {enterpriseDealsCollapsed ? '▼' : '▲'}
                    </span>
                  </button>
                  <label className="inline-flex items-center gap-2 text-sm text-sky-900">
                    <input
                      type="checkbox"
                      checked={enterpriseForecastEnabled}
                      onChange={(e) => setEnterpriseForecastEnabled(e.target.checked)}
                      className="h-4 w-4 accent-sky-600"
                    />
                    Aktiv
                  </label>
                </div>

                {!enterpriseDealsCollapsed && (
                  <div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-sky-900">Deal suchen (OAK oder Account)</label>
                    <input
                      type="text"
                      value={enterpriseLookupQuery}
                      onChange={(e) => setEnterpriseLookupQuery(e.target.value)}
                      list="enterprise-deal-search-options"
                      placeholder="z. B. OAK 12345 oder Salonname"
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm"
                    />
                    <datalist id="enterprise-deal-search-options">
                      {enterpriseLookupOptions.slice(0, 300).map((option) => (
                        <option key={`${option.oakId || 'none'}-${option.accountName || 'none'}`} value={option.label} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-sky-900">Zielmonat</label>
                    <select
                      value={enterpriseDealTargetMonthInput}
                      onChange={(e) => setEnterpriseDealTargetMonthInput(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm"
                    >
                      {MONTH_NAMES_SHORT.map((label, idx) => (
                        <option key={label} value={idx + 1}>
                          {label} {selectedYear}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-sky-900">Erwartete Go-Lives</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={enterpriseDealExpectedGoLivesInput}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setEnterpriseDealExpectedGoLivesInput(Math.max(0, next));
                      }}
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-sky-900">ARR pro Go-Live</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={enterpriseDealArrPerGoLiveInput}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setEnterpriseDealArrPerGoLiveInput(Math.max(0, Math.round(next)));
                      }}
                      className="w-full rounded border border-sky-200 bg-white px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddEnterpriseDeal}
                    disabled={addingEnterpriseDeal}
                    className="inline-flex items-center justify-center rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {addingEnterpriseDeal ? 'Speichere Deal...' : 'Deal hinzufügen'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnterpriseDealArrPerGoLiveInput(Math.max(0, Math.round(enterpriseDefaultArrPerGoLiveYtd)))}
                    className="inline-flex items-center justify-center rounded border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                  >
                    YTD-Ø ARR/Go-Live übernehmen ({formatCurrency(enterpriseDefaultArrPerGoLiveYtd)})
                  </button>
                  <div className="text-xs text-sky-800">
                    Deal-Preview: {formatCurrency(Math.max(0, enterpriseDealExpectedGoLivesInput) * Math.max(0, enterpriseDealArrPerGoLiveInput))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                  <div className="rounded border border-sky-200 bg-white p-2">
                    <div className="text-sky-700">Gesamt ARR (alle Deals)</div>
                    <div className="font-semibold text-sky-900">{formatCurrency(enterpriseDealsSummary.all)}</div>
                  </div>
                  <div className="rounded border border-sky-200 bg-white p-2">
                    <div className="text-sky-700">Aktive Deals ARR</div>
                    <div className="font-semibold text-sky-900">{formatCurrency(enterpriseDealsSummary.active)}</div>
                  </div>
                  <div className="rounded border border-sky-200 bg-white p-2">
                    <div className="text-sky-700">Deals (aktiv/gesamt)</div>
                    <div className="font-semibold text-sky-900">
                      {enterpriseDeals.filter((deal) => deal.is_active).length}/{enterpriseDeals.length}
                    </div>
                  </div>
                </div>

                {enterpriseDealsError && (
                  <div className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                    {enterpriseDealsError}
                  </div>
                )}

                <div className="mt-3 rounded border border-sky-200 bg-white">
                  <div className="border-b border-sky-100 px-3 py-2 text-xs font-medium text-sky-900">
                    Gespeicherte Enterprise Deals
                    {enterpriseDealsLoading ? <span className="ml-2 text-sky-700">Lade...</span> : null}
                  </div>
                  {!enterpriseDealsLoading && enterpriseDeals.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-500">Noch keine Deals erfasst.</div>
                  ) : (
                    <div className="max-h-56 overflow-auto">
                      <table className="w-full min-w-[780px] text-xs">
                        <thead className="bg-sky-50 text-sky-900">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium">Zuordnung</th>
                            <th className="px-2 py-2 text-left font-medium">Monat</th>
                            <th className="px-2 py-2 text-right font-medium">Go-Lives</th>
                            <th className="px-2 py-2 text-right font-medium">ARR/Go-Live</th>
                            <th className="px-2 py-2 text-right font-medium">Deal ARR</th>
                            <th className="px-2 py-2 text-center font-medium">Aktiv</th>
                            <th className="px-2 py-2 text-right font-medium">Aktion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enterpriseDeals.map((deal) => {
                            const dealArr = Math.max(0, Number(deal.expected_go_lives) || 0) * Math.max(0, Number(deal.arr_per_go_live) || 0);
                            return (
                              <tr key={deal.id} className="border-t border-sky-100">
                                <td className="px-2 py-2 text-gray-800">
                                  <div className="font-medium">
                                    {deal.account_name || (deal.oak_id ? `OAK ${deal.oak_id}` : 'Unbekannt')}
                                  </div>
                                  <div className="text-[11px] text-gray-500">
                                    {deal.oak_id ? `OAK ${deal.oak_id}` : 'Keine OAK'}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-gray-700">
                                  {MONTH_NAMES_SHORT[Math.max(0, Math.min(11, Number(deal.target_month || 1) - 1))]} {selectedYear}
                                </td>
                                <td className="px-2 py-2 text-right text-gray-700">{Number(deal.expected_go_lives || 0).toFixed(0)}</td>
                                <td className="px-2 py-2 text-right text-gray-700">{formatCurrency(Number(deal.arr_per_go_live || 0))}</td>
                                <td className="px-2 py-2 text-right font-semibold text-sky-800">{formatCurrency(dealArr)}</td>
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(deal.is_active)}
                                    disabled={togglingEnterpriseDealId === deal.id}
                                    onChange={() => handleToggleEnterpriseDeal(deal)}
                                    className="h-4 w-4 accent-sky-600"
                                  />
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteEnterpriseDeal(deal)}
                                    disabled={deletingEnterpriseDealId === deal.id}
                                    className="rounded border border-red-300 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {deletingEnterpriseDealId === deal.id ? 'Lösche...' : 'Löschen'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                  </div>
                )}
              </div>
              </>)}
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs text-emerald-900">
                    Manuelles Szenario speichern (ohne LLM-Report) mit den aktuellen Slider-Werten.
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveManualScenario}
                    disabled={savedScenarioActionLoading}
                    className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savedScenarioActionLoading ? 'Speichere Szenario...' : 'Aktuelles Szenario speichern'}
                  </button>
                </div>
                {savedScenarioConfirmation && (
                  <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {savedScenarioConfirmation}
                  </div>
                )}
              </div>
              <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-indigo-900">Szenario Maßnahmen-Report</div>
                    <div className="text-xs text-indigo-800">
                      Erstellt konkrete Maßnahmen aus den aktuellen Slider-Werten (mit Fallback auf regelbasierte Logik).
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateScenarioReport}
                    disabled={scenarioReportLoading}
                    className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {scenarioReportLoading ? 'Report wird erstellt...' : 'Szenario-Report erstellen'}
                  </button>
                </div>

                {scenarioReportError && (
                  <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {scenarioReportError}
                    {scenarioReportMeta.llmRequested && (
                      <span className="ml-1">
                        (LLM nicht verfügbar oder nicht konfiguriert - regelbasierter Report bleibt nutzbar.)
                      </span>
                    )}
                  </div>
                )}

                {!scenarioReportError && scenarioReportMeta.fallbackActive && scenarioReportMeta.llmError && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    OpenAI-Diagnose: {scenarioReportMeta.llmError}
                  </div>
                )}

                {scenarioReport && (
                  <div ref={scenarioReportExportRef} className="mt-3 rounded border border-indigo-200 bg-white p-3 text-xs text-gray-700">
                    {(() => {
                      const sections = parseScenarioNarrativeSections(scenarioReport.narrative);
                      const hebelevers = scenarioReport.actions.filter(
                        (action) => action.key === 'lead_volume' || action.key === 'conversion' || action.key === 'churn'
                      );
                      const parsedCtaLines = (() => {
                        if (sections.ctaLines.length === 0) return [] as string[];
                        if (sections.ctaLines.length > 1) return sections.ctaLines;

                        const single = sections.ctaLines[0] || '';
                        const matches = single.match(/(?:\d+[.):-]?\s.*?)(?=(?:\s\d+[.):-]?\s)|$)/g);
                        if (matches && matches.length > 1) {
                          return matches.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
                        }
                        return sections.ctaLines;
                      })();

                      const fallbackCtaLines = hebelevers.map(
                        (action, idx) =>
                          `${idx + 1}. ${action.title}: ${action.requiredDelta.toFixed(2)} ${action.unit} (ARR-Hebel ${formatCurrency(
                            action.impactPerUnitNetArr
                          )}/Einheit)`
                      );

                      const ctaLines = parsedCtaLines.length >= 3 ? parsedCtaLines : fallbackCtaLines;
                      const ctaDisplayLines = ctaLines.slice(0, 3);

                      const leadVolumeAction = hebelevers.find((action) => action.key === 'lead_volume');
                      const conversionAction = hebelevers.find((action) => action.key === 'conversion');
                      const churnAction = hebelevers.find((action) => action.key === 'churn');

                      const leadVolumeDelta = Number(leadVolumeAction?.requiredDelta || 0);
                      const conversionDelta = Number(conversionAction?.requiredDelta || 0);
                      const churnDeltaReduction = Number(churnAction?.requiredDelta || 0);

                      const currentLeadVolume = Number(futureLeadVolumeScenarioMonthlyLeads || 0);
                      const currentConversion = Number(leadToGoLiveForecastPercent || 0);
                      const currentChurn = Number(futureChurnScenarioFactorPercent || 0);

                      const targetLeadVolume = Math.max(0, currentLeadVolume + (Number.isFinite(leadVolumeDelta) ? leadVolumeDelta : 0));
                      const targetConversion = Math.max(0, Math.min(100, currentConversion + (Number.isFinite(conversionDelta) ? conversionDelta : 0)));
                      const targetChurn = Math.max(0, Math.min(300, currentChurn - (Number.isFinite(churnDeltaReduction) ? churnDeltaReduction : 0)));

                      const leadVolumeSliderMax = Math.max(100, Math.ceil(Math.max(currentLeadVolume, targetLeadVolume, 1) * 1.25));
                      const conversionSliderMax = 100;
                      const churnSliderMax = 300;

                      return (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-gray-900">{scenarioReport.headline}</span>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                            <div className="rounded border border-green-200 bg-green-50/40 p-2">
                              <div className="text-gray-500">Forecast Summe Subs ARR</div>
                              <div className="font-semibold text-green-700">{formatCurrency(forecastScenarioInput.forecastSubsArr)}</div>
                              <div className={`text-[11px] mt-1 ${forecastGapSummary.subs > 0 ? 'text-red-600' : 'text-green-700'}`}>
                                Gap: {formatSignedCurrency(forecastGapSummary.subs)}
                              </div>
                            </div>
                            <div className="rounded border border-orange-200 bg-orange-50/40 p-2">
                              <div className="text-gray-500">Forecast Summe Pay ARR</div>
                              <div className="font-semibold text-orange-700">{formatCurrency(forecastScenarioInput.forecastPayArr)}</div>
                              <div className={`text-[11px] mt-1 ${forecastGapSummary.pay > 0 ? 'text-red-600' : 'text-green-700'}`}>
                                Gap: {formatSignedCurrency(forecastGapSummary.pay)}
                              </div>
                            </div>
                            <div className="rounded border border-red-200 bg-red-50/40 p-2">
                              <div className="text-gray-500">Forecast Churn ARR</div>
                              <div className="font-semibold text-red-700">{formatCurrency(forecastScenarioInput.forecastChurnArr)}</div>
                              <div className={`text-[11px] mt-1 ${forecastGapSummary.churn > 0 ? 'text-red-600' : 'text-green-700'}`}>
                                Gap: {formatSignedCurrency(forecastGapSummary.churn)}
                              </div>
                            </div>
                            <div className="rounded border border-indigo-200 bg-indigo-50/40 p-2">
                              <div className="text-gray-500">Forecast Summe NET ARR</div>
                              <div className="font-semibold text-indigo-700">{formatCurrency(forecastScenarioInput.forecastNetArr)}</div>
                              <div className={`text-[11px] mt-1 ${scenarioReport.netGapArr > 0 ? 'text-red-600' : 'text-green-700'}`}>
                                Gap: {formatCurrency(scenarioReport.netGapArr)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                            {hebelevers.map((action) => (
                              <div key={action.key} className="rounded border border-gray-200 p-2">
                                <div className="font-medium text-gray-900">{action.title}</div>
                                <div>Ziel-Beitrag: {action.requiredDelta.toFixed(2)} {action.unit}</div>
                                <div>Wirkung/Einheit: {formatCurrency(action.impactPerUnitNetArr)}</div>
                                <div className="text-gray-500">{action.details}</div>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 rounded border border-indigo-200 bg-indigo-50/30 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                              Empfohlenes Slider-Szenario (Hard Copy)
                            </div>
                            <div className="mt-2 space-y-3">
                              <div className="rounded border border-gray-200 bg-white p-2">
                                <div className="mb-1 flex items-center justify-between text-[12px]">
                                  <span className="font-medium text-gray-800">Lead Conversion (Lead -&gt; Go-Live)</span>
                                  <span className="text-gray-700">
                                    aktuell {currentConversion.toFixed(1)}% -&gt; Ziel {targetConversion.toFixed(1)}%
                                    <span className="ml-1 font-semibold text-indigo-700">({conversionDelta >= 0 ? '+' : ''}{conversionDelta.toFixed(1)}pp)</span>
                                  </span>
                                </div>
                                <input type="range" min={0} max={conversionSliderMax} step={0.1} value={targetConversion} readOnly className="w-full accent-slate-600" />
                              </div>

                              <div className="rounded border border-gray-200 bg-white p-2">
                                <div className="mb-1 flex items-center justify-between text-[12px]">
                                  <span className="font-medium text-gray-800">Lead Volumen (Leads pro Future-Monat)</span>
                                  <span className="text-gray-700">
                                    aktuell {currentLeadVolume.toFixed(0)} -&gt; Ziel {targetLeadVolume.toFixed(0)}
                                    <span className="ml-1 font-semibold text-indigo-700">({leadVolumeDelta >= 0 ? '+' : ''}{leadVolumeDelta.toFixed(1)})</span>
                                  </span>
                                </div>
                                <input type="range" min={0} max={leadVolumeSliderMax} step={1} value={targetLeadVolume} readOnly className="w-full accent-slate-600" />
                              </div>

                              <div className="rounded border border-gray-200 bg-white p-2">
                                <div className="mb-1 flex items-center justify-between text-[12px]">
                                  <span className="font-medium text-gray-800">Churn Faktor</span>
                                  <span className="text-gray-700">
                                    aktuell {currentChurn.toFixed(1)}% -&gt; Ziel {targetChurn.toFixed(1)}%
                                    <span className="ml-1 font-semibold text-emerald-700">(-{Math.abs(churnDeltaReduction).toFixed(1)}pp)</span>
                                  </span>
                                </div>
                                <input type="range" min={0} max={churnSliderMax} step={0.1} value={targetChurn} readOnly className="w-full accent-red-500" />
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 rounded border border-gray-200 bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Executive Summary</div>
                            <div className="mt-1 whitespace-pre-wrap text-[12px] text-gray-800">{sections.executiveSummary || scenarioReport.summaryLines.join(' ')}</div>
                          </div>

                          <div className="mt-2 rounded border border-gray-200 bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Hebelwirkung</div>
                            <div className="mt-1 whitespace-pre-wrap text-[12px] text-gray-800">
                              {sections.hebeleffekt || 'Die drei Hebel wirken zusammen auf Leadzufluss, Conversion und Churn-Stabilisierung.'}
                            </div>
                          </div>

                          <div className="mt-2 rounded border border-gray-200 bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">CTA</div>
                            <div className="mt-1 grid grid-cols-1 gap-2">
                              {ctaDisplayLines.map((line, idx) => {
                                const cleanedLine = line.replace(/^\s*\d+[.):-]?\s*/, '').trim();
                                const metricMatch = cleanedLine.match(/([+\-]?\d+[\.,]?\d*\s*(?:pp|%|EUR|€|Leads\/Monat))/i);
                                return (
                                  <div
                                    key={`${line}-${idx}`}
                                    className="rounded border border-indigo-200 bg-indigo-50/40 p-2"
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white">
                                        {idx + 1}
                                      </span>
                                      <div className="flex-1">
                                        <div className="text-[12px] font-medium text-gray-800">{cleanedLine || line}</div>
                                        {metricMatch && (
                                          <span className="mt-1 inline-flex items-center rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                            KPI: {metricMatch[1]}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="mt-2 rounded border border-gray-200 bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Elevator Pitch</div>
                            <div className="mt-1 whitespace-pre-wrap text-[12px] text-gray-800">
                              {sections.elevatorPitch || scenarioReport.narrative || 'Kein Elevator Pitch vorhanden.'}
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-end gap-3">
                            {savedScenarioConfirmation && (
                              <div className="rounded-md bg-emerald-50 border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 animate-fade-in">
                                {savedScenarioConfirmation}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={handleSaveScenario}
                              disabled={savedScenarioActionLoading}
                              className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {savedScenarioActionLoading ? 'Speichere Szenario...' : 'In ein Szenario übernehmen'}
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                <div className="mt-3 rounded border border-indigo-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-gray-800">Gespeicherte Szenarien</div>
                    {savedScenariosLoading && <div className="text-xs text-gray-500">Lade...</div>}
                  </div>
                  {savedScenarioError && (
                    <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                      {savedScenarioError}
                    </div>
                  )}
                  {!savedScenariosLoading && savedScenarios.length === 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      Noch keine gespeicherten Szenarien für {selectedYear}.
                    </div>
                  )}
                  {savedScenarios.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {savedScenarios.map((saved) => {
                        const payload = saved.scenario_payload || {};
                        const source = String(payload.source || '').trim().toLowerCase();
                        const isManual = source === 'manual_slider_save';

                        return (
                          <div
                            key={saved.id}
                            className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-2 md:flex-row md:items-center md:justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-gray-900">{saved.title}</div>
                                <span
                                  className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${
                                    isManual
                                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : 'border border-indigo-300 bg-indigo-50 text-indigo-700'
                                  }`}
                                >
                                  {isManual ? 'Manuell' : 'Report'}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500">
                                {new Date(saved.created_at).toLocaleString('de-DE')}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleApplySavedScenario(saved)}
                                  className="inline-flex items-center justify-center rounded border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                                >
                                  Szenario laden
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadSavedScenarioPdf(saved)}
                                  disabled={downloadingPdfScenarioId === saved.id}
                                  className="inline-flex items-center justify-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {downloadingPdfScenarioId === saved.id ? 'Lade PDF...' : 'PDF herunterladen'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSavedScenario(saved)}
                                  disabled={deletingScenarioId === saved.id}
                                  className="inline-flex items-center justify-center rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deletingScenarioId === saved.id ? 'Lösche...' : 'Szenario löschen'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="bg-white rounded-lg shadow-sm p-4 border border-green-200">
                  <div className="text-xs text-gray-500">Forecast Summe Subs ARR</div>
                  <div className="text-xl font-bold text-green-700">{formatCurrency(forecastSummary.subs)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  YTD eingebucht: {formatCurrency(forecastSummary.ytdBookedSubs)}
                </div>
                  <div className="text-xs text-gray-500 mt-1">Target: {formatCurrency(forecastTargetSummary.subs)}</div>
                  <div className="text-xs text-gray-500 mt-1">{(forecastAchievement.subs * 100).toFixed(1)}% erreicht</div>
                  <div className={`text-sm font-bold mt-2 ${forecastGapSummary.subs > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    Gap: {formatSignedCurrency(forecastGapSummary.subs)}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4 border border-orange-200">
                  <div className="text-xs text-gray-500">Forecast Summe Pay ARR</div>
                  <div className="text-xl font-bold text-orange-700">{formatCurrency(forecastSummary.pay)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  YTD eingebucht: {formatCurrency(forecastSummary.ytdBookedPay)}
                </div>
                  <div className="text-xs text-gray-500 mt-1">Target: {formatCurrency(forecastTargetSummary.pay)}</div>
                  <div className="text-xs text-gray-500 mt-1">{(forecastAchievement.pay * 100).toFixed(1)}% erreicht</div>
                  <div className={`text-sm font-bold mt-2 ${forecastGapSummary.pay > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    Gap: {formatSignedCurrency(forecastGapSummary.pay)}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4 border border-red-200">
                  <div className="text-xs text-gray-500">Forecast Churn ARR</div>
                  <div className="text-xl font-bold text-red-700">{formatCurrency(forecastSummary.churn)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    YTD eingebucht: {formatCurrency(churnScenarioSummary.ytdChurnTotal)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Future Basis (Plan): {formatCurrency(churnScenarioSummary.futurePlanBaseTotal)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Future Szenario: {formatCurrency(churnScenarioSummary.scenarioFutureChurnTotal)} ({(churnScenarioSummary.churnScenarioFactor * 100).toFixed(0)}%)
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Über Plan (eingebucht): {formatCurrency(churnScenarioSummary.overPlanFutureTotal)}
                  </div>
                  <div className={`text-sm font-bold mt-2 ${forecastGapSummary.churn > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    Gap: {formatSignedCurrency(forecastGapSummary.churn)}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4 border border-sky-200">
                  <div className="text-xs text-gray-500">Forecast Enterprise ARR</div>
                  <div className="text-xl font-bold text-sky-700">{formatCurrency(forecastSummary.enterprise)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Status: {enterpriseForecastEnabled ? 'Aktiv' : 'Inaktiv'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Aktive Deals: {enterpriseDeals.filter((deal) => deal.is_active).length}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4 border border-blue-200">
                  <div className="text-xs text-gray-500">Forecast Summe NET ARR</div>
                  <div className="text-xl font-bold text-blue-700">{formatCurrency(forecastSummary.net)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  YTD eingebucht: {formatCurrency(forecastSummary.ytdBookedNet)}
                </div>
                  <div className="text-xs text-gray-500 mt-1">Target: {formatCurrency(forecastTargetSummary.net)}</div>
                  <div className="text-xs text-gray-500 mt-1">{(forecastAchievement.net * 100).toFixed(1)}% erreicht</div>
                  <div className={`text-sm font-bold mt-2 ${forecastGapSummary.net > 0 ? 'text-red-600' : 'text-green-700'}`}>
                    Gap: {formatSignedCurrency(forecastGapSummary.net)}
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <Tooltip
                    content={renderForecastTooltip}
                  />
                  <Legend />
                  <Bar
                    dataKey="arrGoLivesToDate"
                    stackId="arrSplit"
                    name="ARR aus Go-Lives bis heute"
                    fill="#10B981"
                  />
                  <Bar
                    dataKey="arrGoLivesFuture"
                    stackId="arrSplit"
                    name="ARR aus Future Go-Lives"
                    fill="#3B82F6"
                  />
                  <Bar
                    dataKey="arrWeightedPipeline"
                    stackId="arrSplit"
                    name="ARR aus Weighted Sales Pipeline"
                    fill="#D946EF"
                    minPointSize={3}
                  />
                  <Bar
                    dataKey="arrNotBookedPipeline"
                    stackId="arrSplit"
                    name="ARR aus Sign-ups Not Booked"
                    fill="#FACC15"
                    minPointSize={4}
                    stroke="#CA8A04"
                    strokeWidth={1}
                  />
                  <Bar
                    dataKey="arrConversionBased"
                    stackId="arrSplit"
                    name="ARR aus YTD Lead-Conversion Forecast"
                    fill="#6B7280"
                    minPointSize={3}
                  />
                  <Bar
                    dataKey="arrEnterpriseExpectation"
                    stackId="arrSplit"
                    name="ARR aus Enterprise Erwartung"
                    fill="#0EA5E9"
                    minPointSize={3}
                  />
                  <Bar
                    dataKey="arrChurnBookedDeduction"
                    stackId="arrSplit"
                    name="Churn ARR eingebucht (abgezogen)"
                    fill="#EF4444"
                  />
                  <Bar
                    dataKey="arrChurnProjectedDeduction"
                    stackId="arrSplit"
                    name="Churn ARR projiziert (abgezogen)"
                    fill="#EF4444"
                    fillOpacity={0.35}
                    stroke="#EF4444"
                    strokeOpacity={0.6}
                    strokeWidth={1}
                  />
                  <Bar
                    dataKey="arrChurnOverPlanDeduction"
                    stackId="arrSplit"
                    name="Churn ARR über Plan (abgezogen)"
                    fill="#991B1B"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="netForecast" 
                    name="Forecast NET ARR"
                    stroke="#F59E0B" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="netTarget" 
                    name="Goal NET ARR"
                    stroke="#FACC15" 
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

          </div>
        )}

        {/* New Sales Pipe */}
        {reportCategory === 'new_sales_arr' && reportType === 'salespipe' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800">New Sales Pipe</h3>
              <p className="text-sm text-gray-500 mt-1">
                Kombinierte Journey aus Leads-Import, Sales-Import und Sign-up/Go-Live-Matches über OAK ID.
              </p>
            </div>

            {salespipeLoading ? (
              <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
                Lade Sales Pipe Daten...
              </div>
            ) : (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSalespipeOverviewExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
                  >
                    <span className="text-sm font-semibold text-gray-700">Sales-Pipe Übersicht</span>
                    <span className="text-sm text-gray-500">{salespipeOverviewExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
                  </button>
                  {salespipeOverviewExpanded && (
                    <div className="p-4 pt-3 border-t border-gray-200 space-y-4">
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
                        <div className="bg-white rounded-lg shadow-sm p-3 md:p-4">
                          <span className="text-xs text-gray-500">Open Pipeline</span>
                          <p className="text-lg md:text-2xl font-bold text-indigo-700">{salespipeKpis.openRows}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-sm p-3 md:p-4">
                          <span className="text-xs text-gray-500">Open Pipeline ARR</span>
                          <p className="text-lg md:text-2xl font-bold text-blue-700">{formatCurrency(salespipeKpis.totalPipelineArr)}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-sm p-3 md:p-4">
                          <span className="text-xs text-gray-500">Weighted ARR</span>
                          <p className="text-lg md:text-2xl font-bold text-emerald-700">{formatCurrency(salespipeKpis.weightedArr)}</p>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">Probability Stages (Open Pipeline)</h4>
                          <span className="text-xs text-gray-500">aus gemergten Daten, inkl. SalesImport2</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                          {probabilityBuckets.map((bucket) => (
                            <button
                              key={bucket.key}
                              type="button"
                              onClick={() =>
                                setSelectedProbabilityBucketKey((prev) => (prev === bucket.key ? null : bucket.key))
                              }
                              className={`rounded-lg border p-3 text-left transition ${
                                selectedProbabilityBucketKey === bucket.key
                                  ? 'border-indigo-300 bg-indigo-50'
                                  : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-medium text-gray-600">{bucket.label}</div>
                                <div className="text-[10px] text-gray-500">
                                  {selectedProbabilityBucketKey === bucket.key ? 'Ausblenden ▴' : 'Details ▾'}
                                </div>
                              </div>
                              <div className="text-lg font-bold text-gray-800">{bucket.count}</div>
                              <div className="text-xs text-gray-500">{formatCurrency(bucket.arr)}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {selectedProbabilityBucketKey && (
                        <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
                          <div className="px-4 py-3 border-b border-indigo-200 bg-indigo-50 flex items-center justify-between">
                            <div>
                              <h4 className="text-sm font-semibold text-indigo-800">
                                Opportunity-Details – Probability{' '}
                                {PROBABILITY_BUCKET_DEFS.find((bucket) => bucket.key === selectedProbabilityBucketKey)?.label}
                              </h4>
                              <p className="text-xs text-indigo-700">
                                {selectedProbabilityBucketRows.length} Opportunities ·{' '}
                                {formatCurrency(
                                  selectedProbabilityBucketRows.reduce((sum, item) => sum + item.row.weightedArr, 0)
                                )}{' '}
                                Weighted ARR
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedProbabilityBucketKey(null)}
                              className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                            >
                              Schließen
                            </button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[980px] text-xs">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-2 py-2 text-center font-semibold text-gray-600">Aktiv</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Datensatz</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Stage</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Owner</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Leadsource</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">ARR</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Probability</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Weighted ARR</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Angelegt am</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Schlusstermin</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Tage bis Schlusstermin</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedProbabilityBucketRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={11} className="px-2 py-6 text-center text-gray-500">
                                      Keine Opportunities für diese Probability-Stage in der aktuellen Filterung.
                                    </td>
                                  </tr>
                                ) : (
                                  selectedProbabilityBucketRows.map((item) => {
                                    const row = item.row;
                                    const rowDisabled = isPipelineRowDisabled(row);
                                    const daysUntilClose = calculateDaysUntil(row.closeDate);
                                    const stageCfg =
                                      PIPELINE_STAGE_CONFIG.find((cfg) => cfg.key === row.stageKey) || PIPELINE_STAGE_CONFIG[0];
                                    return (
                                      <tr
                                        key={`prob-detail-${row.id}`}
                                        className={`border-b last:border-b-0 ${rowDisabled ? 'bg-gray-100/70 text-gray-400' : ''}`}
                                      >
                                        <td className="px-2 py-1.5 text-center">
                                          <input
                                            type="checkbox"
                                            checked={!rowDisabled}
                                            onChange={() => togglePipelineRowDisabled(row)}
                                            className="h-4 w-4 accent-indigo-600"
                                            title="Datensatz aktiv/inaktiv"
                                          />
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <div className="font-medium text-gray-800">
                                            {row.opportunityId ? (
                                              <a
                                                href={buildSalesforceOpportunityUrl(row.opportunityId) || '#'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-indigo-700 hover:text-indigo-900 underline"
                                              >
                                                {row.name}
                                              </a>
                                            ) : (
                                              row.name
                                            )}
                                          </div>
                                          <div className="text-[11px] text-gray-500">OAK: {row.oakId ?? '-'}</div>
                                        </td>
                                        <td className="px-2 py-1.5">
                                          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${stageCfg.bg} ${stageCfg.color}`}>
                                            {stageCfg.label}
                                          </span>
                                        </td>
                                        <td className="px-2 py-1.5 text-gray-700">{row.owner || '-'}</td>
                                        <td className="px-2 py-1.5 text-gray-700">{row.leadSource || '-'}</td>
                                        <td className="px-2 py-1.5 text-right text-blue-700">{formatCurrency(row.arr)}</td>
                                        <td className="px-2 py-1.5 text-right text-gray-700">
                                          {row.probability === null ? '-' : `${(row.probability * 100).toFixed(0)}%`}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-emerald-700">{formatCurrency(row.weightedArr)}</td>
                                        <td className="px-2 py-1.5 text-gray-700">
                                          {row.filterDate ? new Date(row.filterDate).toLocaleDateString('de-DE') : '-'}
                                        </td>
                                        <td className="px-2 py-1.5 text-gray-700">
                                          {row.closeDate ? new Date(row.closeDate).toLocaleDateString('de-DE') : '-'}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-gray-700">
                                          {daysUntilClose === null ? '-' : daysUntilClose}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2">
                        {PIPELINE_STAGE_CONFIG_VISIBLE.map((stage) => (
                          <div key={stage.key} className={`rounded-lg border p-3 ${stage.bg}`}>
                            <div className={`text-xs font-medium ${stage.color}`}>{stage.label}</div>
                            <div className="text-lg font-bold text-gray-800">{salespipeStageSummary[stage.key].count}</div>
                            <div className="text-xs text-gray-500">{formatCurrency(salespipeStageSummary[stage.key].arr)}</div>
                          </div>
                        ))}
                        <div className="rounded-lg border p-3 bg-emerald-50">
                          <div className="text-xs font-medium text-emerald-700">Winrate</div>
                          <div className="text-lg font-bold text-gray-800">
                            {salespipeWinRate === null ? '-' : `${(salespipeWinRate * 100).toFixed(1)}%`}
                          </div>
                          <div className="text-xs text-gray-500">
                            Close Won / (Close Won + Close Lost)
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-rose-50">
                          <div className="text-xs font-medium text-rose-700">Lost Rate</div>
                          <div className="text-lg font-bold text-gray-800">
                            {salespipeLostRate === null ? '-' : `${(salespipeLostRate * 100).toFixed(1)}%`}
                          </div>
                          <div className="text-xs text-gray-500">
                            Close Lost / (Close Won + Close Lost)
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-fuchsia-50">
                          <div className="text-xs font-medium text-fuchsia-700">Converted Rate</div>
                          <div className="text-lg font-bold text-gray-800">
                            {convertedRate === null ? '-' : `${(convertedRate * 100).toFixed(1)}%`}
                          </div>
                          <div className="text-xs text-gray-500">
                            Converted / (Converted + Not converted)
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-slate-50">
                          <div className="text-xs font-medium text-slate-700">Not converted Rate</div>
                          <div className="text-lg font-bold text-gray-800">
                            {notConvertedRate === null ? '-' : `${(notConvertedRate * 100).toFixed(1)}%`}
                          </div>
                          <div className="text-xs text-gray-500">
                            Not converted / (Converted + Not converted)
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-violet-50 lg:col-span-2">
                          <div className="text-xs font-medium text-violet-700">
                            Ø Sales Cycle Length
                          </div>
                          <div className="text-lg font-bold text-gray-800">
                            {convertedToCloseWonCycleStats
                              ? `${convertedToCloseWonCycleStats.averageDays.toFixed(1)} Tage`
                              : '-'}
                          </div>
                          <div className="text-xs text-gray-500">
                            Converted → Close Won (Opportunity-ID), Median:{' '}
                            {convertedToCloseWonCycleStats
                              ? `${convertedToCloseWonCycleStats.medianDays.toFixed(1)} Tage`
                              : '-'}
                            {' '}| N={convertedToCloseWonCycleStats?.samples ?? 0}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-cyan-50 lg:col-span-2">
                          <div className="text-xs font-medium text-cyan-700">
                            Ø Close Won → Go-Live
                          </div>
                          <div className="text-lg font-bold text-gray-800">
                            {closeWonToGoLiveCycleStats
                              ? `${closeWonToGoLiveCycleStats.averageDays.toFixed(1)} Tage`
                              : '-'}
                          </div>
                          <div className="text-xs text-gray-500">
                            OAK Match, Median:{' '}
                            {closeWonToGoLiveCycleStats
                              ? `${closeWonToGoLiveCycleStats.medianDays.toFixed(1)} Tage`
                              : '-'}
                            {' '}| N={closeWonToGoLiveCycleStats?.samples ?? 0}
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                        <div className="space-y-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <input
                              type="text"
                              value={salespipeSearch}
                              onChange={(e) => setSalespipeSearch(e.target.value)}
                              placeholder="Suche nach Opportunity, Owner, OAK oder Signup..."
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none md:max-w-md"
                            />
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Quelle</span>
                              <select
                                value={salespipeSourceFilter}
                                onChange={(e) => setSalespipeSourceFilter(e.target.value as PipelineSourceFilter)}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              >
                                <option value="all">Alle Quellen</option>
                                <option value="salespipe2_only">Nur SalesImport2</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Stage</span>
                              <select
                                value={salespipeStageFilter}
                                onChange={(e) => setSalespipeStageFilter(e.target.value as PipelineStageKey | 'all')}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              >
                                <option value="all">Alle</option>
                                {PIPELINE_STAGE_CONFIG_VISIBLE.map((stage) => (
                                  <option key={stage.key} value={stage.key}>{stage.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 md:flex-row md:items-center">
                            <span className="text-xs text-gray-500 md:w-28">Zeitraum</span>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="date"
                                value={salespipeDateFromInput}
                                onChange={(e) => setSalespipeDateFromInput(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              />
                              <span className="text-xs text-gray-500">bis</span>
                              <input
                                type="date"
                                value={salespipeDateToInput}
                                onChange={(e) => setSalespipeDateToInput(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              />
                              <button
                                type="button"
                                onClick={applySalespipeDateFilter}
                                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                              >
                                Anwenden
                              </button>
                              <button
                                type="button"
                                onClick={resetSalespipeDateFilter}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Zurücksetzen
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 md:flex-row md:items-center">
                            <span className="text-xs text-gray-500 md:w-28">Relativ ab heute</span>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={salespipeRelativeDaysInput}
                                onChange={(e) => setSalespipeRelativeDaysInput(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              >
                                <option value="none">Kein relativer Filter</option>
                                <option value="7">Letzte 7 Tage</option>
                                <option value="30">Letzte 30 Tage</option>
                                <option value="60">Letzte 60 Tage</option>
                                <option value="90">Letzte 90 Tage</option>
                                <option value="180">Letzte 180 Tage</option>
                              </select>
                              <span className="text-xs text-gray-400">mit „Anwenden“ aktivieren (optional zusätzlich zum Zeitraum)</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 md:flex-row md:items-center">
                            <span className="text-xs text-gray-500 md:w-28">Schnellfilter</span>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => applySalespipeQuickPreset('today')}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Heute
                              </button>
                              <button
                                type="button"
                                onClick={() => applySalespipeQuickPreset('this_week')}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Diese Woche
                              </button>
                              <button
                                type="button"
                                onClick={() => applySalespipeQuickPreset('this_month')}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Dieser Monat
                              </button>
                              <button
                                type="button"
                                onClick={() => applySalespipeQuickPreset('ytd')}
                                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                YTD
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-gray-500">
                            Zeitraum:{' '}
                            {salespipeDateFrom || salespipeDateTo
                              ? `${salespipeDateFrom || '...'} bis ${salespipeDateTo || '...'}`
                              : `gesamtes Jahr ${selectedYear}`}
                            {' · '}
                            Relativ:{' '}
                            {salespipeRelativeDays !== null ? `letzte ${salespipeRelativeDays} Tage (ab heute)` : 'aus'}
                            {' '} (Filterdatum je Stage aus Importdatum/Close Date/Signup Date)
                          </p>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSalespipeWhatIfExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-50 transition"
                  >
                    <span className="text-sm font-semibold text-indigo-800">What-if Szenario (Sales Pipe)</span>
                    <span className="text-sm text-indigo-600">{salespipeWhatIfExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
                  </button>
                  {salespipeWhatIfExpanded && (
                    <div className="p-4 pt-3 border-t border-indigo-200 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <label className="text-xs font-medium text-gray-700 block mb-1">
                            Converted Rate (%)
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={whatIfConvertedRatePct}
                            onChange={(e) => setWhatIfConvertedRatePct(Number(e.target.value) || 0)}
                            className="w-full accent-indigo-600"
                          />
                          <div className="text-xs text-gray-700 mt-1">
                            Szenario: {whatIfConvertedRatePct.toFixed(1)}%
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Basis: {(whatIfScenario.convertedRateBase * 100).toFixed(1)}% → Szenario: {(whatIfScenario.convertedRateWhatIf * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <label className="text-xs font-medium text-gray-700 block mb-1">
                            Winrate (%)
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={whatIfWinRatePct}
                            onChange={(e) => setWhatIfWinRatePct(Number(e.target.value) || 0)}
                            className="w-full accent-emerald-600"
                          />
                          <div className="text-xs text-gray-700 mt-1">
                            Szenario: {whatIfWinRatePct.toFixed(1)}%
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Basis: {(whatIfScenario.winRateBase * 100).toFixed(1)}% → Szenario: {(whatIfScenario.winRateWhatIf * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                        <div className="rounded-lg border p-3 bg-blue-50">
                          <div className="text-xs text-blue-700">SQL (fix)</div>
                          <div className="text-lg font-bold text-gray-800">{whatIfScenario.sqlCount}</div>
                        </div>
                        <div className="rounded-lg border p-3 bg-fuchsia-50">
                          <div className="text-xs text-fuchsia-700">Converted</div>
                          <div className="text-lg font-bold text-gray-800">
                            {whatIfScenario.convertedCountWhatIf}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {whatIfScenario.convertedCountBase})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-slate-50">
                          <div className="text-xs text-slate-700">Not converted</div>
                          <div className="text-lg font-bold text-gray-800">
                            {whatIfScenario.notConvertedCountWhatIf}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {whatIfScenario.notConvertedCountBase})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-emerald-50">
                          <div className="text-xs text-emerald-700">Close Won</div>
                          <div className="text-lg font-bold text-gray-800">
                            {whatIfScenario.closeWonCountWhatIf}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {whatIfScenario.closeWonCountBase})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-rose-50">
                          <div className="text-xs text-rose-700">Close Lost</div>
                          <div className="text-lg font-bold text-gray-800">
                            {whatIfScenario.closeLostCountWhatIf}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {whatIfScenario.closeLostCountBase})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-indigo-50">
                          <div className="text-xs text-indigo-700">Weighted Pipeline ARR</div>
                          <div className="text-lg font-bold text-gray-800">
                            {formatCurrency(whatIfScenario.openPipelineArrWhatIf)}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {formatCurrency(whatIfScenario.openPipelineArrBase)})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-teal-50">
                          <div className="text-xs text-teal-700">Close Won ARR</div>
                          <div className="text-lg font-bold text-gray-800">
                            {formatCurrency(whatIfScenario.closeWonArrWhatIf)}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {formatCurrency(whatIfScenario.closeWonArrBase)})</span>
                          </div>
                        </div>
                        <div className="rounded-lg border p-3 bg-orange-50">
                          <div className="text-xs text-orange-700">Close Lost ARR</div>
                          <div className="text-lg font-bold text-gray-800">
                            {formatCurrency(whatIfScenario.closeLostArrWhatIf)}
                            <span className="text-xs font-normal text-gray-500 ml-1">(aktuell {formatCurrency(whatIfScenario.closeLostArrBase)})</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setSalespipeWhatIfDatasetExpanded((prev) => !prev)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-50 transition"
                        >
                          <span className="text-sm font-semibold text-indigo-800">Datensätze (What-if Grundlage)</span>
                          <span className="text-sm text-indigo-600">
                            {salespipeWhatIfDatasetExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}
                          </span>
                        </button>
                        {salespipeWhatIfDatasetExpanded && (
                          <div className="border-t border-indigo-200 overflow-x-auto">
                            <table className="w-full min-w-[1280px] text-xs">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-2 py-2 text-center font-semibold text-gray-600">Aktiv</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Datensatz</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Stage</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Tage</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Owner</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Leadsource</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">ARR</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Probability</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Weighted ARR</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Angelegt am</th>
                                  <th className="px-2 py-2 text-left font-semibold text-gray-600">Schlusstermin</th>
                                  <th className="px-2 py-2 text-right font-semibold text-gray-600">Tage bis Schlusstermin</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredSalespipeRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={12} className="px-2 py-6 text-center text-gray-500">
                                      Keine Datensätze für die aktuelle Auswahl.
                                    </td>
                                  </tr>
                                ) : (
                                  filteredSalespipeRows
                                    .slice()
                                    .sort((a, b) => b.arr - a.arr)
                                    .map((row) => {
                                      const stageCfg =
                                        PIPELINE_STAGE_CONFIG.find((cfg) => cfg.key === row.stageKey) || PIPELINE_STAGE_CONFIG[0];
                                      const rowDisabled = isPipelineRowDisabled(row);
                                      const leadToCloseDays = calculateDaysBetween(row.leadCreatedDate, row.closeDate);
                                      const daysUntilClose = calculateDaysUntil(row.closeDate);
                                      return (
                                        <tr
                                          key={`whatif-row-${row.id}`}
                                          className={`border-b last:border-b-0 ${rowDisabled ? 'bg-gray-100/70 text-gray-400' : ''}`}
                                        >
                                          <td className="px-2 py-1.5 text-center">
                                            <input
                                              type="checkbox"
                                              checked={!rowDisabled}
                                              onChange={() => togglePipelineRowDisabled(row)}
                                              className="h-4 w-4 accent-indigo-600"
                                              title="Datensatz aktiv/inaktiv"
                                            />
                                          </td>
                                          <td className="px-2 py-1.5">
                                            <div className="font-medium text-gray-800">{row.name}</div>
                                            <div className="text-[11px] text-gray-500">OAK: {row.oakId ?? '-'}</div>
                                          </td>
                                          <td className="px-2 py-1.5">
                                            <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${stageCfg.bg} ${stageCfg.color}`}>
                                              {stageCfg.label}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1.5 text-right">
                                            {(row.stageKey === 'close_won' || row.stageKey === 'close_lost') && leadToCloseDays !== null
                                              ? `${leadToCloseDays}d`
                                              : '-'}
                                          </td>
                                          <td className="px-2 py-1.5 text-gray-700">{row.owner || '-'}</td>
                                          <td className="px-2 py-1.5 text-gray-700">{row.leadSource || '-'}</td>
                                          <td className="px-2 py-1.5 text-right text-blue-700">{formatCurrency(row.arr)}</td>
                                          <td className="px-2 py-1.5 text-right text-gray-700">
                                            {row.probability === null ? '-' : `${(row.probability * 100).toFixed(0)}%`}
                                          </td>
                                          <td className="px-2 py-1.5 text-right text-emerald-700">{formatCurrency(row.weightedArr)}</td>
                                          <td className="px-2 py-1.5 text-gray-700">
                                            {row.filterDate ? new Date(row.filterDate).toLocaleDateString('de-DE') : '-'}
                                          </td>
                                          <td className="px-2 py-1.5 text-gray-700">
                                            {row.closeDate ? new Date(row.closeDate).toLocaleDateString('de-DE') : '-'}
                                          </td>
                                          <td className="px-2 py-1.5 text-right text-gray-700">
                                            {daysUntilClose === null ? '-' : daysUntilClose}
                                          </td>
                                        </tr>
                                      );
                                    })
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSalespipeDatasetExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition border-b border-gray-200"
                  >
                    <span className="text-sm font-semibold text-gray-700">Datensätze (Sales Pipe)</span>
                    <span className="text-sm text-gray-500">{salespipeDatasetExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
                  </button>
                  {salespipeDatasetExpanded && (
                    <>
                      <div
                        ref={salespipeMainTopScrollRef}
                        onScroll={handleTopScroll}
                        style={{ overflowX: 'scroll', overflowY: 'hidden', height: 10, marginBottom: -1 }}
                      >
                        <div style={{ width: salespipeMainTableMinWidth, height: 1 }} />
                      </div>
                    <div
                      ref={salespipeMainBottomScrollRef}
                      onScroll={handleBottomScroll}
                      style={{ overflowX: 'auto' }}
                      className="pb-2"
                    >
                      <table style={{ minWidth: salespipeMainTableMinWidth }} className="text-xs table-fixed">
                    <colgroup>
                      {salespipeMainColWidths.map((width, idx) => (
                        <col key={`salespipe-col-${idx}`} style={{ width }} />
                      ))}
                    </colgroup>
                    <thead className="bg-gray-50">
                      <tr>
                        {[
                          { label: 'Aktiv', align: 'text-center' },
                          { label: 'Datensatz', align: 'text-left' },
                          { label: 'Stage', align: 'text-left' },
                          { label: 'Tage', align: 'text-right' },
                          { label: 'Owner', align: 'text-left' },
                          { label: 'Leadsource', align: 'text-left' },
                          { label: 'ARR', align: 'text-right' },
                          { label: 'Probability', align: 'text-right' },
                          { label: 'Weighted ARR', align: 'text-right' },
                          { label: 'Match', align: 'text-left' },
                          { label: 'Angelegt am', align: 'text-left' },
                          { label: 'Schlusstermin', align: 'text-left' },
                          { label: 'Tage bis Schlusstermin', align: 'text-right' },
                        ].map((column, index) => (
                          <th
                            key={column.label}
                            className={`relative px-2 py-2 font-semibold text-gray-600 ${column.align}`}
                          >
                            {column.label}
                            <span
                              onMouseDown={(event) => startResizeSalespipeColumn(index, event)}
                              className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-100"
                              title="Spalte ziehen zum Anpassen"
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSalespipeRows.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="px-2 py-8 text-center text-gray-500">
                            Keine Pipeline-Daten für die aktuelle Auswahl.
                          </td>
                        </tr>
                      ) : (
                        filteredSalespipeRows
                          .slice()
                          .sort((a, b) => b.arr - a.arr)
                          .map((row) => {
                            const stageCfg = PIPELINE_STAGE_CONFIG.find((cfg) => cfg.key === row.stageKey) || PIPELINE_STAGE_CONFIG[0];
                            const rowDisabled = isPipelineRowDisabled(row);
                            const leadToCloseDays = calculateDaysBetween(row.leadCreatedDate, row.closeDate);
                            const daysUntilClose = calculateDaysUntil(row.closeDate);
                            return (
                              <tr
                                key={row.id}
                                className={`border-b last:border-b-0 ${rowDisabled ? 'bg-gray-100/70 text-gray-400' : ''}`}
                              >
                                <td className="px-2 py-1.5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={!rowDisabled}
                                    onChange={() => togglePipelineRowDisabled(row)}
                                    className="h-4 w-4 accent-indigo-600"
                                    title="Datensatz aktiv/inaktiv"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <div className="font-medium text-gray-800">
                                    {row.opportunityId ? (
                                      <a
                                        href={buildSalesforceOpportunityUrl(row.opportunityId) || '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-700 hover:text-indigo-900 underline"
                                      >
                                        {row.name}
                                      </a>
                                    ) : (
                                      row.name
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500">OAK: {row.oakId ?? '-'}</div>
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${stageCfg.bg} ${stageCfg.color}`}>
                                    {stageCfg.label}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {(row.stageKey === 'close_won' || row.stageKey === 'close_lost') && leadToCloseDays !== null ? (
                                    <span className={`font-medium ${row.stageKey === 'close_won' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                      {leadToCloseDays}d
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-gray-700">{row.owner || '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{row.leadSource || '-'}</td>
                                <td className="px-2 py-1.5 text-right text-blue-700">{formatCurrency(row.arr)}</td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {row.probability === null ? '-' : `${(row.probability * 100).toFixed(0)}%`}
                                </td>
                                <td className="px-2 py-1.5 text-right text-emerald-700">{formatCurrency(row.weightedArr)}</td>
                                <td className="px-2 py-1.5 text-gray-700">
                                  {row.matchedSignupName || '-'}
                                </td>
                                <td className="px-2 py-1.5 text-gray-700">
                                  {row.filterDate ? new Date(row.filterDate).toLocaleDateString('de-DE') : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-gray-700">
                                  {row.closeDate ? new Date(row.closeDate).toLocaleDateString('de-DE') : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {daysUntilClose === null ? '-' : daysUntilClose}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                      </table>
                    </div>
                    </>
                  )}
                </div>

                <div style={{ overflowX: 'auto', width: '100%' }} className="bg-white rounded-xl shadow-sm border border-rose-200 pb-2">
                  <button
                    type="button"
                    onClick={() => setOverdueOpportunitiesExpanded((prev) => !prev)}
                    className="w-full px-4 py-3 border-b border-rose-200 bg-rose-50 flex items-center justify-between text-left hover:bg-rose-100 transition"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-rose-800">Überfällige Opportunities (nach Probability-Stage-Regeln)</h4>
                      <p className="text-xs text-rose-700">
                        Nur offene Opportunities (ohne SQL). Direktlink öffnet den Salesforce-Datensatz.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                        {overdueOpportunities.length} überfällig
                      </span>
                      <span className="text-xs text-rose-700">
                        {overdueOpportunitiesExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}
                      </span>
                    </div>
                  </button>
                  {overdueOpportunitiesExpanded && (
                  <table style={{ minWidth: 1120 }} className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">Opportunity</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">Stage</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600">Probability</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600">Alter (Tage)</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600">Max bis Close</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600">Überfällig</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600">ARR</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">Owner</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">Schlusstermin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdueOpportunities.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-2 py-8 text-center text-gray-500">
                            Keine überfälligen Opportunities für die aktuelle Auswahl.
                          </td>
                        </tr>
                      ) : (
                        overdueOpportunities.map((entry) => {
                          const stageCfg =
                            PIPELINE_STAGE_CONFIG.find((cfg) => cfg.key === entry.row.stageKey) || PIPELINE_STAGE_CONFIG[0];
                          const sfUrl = buildSalesforceOpportunityUrl(entry.row.opportunityId);
                          return (
                            <tr key={`overdue-${entry.row.id}`} className="border-b last:border-b-0">
                              <td className="px-2 py-1.5">
                                <div className="font-medium text-gray-800">
                                  {sfUrl ? (
                                    <a
                                      href={sfUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-indigo-700 hover:text-indigo-900 underline"
                                    >
                                      {entry.row.name}
                                    </a>
                                  ) : (
                                    entry.row.name
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">ID: {entry.row.opportunityId || '-'}</div>
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${stageCfg.bg} ${stageCfg.color}`}>
                                  {stageCfg.label}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right text-gray-700">
                                {entry.row.probability === null ? '-' : `${(entry.row.probability * 100).toFixed(0)}%`}
                              </td>
                              <td className="px-2 py-1.5 text-right text-gray-700">{entry.ageDays}</td>
                              <td className="px-2 py-1.5 text-right text-gray-700">{entry.limitDays}</td>
                              <td className="px-2 py-1.5 text-right font-semibold text-rose-700">{entry.overdueDays}</td>
                              <td className="px-2 py-1.5 text-right text-blue-700">{formatCurrency(entry.row.arr)}</td>
                              <td className="px-2 py-1.5 text-gray-700">{entry.row.owner || '-'}</td>
                              <td className="px-2 py-1.5 text-gray-700">
                                {entry.row.closeDate ? new Date(entry.row.closeDate).toLocaleDateString('de-DE') : '-'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* YTD Summary – wie Jahresübersicht, basierend auf zentralen DLT-Settings (ohne Provision) */}
        {reportCategory === 'new_sales_arr' && reportType === 'ytd' && (
          <div className="space-y-6">
            <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setYtdKpiSectionExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
              >
                <span className="text-sm font-semibold text-gray-700">YTD KPI-Bereich</span>
                <span className="text-sm text-gray-500">{ytdKpiSectionExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
              </button>
              {ytdKpiSectionExpanded && (
                <div className="p-4 pt-3 border-t border-gray-200 space-y-4">
                  {/*
                    Bill-KPIs basieren auf den aktuell ausgewählten Monaten.
                    Monthly Pay Bill = Summe Pay ARR / Summe Go-Lives (über alle ausgewählten Monate).
                  */}
                  {(() => {
                    const monthlySubsBill = selectedBillMetrics?.subsBill ?? 0;
                    const monthlyPayBill = selectedBillMetrics?.payBill ?? 0;
                    const monthlyAllInBill = selectedBillMetrics?.allInBill ?? 0;
                    const hasBillMetrics = !!selectedBillMetrics;
                    return (
                      <>
            {/* Reihe 1: Basis-KPIs (wie Jahresübersicht) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500">Go-Lives</span>
                <p className="text-lg md:text-2xl font-bold text-gray-800">{ytdSummary.totalGoLives}</p>
                <p className="text-xs text-gray-500 mt-1">{t('dlt.kpi.target')}: {ytdSummary.totalGoLivesTarget}</p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500">{t('yearOverview.terminals')}</span>
                <p className="text-lg md:text-2xl font-bold text-gray-800">{ytdSummary.totalTerminals}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {selectedTerminalsTarget !== null ? selectedTerminalsTarget : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlySubsBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-green-600">
                  {hasBillMetrics ? formatCurrency(monthlySubsBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.subsBillTarget) : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyPayBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-orange-600">
                  {hasBillMetrics ? formatCurrency(monthlyPayBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.payBillTarget) : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 col-span-2 sm:col-span-1">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyAllInBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-blue-600">
                  {hasBillMetrics ? formatCurrency(monthlyAllInBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.allInBillTarget) : '–'}
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-500 -mt-2 space-y-1">
              <p>{t('dlt.reports.ytdBillKpiBasis')}</p>
              <p>{t('dlt.reports.ytdBillKpiPayTargetNote')}</p>
            </div>

                <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border border-gray-200">
                  <div className="text-xs md:text-sm text-gray-600 mb-2">
                    Berücksichtigte Monate (YTD):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleYtdMonths.map((monthNum) => (
                      <button
                        key={monthNum}
                        type="button"
                        onClick={() => handleToggleYtdMonth(monthNum)}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border transition ${
                          selectedYtdMonths.includes(monthNum)
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {MONTH_NAMES_SHORT[monthNum - 1]}
                      </button>
                    ))}
                  </div>
                </div>

            {/* Reihe 2: ARR YTD vs Ziel mit Fortschrittsbalken */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-green-500">
                <span className="text-xs md:text-sm text-gray-500">Subs ARR YTD vs Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-green-600">
                  {formatCurrency(ytdSummary.totalSubsARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-green-400">{formatCurrency(ytdSummary.totalSubsTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(ytdSummary.totalSubsTarget > 0 ? (ytdSummary.totalSubsARR / ytdSummary.totalSubsTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {ytdSummary.totalSubsTarget > 0 ? ((ytdSummary.totalSubsARR / ytdSummary.totalSubsTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-orange-500">
                <span className="text-xs md:text-sm text-gray-500">Pay ARR YTD vs Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-orange-600">
                  {formatCurrency(ytdSummary.totalPayARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-orange-400">{formatCurrency(ytdSummary.totalPayTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(ytdSummary.totalPayTarget > 0 ? (ytdSummary.totalPayARR / ytdSummary.totalPayTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {ytdSummary.totalPayTarget > 0 ? ((ytdSummary.totalPayARR / ytdSummary.totalPayTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-blue-500">
                <span className="text-xs md:text-sm text-gray-500">All-in ARR YTD minus Churn vs NET ARR Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-blue-600">
                  {formatCurrency(netArrGoals.ytdNetActual)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-blue-400">{formatCurrency(netArrGoals.netGoalYtd)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(Math.max(netArrGoals.ytdPct * 100, 0), 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {netArrGoals.netGoalYtd > 0 ? (netArrGoals.ytdPct * 100).toFixed(1) : 0}% {t('yearOverview.achieved')} · Plan-Churn (Invoiced): {formatCurrency(selectedInvoicedChurnTargetArr)}
                </p>
              </div>
            </div>

            {/* Reihe 3: ARR YTD vs Jahresziel */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-green-500">
                <span className="text-xs md:text-sm text-gray-500">Subs ARR YTD vs Yearly ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-green-600">
                  {formatCurrency(ytdSummary.totalSubsARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-green-400">{formatCurrency(fullYearTotals.totalSubsTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(fullYearTotals.totalSubsTarget > 0 ? (ytdSummary.totalSubsARR / fullYearTotals.totalSubsTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {fullYearTotals.totalSubsTarget > 0 ? ((ytdSummary.totalSubsARR / fullYearTotals.totalSubsTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-orange-500">
                <span className="text-xs md:text-sm text-gray-500">Pay ARR YTD vs Yearly ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-orange-600">
                  {formatCurrency(ytdSummary.totalPayARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-orange-400">{formatCurrency(fullYearTotals.totalPayTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(fullYearTotals.totalPayTarget > 0 ? (ytdSummary.totalPayARR / fullYearTotals.totalPayTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {fullYearTotals.totalPayTarget > 0 ? ((ytdSummary.totalPayARR / fullYearTotals.totalPayTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-blue-500">
                <span className="text-xs md:text-sm text-gray-500">All-in ARR YTD minus Churn vs Yearly NET ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-blue-600">
                  {formatCurrency(netArrGoals.ytdNetActual)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-blue-400">{formatCurrency(netArrGoals.netGoalYearly)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(Math.max(netArrGoals.yearlyPct * 100, 0), 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {netArrGoals.netGoalYearly > 0 ? (netArrGoals.yearlyPct * 100).toFixed(1) : 0}% {t('yearOverview.achieved')} · Jahres-Plan-Churn (Invoiced): {formatCurrency(yearlyInvoicedChurnTargetArr)}
                </p>
              </div>
            </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Monatliche Übersicht (ohne Provision) */}
            <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setYtdMonthlyOverviewExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition"
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{t('yearOverview.monthlyOverview')}</h3>
                  <p className="text-sm text-gray-500 mt-1">💡 {t('yearOverview.clickForDetails')}</p>
                </div>
                <span className="text-sm text-gray-500">{ytdMonthlyOverviewExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
              </button>
              {ytdMonthlyOverviewExpanded && (
                <div className="overflow-x-auto border-t border-gray-200">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.reports.month')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Go-Lives</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Terminals</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-green-600 uppercase">Subs Plan</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-green-600 uppercase">Subs IST</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-orange-600 uppercase">Pay Plan</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-orange-600 uppercase">Pay IST</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-blue-600 uppercase">Gesamt ARR Brutto Plan</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-blue-700 uppercase">Gesamt ARR Brutto IST</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-indigo-600 uppercase">Gesamt ARR Netto Plan</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-indigo-700 uppercase">Gesamt ARR Netto IST</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {ytdSelectedMonthlyResult.map((r) => {
                        const subsPct = r.subs_target > 0 ? r.subs_actual / r.subs_target : 0;
                        const payPct = r.pay_target > 0 ? r.pay_actual / r.pay_target : 0;
                        const totalBruttoPlan = r.subs_target + r.pay_target;
                        const totalBruttoActual = r.subs_actual + r.pay_actual;
                        const totalBruttoPct = totalBruttoPlan > 0 ? totalBruttoActual / totalBruttoPlan : 0;
                        const totalArrLost = monthlyChurnData.find((row) => row.month === r.month)?.totalArrLost || 0;
                        const monthlyChurnTarget = invoicedChurnTargetArrByMonth[r.month - 1] || 0;
                        const totalNettoPlan = totalBruttoPlan - monthlyChurnTarget;
                        const totalNettoActual = totalBruttoActual - totalArrLost;
                        const totalNettoPct = totalNettoPlan > 0 ? totalNettoActual / totalNettoPlan : 0;
                        const isPast = (r.month - 1) <= currentMonth;
                        return (
                          <tr
                            key={r.month}
                            className={`transition ${isPast ? 'cursor-pointer hover:bg-blue-50' : 'text-gray-400 cursor-pointer hover:bg-gray-50'}`}
                            onClick={() => setSelectedMonthDetail(r.month)}
                          >
                            <td className="px-4 py-3 font-medium">{MONTH_NAMES[r.month - 1]}</td>
                            <td className="px-4 py-3 text-right">{r.go_lives_count}</td>
                            <td className="px-4 py-3 text-right">{r.terminals_count}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(r.subs_target)}</td>
                            <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(r.subs_actual)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(subsPct)}`}>{formatPercent(subsPct)}</td>
                            <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(r.pay_target)}</td>
                            <td className="px-4 py-3 text-right text-orange-700 font-medium">{formatCurrency(r.pay_actual)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(payPct)}`}>{formatPercent(payPct)}</td>
                            <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(totalBruttoPlan)}</td>
                            <td className="px-4 py-3 text-right text-blue-700 font-medium">{formatCurrency(totalBruttoActual)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(totalBruttoPct)}`}>{formatPercent(totalBruttoPct)}</td>
                            <td className="px-4 py-3 text-right text-indigo-600">{formatCurrency(totalNettoPlan)}</td>
                            <td className="px-4 py-3 text-right text-indigo-700 font-medium">{formatCurrency(totalNettoActual)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(totalNettoPct)}`}>{formatPercent(totalNettoPct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td className="px-4 py-3">{t('dlt.reports.total')}</td>
                        <td className="px-4 py-3 text-right">{ytdSelectedTotals.totalGoLives}</td>
                        <td className="px-4 py-3 text-right">{ytdSelectedTotals.totalTerminals}</td>
                        <td className="px-4 py-3 text-right text-green-600">{formatCurrency(ytdSelectedTotals.totalSubsTarget)}</td>
                        <td className="px-4 py-3 text-right text-green-700">{formatCurrency(ytdSelectedTotals.totalSubsARR)}</td>
                        <td className={`px-4 py-3 text-right ${getAchievementColor(ytdSelectedTotals.totalSubsTarget > 0 ? ytdSelectedTotals.totalSubsARR / ytdSelectedTotals.totalSubsTarget : 0)}`}>
                          {formatPercent(ytdSelectedTotals.totalSubsTarget > 0 ? ytdSelectedTotals.totalSubsARR / ytdSelectedTotals.totalSubsTarget : 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(ytdSelectedTotals.totalPayTarget)}</td>
                        <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(ytdSelectedTotals.totalPayARR)}</td>
                        <td className={`px-4 py-3 text-right ${getAchievementColor(ytdSelectedTotals.totalPayTarget > 0 ? ytdSelectedTotals.totalPayARR / ytdSelectedTotals.totalPayTarget : 0)}`}>
                          {formatPercent(ytdSelectedTotals.totalPayTarget > 0 ? ytdSelectedTotals.totalPayARR / ytdSelectedTotals.totalPayTarget : 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget)}</td>
                        <td className="px-4 py-3 text-right text-blue-700">{formatCurrency(ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR)}</td>
                        <td className={`px-4 py-3 text-right ${getAchievementColor((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) > 0 ? (ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) / (ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) : 0)}`}>
                          {formatPercent((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) > 0 ? (ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) / (ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) : 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-indigo-600">
                          {formatCurrency((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) - selectedInvoicedChurnTargetArr)}
                        </td>
                        <td className="px-4 py-3 text-right text-indigo-700">
                          {formatCurrency((ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) - selectedChurnTotals.totalArrLost)}
                        </td>
                        <td className={`px-4 py-3 text-right ${getAchievementColor(((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) - selectedInvoicedChurnTargetArr) > 0 ? ((ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) - selectedChurnTotals.totalArrLost) / ((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) - selectedInvoicedChurnTargetArr) : 0)}`}>
                          {formatPercent(((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) - selectedInvoicedChurnTargetArr) > 0 ? ((ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) - selectedChurnTotals.totalArrLost) / ((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) - selectedInvoicedChurnTargetArr) : 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setYtdChurnOverviewExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition"
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Churn pro Monat</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Scheduled und Non-Scheduled Churn im gleichen Monatsraster wie die Go-Live-Übersicht.
                  </p>
                  <p className="text-sm text-gray-500 mt-1">💡 Zeile anklicken für Churn-Details</p>
                </div>
                <span className="text-sm text-gray-500">{ytdChurnOverviewExpanded ? 'Ausblenden ▴' : 'Einblenden ▾'}</span>
              </button>
              {ytdChurnOverviewExpanded && (
                <div className="overflow-x-auto border-t border-gray-200">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.reports.month')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-amber-700 uppercase">Scheduled Churns</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-amber-700 uppercase">Scheduled Churn ARR</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-rose-700 uppercase">Churns</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-rose-700 uppercase">Churn ARR Lost</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase">Total Churn</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-red-700 uppercase">Total ARR Lost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {selectedMonthlyChurnData.map((row) => {
                        const hasData = row.totalCount > 0;
                        return (
                          <tr
                            key={`churn-${row.month}`}
                            className={`transition cursor-pointer ${hasData ? 'hover:bg-rose-50' : 'text-gray-400 hover:bg-gray-50'}`}
                            onClick={() => setSelectedChurnMonthDetail(row.month)}
                          >
                            <td className="px-4 py-3 font-medium">{MONTH_NAMES[row.month - 1]}</td>
                            <td className="px-4 py-3 text-right text-amber-700">{row.scheduledCount}</td>
                            <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(row.scheduledArrLost)}</td>
                            <td className="px-4 py-3 text-right text-rose-700">{row.nonScheduledCount}</td>
                            <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(row.nonScheduledArrLost)}</td>
                            <td className="px-4 py-3 text-right">{row.totalCount}</td>
                            <td className="px-4 py-3 text-right font-semibold text-red-700">{formatCurrency(row.totalArrLost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td className="px-4 py-3">{t('dlt.reports.total')}</td>
                        <td className="px-4 py-3 text-right text-amber-700">{selectedChurnTotals.scheduledCount}</td>
                        <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(selectedChurnTotals.scheduledArrLost)}</td>
                        <td className="px-4 py-3 text-right text-rose-700">{selectedChurnTotals.nonScheduledCount}</td>
                        <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(selectedChurnTotals.nonScheduledArrLost)}</td>
                        <td className="px-4 py-3 text-right">{selectedChurnTotals.totalCount}</td>
                        <td className="px-4 py-3 text-right text-red-700">{formatCurrency(selectedChurnTotals.totalArrLost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {reportCategory === 'expanding_arr' && (() => {
          const nrrBasis = planzahlen?.expanding_arr_data?.nrr_basis;
          const arrBasisDec = Number(nrrBasis?.arr_basis_dec) || 0;
          const arrBasisJanEnd = Number(nrrBasis?.arr_basis_jan_end) || 0;
          const hasBasis = arrBasisJanEnd > 0;

          // Hilfsfunktionen
          const getUpDownsell = (monthKey: string) =>
            upDownsellsData.find((r) => r.month === monthKey) ?? { netGrowthArr: 0, netLossArr: 0, netArr: 0 };
          const getSmsMrr = (monthKey: string) =>
            smsData.find((r) => r.month === monthKey)?.mrr ?? null;
          const getPhorestPay = (monthKey: string) =>
            phorestPayData.find((r) => r.month === monthKey)?.dachValue ?? null;

          // Januar = Referenzmonat (automatisch aus Import)
          const janKey = `${selectedYear}-01`;
          const janSmsMrr = getSmsMrr(janKey);
          const janPayValMonthly = getPhorestPay(janKey);
          const janPayVal = janPayValMonthly !== null ? janPayValMonthly * 12 : null;
          const hasJanSmsRef = janSmsMrr !== null;
          const hasJanPayRef = janPayVal !== null;

          // Alle 12 Monate aufbauen
          // Januar: isRef=true (wird angezeigt, aber nicht in NRR gerechnet)
          // Feb–Dez: Delta vs. Januar
          const months = Array.from({ length: 12 }, (_, i) => {
            const monthNum = i + 1;
            const monthKey = `${selectedYear}-${String(monthNum).padStart(2, '0')}`;
            const isRef = monthNum === 1;
            const upDown = getUpDownsell(monthKey);
            const smsMrr = getSmsMrr(monthKey);
            const payValMonthly = getPhorestPay(monthKey);
            // Expanding ARR arbeitet ARR-basiert: Monatswert auf ARR annualisieren.
            const payVal = payValMonthly !== null ? payValMonthly * 12 : null;
            // Delta gegen Januar-Basis (ab Feb); ARR-Betrachtung: MRR × 12
            const smsDelta = !isRef && smsMrr !== null && hasJanSmsRef
              ? (smsMrr - janSmsMrr!) * 12
              : null;
            const payDelta = !isRef && payVal !== null && hasJanPayRef
              ? payVal - janPayVal!
              : null;
            return { monthKey, monthNum, isRef, upDown, smsMrr, payVal, smsDelta, payDelta };
          });

          // Churn: Total ARR Lost (Scheduled + Non-Scheduled), identisch zu „Churn pro Monat“
          const churnByMonth = churnTotalArrLostByMonth;

          // YTD: nur Feb–aktueller Monat (Januar ausgeschlossen)
          const rollingMonths = months.filter((m) => !m.isRef);
          const ytdRollingMonths = rollingMonths.slice(0, Math.max(0, currentMonth)); // currentMonth=0 → Jan, also Feb ist idx 0 in rolling
          const ytdUpDown = ytdRollingMonths.reduce((s, m) => s + m.upDown.netArr, 0);
          const ytdGrowthArr = ytdRollingMonths.filter(m => m.upDown.netGrowthArr > 0).reduce((s, m) => s + m.upDown.netGrowthArr, 0);
          const ytdLossArr = ytdRollingMonths.reduce((s, m) => s + m.upDown.netLossArr, 0);
          const ytdSmsDelta = ytdRollingMonths.reduce((s, m) => s + (m.smsDelta ?? 0), 0);
          const ytdLatestPayMonth = [...ytdRollingMonths].reverse().find((m) => m.payDelta !== null);
          const ytdPayDelta = ytdLatestPayMonth?.payDelta ?? 0;
          const ytdChurn = churnByMonth.slice(1, currentMonth + 1).reduce((s, v) => s + v, 0); // ab Feb
          const ytdNetMovement = ytdUpDown + ytdSmsDelta + ytdPayDelta - ytdChurn;
          const ytdEndArr = arrBasisJanEnd + ytdNetMovement;
          const ytdNrr =
            arrBasisJanEnd > 0 && ytdRollingMonths.length > 0 ? (ytdEndArr / arrBasisJanEnd) * 100 : null;

          // Quartalswerte: Q1 = nur Feb+Mär (Jan = Referenz), Q2–Q4 normal
          const quarters = [
            { label: 'Q1 (Feb–Mär)', monthIdxs: [1, 2] },
            { label: 'Q2', monthIdxs: [3, 4, 5] },
            { label: 'Q3', monthIdxs: [6, 7, 8] },
            { label: 'Q4', monthIdxs: [9, 10, 11] },
          ].map(({ label, monthIdxs }) => {
            const netUpDown = monthIdxs.reduce((s, i) => s + months[i].upDown.netArr, 0);
            const smsDelta = monthIdxs.reduce((s, i) => s + (months[i].smsDelta ?? 0), 0);
            const latestPayMonth = [...monthIdxs].reverse().map((i) => months[i]).find((m) => m.payDelta !== null);
            const payDelta = latestPayMonth?.payDelta ?? 0;
            const churn = monthIdxs.reduce((s, i) => s + churnByMonth[i], 0);
            const net = netUpDown + smsDelta + payDelta - churn;
            return { label, netUpDown, smsDelta, payDelta, churn, net };
          });

          const nrrColor = (v: number | null) => {
            if (v === null) return 'text-gray-400';
            if (v >= 100) return 'text-emerald-600 font-semibold';
            if (v >= 95) return 'text-yellow-600 font-semibold';
            return 'text-red-600 font-semibold';
          };

          return (
            <div className="space-y-6">
              {/* Basiswert-Hinweis */}
              {!hasBasis && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <strong>Berechnungsbasis fehlt:</strong> Bitte trage unter <em>Planzahlen → NRR Basiswerte</em> den <strong>ARR-Stand Ende Januar</strong> des Planjahres ein (Ausgangspunkt für NRR). Der Wert per 31.12. ist nur Referenz.
                </div>
              )}
              {(!hasJanSmsRef || !hasJanPayRef) && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
                  <strong>Hinweis:</strong> {!hasJanSmsRef && 'SMS-Januar-Daten nicht importiert — SMS-Delta nicht berechenbar. '}
                  {!hasJanPayRef && 'Phorest Pay Net Margin (DACH) Januar nicht importiert — Pay-Delta nicht berechenbar. '}
                  Januar dient als automatischer Referenzmonat für SMS- und Pay-Deltas (ersetzt Dezember-Basis).
                </div>
              )}

              {/* KPI-Übersicht */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <div className="rounded-xl bg-white border-2 border-indigo-200 shadow-sm p-4">
                    <div className="text-xs text-gray-500 mb-1">ARR Ende Jan. (Berechnungsbasis)</div>
                    <div className="text-lg font-bold text-gray-800">
                      {arrBasisJanEnd > 0 ? formatCurrency(arrBasisJanEnd) : '—'}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">Fortschreibung ab Feb.</div>
                  </div>
                  <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-3">
                    <div className="text-[11px] text-gray-500 mb-0.5">ARR Referenz 31.12.</div>
                    <div className="text-sm font-semibold text-gray-600">
                      {arrBasisDec > 0 ? formatCurrency(arrBasisDec) : '—'}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">nur Kontext</div>
                  </div>
                </div>
                <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4">
                  <div className="text-xs text-gray-500 mb-1">ARR aktuell (YTD)</div>
                  <div className="text-lg font-bold text-gray-800">
                    {hasBasis && ytdRollingMonths.length > 0 ? formatCurrency(ytdEndArr) : '—'}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">Ende Jan. + Net Movement</div>
                </div>
                <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4">
                  <div className="text-xs text-gray-500 mb-1">YTD Net Movement</div>
                  <div className={`text-lg font-bold ${ytdNetMovement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {hasBasis && ytdRollingMonths.length > 0 ? `${ytdNetMovement >= 0 ? '+' : ''}${formatCurrency(ytdNetMovement)}` : '—'}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">Feb–heute, Expansion − Churn</div>
                </div>
                <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4">
                  <div className="text-xs text-gray-500 mb-1">NRR YTD (ab Feb)</div>
                  <div className={`text-2xl ${nrrColor(ytdNrr)}`}>
                    {ytdNrr !== null ? `${ytdNrr.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">gegen ARR Ende Jan.</div>
                </div>
              </div>

              {/* Kompakte YTD-Pillar-Zusammenfassung */}
              <div className="bg-white rounded-xl shadow-md border-2 border-indigo-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-indigo-100 bg-indigo-50">
                  <h4 className="text-sm font-semibold text-indigo-800">YTD Pillar-Übersicht <span className="text-xs font-normal text-indigo-500 ml-1">(aus der Monatsübersicht, ab Feb)</span></h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-indigo-100 bg-white text-gray-500">
                        <th className="px-4 py-2 text-left font-medium">Zeitraum</th>
                        <th className="px-4 py-2 text-right font-medium">Net Up/Down</th>
                        <th className="px-4 py-2 text-right font-medium">SMS-Delta ARR</th>
                        <th className="px-4 py-2 text-right font-medium">Pay-Delta</th>
                        <th className="px-4 py-2 text-right font-medium">Churn</th>
                        <th className="px-4 py-2 text-right font-medium">Net Movement</th>
                        <th className="px-4 py-2 text-right font-medium">NRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-indigo-50/80 font-semibold">
                        <td className="px-4 py-3 text-gray-700">YTD (ab Feb)</td>
                        <td className={`px-4 py-3 text-right ${ytdUpDown >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {ytdUpDown !== 0 ? `${ytdUpDown >= 0 ? '+' : ''}${formatCurrency(ytdUpDown)}` : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right ${ytdSmsDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {hasJanSmsRef ? `${ytdSmsDelta >= 0 ? '+' : ''}${formatCurrency(ytdSmsDelta)}` : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right ${ytdPayDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {hasJanPayRef ? `${ytdPayDelta >= 0 ? '+' : ''}${formatCurrency(ytdPayDelta)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-red-500">
                          {ytdChurn > 0 ? `−${formatCurrency(ytdChurn)}` : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right ${ytdNetMovement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {hasBasis && ytdRollingMonths.length > 0 ? `${ytdNetMovement >= 0 ? '+' : ''}${formatCurrency(ytdNetMovement)}` : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right ${nrrColor(ytdNrr)}`}>
                          {ytdNrr !== null ? `${ytdNrr.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Quartalssicht */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <h4 className="text-sm font-semibold text-gray-700">Quartalsübersicht NRR <span className="text-xs font-normal text-gray-400 ml-1">(Jan = Referenzmonat, nicht gerechnet)</span></h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                        <th className="px-4 py-2 text-left font-medium">Quartal</th>
                        <th className="px-4 py-2 text-right font-medium">Up-/Downsell netto</th>
                        <th className="px-4 py-2 text-right font-medium">SMS-Delta</th>
                        <th className="px-4 py-2 text-right font-medium">Pay-Delta</th>
                        <th className="px-4 py-2 text-right font-medium">Churn</th>
                        <th className="px-4 py-2 text-right font-medium">Net Movement</th>
                        <th className="px-4 py-2 text-right font-medium">NRR %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarters.map((q) => {
                        const endArr = arrBasisJanEnd > 0 ? arrBasisJanEnd + q.net : null;
                        const qNrr = endArr !== null && arrBasisJanEnd > 0 ? (endArr / arrBasisJanEnd) * 100 : null;
                        return (
                          <tr key={q.label} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 font-semibold text-gray-700">{q.label}</td>
                            <td className={`px-4 py-2 text-right ${q.netUpDown >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {q.netUpDown !== 0 ? `${q.netUpDown >= 0 ? '+' : ''}${formatCurrency(q.netUpDown)}` : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right ${q.smsDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {hasJanSmsRef ? `${q.smsDelta >= 0 ? '+' : ''}${formatCurrency(q.smsDelta)}` : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right ${q.payDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {hasJanPayRef ? `${q.payDelta >= 0 ? '+' : ''}${formatCurrency(q.payDelta)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-red-500">
                              {q.churn > 0 ? `−${formatCurrency(q.churn)}` : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right font-semibold ${q.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {hasBasis ? `${q.net >= 0 ? '+' : ''}${formatCurrency(q.net)}` : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right ${nrrColor(qNrr)}`}>
                              {qNrr !== null ? `${qNrr.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Monatstabelle */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <h4 className="text-sm font-semibold text-gray-700">Monatliche ARR-Bewegung (Pillar-Ansicht)</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                        <th className="px-4 py-2 text-left font-medium w-16">Monat</th>
                        <th className="px-4 py-2 text-right font-medium">Up-Sell</th>
                        <th className="px-4 py-2 text-right font-medium">Down-Sell</th>
                        <th className="px-4 py-2 text-right font-medium">Net Up/Down</th>
                        <th className="px-4 py-2 text-right font-medium">SMS ARR</th>
                        <th className="px-4 py-2 text-right font-medium">SMS-Delta ARR</th>
                        <th className="px-4 py-2 text-right font-medium">Pay Net Margin (DACH, ARR)</th>
                        <th className="px-4 py-2 text-right font-medium">Pay-Delta</th>
                        <th className="px-4 py-2 text-right font-medium">Churn</th>
                        <th className="px-4 py-2 text-right font-medium">Net Movement</th>
                        <th className="px-4 py-2 text-right font-medium">NRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map(({ monthNum, monthKey, isRef, upDown, smsMrr, payVal, smsDelta, payDelta }) => {
                        const churn = churnByMonth[monthNum - 1] ?? 0;
                        const smsDeltaVal = isRef ? 0 : smsDelta ?? 0;
                        const payDeltaVal = isRef ? 0 : payDelta ?? 0;
                        const netMovement = isRef ? 0 : upDown.netArr + smsDeltaVal + payDeltaVal - churn;
                        const endArr =
                          arrBasisJanEnd > 0
                            ? arrBasisJanEnd + netMovement
                            : null;
                        const monthNrr =
                          endArr !== null && arrBasisJanEnd > 0 ? (endArr / arrBasisJanEnd) * 100 : null;
                        const hasData = isRef || upDown.netArr !== 0 || smsMrr !== null || payVal !== null || churn > 0;
                        return (
                          <tr key={monthKey} className={`border-b ${isRef ? 'bg-indigo-50 font-semibold' : !hasData ? 'opacity-40' : 'hover:bg-gray-50'}`}>
                            <td className={`px-4 py-2 ${isRef ? 'font-bold text-indigo-700' : 'font-medium text-gray-700'}`}>
                              {isRef ? 'DELTA Jan.' : MONTH_NAMES_SHORT[monthNum - 1]}
                            </td>
                            <td className="px-4 py-2 text-right text-emerald-600">
                              {!isRef && upDown.netGrowthArr > 0 ? `+${formatCurrency(upDown.netGrowthArr)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-red-500">
                              {!isRef && upDown.netLossArr < 0 ? formatCurrency(upDown.netLossArr) : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right font-medium ${upDown.netArr >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {!isRef && upDown.netArr !== 0 ? `${upDown.netArr >= 0 ? '+' : ''}${formatCurrency(upDown.netArr)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {smsMrr !== null ? formatCurrency(smsMrr * 12) : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right ${smsDelta !== null ? (smsDelta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-gray-400'}`}>
                              {isRef && hasJanSmsRef ? formatCurrency(0) : smsDelta !== null ? `${smsDelta >= 0 ? '+' : ''}${formatCurrency(smsDelta)}` : smsMrr !== null ? '—' : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {payVal !== null ? formatCurrency(payVal) : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right ${payDelta !== null ? (payDelta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-gray-400'}`}>
                              {isRef && hasJanPayRef ? formatCurrency(0) : payDelta !== null ? `${payDelta >= 0 ? '+' : ''}${formatCurrency(payDelta)}` : payVal !== null ? '—' : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-red-500">
                              {!isRef && churn > 0 ? `−${formatCurrency(churn)}` : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right font-semibold ${!hasData ? 'text-gray-300' : netMovement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {hasBasis ? (isRef ? formatCurrency(0) : `${netMovement >= 0 ? '+' : ''}${formatCurrency(netMovement)}`) : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right text-sm ${nrrColor(monthNrr)}`}>
                              {hasData && monthNrr !== null ? `${monthNrr.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                        <td className="px-4 py-2 text-gray-700">YTD (ab Feb)</td>
                        <td className="px-4 py-2 text-right text-emerald-600">
                          {ytdGrowthArr > 0 ? `+${formatCurrency(ytdGrowthArr)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-red-500">
                          {ytdLossArr < 0 ? formatCurrency(ytdLossArr) : '—'}
                        </td>
                        <td className={`px-4 py-2 text-right ${ytdUpDown >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {ytdUpDown !== 0 ? `${ytdUpDown >= 0 ? '+' : ''}${formatCurrency(ytdUpDown)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500">—</td>
                        <td className={`px-4 py-2 text-right ${ytdSmsDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {hasJanSmsRef ? `${ytdSmsDelta >= 0 ? '+' : ''}${formatCurrency(ytdSmsDelta)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500">—</td>
                        <td className={`px-4 py-2 text-right ${ytdPayDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {hasJanPayRef ? `${ytdPayDelta >= 0 ? '+' : ''}${formatCurrency(ytdPayDelta)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-red-500">
                          {ytdChurn > 0 ? `−${formatCurrency(ytdChurn)}` : '—'}
                        </td>
                        <td className={`px-4 py-2 text-right ${ytdNetMovement >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {hasBasis && ytdRollingMonths.length > 0 ? `${ytdNetMovement >= 0 ? '+' : ''}${formatCurrency(ytdNetMovement)}` : '—'}
                        </td>
                        <td className={`px-4 py-2 text-right text-sm ${nrrColor(ytdNrr)}`}>
                          {ytdNrr !== null ? `${ytdNrr.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Legende */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 space-y-1">
                <p><strong>NRR (ARR-basiert):</strong> (ARR Ende Januar + Net Movement) / ARR Ende Januar × 100 — rollierend ab Februar; 31.12.-Referenz nur Anzeige</p>
                <p><strong>Januar = Referenzmonat:</strong> SMS- und Pay-Basiswert werden automatisch aus dem Januar-Import abgeleitet. Januar wird als fette DELTA-Basiszeile angezeigt, fließt aber nicht in NRR/YTD ein.</p>
                <p><strong>SMS ARR:</strong> SMS MRR × 12. <strong>SMS-Delta ARR:</strong> SMS ARR Monat − SMS ARR Januar — {smsData.length > 0 ? `${smsData.length} Monate importiert` : 'keine Daten für dieses Jahr'}{hasJanSmsRef ? `, Januar-Basis: ${formatCurrency(janSmsMrr! * 12)} ARR` : ', Januar-Daten fehlen'}</p>
                <p><strong>Pay-Delta:</strong> Monatswert = (Phorest Pay Net Margin (DACH) Monat × 12) − Januar-Basis; YTD = letzter verfügbarer Pay-ARR-Stand − Januar-Basis (Import: <em>net_margin</em>/<em>margin</em>-CSV aus der Phorest-Pay-ZIP) — {phorestPayData.length > 0 ? `${phorestPayData.length} Monate` : 'keine Daten für dieses Jahr'}{hasJanPayRef ? `, Januar ARR: ${formatCurrency(janPayVal!)}` : ', Januar fehlt'}</p>
                <p><strong>Up-/Downsell:</strong> Aus importierten Up-Downsells Events ({upDownsellsData.length} Einträge für {selectedYear})</p>
                <p><strong>Churn:</strong> Total ARR Lost pro Monat (Scheduled + Non-Scheduled), wie unter „Churn pro Monat“. YTD-Summe ab Februar — ohne Januar, da die Berechnungsbasis ARR Ende Januar den Januar-Churn bereits enthält.</p>
              </div>
            </div>
          );
        })()}

        {reportCategory === 'total_business_arr' && (
          <div className="space-y-4">
            {!totalBusinessReport.hasBeginningArr && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <strong>Beginning ARR fehlt:</strong> Bitte unter <em>Planzahlen → NRR Basiswerte</em> den
                ARR-Stand Ende Januar pflegen. Ohne diesen Startwert bleiben Beginning/Ending ARR und
                Retention-Metriken leer.
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Total Business ARR</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Startbasis ist ARR Ende Januar; die monatliche Fortschreibung beginnt ab Februar.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[360px]">
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <div className="text-indigo-600">Startbasis Ende Jan.</div>
                      <div className="mt-0.5 text-sm font-bold text-slate-800">
                        {totalBusinessReport.arrBasisJanEnd > 0 ? formatCurrency(totalBusinessReport.arrBasisJanEnd) : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="text-gray-500">ARR 31.12. Kontext</div>
                      <div className="mt-0.5 text-sm font-semibold text-gray-700">
                        {totalBusinessReport.arrBasisDec > 0 ? formatCurrency(totalBusinessReport.arrBasisDec) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                ref={totalBusinessTopScrollRef}
                onScroll={handleTotalBusinessTopScroll}
                className="border-b border-gray-100 overflow-x-scroll overflow-y-hidden"
                style={{ height: 14 }}
                aria-label="Total Business ARR horizontal scroll"
              >
                <div className="min-w-[2450px] h-1" />
              </div>
              <div
                ref={totalBusinessBottomScrollRef}
                onScroll={handleTotalBusinessBottomScroll}
                className="max-w-full overflow-x-scroll pb-3"
              >
                <table className="min-w-[2450px] w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="sticky left-0 z-20 w-64 min-w-64 border-r border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold">
                        Metric
                      </th>
                      <th className="border-r border-indigo-200 bg-indigo-50 px-3 py-2 text-center font-semibold text-indigo-700">
                        Startbasis Ende Jan.
                      </th>
                      {MONTH_NAMES.slice(1).map((month) => (
                        <th key={month} colSpan={2} className="border-r border-gray-200 px-3 py-2 text-center font-semibold">
                          {month}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-white text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="sticky left-0 z-20 border-r border-gray-200 bg-white px-3 py-2 text-left font-medium">
                        &nbsp;
                      </th>
                      <th className="min-w-28 border-r border-indigo-200 bg-indigo-50/60 px-2 py-2 text-right font-medium text-indigo-500">
                        Basis
                      </th>
                      {MONTH_NAMES.slice(1).flatMap((month) => [
                        <th key={`${month}-actual`} className="min-w-20 border-r border-gray-100 px-2 py-2 text-right font-medium">
                          Actual
                        </th>,
                        <th key={`${month}-plan`} className="min-w-24 border-r border-gray-200 px-2 py-2 text-right font-medium">
                          Commercial plan
                        </th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {totalBusinessReport.rows.map((row, rowIdx) => {
                      if (row.type === 'section') {
                        return (
                          <tr key={`${row.label}-${rowIdx}`} className="bg-violet-100/70">
                            <td className="sticky left-0 z-10 border-r border-violet-200 bg-violet-100 px-3 py-2 font-bold text-slate-800">
                              {row.label}
                            </td>
                            <td colSpan={23} className="border-r border-violet-200 px-2 py-2" />
                          </tr>
                        );
                      }

                      const formatTotalBusinessCell = (value: number | null) => {
                        if (value === null || value === undefined || !Number.isFinite(value)) return '—';
                        if (row.format === 'currency') return formatCurrency(value);
                        if (row.format === 'percent') return `${(value * 100).toFixed(1)}%`;
                        return Math.round(value).toLocaleString('de-DE');
                      };

                      const startBasisValue =
                        totalBusinessReport.hasBeginningArr &&
                        (row.label === 'Beginning ARR' || row.label === 'Ending ARR')
                          ? totalBusinessReport.arrBasisJanEnd
                          : null;

                      return (
                        <tr key={`${row.label}-${rowIdx}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="sticky left-0 z-10 border-r border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700">
                            {row.label}
                          </td>
                          <td className="border-r border-indigo-200 bg-indigo-50/40 px-2 py-1.5 text-right font-semibold tabular-nums text-indigo-700">
                            {formatTotalBusinessCell(startBasisValue)}
                          </td>
                          {row.actual.slice(1).flatMap((actualValue, relativeIdx) => {
                            const idx = relativeIdx + 1;
                            const planValue = row.plan[idx] ?? null;
                            const actualClass =
                              actualValue !== null && row.format !== 'number'
                                ? actualValue < 0
                                  ? 'text-red-600'
                                  : 'text-gray-800'
                                : 'text-gray-800';
                            const planClass =
                              planValue !== null && row.format !== 'number'
                                ? planValue < 0
                                  ? 'text-red-500'
                                  : 'text-gray-500'
                                : 'text-gray-500';
                            return [
                              <td
                                key={`${row.label}-${idx}-actual`}
                                className={`border-r border-gray-100 px-2 py-1.5 text-right tabular-nums ${actualClass}`}
                              >
                                {formatTotalBusinessCell(actualValue)}
                              </td>,
                              <td
                                key={`${row.label}-${idx}-plan`}
                                className={`border-r border-gray-200 bg-gray-50/50 px-2 py-1.5 text-right tabular-nums ${planClass}`}
                              >
                                {formatTotalBusinessCell(planValue)}
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 space-y-1">
              <p><strong>Datenbasis:</strong> ARR 31.12. ist nur Kontext. Die Fortschreibung startet mit ARR Ende Januar; New Sales, Expanding und Churn werden ab Februar gerechnet.</p>
              <p><strong>Bewegungen:</strong> New Sales ARR aus Go-Lives, Expanding ARR aus Up-/Downsells plus SMS/Pay-Delta, Churn ARR aus importierten Churn-Events.</p>
              <p><strong>P&L:</strong> Revenue wird aus Ending ARR / 12 abgeleitet. Kosten-, EBITDA- und Rule-of-40-Zeilen bleiben leer, bis dafür eine belastbare Quelle angebunden ist.</p>
            </div>
          </div>
        )}
      </div>

      {selectedMonthDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedMonthDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">
                📅 {MONTH_NAMES[selectedMonthDetail - 1]} {selectedYear} - Go-Lives
              </h3>
              <button
                onClick={() => setSelectedMonthDetail(null)}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="p-6">
              {monthDetailGoLives.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  {t('monthDetail.noGoLives')}
                </div>
              ) : (
                <>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <input
                      type="text"
                      value={goLiveDetailSearch}
                      onChange={(e) => setGoLiveDetailSearch(e.target.value)}
                      placeholder="Suche nach Kunde, OAK, Datum oder AE..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none md:max-w-md"
                    />
                    <span className="text-xs text-gray-500">
                      {filteredMonthDetailGoLives.length} von {monthDetailGoLives.length} Go-Lives
                    </span>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Go-Lives</div>
                      <div className="text-lg font-bold text-gray-800">{filteredMonthDetailGoLives.length}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Terminals</div>
                      <div className="text-lg font-bold text-blue-700">
                        {filteredMonthDetailGoLives.filter((g) => g.has_terminal).length}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Subs ARR</div>
                      <div className="text-lg font-bold text-green-700">
                        {formatCurrency(filteredMonthDetailGoLives.reduce((sum, g) => sum + g.subs_arr, 0))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Pay ARR</div>
                      <div className="text-lg font-bold text-orange-700">
                        {formatCurrency(filteredMonthDetailGoLives.reduce((sum, g) => sum + getEffectiveGoLivePayArrForDisplay(g), 0))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Gesamt ARR</div>
                      <div className="text-lg font-bold text-blue-700">
                        {formatCurrency(
                          filteredMonthDetailGoLives.reduce((sum, g) => sum + (g.subs_arr || 0) + getEffectiveGoLivePayArrForDisplay(g), 0)
                        )}
                      </div>
                    </div>
                  </div>

                  {filteredMonthDetailGoLives.length === 0 ? (
                    <div className="py-6 text-center text-gray-500">Keine Treffer für die Suche.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.oakId')}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('monthDetail.customer')}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.goLiveDate')}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.assignedTo')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-green-700">{t('goLive.subsArr')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-emerald-700">Pay Ist / Monat (€)</th>
                            <th className="px-3 py-2 text-right font-semibold text-orange-700">{t('goLive.payArr')}</th>
                            <th className="px-3 py-2 text-right font-semibold text-blue-700">Gesamt ARR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMonthDetailGoLives.map((gl) => (
                            <tr key={gl.id} className="border-b last:border-b-0">
                              <td className="px-3 py-2 text-gray-500">{gl.oak_id || '-'}</td>
                              <td className="px-3 py-2 font-medium text-gray-800">{gl.customer_name}</td>
                              <td className="px-3 py-2 text-gray-700">{new Date(gl.go_live_date).toLocaleDateString('de-DE')}</td>
                              <td className="px-3 py-2 text-gray-700">{userNameById.get(gl.user_id) || '-'}</td>
                              <td className="px-3 py-2 text-right text-green-700">{formatCurrency(gl.subs_arr)}</td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-2">
                                  <input
                                    type="number"
                                    value={payIstInputsByGoLiveId[gl.id] ?? ''}
                                    onChange={(e) =>
                                      setPayIstInputsByGoLiveId((prev) => ({ ...prev, [gl.id]: e.target.value }))
                                    }
                                    disabled={!gl.has_terminal || savingPayIstByGoLiveId[gl.id]}
                                    placeholder={gl.has_terminal ? 'z.B. 145' : '-'}
                                    className={`w-24 rounded border px-2 py-1 text-right text-sm ${
                                      !gl.has_terminal ? 'bg-gray-100 text-gray-400 border-gray-200' : 'border-emerald-300'
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSavePayIstForGoLive(gl)}
                                    disabled={!gl.has_terminal || savingPayIstByGoLiveId[gl.id]}
                                    className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {savingPayIstByGoLiveId[gl.id] ? '...' : 'Speichern'}
                                  </button>
                                </div>
                                {payIstErrorByGoLiveId[gl.id] ? (
                                  <div className="mt-1 text-right text-xs text-red-600">{payIstErrorByGoLiveId[gl.id]}</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(getEffectiveGoLivePayArrForDisplay(gl))}</td>
                              <td className="px-3 py-2 text-right font-medium text-blue-700">
                                {formatCurrency((gl.subs_arr || 0) + getEffectiveGoLivePayArrForDisplay(gl))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedChurnMonthDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedChurnMonthDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">
                📉 {MONTH_NAMES[selectedChurnMonthDetail - 1]} {selectedYear} - Churn-Details
              </h3>
              <button
                onClick={() => setSelectedChurnMonthDetail(null)}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="p-6">
              {monthDetailChurnEvents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">Keine Churn-Events in diesem Monat.</div>
              ) : (
                <>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <input
                      type="text"
                      value={churnDetailSearch}
                      onChange={(e) => setChurnDetailSearch(e.target.value)}
                      placeholder="Suche nach Kunde, OAK, COO, Package, Reason..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none md:max-w-md"
                    />
                    <span className="text-xs text-gray-500">
                      {filteredMonthDetailChurnEvents.length} von {monthDetailChurnEvents.length} Churn-Events
                    </span>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Total Churn</div>
                      <div className="text-lg font-bold text-gray-800">{churnDetailSummary.totalCount}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Scheduled</div>
                      <div className="text-lg font-bold text-amber-700">{churnDetailSummary.scheduledCount}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Non-Scheduled</div>
                      <div className="text-lg font-bold text-rose-700">{churnDetailSummary.nonScheduledCount}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Total ARR Lost</div>
                      <div className="text-lg font-bold text-red-700">{formatCurrency(churnDetailSummary.totalArrLost)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Subs Lost</div>
                      <div className="text-lg font-bold text-violet-700">{formatCurrency(churnDetailSummary.subsArrLost)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Pay Lost</div>
                      <div className="text-lg font-bold text-orange-700">{formatCurrency(churnDetailSummary.payArrLost)}</div>
                    </div>
                  </div>

                  {filteredMonthDetailChurnEvents.length === 0 ? (
                    <div className="py-6 text-center text-gray-500">Keine Treffer für die Suche.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Oak ID</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Kunde</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">COO</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Package</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Reason</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Scheduled</th>
                            <th className="px-3 py-2 text-right font-semibold text-violet-700">Subs Lost</th>
                            <th className="px-3 py-2 text-right font-semibold text-orange-700">Pay Lost</th>
                            <th className="px-3 py-2 text-right font-semibold text-red-700">Total ARR Lost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMonthDetailChurnEvents.map((event, idx) => (
                            <tr key={event.id || `${event.oak_id || 'n/a'}-${event.customer_name || 'unknown'}-${idx}`} className="border-b last:border-b-0">
                              <td className="px-3 py-2 text-gray-500">{event.oak_id ?? '-'}</td>
                              <td className="px-3 py-2 font-medium text-gray-800">{event.customer_name || '-'}</td>
                              <td className="px-3 py-2 text-gray-700">{event.coo || '-'}</td>
                              <td className="px-3 py-2 text-gray-700">{event.package_name || '-'}</td>
                              <td className="px-3 py-2 text-gray-700">{event.churn_reason || '-'}</td>
                              <td className={`px-3 py-2 ${event.scheduled ? 'text-amber-700' : 'text-rose-700'}`}>
                                {event.scheduled ? 'Ja' : 'Nein'}
                              </td>
                              <td className="px-3 py-2 text-right text-violet-700">{formatCurrency(Number(event.subs_revenue_lost) || 0)}</td>
                              <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(Number(event.pay_revenue_lost) || 0)}</td>
                              <td className="px-3 py-2 text-right font-medium text-red-700">{formatCurrency(effectiveTotalArrLost(event))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
