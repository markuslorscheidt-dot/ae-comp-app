import { 
  AESettings, 
  GoLive, 
  ProvisionTier, 
  MonthlyResult, 
  YearSummary,
  OTEProjection,
  MONTH_NAMES,
  DEFAULT_SETTINGS,
  DEFAULT_SUBS_TIERS,
  DEFAULT_PAY_TIERS,
  DEFAULT_TOTAL_ARR_TIERS,
  DEFAULT_MONTHLY_GO_LIVE_TARGETS
} from './types';

/**
 * Ermittelt die Provisions-Rate basierend auf der Zielerreichung
 */
export function getProvisionRate(achievement: number, tiers: ProvisionTier[]): number {
  for (const tier of tiers) {
    if (achievement >= tier.min && achievement < tier.max) {
      return tier.rate;
    }
  }
  // Falls über allen Tiers, nimm die letzte Rate
  return tiers[tiers.length - 1].rate;
}

/**
 * Ermittelt das aktuelle Tier-Label basierend auf der Zielerreichung
 */
export function getCurrentTierLabel(achievement: number, tiers: ProvisionTier[]): string {
  for (const tier of tiers) {
    if (achievement >= tier.min && achievement < tier.max) {
      return tier.label;
    }
  }
  return tiers[tiers.length - 1].label;
}

/**
 * OTC = Base Salary + Variable OTE
 */
export function calculateOtc(baseSalary: number, variableOte: number): number {
  return Math.max(0, (baseSalary || 0) + (variableOte || 0));
}

/**
 * Quota ARR = OTC * Multiple
 */
export function calculateQuotaFromMultiple(otc: number, arrMultiple: number): number {
  return Math.max(0, otc * (arrMultiple || 0));
}

/**
 * CAC Payback (Monate) = OTC / (Quota * Gross Margin) * 12
 */
export function calculateCacPaybackMonths(otc: number, quotaArr: number, grossMarginPct: number): number {
  const contribution = quotaArr * ((grossMarginPct || 0) / 100);
  if (contribution <= 0) return Infinity;
  return (otc / contribution) * 12;
}

/**
 * Rueckwaertsrechnung: Welche Bruttomarge wird fuer einen Ziel-Payback benoetigt?
 * Formel umgestellt aus:
 *   payback = otc / (quota * margin) * 12
 */
export function calculateRequiredGrossMarginPctForPayback(
  otc: number,
  quotaArr: number,
  targetPaybackMonths: number
): number | null {
  if (otc <= 0 || quotaArr <= 0 || targetPaybackMonths <= 0) return null;
  const requiredContribution = (otc * 12) / targetPaybackMonths;
  return (requiredContribution / quotaArr) * 100;
}

/**
 * Rueckwaertsrechnung: Welches ARR-Multiple wird fuer einen Ziel-Payback benoetigt?
 * Mit quota = otc * multiple und:
 *   payback = otc / (quota * margin) * 12
 * => multiple = 12 / (payback * margin)
 */
export function calculateRequiredArrMultipleForPayback(
  grossMarginPct: number,
  targetPaybackMonths: number,
  activeMonthsInYear: number = 12
): number | null {
  const marginFraction = (grossMarginPct || 0) / 100;
  if (marginFraction <= 0 || targetPaybackMonths <= 0) return null;
  const monthsFactor = Math.min(12, Math.max(1, Math.round(activeMonthsInYear))) / 12;
  return 12 / (targetPaybackMonths * marginFraction * monthsFactor);
}

/**
 * Liefert zentrale Multiple-/OTC-Kalibrierungskennzahlen.
 */
export function calculateMultipleCalibration(settings: AESettings, plannedTerminals: number = 0) {
  const baseSalary = settings.base_salary ?? 0;
  const variableOte = settings.variable_ote ?? settings.ote ?? 0;
  const arrMultiple = settings.arr_multiple ?? DEFAULT_SETTINGS.arr_multiple;
  const grossMarginPct = settings.gross_margin_pct ?? DEFAULT_SETTINGS.gross_margin_pct;

  const otc = calculateOtc(baseSalary, variableOte);
  const quotaArrAnnual = calculateQuotaFromMultiple(otc, arrMultiple);
  const activeMonths = Math.min(12, Math.max(1, Math.round(settings.active_months_in_year ?? 12)));
  const quotaArr = quotaArrAnnual * (activeMonths / 12);
  const paybackMonths = calculateCacPaybackMonths(otc, quotaArr, grossMarginPct);

  const totalArrTarget = (settings.monthly_total_arr_targets?.reduce((sum, v) => sum + (v || 0), 0) || 0)
    || ((settings.monthly_subs_targets?.reduce((sum, v) => sum + (v || 0), 0) || 0)
      + (settings.monthly_pay_targets?.reduce((sum, v) => sum + (v || 0), 0) || 0));

  const totalTiers = settings.total_arr_tiers || settings.subs_tiers || DEFAULT_TOTAL_ARR_TIERS;
  const totalRateAt100 = getProvisionRate(1.0, totalTiers);
  const expectedProvisionAt100 = totalArrTarget * totalRateAt100;

  const yearlyGoLives = settings.monthly_go_live_targets?.reduce((a, b) => a + (b || 0), 0) || 0;
  const penetration = yearlyGoLives > 0 ? plannedTerminals / yearlyGoLives : 0;
  const terminalRate = penetration >= settings.terminal_penetration_threshold
    ? settings.terminal_bonus
    : settings.terminal_base;
  const terminalProvisionAt100 = plannedTerminals * terminalRate;

  const expectedTotalPayoutAt100 = expectedProvisionAt100 + terminalProvisionAt100;
  const quotaDeviationPct = quotaArr > 0 ? ((totalArrTarget - quotaArr) / quotaArr) * 100 : 0;

  return {
    baseSalary,
    variableOte,
    otc,
    arrMultiple,
    grossMarginPct,
    activeMonths,
    quotaArrAnnual,
    quotaArr,
    totalArrTarget,
    quotaDeviationPct,
    paybackMonths,
    expectedProvisionAt100,
    terminalProvisionAt100,
    expectedTotalPayoutAt100,
  };
}

/**
 * Berechnet die Terminal-Rate basierend auf Penetration
 * ≥70% → Bonus-Rate, sonst Basis-Rate
 */
export function getTerminalRate(
  terminalsCount: number, 
  goLivesCount: number, 
  settings: AESettings
): number {
  if (goLivesCount === 0) return settings.terminal_base;
  
  const penetration = terminalsCount / goLivesCount;
  return penetration >= settings.terminal_penetration_threshold 
    ? settings.terminal_bonus 
    : settings.terminal_base;
}

/** Kohorten-Key für Paymargin-Import (Jahr + Go-Live-Monat der Zeile). */
export function paymarginCohortKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export type PayArrReportingOptions = {
  /** Wenn gesetzt: für diese Kohorten kein Planungs-Default (avg_pay_bill×12), nur pay_arr / pay_arr_target / 0 */
  paymarginImportedCohortKeys?: ReadonlySet<string>;
};

/**
 * PAY IST für Reporting:
 * 1) Finance-Actual (pay_arr), falls vorhanden
 * 2) sonst Go-Live Forecast (pay_arr_target)
 * 3) sonst Settings-Default bei Terminal (avg_pay_bill * 12) — nur wenn für die Kohorte kein Paymargin-Commit existiert
 */
export function getEffectivePayArrForReporting(gl: GoLive, settings: AESettings, options?: PayArrReportingOptions): number {
  if (gl.pay_arr !== null && gl.pay_arr !== undefined) return gl.pay_arr;
  if (gl.pay_arr_target !== null && gl.pay_arr_target !== undefined) return gl.pay_arr_target;
  if (!gl.has_terminal) return 0;
  const cohortKey = paymarginCohortKey(gl.year, gl.month);
  const imported = options?.paymarginImportedCohortKeys;
  if (imported !== undefined && imported.has(cohortKey)) {
    return 0;
  }
  return (settings.avg_pay_bill || 0) * 12;
}

/**
 * Berechnet das Monatsergebnis
 * Für ARR-Tracking: Alle Go-Lives zählen
 * Für Provision: Nur commission_relevant Go-Lives
 * 
 * NEU: Pay Provision in M0 (Target) und M3 (Ist) aufgeteilt
 * - M0: Provision wird auf Basis von pay_arr_target berechnet und sofort ausgezahlt
 * - M3: Nach 3 Monaten wird pay_arr (Ist) verglichen
 *       Falls Ist < Target → Clawback (Rückforderung der Differenz)
 */
export function calculateMonthlyResult(
  month: number,
  goLives: GoLive[],
  settings: AESettings,
  payOptions?: PayArrReportingOptions
): MonthlyResult {
  const monthGoLives = goLives.filter(gl => gl.month === month);
  
  // Für Provision: Nur commission_relevant Go-Lives
  const commissionGoLives = monthGoLives.filter(gl => gl.commission_relevant !== false);
  
  // Zähler (alle Go-Lives für ARR-Tracking)
  const goLivesCount = monthGoLives.length;
  const goLivesTarget = settings.monthly_go_live_targets?.[month - 1] || DEFAULT_MONTHLY_GO_LIVE_TARGETS[month - 1] || 0;
  const terminalsCount = monthGoLives.filter(gl => gl.has_terminal).length;
  const terminalPenetration = goLivesCount > 0 ? terminalsCount / goLivesCount : 0;
  
  // ARR-Werte (alle Go-Lives)
  const subsActualTotal = monthGoLives.reduce((sum, gl) => sum + (gl.subs_arr || 0), 0);
  const payActualTotal = monthGoLives.reduce(
    (sum, gl) => sum + getEffectivePayArrForReporting(gl, settings, payOptions),
    0
  );
  
  // Pay ARR Target (Summe der Targets bei Go-Live, alle Go-Lives)
  const payArrTargetTotal = monthGoLives.reduce((sum, gl) => sum + (gl.pay_arr_target || 0), 0);
  
  // Provision nur für commission_relevant Go-Lives
  const commissionTerminals = commissionGoLives.filter(gl => gl.has_terminal).length;
  const subsActualCommission = commissionGoLives.reduce((sum, gl) => sum + (gl.subs_arr || 0), 0);
  const payActualCommission = commissionGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
  // Pay ARR Target für commission_relevant Go-Lives
  const payArrTargetCommission = commissionGoLives.reduce((sum, gl) => sum + (gl.pay_arr_target || 0), 0);
  
  // Subs ARR (Zielerreichung basiert auf commission_relevant)
  const subsTarget = settings.monthly_subs_targets?.[month - 1] || 0;
  const subsAchievement = subsTarget > 0 ? subsActualCommission / subsTarget : 0;
  const subsTiers = settings.subs_tiers || DEFAULT_SUBS_TIERS;
  const subsRate = getProvisionRate(subsAchievement, subsTiers);
  const subsProvision = subsActualCommission * subsRate;
  
  // Terminal (nur commission_relevant)
  const commissionGoLivesCount = commissionGoLives.length;
  const terminalRate = getTerminalRate(commissionTerminals, commissionGoLivesCount, settings);
  const terminalProvision = commissionTerminals * terminalRate;
  
  // Pay ARR Target aus Settings (für Zielerreichung)
  const payTarget = settings.monthly_pay_targets?.[month - 1] || 0;
  const payTiers = settings.pay_tiers || DEFAULT_PAY_TIERS;
  
  // ========== M0: Pay Provision auf TARGET-Basis ==========
  // Bei Go-Live wird sofort Provision auf Basis des pay_arr_target gezahlt
  const payM0Achievement = payTarget > 0 ? payArrTargetCommission / payTarget : 0;
  const payM0Rate = getProvisionRate(payM0Achievement, payTiers);
  const payM0Provision = payArrTargetCommission * payM0Rate;
  
  // ========== M3: Pay Provision auf IST-Basis & Clawback ==========
  // WICHTIG: M3/Clawback nur berechnen wenn pay_arr (Ist) MANUELL ERFASST wurde!
  // Prüfe ob mindestens ein Go-Live mit Terminal pay_arr erfasst hat
  const hasPayArrRecorded = commissionGoLives.some(gl => gl.has_terminal && gl.pay_arr !== null && gl.pay_arr !== undefined);
  
  // Nur wenn pay_arr erfasst wurde: M3 und Clawback berechnen
  let payAchievement = 0;
  let payRate = 0;
  let payProvision = 0;
  let payClawbackBase = 0;
  let payClawback = 0;
  let m3Provision = 0;
  
  if (hasPayArrRecorded) {
    // Nach 3 Monaten wird der tatsächliche Pay ARR verglichen
    payAchievement = payTarget > 0 ? payActualCommission / payTarget : 0;
    payRate = getProvisionRate(payAchievement, payTiers);
    payProvision = payActualCommission * payRate;
    
    // Clawback: Differenz zwischen Target und Ist (nur wenn Target > Ist)
    payClawbackBase = Math.max(0, payArrTargetCommission - payActualCommission);
    // Clawback-Betrag: Die Differenz × die ursprüngliche M0-Rate
    payClawback = payClawbackBase * payM0Rate;
    
    // M3 Provision: Differenz zwischen Ist-Provision und M0-Provision
    m3Provision = payProvision - payM0Provision;
  }
  // Wenn pay_arr noch nicht erfasst: M3 = 0, Clawback = 0 (bleibt bei Init-Werten)

  // ========== UNIFIED TOTAL ARR MODE (mit Legacy-Fallback) ==========
  // Wenn total_arr_tiers und monthly_total_arr_targets vorhanden sind, wird die Provision
  // auf Basis von Gesamt-ARR-Zielerreichung gerechnet. Terminal bleibt separat bestehen.
  const hasUnifiedTotalArrModel = Boolean(
    settings.total_arr_tiers?.length &&
      settings.monthly_total_arr_targets?.length
  );

  if (hasUnifiedTotalArrModel) {
    const totalTarget = settings.monthly_total_arr_targets?.[month - 1] || 0;
    const payActualEffectiveCommission = commissionGoLives.reduce(
      (sum, gl) => sum + getEffectivePayArrForReporting(gl, settings, payOptions),
      0
    );
    const totalActualCommission = subsActualCommission + payActualEffectiveCommission;
    const totalAchievement = totalTarget > 0 ? totalActualCommission / totalTarget : 0;
    const totalRate = getProvisionRate(totalAchievement, settings.total_arr_tiers || DEFAULT_TOTAL_ARR_TIERS);

    const unifiedSubsProvision = subsActualCommission * totalRate;
    const unifiedPayProvision = payActualEffectiveCommission * totalRate;
    const unifiedCoreProvision = unifiedSubsProvision + unifiedPayProvision;
    const unifiedTotalProvision = unifiedCoreProvision + terminalProvision;

    return {
      month,
      month_name: MONTH_NAMES[month - 1],
      go_lives_count: goLivesCount,
      go_lives_target: goLivesTarget,
      terminals_count: terminalsCount,
      terminal_penetration: terminalPenetration,
      subs_target: subsTarget,
      subs_actual: subsActualTotal,
      subs_achievement: subsAchievement,
      subs_rate: totalRate,
      subs_provision: unifiedSubsProvision,
      terminal_rate: terminalRate,
      terminal_provision: terminalProvision,
      pay_arr_target_total: payArrTargetTotal,
      pay_target: payTarget,
      pay_m0_achievement: payTarget > 0 ? payArrTargetCommission / payTarget : 0,
      pay_m0_rate: totalRate,
      pay_m0_provision: unifiedPayProvision,
      pay_actual: payActualTotal,
      pay_achievement: payTarget > 0 ? payActualEffectiveCommission / payTarget : 0,
      pay_rate: totalRate,
      pay_provision: unifiedPayProvision,
      pay_clawback_base: 0,
      pay_clawback: 0,
      m0_provision: unifiedTotalProvision,
      m3_provision: 0,
      total_provision: unifiedTotalProvision,
    };
  }
  
  // ========== TOTALS ==========
  // M0 Provision: Subs + Terminal + Pay auf Target-Basis
  const m0Provision = subsProvision + terminalProvision + payM0Provision;
  
  // Total: M0 + M3 (M3 ist 0 wenn pay_arr noch nicht erfasst)
  const totalProvision = m0Provision + m3Provision;
  
  return {
    month,
    month_name: MONTH_NAMES[month - 1],
    go_lives_count: goLivesCount,
    go_lives_target: goLivesTarget,
    terminals_count: terminalsCount,
    terminal_penetration: terminalPenetration,
    subs_target: subsTarget,
    subs_actual: subsActualTotal,
    subs_achievement: subsAchievement,
    subs_rate: subsRate,
    subs_provision: subsProvision,
    terminal_rate: terminalRate,
    terminal_provision: terminalProvision,
    // Pay M0 (Target)
    pay_arr_target_total: payArrTargetTotal,
    pay_target: payTarget,
    pay_m0_achievement: payM0Achievement,
    pay_m0_rate: payM0Rate,
    pay_m0_provision: payM0Provision,
    // Pay M3 (Ist)
    pay_actual: payActualTotal,
    pay_achievement: payAchievement,
    pay_rate: payRate,
    pay_provision: payProvision,
    // Clawback
    pay_clawback_base: payClawbackBase,
    pay_clawback: payClawback,
    // Totals
    m0_provision: m0Provision,
    m3_provision: m3Provision,
    total_provision: totalProvision
  };
}

/**
 * Berechnet die Jahres-Zusammenfassung
 */
export function calculateYearSummary(
  goLives: GoLive[],
  settings: AESettings,
  payOptions?: PayArrReportingOptions
): YearSummary {
  const monthlyResults: MonthlyResult[] = [];
  
  for (let month = 1; month <= 12; month++) {
    monthlyResults.push(calculateMonthlyResult(month, goLives, settings, payOptions));
  }
  
  const totalGoLives = monthlyResults.reduce((sum, r) => sum + r.go_lives_count, 0);
  const totalGoLivesTarget = monthlyResults.reduce((sum, r) => sum + r.go_lives_target, 0);
  const totalTerminals = monthlyResults.reduce((sum, r) => sum + r.terminals_count, 0);
  const totalSubsTarget = monthlyResults.reduce((sum, r) => sum + r.subs_target, 0);
  const totalSubsActual = monthlyResults.reduce((sum, r) => sum + r.subs_actual, 0);
  const totalPayTarget = monthlyResults.reduce((sum, r) => sum + r.pay_target, 0);
  const totalPayActual = monthlyResults.reduce((sum, r) => sum + r.pay_actual, 0);
  // NEU: Pay ARR Target und M0 Provision
  const totalPayArrTarget = monthlyResults.reduce((sum, r) => sum + r.pay_arr_target_total, 0);
  const totalPayM0Provision = monthlyResults.reduce((sum, r) => sum + r.pay_m0_provision, 0);
  // NEU: Clawback
  const totalPayClawbackBase = monthlyResults.reduce((sum, r) => sum + r.pay_clawback_base, 0);
  const totalPayClawback = monthlyResults.reduce((sum, r) => sum + r.pay_clawback, 0);
  // Totals
  const totalM0Provision = monthlyResults.reduce((sum, r) => sum + r.m0_provision, 0);
  const totalM3Provision = monthlyResults.reduce((sum, r) => sum + r.m3_provision, 0);
  
  return {
    total_go_lives: totalGoLives,
    total_go_lives_target: totalGoLivesTarget,
    total_terminals: totalTerminals,
    total_subs_target: totalSubsTarget,
    total_subs_actual: totalSubsActual,
    total_subs_achievement: totalSubsTarget > 0 ? totalSubsActual / totalSubsTarget : 0,
    // Pay Target (M0)
    total_pay_arr_target: totalPayArrTarget,
    total_pay_target: totalPayTarget,
    total_pay_m0_provision: totalPayM0Provision,
    // Pay Ist (M3)
    total_pay_actual: totalPayActual,
    total_pay_achievement: totalPayTarget > 0 ? totalPayActual / totalPayTarget : 0,
    // Clawback
    total_pay_clawback_base: totalPayClawbackBase,
    total_pay_clawback: totalPayClawback,
    // Totals
    total_m0_provision: totalM0Provision,
    total_m3_provision: totalM3Provision,
    total_provision: totalM0Provision + totalM3Provision,
    monthly_results: monthlyResults
  };
}

/**
 * Berechnet YTD (Year-to-Date) Werte bis zum aktuellen Monat
 */
export function calculateYTDSummary(
  goLives: GoLive[],
  settings: AESettings,
  upToMonth: number,
  payOptions?: PayArrReportingOptions
): YearSummary {
  const fullYear = calculateYearSummary(goLives, settings, payOptions);
  const ytdResults = fullYear.monthly_results.slice(0, upToMonth);
  
  const totalGoLives = ytdResults.reduce((sum, r) => sum + r.go_lives_count, 0);
  const totalGoLivesTarget = ytdResults.reduce((sum, r) => sum + r.go_lives_target, 0);
  const totalTerminals = ytdResults.reduce((sum, r) => sum + r.terminals_count, 0);
  const totalSubsTarget = ytdResults.reduce((sum, r) => sum + r.subs_target, 0);
  const totalSubsActual = ytdResults.reduce((sum, r) => sum + r.subs_actual, 0);
  const totalPayTarget = ytdResults.reduce((sum, r) => sum + r.pay_target, 0);
  const totalPayActual = ytdResults.reduce((sum, r) => sum + r.pay_actual, 0);
  // NEU: Pay ARR Target und M0 Provision
  const totalPayArrTarget = ytdResults.reduce((sum, r) => sum + r.pay_arr_target_total, 0);
  const totalPayM0Provision = ytdResults.reduce((sum, r) => sum + r.pay_m0_provision, 0);
  // NEU: Clawback
  const totalPayClawbackBase = ytdResults.reduce((sum, r) => sum + r.pay_clawback_base, 0);
  const totalPayClawback = ytdResults.reduce((sum, r) => sum + r.pay_clawback, 0);
  // Totals
  const totalM0Provision = ytdResults.reduce((sum, r) => sum + r.m0_provision, 0);
  const totalM3Provision = ytdResults.reduce((sum, r) => sum + r.m3_provision, 0);
  
  return {
    total_go_lives: totalGoLives,
    total_go_lives_target: totalGoLivesTarget,
    total_terminals: totalTerminals,
    total_subs_target: totalSubsTarget,
    total_subs_actual: totalSubsActual,
    total_subs_achievement: totalSubsTarget > 0 ? totalSubsActual / totalSubsTarget : 0,
    // Pay Target (M0)
    total_pay_arr_target: totalPayArrTarget,
    total_pay_target: totalPayTarget,
    total_pay_m0_provision: totalPayM0Provision,
    // Pay Ist (M3)
    total_pay_actual: totalPayActual,
    total_pay_achievement: totalPayTarget > 0 ? totalPayActual / totalPayTarget : 0,
    // Clawback
    total_pay_clawback_base: totalPayClawbackBase,
    total_pay_clawback: totalPayClawback,
    // Totals
    total_m0_provision: totalM0Provision,
    total_m3_provision: totalM3Provision,
    total_provision: totalM0Provision + totalM3Provision,
    monthly_results: ytdResults
  };
}

/**
 * Berechnet OTE-Projektionen für verschiedene Zielerreichungs-Szenarien
 * Zeigt erwartete Provision bei 100-110%, 110-120%, 120%+ Zielerreichung
 * @param settings AE Settings
 * @param plannedTerminals Optional: Anzahl der geplanten Pay Terminals (für Penetration-Berechnung)
 */
export function calculateOTEProjections(settings: AESettings, plannedTerminals?: number): OTEProjection[] {
  // Alle 7 Stufen aus den Provisions-Tabellen
  const scenarios = [
    { scenario: '< 50%', factor: 0.25, tierMin: 0, tierMax: 0.5 },
    { scenario: '50% - 70%', factor: 0.60, tierMin: 0.5, tierMax: 0.7 },
    { scenario: '70% - 85%', factor: 0.775, tierMin: 0.7, tierMax: 0.85 },
    { scenario: '85% - 100%', factor: 0.925, tierMin: 0.85, tierMax: 1.0 },
    { scenario: '100% - 110%', factor: 1.05, tierMin: 1.0, tierMax: 1.1 },
    { scenario: '110% - 120%', factor: 1.15, tierMin: 1.1, tierMax: 1.2 },
    { scenario: '120%+', factor: 1.25, tierMin: 1.2, tierMax: 999 },
  ];

  const yearlySubsTarget = settings.monthly_subs_targets?.reduce((a, b) => a + b, 0) || 0;
  const yearlyPayTarget = settings.monthly_pay_targets?.reduce((a, b) => a + b, 0) || 0;
  const yearlyTotalTarget =
    settings.monthly_total_arr_targets?.reduce((a, b) => a + b, 0) || (yearlySubsTarget + yearlyPayTarget);
  const yearlyGoLives = settings.monthly_go_live_targets?.reduce((a, b) => a + b, 0) || 0;

  const subsTiers = settings.subs_tiers || DEFAULT_SUBS_TIERS;
  const payTiers = settings.pay_tiers || DEFAULT_PAY_TIERS;
  const totalTiers = settings.total_arr_tiers || DEFAULT_TOTAL_ARR_TIERS;
  const hasUnifiedTotalArrModel = Boolean(settings.total_arr_tiers?.length && settings.monthly_total_arr_targets?.length);
  
  // Terminal-Provision: Basierend auf Penetration pro Szenario
  const terminals = plannedTerminals !== undefined ? plannedTerminals : yearlyGoLives;
  const penetrationThreshold = settings.terminal_penetration_threshold || 0.75;

  return scenarios.map(({ scenario, factor, tierMin, tierMax }) => {
    // Erwarteter ARR bei dieser Zielerreichung
    const expectedSubsArr = yearlySubsTarget * factor;
    const expectedPayArr = yearlyPayTarget * factor;
    const expectedTotalArr = expectedSubsArr + expectedPayArr;

    // Finde die passende Rate für diesen Tier
    const subsRate = subsTiers.find(t => t.min === tierMin)?.rate || 0;
    const payRate = payTiers.find(t => t.min === tierMin)?.rate || 0;
    const totalRate = totalTiers.find(t => t.min === tierMin)?.rate || 0;

    // Berechne Provisionen
    const subsProvision = hasUnifiedTotalArrModel
      ? (yearlyTotalTarget * factor) * (yearlyTotalTarget > 0 ? (yearlySubsTarget / yearlyTotalTarget) : 0) * totalRate
      : expectedSubsArr * subsRate;
    
    // Terminal-Provision: Skalierte Anzahl Terminals × Rate
    // Die Terminal-Anzahl wird mit dem Szenario-Faktor skaliert
    // Die Rate (Basis/Bonus) wird pro Szenario basierend auf der skalierten Penetration berechnet
    const scaledTerminals = Math.round(terminals * factor);
    const scaledPenetration = yearlyGoLives > 0 ? (scaledTerminals / yearlyGoLives) : 0;
    const terminalRate = scaledPenetration >= penetrationThreshold ? settings.terminal_bonus : settings.terminal_base;
    const terminalProvision = scaledTerminals * terminalRate;
    
    const payProvision = hasUnifiedTotalArrModel
      ? (yearlyTotalTarget * factor) * (yearlyTotalTarget > 0 ? (yearlyPayTarget / yearlyTotalTarget) : 0) * totalRate
      : expectedPayArr * payRate;
    const totalProvision = subsProvision + terminalProvision + payProvision;

    // Prüfe ob es zum OTE passt (±10%)
    const oteMatch = totalProvision >= settings.ote * 0.9 && totalProvision <= settings.ote * 1.1;

    return {
      scenario,
      factor,
      expected_subs_arr: expectedSubsArr,
      expected_pay_arr: expectedPayArr,
      expected_total_arr: expectedTotalArr,
      subs_provision: subsProvision,
      terminal_provision: terminalProvision,
      pay_provision: payProvision,
      total_provision: totalProvision,
      ote_match: oteMatch
    };
  });
}

/**
 * Validiert ob die Einstellungen zum OTE passen
 * Returns: { valid: boolean, message: string, expectedProvision: number }
 * @param settings AE Settings
 * @param plannedTerminals Optional: Anzahl der geplanten Pay Terminals
 */
export function validateOTESettings(settings: AESettings, plannedTerminals?: number): { 
  valid: boolean; 
  message: string; 
  expectedProvision: number;
  deviation: number;
} {
  const projections = calculateOTEProjections(settings, plannedTerminals);
  // Index 4 ist jetzt 100-110% (nach Erweiterung auf 7 Stufen)
  const baseProjection = projections[4]; // 100-110% Szenario

  const deviation = ((baseProjection.total_provision - settings.ote) / settings.ote) * 100;
  const valid = Math.abs(deviation) <= 10;

  // Message wird nicht mehr hier generiert, sondern in der UI mit i18n
  return {
    valid,
    message: '', // Wird in der UI generiert
    expectedProvision: baseProjection.total_provision,
    deviation
  };
}

/**
 * Formatiert einen Wert als Euro
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

/**
 * Formatiert einen Wert als Euro mit Dezimalstellen
 */
export function formatCurrencyPrecise(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Formatiert einen Wert als Prozent
 */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

/**
 * Formatiert Dezimalzahl als Prozent-String (für Eingabefelder)
 */
export function formatPercentInput(value: number): string {
  return (value * 100).toFixed(1);
}

/**
 * Bestimmt die Farbe basierend auf Zielerreichung
 */
export function getAchievementColor(achievement: number): string {
  if (achievement >= 1.0) return 'text-green-600';
  if (achievement >= 0.85) return 'text-yellow-600';
  if (achievement >= 0.7) return 'text-orange-500';
  return 'text-red-500';
}

/**
 * Bestimmt die Hintergrundfarbe basierend auf Zielerreichung
 */
export function getAchievementBgColor(achievement: number): string {
  if (achievement >= 1.0) return 'bg-green-100';
  if (achievement >= 0.85) return 'bg-yellow-100';
  if (achievement >= 0.7) return 'bg-orange-100';
  return 'bg-red-100';
}
