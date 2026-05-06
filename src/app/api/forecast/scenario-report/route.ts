import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { generateScenarioReportWithDiagnostics, type ScenarioReportInput } from '@/lib/forecastScenarioReport';
import { createOpenAIScenarioNarrativeProvider } from '@/lib/forecastScenarioReportOpenAI';

const SNAPSHOT_INTERVAL_DAYS = 28;

type ScenarioSnapshotRow = {
  id: string;
  created_at: string;
  year: number;
  user_id: string | null;
  forecast_net_arr: number | null;
  target_net_arr: number | null;
  forecast_subs_arr: number | null;
  forecast_pay_arr: number | null;
  forecast_churn_arr: number | null;
  forecast_weighted_pipeline_arr: number | null;
  snapshot_payload: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

function parseBooleanEnv(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysBetween(fromIso: string, toDate: Date) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((toDate.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

async function loadLatestScenarioSnapshot(
  userId: string | undefined,
  year: number
): Promise<ScenarioSnapshotRow | null> {
  const supabase = await createServiceClient();
  if (!supabase) return null;
  let query = supabase
    .from('forecast_scenario_snapshots')
    .select(
      'id, created_at, year, user_id, forecast_net_arr, target_net_arr, forecast_subs_arr, forecast_pay_arr, forecast_churn_arr, forecast_weighted_pipeline_arr, snapshot_payload'
    )
    .eq('year', year)
    .order('created_at', { ascending: false })
    .limit(1);
  query = userId ? query.eq('user_id', userId) : query.is('user_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return (data as ScenarioSnapshotRow | null) ?? null;
}

async function storeScenarioSnapshot(input: ScenarioReportInput): Promise<boolean> {
  const supabase = await createServiceClient();
  if (!supabase) return false;
  const row = {
    user_id: input.userId || null,
    year: input.year,
    forecast_net_arr: toNumber(input.forecastNetArr),
    target_net_arr: toNumber(input.targetNetArr),
    forecast_subs_arr: toNumber(input.forecastSubsArr),
    forecast_pay_arr: toNumber(input.forecastPayArr),
    forecast_churn_arr: toNumber(input.forecastChurnArr),
    forecast_weighted_pipeline_arr: toNumber(input.forecastWeightedPipelineArr || 0),
    snapshot_payload: {
      leadConversionPercent: toNumber(input.leadConversionPercent),
      leadVolumePerFutureMonth: toNumber(input.leadVolumePerFutureMonth),
      churnFactorPercent: toNumber(input.churnFactorPercent),
      scenarioFutureChurnArr: toNumber(input.scenarioFutureChurnArr),
      futurePlanChurnArr: toNumber(input.futurePlanChurnArr),
    },
  };
  const { error } = await supabase.from('forecast_scenario_snapshots').insert(row);
  return !error;
}

function withHistoricalContext(
  input: ScenarioReportInput,
  latestSnapshot: ScenarioSnapshotRow | null
): ScenarioReportInput {
  if (!latestSnapshot?.created_at) return input;
  const currentNetGap = toNumber(input.targetNetArr) - toNumber(input.forecastNetArr);
  const snapshotNetGap = toNumber(latestSnapshot.target_net_arr) - toNumber(latestSnapshot.forecast_net_arr);
  return {
    ...input,
    historicalContext: {
      snapshotDateIso: latestSnapshot.created_at,
      daysSinceSnapshot: daysBetween(latestSnapshot.created_at, new Date()),
      deltaNetArr: toNumber(input.forecastNetArr) - toNumber(latestSnapshot.forecast_net_arr),
      deltaSubsArr: toNumber(input.forecastSubsArr) - toNumber(latestSnapshot.forecast_subs_arr),
      deltaPayArr: toNumber(input.forecastPayArr) - toNumber(latestSnapshot.forecast_pay_arr),
      deltaChurnArr: toNumber(input.forecastChurnArr) - toNumber(latestSnapshot.forecast_churn_arr),
      deltaWeightedPipelineArr:
        toNumber(input.forecastWeightedPipelineArr || 0) - toNumber(latestSnapshot.forecast_weighted_pipeline_arr),
      deltaNetGapArr: currentNetGap - snapshotNetGap,
    },
  };
}

function getOpenAIProviderFromEnv() {
  const enabled = parseBooleanEnv(process.env.OPENAI_REPORT_ENABLED, true);
  if (!enabled) return null;

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;

  const model = process.env.OPENAI_REPORT_MODEL || 'gpt-5.4-mini';
  const timeoutMs = Math.max(2000, parseNumberEnv(process.env.OPENAI_REPORT_TIMEOUT_MS, 12000));
  const temperature = Math.min(1, Math.max(0, parseNumberEnv(process.env.OPENAI_REPORT_TEMPERATURE, 0.2)));
  const maxTokens = Math.max(120, parseIntegerEnv(process.env.OPENAI_REPORT_MAX_TOKENS, 350));
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  return createOpenAIScenarioNarrativeProvider({
    apiKey,
    model,
    timeoutMs,
    temperature,
    maxTokens,
    baseUrl,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!isRecord(body) || !isRecord(body.input)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ungueltige Request. Erwartet: { input: ScenarioReportInput }',
        },
        { status: 400 }
      );
    }

    const rawInput = body.input as unknown as ScenarioReportInput;
    const input: ScenarioReportInput = {
      ...rawInput,
      userId: rawInput.userId ? String(rawInput.userId) : undefined,
      year: Number(rawInput.year),
    };
    const latestSnapshot = await loadLatestScenarioSnapshot(input.userId, input.year);
    const inputWithHistory = withHistoricalContext(input, latestSnapshot);
    const snapshotDue =
      !latestSnapshot ||
      daysBetween(String(latestSnapshot.created_at || ''), new Date()) >= SNAPSHOT_INTERVAL_DAYS;
    let snapshotCreated = false;
    if (snapshotDue) {
      snapshotCreated = await storeScenarioSnapshot(inputWithHistory);
    }
    const preferLlm = Boolean(body.preferLlm);
    const useLlm = preferLlm && process.env.USE_LLM_REPORT === 'true';
    const providerName = (process.env.REPORT_LLM_PROVIDER || 'openai').trim().toLowerCase();
    const provider = useLlm && providerName === 'openai' ? getOpenAIProviderFromEnv() : null;
    const { report, diagnostics } = await generateScenarioReportWithDiagnostics(inputWithHistory, { useLlm, provider });

    return NextResponse.json({
      success: true,
      mode: report.mode,
      report,
      fallbackActive: report.mode !== 'llm',
      llmRequested: useLlm,
      llmProvider: providerName,
      llmAttempted: diagnostics.llmAttempted,
      llmError: diagnostics.llmError,
      snapshotCreated,
      snapshotReferenceDate: latestSnapshot?.created_at || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Szenario-Report konnte nicht erstellt werden',
      },
      { status: 500 }
    );
  }
}
