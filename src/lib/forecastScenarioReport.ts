export interface ScenarioReportInput {
  userId?: string;
  year: number;
  leadConversionPercent: number;
  leadVolumePerFutureMonth: number;
  churnFactorPercent: number;
  futureMonthsCount: number;
  baselineFutureLeads: number;
  scenarioFutureLeads: number;
  ytdAvgLeadsPerMonth: number;
  avgArrPerExpectedGoLive: number;
  expectedGoLivesFromLeads: number;
  forecastNetArr: number;
  targetNetArr: number;
  forecastSubsArr: number;
  targetSubsArr: number;
  forecastPayArr: number;
  targetPayArr: number;
  forecastChurnArr: number;
  forecastWeightedPipelineArr?: number;
  ytdBookedNetArr: number;
  futurePlanChurnArr: number;
  scenarioFutureChurnArr: number;
  historicalContext?: {
    snapshotDateIso: string;
    daysSinceSnapshot: number;
    deltaNetArr: number;
    deltaSubsArr: number;
    deltaPayArr: number;
    deltaChurnArr: number;
    deltaWeightedPipelineArr: number;
    deltaNetGapArr: number;
  };
  baselineDefaults?: {
    leadConversionPercent: number;
    leadVolumePerFutureMonth: number;
    churnFactorPercent: number;
    forecastNetArr: number;
    netGapArr: number;
  };
  scenarioAssessment?: {
    forecastNetArr: number;
    netGapArr: number;
    leadVolumeChangePercentVsBaseline: number;
    conversionDeltaPctPointsVsBaseline: number;
    churnFactorDeltaPctPointsVsBaseline: number;
    feasibilityScore: number;
    feasibilityBand: 'high' | 'medium' | 'low';
  };
  leadInsights?: {
    sourceSummary?: Array<{
      source: string;
      leads: number;
      tamFitPercent: number | null;
      leadToGoLivePercent: number | null;
    }>;
    statusSummary?: {
      qualified: number;
      notConverted: number;
      working: number;
      newlyCreated: number;
      qualifiedVsNotConvertedRatio: number | null;
    };
    cohortSummary?: {
      leadToDemoCompletedRateYtd: number | null;
      leadToSignupRateYtd: number | null;
      leadToGoLiveRateYtd: number | null;
      avgLeadToDemoCompletedDays: number | null;
      avgLeadToSignupDays: number | null;
      avgLeadToGoLiveDays: number | null;
    };
    repSummary?: Array<{
      rep: string;
      leads: number;
      leadToGoLivePercent: number | null;
    }>;
    leadDetailSignals?: {
      qualifiedOrWorkingWithoutDemo: number;
      notConvertedLeads: number;
      validLeadSharePercent: number | null;
      keyRisks: string[];
    };
  };
  tableSignals?: {
    salespipeRows: number;
    signupsRows: number;
    leadsRows: number;
    lookerLeadsRows: number;
    churnRows: number;
    hasPlanzahlen: boolean;
    keyRiskCount: number;
  };
}

export interface ScenarioActionRecommendation {
  key: 'lead_volume' | 'conversion' | 'churn' | 'balanced';
  title: string;
  impactPerUnitNetArr: number;
  requiredDelta: number;
  unit: string;
  details: string;
}

export interface ScenarioReport {
  mode: 'rules' | 'llm';
  title: string;
  headline: string;
  status: 'on_track' | 'gap';
  year: number;
  netGapArr: number;
  assumptions: {
    futureMonthsCount: number;
    leadConversionPercent: number;
    leadVolumePerFutureMonth: number;
    churnFactorPercent: number;
    avgArrPerExpectedGoLive: number;
    expectedGoLivesFromLeads: number;
  };
  leverSensitivity: {
    netArrPerAdditionalLeadPerMonth: number;
    netArrPerConversionPoint: number;
    netArrPerChurnPointReduction: number;
  };
  scenarioDelta: {
    baselineNetArr: number;
    scenarioNetArr: number;
    deltaNetArrVsBaseline: number;
    additionalLeadsPerMonthVsBaseline: number;
    additionalLeadsTotalVsBaseline: number;
    additionalArrFromLeadVolumeVsBaseline: number;
    conversionDeltaPctPointsVsBaseline: number;
    additionalLeadsFromConversionVsBaseline: number;
    additionalArrFromConversionVsBaseline: number;
    churnFactorDeltaPctPointsVsBaseline: number;
    additionalArrFromChurnDeltaVsBaseline: number;
  };
  actions: ScenarioActionRecommendation[];
  summaryLines: string[];
  narrative?: string;
  generatedAtIso: string;
}

export interface ScenarioNarrativeProvider {
  generateNarrative(input: ScenarioReportInput, report: ScenarioReport): Promise<string>;
}

export interface GenerateScenarioReportOptions {
  useLlm?: boolean;
  provider?: ScenarioNarrativeProvider | null;
}

export interface ScenarioReportDiagnostics {
  llmAttempted: boolean;
  llmError: string | null;
}

export interface ScenarioReportWithDiagnostics {
  report: ScenarioReport;
  diagnostics: ScenarioReportDiagnostics;
}

let narrativeProvider: ScenarioNarrativeProvider | null = null;

export function registerScenarioNarrativeProvider(provider: ScenarioNarrativeProvider | null) {
  narrativeProvider = provider;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function toSafeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function buildRulesReport(input: ScenarioReportInput): ScenarioReport {
  const leadConversionRate = Math.max(0, input.leadConversionPercent / 100);
  const leadVolumePerFutureMonth = Math.max(0, input.leadVolumePerFutureMonth);
  const futureMonthsCount = Math.max(0, Math.round(input.futureMonthsCount));
  const avgArrPerExpectedGoLive = Math.max(0, input.avgArrPerExpectedGoLive);
  const netGapArr = Math.max(0, input.targetNetArr - input.forecastNetArr);
  const hasGap = netGapArr > 0;
  const status: 'on_track' | 'gap' = netGapArr > 0 ? 'gap' : 'on_track';

  const baselineLeadVolumePerMonth = Math.max(
    0,
    input.baselineDefaults?.leadVolumePerFutureMonth ?? input.ytdAvgLeadsPerMonth
  );
  const baselineLeadConversionPercent = Math.max(0, input.baselineDefaults?.leadConversionPercent ?? 16);
  const baselineChurnFactorPercent = Math.max(0, input.baselineDefaults?.churnFactorPercent ?? 100);
  const baselineNetArr = input.baselineDefaults?.forecastNetArr ?? input.forecastNetArr;
  const scenarioNetArr = input.forecastNetArr;
  const deltaNetArrVsBaseline = scenarioNetArr - baselineNetArr;

  const additionalLeadsPerMonthVsBaseline = leadVolumePerFutureMonth - baselineLeadVolumePerMonth;
  const additionalLeadsTotalVsBaseline = additionalLeadsPerMonthVsBaseline * futureMonthsCount;

  const netArrPerAdditionalLeadPerMonth =
    futureMonthsCount > 0 ? futureMonthsCount * leadConversionRate * avgArrPerExpectedGoLive : 0;
  const netArrPerConversionPoint = Math.max(0, input.scenarioFutureLeads) * 0.01 * avgArrPerExpectedGoLive;
  const netArrPerChurnPointReduction = Math.max(0, input.futurePlanChurnArr) * 0.01;
  const additionalArrFromLeadVolumeVsBaseline = additionalLeadsPerMonthVsBaseline * netArrPerAdditionalLeadPerMonth;
  const conversionDeltaPctPointsVsBaseline = input.leadConversionPercent - baselineLeadConversionPercent;
  const additionalLeadsFromConversionVsBaseline = input.scenarioFutureLeads * (conversionDeltaPctPointsVsBaseline / 100);
  const additionalArrFromConversionVsBaseline = conversionDeltaPctPointsVsBaseline * netArrPerConversionPoint;
  const churnFactorDeltaPctPointsVsBaseline = input.churnFactorPercent - baselineChurnFactorPercent;
  const additionalArrFromChurnDeltaVsBaseline = -churnFactorDeltaPctPointsVsBaseline * netArrPerChurnPointReduction;

  const requiredLeadDelta =
    netGapArr > 0 && netArrPerAdditionalLeadPerMonth > 0 ? netGapArr / netArrPerAdditionalLeadPerMonth : 0;
  const requiredConversionDelta =
    netGapArr > 0 && netArrPerConversionPoint > 0 ? netGapArr / netArrPerConversionPoint : 0;
  const requiredChurnReduction =
    netGapArr > 0 && netArrPerChurnPointReduction > 0 ? netGapArr / netArrPerChurnPointReduction : 0;

  const plausibleLeadUpper = Math.max(8, baselineLeadVolumePerMonth * 0.35);
  const plausibleConversionUpper = 6;
  const plausibleChurnUpper = 25;
  const suggestedLeadDelta = hasGap
    ? Math.min(Math.max(requiredLeadDelta * 0.45, 5), plausibleLeadUpper)
    : Math.max(3, baselineLeadVolumePerMonth * 0.1);
  const suggestedConversionDelta = hasGap
    ? Math.min(Math.max(requiredConversionDelta * 0.45, 1.0), plausibleConversionUpper)
    : 1.0;
  const suggestedChurnReduction = hasGap
    ? Math.min(Math.max(requiredChurnReduction * 0.35, 5), plausibleChurnUpper)
    : 5;
  const suggestedLeadArr = suggestedLeadDelta * netArrPerAdditionalLeadPerMonth;
  const suggestedConversionArr = suggestedConversionDelta * netArrPerConversionPoint;
  const suggestedChurnArr = suggestedChurnReduction * netArrPerChurnPointReduction;
  const suggestedBalancedArr = suggestedLeadArr + suggestedConversionArr + suggestedChurnArr;

  const actions: ScenarioActionRecommendation[] = [
    {
      key: 'lead_volume',
      title: 'Lead-Volumen erhöhen',
      impactPerUnitNetArr: round2(netArrPerAdditionalLeadPerMonth),
      requiredDelta: round2(suggestedLeadDelta),
      unit: 'Leads/Monat',
      details: `Plausibler Zielbeitrag aus Channel-Mix: +${round2(suggestedLeadDelta)} Leads/Monat => ARR-Hebel ${round2(
        suggestedLeadArr
      )} EUR.`,
    },
    {
      key: 'conversion',
      title: 'Lead->Go-Live Conversion steigern',
      impactPerUnitNetArr: round2(netArrPerConversionPoint),
      requiredDelta: round2(suggestedConversionDelta),
      unit: 'Prozentpunkte',
      details: `Plausibler Delta-Wert ggü. Szenario: +${round2(
        suggestedConversionDelta
      )}pp => ARR-Hebel ${round2(suggestedConversionArr)} EUR.`,
    },
    {
      key: 'churn',
      title: 'Future-Churn-Faktor reduzieren',
      impactPerUnitNetArr: round2(netArrPerChurnPointReduction),
      requiredDelta: round2(suggestedChurnReduction),
      unit: 'Prozentpunkte',
      details: `Vorgeschlagener Zielbeitrag: -${round2(suggestedChurnReduction)}pp Churn-Faktor => ARR-Hebel ${round2(
        suggestedChurnArr
      )} EUR.`,
    },
    {
      key: 'balanced',
      title: 'Balanced Mix (drei Hebel kombiniert)',
      impactPerUnitNetArr: round2(suggestedBalancedArr),
      requiredDelta: round2(netGapArr),
      unit: 'EUR Gap',
      details: `Richtwert: +${round2(suggestedLeadDelta)} Leads/Monat, +${round2(
        suggestedConversionDelta
      )}pp Conversion, -${round2(suggestedChurnReduction)}pp Churn-Faktor.`,
    },
  ];

  const summaryLines =
    status === 'on_track'
      ? [
          `Forecast NET ARR (${round2(input.forecastNetArr)}) liegt auf/über Target (${round2(input.targetNetArr)}).`,
          `Delta ARR Prognose vs. Baseline: ${round2(deltaNetArrVsBaseline)} EUR.`,
          'Fokus auf Stabilisierung: Conversion und Churn eng monitoren, um keinen Rebound ins Gap zu bekommen.',
        ]
      : [
          `Forecast NET ARR (${round2(input.forecastNetArr)}) liegt unter Target (${round2(input.targetNetArr)}).`,
          `Aktuelles Gap: ${round2(netGapArr)} EUR.`,
          `Delta ARR Prognose vs. Baseline: ${round2(deltaNetArrVsBaseline)} EUR (Szenario ${round2(
            scenarioNetArr
          )} EUR vs. Baseline ${round2(baselineNetArr)} EUR).`,
          `Leads-only-Szenario: +${round2(requiredLeadDelta)} Leads/Monat zusätzlich.`,
          `Conversion-only-Szenario: +${round2(requiredConversionDelta)} Prozentpunkte.`,
          `Churn-only-Szenario: -${round2(requiredChurnReduction)} Prozentpunkte auf den Churn-Faktor.`,
        ];

  const headline =
    status === 'on_track'
      ? 'Szenario liegt aktuell auf Zielkurs'
      : 'Szenario verfehlt aktuell das Ziel - Maßnahmen erforderlich';

  return {
    mode: 'rules',
    title: 'Forecast Maßnahmen-Report',
    headline,
    status,
    year: input.year,
    netGapArr: round2(netGapArr),
    assumptions: {
      futureMonthsCount,
      leadConversionPercent: round2(input.leadConversionPercent),
      leadVolumePerFutureMonth: round2(leadVolumePerFutureMonth),
      churnFactorPercent: round2(input.churnFactorPercent),
      avgArrPerExpectedGoLive: round2(avgArrPerExpectedGoLive),
      expectedGoLivesFromLeads: round2(input.expectedGoLivesFromLeads),
    },
    leverSensitivity: {
      netArrPerAdditionalLeadPerMonth: round2(netArrPerAdditionalLeadPerMonth),
      netArrPerConversionPoint: round2(netArrPerConversionPoint),
      netArrPerChurnPointReduction: round2(netArrPerChurnPointReduction),
    },
    scenarioDelta: {
      baselineNetArr: round2(baselineNetArr),
      scenarioNetArr: round2(scenarioNetArr),
      deltaNetArrVsBaseline: round2(deltaNetArrVsBaseline),
      additionalLeadsPerMonthVsBaseline: round2(additionalLeadsPerMonthVsBaseline),
      additionalLeadsTotalVsBaseline: round2(additionalLeadsTotalVsBaseline),
      additionalArrFromLeadVolumeVsBaseline: round2(additionalArrFromLeadVolumeVsBaseline),
      conversionDeltaPctPointsVsBaseline: round2(conversionDeltaPctPointsVsBaseline),
      additionalLeadsFromConversionVsBaseline: round2(additionalLeadsFromConversionVsBaseline),
      additionalArrFromConversionVsBaseline: round2(additionalArrFromConversionVsBaseline),
      churnFactorDeltaPctPointsVsBaseline: round2(churnFactorDeltaPctPointsVsBaseline),
      additionalArrFromChurnDeltaVsBaseline: round2(additionalArrFromChurnDeltaVsBaseline),
    },
    actions,
    summaryLines,
    generatedAtIso: new Date().toISOString(),
  };
}

function normalizeScenarioInput(input: ScenarioReportInput): ScenarioReportInput {
  const normalizedLeadInsights = input.leadInsights
    ? {
        sourceSummary: (input.leadInsights.sourceSummary || []).slice(0, 8).map((row) => ({
          source: String(row.source || ''),
          leads: toSafeNumber(row.leads),
          tamFitPercent: row.tamFitPercent === null ? null : toSafeNumber(row.tamFitPercent),
          leadToGoLivePercent: row.leadToGoLivePercent === null ? null : toSafeNumber(row.leadToGoLivePercent),
        })),
        statusSummary: input.leadInsights.statusSummary
          ? {
              qualified: toSafeNumber(input.leadInsights.statusSummary.qualified),
              notConverted: toSafeNumber(input.leadInsights.statusSummary.notConverted),
              working: toSafeNumber(input.leadInsights.statusSummary.working),
              newlyCreated: toSafeNumber(input.leadInsights.statusSummary.newlyCreated),
              qualifiedVsNotConvertedRatio:
                input.leadInsights.statusSummary.qualifiedVsNotConvertedRatio === null
                  ? null
                  : toSafeNumber(input.leadInsights.statusSummary.qualifiedVsNotConvertedRatio),
            }
          : undefined,
        cohortSummary: input.leadInsights.cohortSummary
          ? {
              leadToDemoCompletedRateYtd:
                input.leadInsights.cohortSummary.leadToDemoCompletedRateYtd === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.leadToDemoCompletedRateYtd),
              leadToSignupRateYtd:
                input.leadInsights.cohortSummary.leadToSignupRateYtd === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.leadToSignupRateYtd),
              leadToGoLiveRateYtd:
                input.leadInsights.cohortSummary.leadToGoLiveRateYtd === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.leadToGoLiveRateYtd),
              avgLeadToDemoCompletedDays:
                input.leadInsights.cohortSummary.avgLeadToDemoCompletedDays === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.avgLeadToDemoCompletedDays),
              avgLeadToSignupDays:
                input.leadInsights.cohortSummary.avgLeadToSignupDays === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.avgLeadToSignupDays),
              avgLeadToGoLiveDays:
                input.leadInsights.cohortSummary.avgLeadToGoLiveDays === null
                  ? null
                  : toSafeNumber(input.leadInsights.cohortSummary.avgLeadToGoLiveDays),
            }
          : undefined,
        repSummary: (input.leadInsights.repSummary || []).slice(0, 8).map((row) => ({
          rep: String(row.rep || ''),
          leads: toSafeNumber(row.leads),
          leadToGoLivePercent: row.leadToGoLivePercent === null ? null : toSafeNumber(row.leadToGoLivePercent),
        })),
        leadDetailSignals: input.leadInsights.leadDetailSignals
          ? {
              qualifiedOrWorkingWithoutDemo: toSafeNumber(input.leadInsights.leadDetailSignals.qualifiedOrWorkingWithoutDemo),
              notConvertedLeads: toSafeNumber(input.leadInsights.leadDetailSignals.notConvertedLeads),
              validLeadSharePercent:
                input.leadInsights.leadDetailSignals.validLeadSharePercent === null
                  ? null
                  : toSafeNumber(input.leadInsights.leadDetailSignals.validLeadSharePercent),
              keyRisks: (input.leadInsights.leadDetailSignals.keyRisks || []).slice(0, 6).map((item) => String(item || '')),
            }
          : undefined,
      }
    : undefined;

  return {
    ...input,
    userId: input.userId ? String(input.userId) : undefined,
    year: Math.round(toSafeNumber(input.year)),
    leadConversionPercent: toSafeNumber(input.leadConversionPercent),
    leadVolumePerFutureMonth: toSafeNumber(input.leadVolumePerFutureMonth),
    churnFactorPercent: toSafeNumber(input.churnFactorPercent),
    futureMonthsCount: toSafeNumber(input.futureMonthsCount),
    baselineFutureLeads: toSafeNumber(input.baselineFutureLeads),
    scenarioFutureLeads: toSafeNumber(input.scenarioFutureLeads),
    ytdAvgLeadsPerMonth: toSafeNumber(input.ytdAvgLeadsPerMonth),
    avgArrPerExpectedGoLive: toSafeNumber(input.avgArrPerExpectedGoLive),
    expectedGoLivesFromLeads: toSafeNumber(input.expectedGoLivesFromLeads),
    forecastNetArr: toSafeNumber(input.forecastNetArr),
    targetNetArr: toSafeNumber(input.targetNetArr),
    forecastSubsArr: toSafeNumber(input.forecastSubsArr),
    targetSubsArr: toSafeNumber(input.targetSubsArr),
    forecastPayArr: toSafeNumber(input.forecastPayArr),
    targetPayArr: toSafeNumber(input.targetPayArr),
    forecastChurnArr: toSafeNumber(input.forecastChurnArr),
    forecastWeightedPipelineArr: toSafeNumber(input.forecastWeightedPipelineArr || 0),
    ytdBookedNetArr: toSafeNumber(input.ytdBookedNetArr),
    futurePlanChurnArr: toSafeNumber(input.futurePlanChurnArr),
    scenarioFutureChurnArr: toSafeNumber(input.scenarioFutureChurnArr),
    historicalContext: input.historicalContext
      ? {
          snapshotDateIso: String(input.historicalContext.snapshotDateIso || ''),
          daysSinceSnapshot: toSafeNumber(input.historicalContext.daysSinceSnapshot),
          deltaNetArr: toSafeNumber(input.historicalContext.deltaNetArr),
          deltaSubsArr: toSafeNumber(input.historicalContext.deltaSubsArr),
          deltaPayArr: toSafeNumber(input.historicalContext.deltaPayArr),
          deltaChurnArr: toSafeNumber(input.historicalContext.deltaChurnArr),
          deltaWeightedPipelineArr: toSafeNumber(input.historicalContext.deltaWeightedPipelineArr),
          deltaNetGapArr: toSafeNumber(input.historicalContext.deltaNetGapArr),
        }
      : undefined,
    baselineDefaults: input.baselineDefaults
      ? {
          leadConversionPercent: toSafeNumber(input.baselineDefaults.leadConversionPercent),
          leadVolumePerFutureMonth: toSafeNumber(input.baselineDefaults.leadVolumePerFutureMonth),
          churnFactorPercent: toSafeNumber(input.baselineDefaults.churnFactorPercent),
          forecastNetArr: toSafeNumber(input.baselineDefaults.forecastNetArr),
          netGapArr: toSafeNumber(input.baselineDefaults.netGapArr),
        }
      : undefined,
    scenarioAssessment: input.scenarioAssessment
      ? {
          forecastNetArr: toSafeNumber(input.scenarioAssessment.forecastNetArr),
          netGapArr: toSafeNumber(input.scenarioAssessment.netGapArr),
          leadVolumeChangePercentVsBaseline: toSafeNumber(input.scenarioAssessment.leadVolumeChangePercentVsBaseline),
          conversionDeltaPctPointsVsBaseline: toSafeNumber(input.scenarioAssessment.conversionDeltaPctPointsVsBaseline),
          churnFactorDeltaPctPointsVsBaseline: toSafeNumber(input.scenarioAssessment.churnFactorDeltaPctPointsVsBaseline),
          feasibilityScore: toSafeNumber(input.scenarioAssessment.feasibilityScore),
          feasibilityBand:
            input.scenarioAssessment.feasibilityBand === 'high' ||
            input.scenarioAssessment.feasibilityBand === 'medium' ||
            input.scenarioAssessment.feasibilityBand === 'low'
              ? input.scenarioAssessment.feasibilityBand
              : 'medium',
        }
      : undefined,
    leadInsights: normalizedLeadInsights,
    tableSignals: input.tableSignals
      ? {
          salespipeRows: toSafeNumber(input.tableSignals.salespipeRows),
          signupsRows: toSafeNumber(input.tableSignals.signupsRows),
          leadsRows: toSafeNumber(input.tableSignals.leadsRows),
          lookerLeadsRows: toSafeNumber(input.tableSignals.lookerLeadsRows),
          churnRows: toSafeNumber(input.tableSignals.churnRows),
          hasPlanzahlen: Boolean(input.tableSignals.hasPlanzahlen),
          keyRiskCount: toSafeNumber(input.tableSignals.keyRiskCount),
        }
      : undefined,
  };
}

export async function generateScenarioReportWithDiagnostics(
  input: ScenarioReportInput,
  options?: GenerateScenarioReportOptions
): Promise<ScenarioReportWithDiagnostics> {
  const safeInput: ScenarioReportInput = {
    ...normalizeScenarioInput(input),
  };

  const report = buildRulesReport(safeInput);
  const provider = options?.provider ?? narrativeProvider;
  if (!options?.useLlm || !provider) {
    return {
      report,
      diagnostics: {
        llmAttempted: false,
        llmError: null,
      },
    };
  }

  try {
    const narrative = await provider.generateNarrative(safeInput, report);
    if (!narrative || !narrative.trim()) {
      return {
        report,
        diagnostics: {
          llmAttempted: true,
          llmError: 'LLM hat keinen Text zurueckgegeben',
        },
      };
    }
    return {
      report: { ...report, mode: 'llm', narrative: narrative.trim() },
      diagnostics: {
        llmAttempted: true,
        llmError: null,
      },
    };
  } catch (error: any) {
    return {
      report,
      diagnostics: {
        llmAttempted: true,
        llmError: error?.message || 'Unbekannter LLM-Fehler',
      },
    };
  }
}

export async function generateScenarioReport(
  input: ScenarioReportInput,
  options?: GenerateScenarioReportOptions
): Promise<ScenarioReport> {
  const result = await generateScenarioReportWithDiagnostics(input, options);
  return result.report;
}
