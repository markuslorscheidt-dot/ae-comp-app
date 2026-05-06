import type { ScenarioNarrativeProvider, ScenarioReport, ScenarioReportInput } from './forecastScenarioReport';

interface OpenAIChatChoice {
  message?: {
    content?: string;
  };
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[];
  error?: {
    message?: string;
  };
}

export interface OpenAIScenarioProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  baseUrl?: string;
}

function round(value: number, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number, decimals = 2) {
  return round(value, decimals).toFixed(decimals);
}

function formatNullable(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return formatNumber(value, decimals);
}

function buildPrompt(input: ScenarioReportInput, report: ScenarioReport) {
  const actions = report.actions
    .filter((action) => action.key === 'lead_volume' || action.key === 'conversion' || action.key === 'churn')
    .map(
      (action) =>
        `- ${action.title}: Ziel-Beitrag ${action.requiredDelta} ${action.unit}, Wirkung/Einheit ${action.impactPerUnitNetArr} EUR`
    )
    .join('\n');

  const sourceSummary = (input.leadInsights?.sourceSummary || [])
    .slice(0, 6)
    .map(
      (row) =>
        `- ${row.source}: Leads ${formatNumber(row.leads, 0)}, TAM Fit ${formatNullable(
          row.tamFitPercent,
          1
        )}%, Lead->GoLive ${formatNullable(row.leadToGoLivePercent, 1)}%`
    )
    .join('\n');

  const repSummary = (input.leadInsights?.repSummary || [])
    .slice(0, 6)
    .map(
      (row) =>
        `- ${row.rep}: Leads ${formatNumber(row.leads, 0)}, Lead->GoLive ${formatNullable(row.leadToGoLivePercent, 1)}%`
    )
    .join('\n');

  const status = input.leadInsights?.statusSummary;
  const cohort = input.leadInsights?.cohortSummary;
  const detail = input.leadInsights?.leadDetailSignals;
  const baseline = input.baselineDefaults;
  const scenario = input.scenarioAssessment;
  const detailRisks = (detail?.keyRisks || []).map((item) => `- ${item}`).join('\n');
  const tableSignals = input.tableSignals;
  const historical = input.historicalContext;

  return [
    'Erstelle einen fundierten Management-Report auf Deutsch.',
    'Nutze ausschliesslich die vorgegebenen Zahlen. Erfinde keine neuen Daten.',
    'WICHTIG: Nutze immer die YTD-Defaultwerte als feste Baseline und bewerte das aktuelle Slider-Szenario nur als Delta zur Baseline.',
    'Forecast-Logik (verbindlich fuer die Interpretation): ARR aus Weighted Sales Pipeline wird probability-basiert auf Forecast-Monate projiziert (nicht ueber Schlusstermin-Interpretation), und zwar ueber eine feste Restlaufzeitlogik bis Close Won plus durchschnittlich 24 Tage bis Go-Live.',
    'Management-Fokus (verbindlich bewerten): Wenn Subs ARR den Haupt-Gap traegt, ist dies als strukturelle Schwaeche klar zu benennen; Pay ARR ist davon abhaengig (Defaultannahme 70% Terminal-Anteil bei Neukunden) und kann bei Subs-Unterperformance ueberproportional einbrechen.',
    'Risikohinweis (verbindlich): Ein niedriger NET-Gap darf nicht unkritisch positiv bewertet werden, wenn er ueberwiegend aus einer guten Churn-Prognose stammt. Weisen Sie auf Volatilitaet und ploetzliche Churn-Risiken hin (z.B. Produktprobleme, Firmenschliessungen).',
    'Analysiere die bereitgestellten Tabellenkontexte gruendlich (salespipe_events, signups_events, leads_events, looker_leads_events, churn_events, dlt_planzahlen) und beziehe sie in die Interpretation ein.',
    'Wenn Datenabdeckung unvollstaendig ist, benenne den Unsicherheitsfaktor explizit.',
    'Strukturiere den Text exakt in dieser Reihenfolge und mit diesen Ueberschriften:',
    'Executive Summary:',
    '- 1 praeziser Absatz zum Status Quo inkl. NET Gap und Management-Bewertung.',
    'Hebelwirkung:',
    '- 1 kompakter Absatz zur kombinierten Wirkung der drei Hebel (Lead-Volumen, Conversion, Churn).',
    'CTA:',
    '- genau 3 nummerierte Call-to-Actions (1., 2., 3.), konkret und messbar.',
    'Elevator Pitch:',
    '- 2-3 Saetze, entscheidungsreif, klarer Schlussappell.',
    'Formalia: Zahlen in EUR auf 2 Nachkommastellen, Prozent auf 1 Nachkommastelle, klare Sprache, maximal 320 Woerter.',
    'Keine JSON-Ausgabe.',
    '',
    `Jahr: ${input.year}`,
    `Status: ${report.status}`,
    `NET Gap ARR: ${formatNumber(report.netGapArr, 2)}`,
    `Forecast NET ARR: ${formatNumber(input.forecastNetArr, 2)}`,
    `Target NET ARR: ${formatNumber(input.targetNetArr, 2)}`,
    `Lead Conversion (%): ${formatNumber(input.leadConversionPercent, 1)}`,
    `Lead Volumen pro Future-Monat: ${formatNumber(input.leadVolumePerFutureMonth, 0)}`,
    `Churn Faktor (%): ${formatNumber(input.churnFactorPercent, 0)}`,
    `Future Monate: ${input.futureMonthsCount}`,
    `Szenario-Leads gesamt (Future): ${formatNumber(input.scenarioFutureLeads, 0)}`,
    `YTD Leadschnitt pro Monat: ${formatNumber(input.ytdAvgLeadsPerMonth, 1)}`,
    `Erwartete Go-Lives aus Leads: ${formatNumber(input.expectedGoLivesFromLeads, 2)}`,
    `Ø ARR pro erwartetem Go-Live: ${formatNumber(input.avgArrPerExpectedGoLive, 2)}`,
    '',
    'Header-Tiles (immer als Ausgangspunkt interpretieren):',
    `- Forecast Summe Subs ARR: ${formatNumber(input.forecastSubsArr, 2)} EUR (Gap ${formatNumber(input.targetSubsArr - input.forecastSubsArr, 2)} EUR)`,
    `- Forecast Summe Pay ARR: ${formatNumber(input.forecastPayArr, 2)} EUR (Gap ${formatNumber(input.targetPayArr - input.forecastPayArr, 2)} EUR)`,
    `- Forecast Churn ARR: ${formatNumber(input.forecastChurnArr, 2)} EUR (Plan Future ${formatNumber(input.futurePlanChurnArr, 2)} EUR / Szenario Future ${formatNumber(input.scenarioFutureChurnArr, 2)} EUR)`,
    `- ARR aus Weighted Sales Pipeline: ${formatNumber(input.forecastWeightedPipelineArr || 0, 2)} EUR`,
    `- Forecast Summe NET ARR: ${formatNumber(input.forecastNetArr, 2)} EUR (Gap ${formatNumber(report.netGapArr, 2)} EUR)`,
    '- Interpretationsregel: Subs-Gap vor Pay-Gap priorisieren; Churn-Entlastung als potenziell volatil markieren.',
    '',
    'Historischer Vergleich (letzter 4-Wochen-Snapshot):',
    historical
      ? `- Snapshot Datum: ${historical.snapshotDateIso} (${formatNumber(historical.daysSinceSnapshot, 0)} Tage her)`
      : '- Snapshot Datum: n/a',
    historical ? `- Delta Forecast NET ARR: ${formatNumber(historical.deltaNetArr, 2)} EUR` : '- Delta Forecast NET ARR: n/a',
    historical ? `- Delta Forecast Subs ARR: ${formatNumber(historical.deltaSubsArr, 2)} EUR` : '- Delta Forecast Subs ARR: n/a',
    historical ? `- Delta Forecast Pay ARR: ${formatNumber(historical.deltaPayArr, 2)} EUR` : '- Delta Forecast Pay ARR: n/a',
    historical ? `- Delta Forecast Churn ARR: ${formatNumber(historical.deltaChurnArr, 2)} EUR` : '- Delta Forecast Churn ARR: n/a',
    historical
      ? `- Delta ARR aus Weighted Sales Pipeline: ${formatNumber(historical.deltaWeightedPipelineArr, 2)} EUR`
      : '- Delta ARR aus Weighted Sales Pipeline: n/a',
    historical ? `- Delta NET Gap ARR: ${formatNumber(historical.deltaNetGapArr, 2)} EUR` : '- Delta NET Gap ARR: n/a',
    '',
    'Hebel-Sensitivitaet:',
    `- +1 Lead/Monat: ${formatNumber(report.leverSensitivity.netArrPerAdditionalLeadPerMonth, 2)} EUR`,
    `- +1pp Conversion: ${formatNumber(report.leverSensitivity.netArrPerConversionPoint, 2)} EUR`,
    `- -1pp Churn-Faktor: ${formatNumber(report.leverSensitivity.netArrPerChurnPointReduction, 2)} EUR`,
    '',
    'Massnahmenkandidaten:',
    actions,
    '',
    'Baseline Defaults (fixe Referenz, YTD):',
    `- Lead Conversion (%): ${formatNullable(baseline?.leadConversionPercent, 1)}%`,
    `- Lead Volumen/Monat: ${formatNullable(baseline?.leadVolumePerFutureMonth, 0)}`,
    `- Churn Faktor (%): ${formatNullable(baseline?.churnFactorPercent, 0)}%`,
    `- Forecast NET ARR (Baseline): ${formatNullable(baseline?.forecastNetArr, 2)} EUR`,
    `- NET Gap (Baseline): ${formatNullable(baseline?.netGapArr, 2)} EUR`,
    '',
    'Aktuelles Slider-Szenario (zu bewerten):',
    `- Forecast NET ARR (Szenario): ${formatNullable(scenario?.forecastNetArr, 2)} EUR`,
    `- NET Gap (Szenario): ${formatNullable(scenario?.netGapArr, 2)} EUR`,
    `- Lead Volumen Delta vs Baseline: ${formatNullable(scenario?.leadVolumeChangePercentVsBaseline, 1)}%`,
    `- Conversion Delta vs Baseline: ${formatNullable(scenario?.conversionDeltaPctPointsVsBaseline, 1)}pp`,
    `- Churn-Faktor Delta vs Baseline: ${formatNullable(scenario?.churnFactorDeltaPctPointsVsBaseline, 1)}pp`,
    `- Feasibility Score: ${formatNullable(scenario?.feasibilityScore, 0)}/100 (${scenario?.feasibilityBand || 'n/a'})`,
    '',
    'Lead Source (aus Looker Leads):',
    sourceSummary || '- n/a',
    '',
    'Lead Status (aus Looker Leads):',
    `- Qualified: ${formatNumber(status?.qualified || 0, 0)}`,
    `- Not converted: ${formatNumber(status?.notConverted || 0, 0)}`,
    `- Working: ${formatNumber(status?.working || 0, 0)}`,
    `- New: ${formatNumber(status?.newlyCreated || 0, 0)}`,
    `- Ratio Qualified/Not converted: ${formatNullable(status?.qualifiedVsNotConvertedRatio, 2)}`,
    '',
    'Cohort-Indikatoren (aus Looker Leads):',
    `- Lead->Demo completed (% YTD): ${formatNullable(cohort?.leadToDemoCompletedRateYtd, 2)}%`,
    `- Lead->Signup (% YTD): ${formatNullable(cohort?.leadToSignupRateYtd, 2)}%`,
    `- Lead->GoLive (% YTD): ${formatNullable(cohort?.leadToGoLiveRateYtd, 2)}%`,
    `- Avg Lead->Demo completed (Tage): ${formatNullable(cohort?.avgLeadToDemoCompletedDays, 1)}`,
    `- Avg Lead->Signup (Tage): ${formatNullable(cohort?.avgLeadToSignupDays, 1)}`,
    `- Avg Lead->GoLive (Tage): ${formatNullable(cohort?.avgLeadToGoLiveDays, 1)}`,
    '',
    'Sales Representative Leaderboard (aus Looker Leads):',
    repSummary || '- n/a',
    '',
    'Lead Level Risiken (aus Looker Leads):',
    `- Qualified/Working ohne Demo: ${formatNumber(detail?.qualifiedOrWorkingWithoutDemo || 0, 0)}`,
    `- Not converted Leads: ${formatNumber(detail?.notConvertedLeads || 0, 0)}`,
    `- Valid Lead Share: ${formatNullable(detail?.validLeadSharePercent, 1)}%`,
    ...(detailRisks ? ['- Key Risks:', detailRisks] : []),
    '',
    'Tabellenkontext (Datenabdeckung fuer Interpretation):',
    `- salespipe_events Zeilen: ${formatNumber(tableSignals?.salespipeRows || 0, 0)}`,
    `- signups_events Zeilen: ${formatNumber(tableSignals?.signupsRows || 0, 0)}`,
    `- leads_events Zeilen: ${formatNumber(tableSignals?.leadsRows || 0, 0)}`,
    `- looker_leads_events Zeilen: ${formatNumber(tableSignals?.lookerLeadsRows || 0, 0)}`,
    `- churn_events Zeilen: ${formatNumber(tableSignals?.churnRows || 0, 0)}`,
    `- dlt_planzahlen vorhanden: ${tableSignals?.hasPlanzahlen ? 'ja' : 'nein'}`,
    `- erkannte Key-Risiken: ${formatNumber(tableSignals?.keyRiskCount || 0, 0)}`,
    '',
    'Antwort nur als Klartext, keine JSON-Ausgabe.',
  ].join('\n');
}

async function callOpenAI(config: OpenAIScenarioProviderConfig, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_completion_tokens: config.maxTokens,
        messages: [
          {
            role: 'system',
            content:
              'Du bist ein praeziser Business-Analyst fuer DACH Forecast-Planung. Sei faktenbasiert, knapp und handlungsorientiert. Halte dich strikt an die vorgegebene Abschnittsstruktur.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as OpenAIChatResponse;
    if (!response.ok) {
      throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
    }
    const text = String(data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('OpenAI hat keinen Text zurueckgegeben');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export function createOpenAIScenarioNarrativeProvider(
  config: OpenAIScenarioProviderConfig
): ScenarioNarrativeProvider {
  return {
    async generateNarrative(input: ScenarioReportInput, report: ScenarioReport) {
      const prompt = buildPrompt(input, report);
      return callOpenAI(config, prompt);
    },
  };
}
