'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { User, GoLive, isPlannable, canReceiveGoLives, MONTH_NAMES, DEFAULT_SETTINGS } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useMultiUserData, usePaymarginImportedCohortKeys } from '@/lib/hooks';
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

const SALESPIPE_MAIN_COLUMN_WIDTHS_DEFAULT = [280, 110, 120, 130, 90, 90, 110, 140, 120, 120, 130];
const SALESPIPE_MAIN_COLUMN_MIN_WIDTH = [180, 90, 100, 100, 70, 70, 90, 110, 100, 100, 110];

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

function normalizeId(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
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

export default function DLTStrategicReports({ user }: DLTStrategicReportsProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const [selectedYear, setSelectedYear] = useState(currentYear);
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
  const [reportType, setReportType] = useState<'forecast' | 'ytd' | 'salespipe'>('forecast');
  const [leadToGoLiveForecastPercent, setLeadToGoLiveForecastPercent] = useState(16);
  const [futureLeadVolumeScenarioMonthlyLeads, setFutureLeadVolumeScenarioMonthlyLeads] = useState(0);
  const [futureChurnScenarioFactorPercent, setFutureChurnScenarioFactorPercent] = useState(100);
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
  const [whatIfConvertedRatePct, setWhatIfConvertedRatePct] = useState(0);
  const [whatIfWinRatePct, setWhatIfWinRatePct] = useState(0);
  const [churnEvents, setChurnEvents] = useState<ChurnEventRow[]>([]);
  const [churnLoading, setChurnLoading] = useState(true);
  const [payIstInputsByGoLiveId, setPayIstInputsByGoLiveId] = useState<Record<string, string>>({});
  const [savingPayIstByGoLiveId, setSavingPayIstByGoLiveId] = useState<Record<string, boolean>>({});
  const [payIstErrorByGoLiveId, setPayIstErrorByGoLiveId] = useState<Record<string, string>>({});
  const exportRef = useRef<HTMLDivElement>(null);
  const skipScenarioReportResetRef = useRef(false);
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

  // Forecast data: 1) Ist-Monate, 2) Weighted Pipeline (+70 Tage), 3) YTD-Conversion-Forecast als Fallback
  const forecastData = useMemo(() => {
    if (monthlyData.length === 0) return [];

    // Stage-spezifische Restlaufzeit bis Go-Live (heuristisch aus aktueller Journey-Analyse).
    // Ziel: Weighted Pipeline nicht im aktuellen Stage-Monat buchen, sondern im wahrscheinlichen Go-Live-Monat.
    const stageToGoLiveOffsetDays: Record<PipelineStageKey, number> = {
      sql: 70,
      not_converted_new: 60,
      working: 52,
      converted: 44,
      demo_booked: 36,
      demo_completed: 30,
      sent_quote: 26,
      close_won: 26,
      close_lost: 0,
      signups: 0,
      go_live: 0,
    };
    const getProjectedGoLiveDate = (sourceDate: Date, stageKey: PipelineStageKey) => {
      const projected = new Date(sourceDate);
      projected.setDate(projected.getDate() + (stageToGoLiveOffsetDays[stageKey] ?? 0));
      return projected;
    };

    const now = new Date();
    const nowTs = now.getTime();
    const forecastWindowStart = new Date(now);
    forecastWindowStart.setHours(0, 0, 0, 0);
    const pipelineEnd = new Date(now);
    pipelineEnd.setDate(pipelineEnd.getDate() + 70);
    pipelineEnd.setHours(23, 59, 59, 999);

    const pipelineWeightedByMonth = Array.from({ length: 12 }, () => 0);
    salespipeEvents.forEach((row) => {
      const stageKey = normalizeSalespipeStage(row.stage);
      if (!stageKey || !ACTIVE_PIPELINE_STAGES.includes(stageKey)) return;
      // Für die Forecast-Zuordnung zählt primär der erwartete Abschlussmonat.
      const filterDate = row.close_date || row.created_date;
      if (!filterDate) return;
      const sourceDate = new Date(filterDate);
      if (Number.isNaN(sourceDate.getTime())) return;
      const projectedGoLiveDate = getProjectedGoLiveDate(sourceDate, stageKey);
      if (projectedGoLiveDate < forecastWindowStart || projectedGoLiveDate > pipelineEnd) return;
      if (projectedGoLiveDate.getFullYear() !== selectedYear) return;
      const monthIdx = projectedGoLiveDate.getMonth();
      if (monthIdx < 0 || monthIdx > 11) return;
      const arr = Number(row.estimated_arr) || 0;
      const probabilityRaw = Number(row.probability);
      const probability = Number.isFinite(probabilityRaw)
        ? (probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw)
        : getDefaultProbability(stageKey);
      pipelineWeightedByMonth[monthIdx] += arr * probability;
    });
    leadsEvents.forEach((row) => {
      const stageKey = normalizeLeadsStage(
        row.lead_status,
        row.lead_sub_status,
        row.demo_or_quote,
        row.lead_id,
        row.opportunity_id,
        row.opportunity_account
      );
      if (!stageKey || !ACTIVE_PIPELINE_STAGES.includes(stageKey)) return;
      const filterDate = row.conversion_date || row.created_date;
      if (!filterDate) return;
      const sourceDate = new Date(filterDate);
      if (Number.isNaN(sourceDate.getTime())) return;
      const projectedGoLiveDate = getProjectedGoLiveDate(sourceDate, stageKey);
      if (projectedGoLiveDate < forecastWindowStart || projectedGoLiveDate > pipelineEnd) return;
      if (projectedGoLiveDate.getFullYear() !== selectedYear) return;
      const monthIdx = projectedGoLiveDate.getMonth();
      if (monthIdx < 0 || monthIdx > 11) return;
      const arr = Number(row.opportunity_amount) || 0;
      pipelineWeightedByMonth[monthIdx] += arr * getDefaultProbability(stageKey);
    });

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
    churnEvents.forEach((event) => {
      if (!event.churn_month) return;
      const d = new Date(event.churn_month);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== selectedYear) return;
      const idx = d.getMonth();
      if (idx < 0 || idx > 11) return;
      actualChurnByMonth[idx] += Number(event.total_arr_lost) || 0;
    });

    const futureChurnBaseByMonth = plannedChurnByMonth.map((value) => Math.max(0, value));

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
      // Bereits eingebuchter Churn (aus churn_events) wird separat geführt.
      const bookedChurnAbs = Math.max(0, actualChurnByMonth[row.idx] || 0);
      const churnScenarioFactor = Math.max(0, futureChurnScenarioFactorPercent / 100);
      const scenarioPlanChurnAbs = isFutureMonth ? (futureChurnBaseByMonth[row.idx] || 0) * churnScenarioFactor : 0;
      const bookedWithinPlanAbs = isFutureMonth ? Math.min(bookedChurnAbs, scenarioPlanChurnAbs) : bookedChurnAbs;
      const projectedWithinPlanAbs = isFutureMonth
        ? Math.max(0, scenarioPlanChurnAbs - bookedWithinPlanAbs)
        : 0;
      const overPlanChurnAbs = isFutureMonth ? Math.max(0, bookedChurnAbs - scenarioPlanChurnAbs) : 0;
      const churnForForecast = isFutureMonth ? scenarioPlanChurnAbs + overPlanChurnAbs : bookedChurnAbs;
      const arrConversionBaseline = !row.hasActual && isFutureMonth ? (conversionArrByMonth[row.idx] || 0) : 0;
      const primaryArrWithoutConversion =
        arrGoLivesToDate + arrGoLivesFuture + pipelineWeighted + arrNotBookedPipeline;
      const arrConversionTopUp = Math.max(0, arrConversionBaseline - primaryArrWithoutConversion);

      if (row.hasActual) {
        const arrWeightedPipeline = pipelineWeighted;
        const arrConversionBased = 0;
        const grossArr =
          arrGoLivesToDate + arrGoLivesFuture + arrWeightedPipeline + arrNotBookedPipeline + arrConversionBased;
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
          arrGoLivesToDate + arrGoLivesFuture + arrWeightedPipeline + arrNotBookedPipeline + arrConversionBased;
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
        arrGoLivesToDate + arrGoLivesFuture + arrWeightedPipeline + arrNotBookedPipeline + arrConversionBased;
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
    planzahlen,
    churnEvents,
    payArrReportingOptions,
  ]);

  const forecastSummary = useMemo(
    () => ({
      subs: forecastData.reduce((sum, row) => sum + (row.subsForecast || 0), 0),
      pay: forecastData.reduce((sum, row) => sum + (row.payForecast || 0), 0),
      net: forecastData.reduce((sum, row) => sum + (row.netForecast || 0), 0),
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
      monthlyChurn[idx] += Number(event.total_arr_lost) || 0;
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

    const ytdMonthLimit = selectedYear < currentYear ? 11 : selectedYear > currentYear ? -1 : currentMonth;
    const ytdMonths = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) => idx <= ytdMonthLimit);
    const futureMonths = Array.from({ length: 12 }, (_, idx) => idx).filter((idx) =>
      selectedYear > currentYear ? true : selectedYear < currentYear ? false : idx > currentMonth
    );

    const planBaseByMonth = plannedChurnByMonth.map((value) => Math.max(0, value));
    const defaultMonthlyPlanChurn = (() => {
      const futureValues = futureMonths.map((idx) => planBaseByMonth[idx]).filter((value) => value > 0);
      if (futureValues.length > 0) return futureValues.reduce((sum, value) => sum + value, 0) / futureValues.length;
      const allValues = planBaseByMonth.filter((value) => value > 0);
      return allValues.length > 0 ? allValues.reduce((sum, value) => sum + value, 0) / allValues.length : 0;
    })();

    const churnScenarioFactor = Math.max(0, futureChurnScenarioFactorPercent / 100);
    const ytdChurnTotal = ytdMonths.reduce((sum, idx) => sum + (monthlyChurn[idx] || 0), 0);
    const ytdMonthlyBookedAverage = ytdMonths.length > 0 ? ytdChurnTotal / ytdMonths.length : 0;
    const futureBookedChurnTotal = futureMonths.reduce((sum, idx) => sum + (monthlyChurn[idx] || 0), 0);
    const futurePlanBaseTotal = futureMonths.reduce((sum, idx) => sum + (planBaseByMonth[idx] || 0), 0);
    const scenarioFuturePlanTotal = futurePlanBaseTotal * churnScenarioFactor;
    const overPlanFutureTotal = futureMonths.reduce((sum, idx) => {
      const booked = monthlyChurn[idx] || 0;
      const planScenario = (planBaseByMonth[idx] || 0) * churnScenarioFactor;
      return sum + Math.max(0, booked - planScenario);
    }, 0);
    const scenarioFutureChurnTotal = scenarioFuturePlanTotal + overPlanFutureTotal;

    return {
      defaultFactorPercent: 100,
      defaultMonthlyPlanChurn,
      futurePlanBaseTotal,
      scenarioFuturePlanTotal,
      overPlanFutureTotal,
      ytdChurnTotal,
      futureBookedChurnTotal,
      scenarioFutureChurnTotal,
      churnScenarioFactor,
      ytdMonthlyBookedAverage,
      ytdBookedFactorPercent:
        defaultMonthlyPlanChurn > 0 ? (ytdMonthlyBookedAverage / defaultMonthlyPlanChurn) * 100 : 0,
      futureMonthsCount: futureMonths.length,
    };
  }, [churnEvents, planzahlen, selectedYear, currentYear, currentMonth, futureChurnScenarioFactorPercent]);

  useEffect(() => {
    const ytdMarkerDefault = Number.isFinite(churnScenarioSummary.ytdBookedFactorPercent)
      ? Math.max(0, Math.min(300, churnScenarioSummary.ytdBookedFactorPercent))
      : 100;
    setFutureChurnScenarioFactorPercent(ytdMarkerDefault);
  }, [selectedYear, churnScenarioSummary.ytdBookedFactorPercent]);

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
          source: 'report_recommendation_save',
          sourceSliderState: {
            leadToGoLiveForecastPercent,
            futureLeadVolumeScenarioMonthlyLeads,
            futureChurnScenarioFactorPercent,
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
    forecastScenarioInput,
    scenarioReportMeta,
    saveScenarioRecord,
    loadSavedScenarios,
  ]);

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

      if (Number.isFinite(nextLeadConversion)) setLeadToGoLiveForecastPercent(Math.max(0, Math.min(100, nextLeadConversion)));
      if (Number.isFinite(nextLeadVolume)) setFutureLeadVolumeScenarioMonthlyLeads(Math.max(0, nextLeadVolume));
      if (Number.isFinite(nextChurnFactor)) setFutureChurnScenarioFactorPercent(Math.max(0, Math.min(300, nextChurnFactor)));

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
          return d.getMonth() + 1 === month;
        });

        const scheduledEvents = monthEvents.filter((event) => event.scheduled === true);
        const nonScheduledEvents = monthEvents.filter((event) => event.scheduled !== true);
        const scheduledArrLost = scheduledEvents.reduce((sum, event) => sum + (Number(event.total_arr_lost) || 0), 0);
        const nonScheduledArrLost = nonScheduledEvents.reduce((sum, event) => sum + (Number(event.total_arr_lost) || 0), 0);

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
    [churnEvents]
  );

  const monthDetailChurnEvents = useMemo(
    () =>
      selectedChurnMonthDetail
        ? churnEvents
            .filter((event) => {
              if (!event.churn_month) return false;
              const d = new Date(event.churn_month);
              if (Number.isNaN(d.getTime())) return false;
              return d.getMonth() + 1 === selectedChurnMonthDetail;
            })
            .sort((a, b) => (Number(b.total_arr_lost) || 0) - (Number(a.total_arr_lost) || 0))
        : [],
    [churnEvents, selectedChurnMonthDetail]
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
      totalArrLost: filteredMonthDetailChurnEvents.reduce((sum, event) => sum + (Number(event.total_arr_lost) || 0), 0),
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
        const stageKey = normalizeSalespipeStage(sales.stage);
        if (!stageKey) return acc;
        const arr = Number(sales.estimated_arr) || 0;
        const probabilityRaw = Number(sales.probability);
        const probability = Number.isFinite(probabilityRaw)
          ? (probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw)
          : null;
        const probabilityForWeighting = probability ?? getDefaultProbability(stageKey);
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
          weightedArr: arr * probabilityForWeighting,
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
          weightedArr: arr * getDefaultProbability(stageKey),
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

  const connectedJourneyOakSet = useMemo(() => {
    const set = new Set<number>();
    baseFilteredSalespipeRows.forEach((row) => {
      // Strikte Journey-Definition:
      // Lead-ID + Opportunity-ID + daraus gemappte OAK-ID muessen vorhanden sein.
      if (row.source !== 'leads') return;
      if (!row.leadId || !row.opportunityId || row.oakId === null) return;
      set.add(row.oakId);
    });
    return set;
  }, [baseFilteredSalespipeRows]);

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

  const journeyTrackOakSet = useMemo(() => {
    const openRows = filteredSalespipeRows.filter((row) => ACTIVE_PIPELINE_STAGES.includes(row.stageKey));
    const closeWonRows = filteredSalespipeRows.filter((row) => row.stageKey === 'close_won');
    const openAndWonOakSet = new Set(
      [...openRows, ...closeWonRows]
        .map((row) => row.oakId)
        .filter((oakId): oakId is number => oakId !== null)
    );
    return new Set(
      Array.from(openAndWonOakSet).filter((oakId) => connectedJourneyOakSet.has(oakId))
    );
  }, [filteredSalespipeRows, connectedJourneyOakSet]);

  const trackedSignupsStageStats = useMemo(() => {
    const byOak = new Map<number, number>();
    filteredSalespipeRows.forEach((row) => {
      if (row.stageKey !== 'signups' || row.oakId === null || !journeyTrackOakSet.has(row.oakId)) return;
      byOak.set(row.oakId, Math.max(byOak.get(row.oakId) || 0, row.arr));
    });
    return {
      count: byOak.size,
      arr: Array.from(byOak.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRows, journeyTrackOakSet]);

  const trackedGoLiveStageStats = useMemo(() => {
    const byOak = new Map<number, number>();
    filteredSalespipeRows.forEach((row) => {
      if (row.stageKey !== 'go_live' || row.oakId === null || !journeyTrackOakSet.has(row.oakId)) return;
      byOak.set(row.oakId, Math.max(byOak.get(row.oakId) || 0, row.arr));
    });
    return {
      count: byOak.size,
      arr: Array.from(byOak.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRows, journeyTrackOakSet]);

  const trackedCloseWonStageStats = useMemo(() => {
    const byOak = new Map<number, number>();
    filteredSalespipeRows.forEach((row) => {
      if (row.stageKey !== 'close_won' || row.oakId === null || !journeyTrackOakSet.has(row.oakId)) return;
      byOak.set(row.oakId, Math.max(byOak.get(row.oakId) || 0, row.arr));
    });
    return {
      count: byOak.size,
      arr: Array.from(byOak.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRows, journeyTrackOakSet]);

  const trackedCloseLostStageStats = useMemo(() => {
    const byKey = new Map<string, number>();
    filteredSalespipeRows.forEach((row) => {
      if (row.stageKey !== 'close_lost') return;
      // Close-Lost-Einträge kommen teilweise ohne OAK-ID. Dann deduplizieren wir über Opportunity-ID.
      const key = row.oakId !== null
        ? `oak:${row.oakId}`
        : (normalizeId(row.opportunityId) ? `opp:${normalizeId(row.opportunityId)}` : row.id);
      if (!key) return;
      byKey.set(key, Math.max(byKey.get(key) || 0, row.arr));
    });
    return {
      count: byKey.size,
      arr: Array.from(byKey.values()).reduce((sum, value) => sum + value, 0),
    };
  }, [filteredSalespipeRows]);

  const salespipeStageSummary = useMemo(() => {
    const initial = PIPELINE_STAGE_CONFIG.reduce(
      (acc, stage) => ({ ...acc, [stage.key]: { count: 0, arr: 0 } }),
      {} as Record<PipelineStageKey, { count: number; arr: number }>
    );
    filteredSalespipeRows.forEach((row) => {
      initial[row.stageKey].count += 1;
      initial[row.stageKey].arr += row.arr;
    });
    // Sign-up/Go-Live folgen derselben Tracking-Logik wie die KPI-Karten oben.
    initial.close_won = trackedCloseWonStageStats;
    initial.close_lost = trackedCloseLostStageStats;
    initial.signups = trackedSignupsStageStats;
    initial.go_live = trackedGoLiveStageStats;

    // SQL soll die gesamte Lead-Basis im gewählten Zeitraum darstellen.
    const leadRows = filteredSalespipeRows.filter((row) => row.source === 'leads');
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
  }, [filteredSalespipeRows, trackedCloseWonStageStats, trackedCloseLostStageStats, trackedSignupsStageStats, trackedGoLiveStageStats]);

  const convertedDecisionStats = useMemo(() => {
    const convertedOpportunityIds = new Set(
      filteredSalespipeRows
        .filter((row) => row.source === 'leads' && row.stageKey === 'converted')
        .map((row) => normalizeId(row.opportunityId))
        .filter((id): id is string => id !== null)
    );

    if (convertedOpportunityIds.size === 0) {
      return { convertedCount: 0, closeWonCount: 0, closeLostCount: 0 };
    }

    const decisionByOpportunity = new Map<string, { stage: 'close_won' | 'close_lost'; ts: number }>();
    filteredSalespipeRows.forEach((row) => {
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
  }, [filteredSalespipeRows]);

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

    filteredSalespipeRows.forEach((row) => {
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
  }, [filteredSalespipeRows]);

  const closeWonToGoLiveCycleStats = useMemo(() => {
    const toTs = (value: string | null) => {
      if (!value) return null;
      const ts = new Date(value).getTime();
      return Number.isNaN(ts) ? null : ts;
    };
    const msPerDay = 1000 * 60 * 60 * 24;
    const closeWonByOak = new Map<number, number>();
    const goLiveByOak = new Map<number, number>();

    filteredSalespipeRows.forEach((row) => {
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
  }, [filteredSalespipeRows]);

  useEffect(() => {
    if (convertedRate !== null) setWhatIfConvertedRatePct(convertedRate * 100);
  }, [convertedRate]);

  useEffect(() => {
    if (salespipeWinRate !== null) setWhatIfWinRatePct(salespipeWinRate * 100);
  }, [salespipeWinRate]);

  const salespipeKpis = useMemo(() => {
    const openRows = filteredSalespipeRows.filter((row) => OPEN_PIPELINE_KPI_STAGES.includes(row.stageKey));
    const totalPipelineArr = openRows.reduce((sum, row) => sum + row.arr, 0);
    const weightedArr = openRows.reduce((sum, row) => sum + row.weightedArr, 0);
    const closeWonCount = convertedDecisionStats.closeWonCount;
    return {
      openRows: openRows.length,
      totalPipelineArr,
      weightedArr,
      closeWonCount,
    };
  }, [filteredSalespipeRows, convertedDecisionStats.closeWonCount]);

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

    const openPipelineArrPerDeal =
      salespipeKpis.openRows > 0 ? salespipeKpis.totalPipelineArr / salespipeKpis.openRows : 0;
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
      openPipelineArrBase: salespipeKpis.totalPipelineArr,
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
      openPipelineArrWhatIf: openPipelineArrPerDeal * convertedCountWhatIf,
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
    const openRows = filteredSalespipeRows.filter((row) => ACTIVE_PIPELINE_STAGES.includes(row.stageKey));
    const bucketDefs = [
      { key: 'p10', label: '10%', min: 0.1, max: 0.2 },
      { key: 'p20', label: '20%', min: 0.2, max: 0.35 },
      { key: 'p35', label: '35%', min: 0.35, max: 0.5 },
      { key: 'p50', label: '50%', min: 0.5, max: 0.7 },
      { key: 'p70', label: '70%', min: 0.7, max: 0.9 },
      { key: 'p90', label: '90%+', min: 0.9, max: 1.01 },
    ] as const;

    return bucketDefs.map((bucket) => {
      const rows = openRows.filter((row) => {
        const prob = row.probability ?? 0;
        return prob >= bucket.min && prob < bucket.max;
      });
      return {
        ...bucket,
        count: rows.length,
        arr: rows.reduce((sum, row) => sum + row.arr, 0),
      };
    });
  }, [filteredSalespipeRows]);

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
    const openOpportunities = baseFilteredSalespipeRows.filter((row) => {
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
  }, [baseFilteredSalespipeRows, overdueCloseDaysByProbability]);

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

      {/* Report Type Tabs */}
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

      {/* Export Container */}
      <div ref={exportRef}>
        {/* Forecast */}
        {reportType === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">NET ARR Forecast (Subs + Pay - Churn)</h3>
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
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
                  const churnSliderMax = Math.max(
                    250,
                    Math.ceil((churnScenarioSummary.defaultFactorPercent > 0 ? churnScenarioSummary.defaultFactorPercent * 2.5 : 250) / 10) * 10
                  );
                  const churnYtdMarkerFactor = Math.max(
                    0,
                    Math.min(churnSliderMax, churnScenarioSummary.ytdBookedFactorPercent || 0)
                  );
                  const churnYtdMarkerPercent = churnSliderMax > 0
                    ? (churnYtdMarkerFactor / churnSliderMax) * 100
                    : 0;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-700 font-medium">Churn Slider (Faktor auf Plan+Trend)</span>
                        <span className="text-gray-900 font-semibold">{futureChurnScenarioFactorPercent.toFixed(0)}%</span>
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
                              style={{ left: `${churnYtdMarkerPercent}%` }}
                              aria-hidden
                            >
                              <div className="h-5 border-l-2 border-indigo-500 opacity-80" />
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-indigo-700">
                            YTD-Marker: {formatCurrency(churnScenarioSummary.ytdMonthlyBookedAverage)} / Monat
                            ({(churnScenarioSummary.ytdBookedFactorPercent || 0).toFixed(0)}%)
                          </div>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={300}
                          step={5}
                          value={futureChurnScenarioFactorPercent}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            setFutureChurnScenarioFactorPercent(Math.max(0, Math.min(300, next)));
                          }}
                          className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">Default Plan-Churn (Future Ø)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.defaultMonthlyPlanChurn)}</div>
                        </div>
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">Future Churn Basis (Plan)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.futurePlanBaseTotal)}</div>
                        </div>
                        <div className="rounded border border-gray-200 bg-white p-2">
                          <div className="text-gray-500">Szenario Churn (Future)</div>
                          <div className="font-semibold text-gray-800">{formatCurrency(churnScenarioSummary.scenarioFutureChurnTotal)}</div>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Plan-Regel: 100% = geplanter Churn. Werte über 100% erhöhen den Plan-Churn für Worst-Case-Szenarien.
                      </div>
                    </>
                  );
                })()}
              </div>
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
                  <div className="mt-3 rounded border border-indigo-200 bg-white p-3 text-xs text-gray-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">{scenarioReport.headline}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <div className="rounded border border-gray-200 p-2">
                        <div className="text-gray-500">NET Gap</div>
                        <div className="font-semibold text-gray-900">{formatCurrency(scenarioReport.netGapArr)}</div>
                        <div className="text-[11px] text-gray-600 mt-1">
                          Delta ARR Prognose vs Szenario: {formatSignedCurrency(scenarioReport.scenarioDelta.deltaNetArrVsBaseline)}
                        </div>
                      </div>
                      <div className="rounded border border-gray-200 p-2">
                        <div className="text-gray-500">Wirkung +1 Lead/Monat</div>
                        <div className="font-semibold text-gray-900">
                          {formatCurrency(scenarioReport.leverSensitivity.netArrPerAdditionalLeadPerMonth)}
                        </div>
                        <div className="text-[11px] text-gray-600 mt-1">
                          Mehr-Leads Szenario: {scenarioReport.scenarioDelta.additionalLeadsPerMonthVsBaseline.toFixed(1)} / Monat (
                          {scenarioReport.scenarioDelta.additionalLeadsTotalVsBaseline.toFixed(1)} gesamt)
                        </div>
                        <div className="text-[11px] text-gray-600">
                          ARR aus Mehr-Leads: {formatSignedCurrency(scenarioReport.scenarioDelta.additionalArrFromLeadVolumeVsBaseline)}
                        </div>
                      </div>
                      <div className="rounded border border-gray-200 p-2">
                        <div className="text-gray-500">Wirkung +1pp Conversion</div>
                        <div className="font-semibold text-gray-900">
                          {formatCurrency(scenarioReport.leverSensitivity.netArrPerConversionPoint)}
                        </div>
                        <div className="text-[11px] text-gray-600 mt-1">
                          Conversion-Delta: {scenarioReport.scenarioDelta.conversionDeltaPctPointsVsBaseline.toFixed(1)}pp, Mehr-Leads:
                          {' '}{scenarioReport.scenarioDelta.additionalLeadsFromConversionVsBaseline.toFixed(1)}
                        </div>
                        <div className="text-[11px] text-gray-600">
                          ARR aus Conversion-Delta: {formatSignedCurrency(scenarioReport.scenarioDelta.additionalArrFromConversionVsBaseline)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {scenarioReport.summaryLines.map((line, index) => (
                        <div key={`${line}-${index}`}>- {line}</div>
                      ))}
                    </div>
                    {scenarioReport.narrative && (
                      <div className="mt-2 rounded border border-indigo-100 bg-indigo-50/50 p-2 whitespace-pre-wrap text-[12px] text-gray-700">
                        {scenarioReport.narrative}
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {scenarioReport.actions.slice(0, 4).map((action) => (
                        <div key={action.key} className="rounded border border-gray-200 p-2">
                          <div className="font-medium text-gray-900">{action.title}</div>
                          <div>
                            Ziel-Beitrag: {action.requiredDelta.toFixed(2)} {action.unit}
                          </div>
                          <div>
                            Wirkung/Einheit: {formatCurrency(action.impactPerUnitNetArr)}
                          </div>
                          <div className="text-gray-500">{action.details}</div>
                        </div>
                      ))}
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
                                onClick={() => handleDeleteSavedScenario(saved)}
                                disabled={deletingScenarioId === saved.id}
                                className="inline-flex items-center justify-center rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingScenarioId === saved.id ? 'Lösche...' : 'Szenario löschen'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
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
        {reportType === 'salespipe' && (
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
                            <div key={bucket.key} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                              <div className="text-xs font-medium text-gray-600">{bucket.label}</div>
                              <div className="text-lg font-bold text-gray-800">{bucket.count}</div>
                              <div className="text-xs text-gray-500">{formatCurrency(bucket.arr)}</div>
                            </div>
                          ))}
                        </div>
                      </div>

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
                          <div className="text-xs text-indigo-700">Open Pipeline ARR</div>
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
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                          { label: 'Datensatz', align: 'text-left' },
                          { label: 'Stage', align: 'text-left' },
                          { label: 'Owner', align: 'text-left' },
                          { label: 'Leadsource', align: 'text-left' },
                          { label: 'ARR', align: 'text-right' },
                          { label: 'Probability', align: 'text-right' },
                          { label: 'Weighted ARR', align: 'text-right' },
                          { label: 'Match', align: 'text-left' },
                          { label: 'Schlusstermin', align: 'text-left' },
                          { label: 'Lead erstellt am', align: 'text-left' },
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
                          <td colSpan={11} className="px-2 py-8 text-center text-gray-500">
                            Keine Pipeline-Daten für die aktuelle Auswahl.
                          </td>
                        </tr>
                      ) : (
                        filteredSalespipeRows
                          .slice()
                          .sort((a, b) => b.arr - a.arr)
                          .map((row) => {
                            const stageCfg = PIPELINE_STAGE_CONFIG.find((cfg) => cfg.key === row.stageKey) || PIPELINE_STAGE_CONFIG[0];
                            const leadToCloseDays = calculateDaysBetween(row.leadCreatedDate, row.closeDate);
                            return (
                              <tr key={row.id} className="border-b last:border-b-0">
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
                                  {row.closeDate ? new Date(row.closeDate).toLocaleDateString('de-DE') : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-gray-700">
                                  {row.leadCreatedDate ? new Date(row.leadCreatedDate).toLocaleDateString('de-DE') : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {leadToCloseDays === null ? '-' : leadToCloseDays}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
                </div>

                <div style={{ overflowX: 'auto', width: '100%' }} className="bg-white rounded-xl shadow-sm border border-rose-200 pb-2">
                  <div className="px-4 py-3 border-b border-rose-200 bg-rose-50 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-rose-800">Überfällige Opportunities (nach Probability-Stage-Regeln)</h4>
                      <p className="text-xs text-rose-700">
                        Nur offene Opportunities (ohne SQL). Direktlink öffnet den Salesforce-Datensatz.
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                      {overdueOpportunities.length} überfällig
                    </span>
                  </div>
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
                </div>
              </>
            )}
          </div>
        )}

        {/* YTD Summary – wie Jahresübersicht, basierend auf zentralen DLT-Settings (ohne Provision) */}
        {reportType === 'ytd' && (
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
                              <td className="px-3 py-2 text-right font-medium text-red-700">{formatCurrency(Number(event.total_arr_lost) || 0)}</td>
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
