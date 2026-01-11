import { 
  AESettings, 
  GoLive, 
  ProvisionTier, 
  MonthlyResult, 
  YearSummary,
  OTEProjection,
  MONTH_NAMES,
  DEFAULT_SUBS_TIERS,
  DEFAULT_PAY_TIERS,
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

/**
 * Berechnet das Monatsergebnis
 * Für ARR-Tracking: Alle Go-Lives zählen
 * Für Provision: Nur commission_relevant Go-Lives
 */
export function calculateMonthlyResult(
  month: number,
  goLives: GoLive[],
  settings: AESettings
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
  const payActualTotal = monthGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
  
  // Provision nur für commission_relevant Go-Lives
  const commissionTerminals = commissionGoLives.filter(gl => gl.has_terminal).length;
  const subsActualCommission = commissionGoLives.reduce((sum, gl) => sum + (gl.subs_arr || 0), 0);
  const payActualCommission = commissionGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
  
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
  
  // Pay ARR (Zielerreichung basiert auf commission_relevant)
  const payTarget = settings.monthly_pay_targets?.[month - 1] || 0;
  const payAchievement = payTarget > 0 ? payActualCommission / payTarget : 0;
  const payTiers = settings.pay_tiers || DEFAULT_PAY_TIERS;
  const payRate = getProvisionRate(payAchievement, payTiers);
  const payProvision = payActualCommission * payRate;
  
  // Totals
  const m0Provision = subsProvision + terminalProvision;
  const m3Provision = payProvision;
  const totalProvision = m0Provision + m3Provision;
  
  return {
    month,
    month_name: MONTH_NAMES[month - 1],
    go_lives_count: goLivesCount,
    go_lives_target: goLivesTarget,
    terminals_count: terminalsCount,
    terminal_penetration: terminalPenetration,
    subs_target: subsTarget,
    subs_actual: subsActualTotal, // Zeigt gesamten ARR an
    subs_achievement: subsAchievement, // Basiert auf commission_relevant
    subs_rate: subsRate,
    subs_provision: subsProvision,
    terminal_rate: terminalRate,
    terminal_provision: terminalProvision,
    pay_target: payTarget,
    pay_actual: payActualTotal, // Zeigt gesamten ARR an
    pay_achievement: payAchievement, // Basiert auf commission_relevant
    pay_rate: payRate,
    pay_provision: payProvision,
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
  settings: AESettings
): YearSummary {
  const monthlyResults: MonthlyResult[] = [];
  
  for (let month = 1; month <= 12; month++) {
    monthlyResults.push(calculateMonthlyResult(month, goLives, settings));
  }
  
  const totalGoLives = monthlyResults.reduce((sum, r) => sum + r.go_lives_count, 0);
  const totalGoLivesTarget = monthlyResults.reduce((sum, r) => sum + r.go_lives_target, 0);
  const totalTerminals = monthlyResults.reduce((sum, r) => sum + r.terminals_count, 0);
  const totalSubsTarget = monthlyResults.reduce((sum, r) => sum + r.subs_target, 0);
  const totalSubsActual = monthlyResults.reduce((sum, r) => sum + r.subs_actual, 0);
  const totalPayTarget = monthlyResults.reduce((sum, r) => sum + r.pay_target, 0);
  const totalPayActual = monthlyResults.reduce((sum, r) => sum + r.pay_actual, 0);
  const totalM0Provision = monthlyResults.reduce((sum, r) => sum + r.m0_provision, 0);
  const totalM3Provision = monthlyResults.reduce((sum, r) => sum + r.m3_provision, 0);
  
  return {
    total_go_lives: totalGoLives,
    total_go_lives_target: totalGoLivesTarget,
    total_terminals: totalTerminals,
    total_subs_target: totalSubsTarget,
    total_subs_actual: totalSubsActual,
    total_subs_achievement: totalSubsTarget > 0 ? totalSubsActual / totalSubsTarget : 0,
    total_pay_target: totalPayTarget,
    total_pay_actual: totalPayActual,
    total_pay_achievement: totalPayTarget > 0 ? totalPayActual / totalPayTarget : 0,
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
  upToMonth: number
): YearSummary {
  const fullYear = calculateYearSummary(goLives, settings);
  const ytdResults = fullYear.monthly_results.slice(0, upToMonth);
  
  const totalGoLives = ytdResults.reduce((sum, r) => sum + r.go_lives_count, 0);
  const totalGoLivesTarget = ytdResults.reduce((sum, r) => sum + r.go_lives_target, 0);
  const totalTerminals = ytdResults.reduce((sum, r) => sum + r.terminals_count, 0);
  const totalSubsTarget = ytdResults.reduce((sum, r) => sum + r.subs_target, 0);
  const totalSubsActual = ytdResults.reduce((sum, r) => sum + r.subs_actual, 0);
  const totalPayTarget = ytdResults.reduce((sum, r) => sum + r.pay_target, 0);
  const totalPayActual = ytdResults.reduce((sum, r) => sum + r.pay_actual, 0);
  const totalM0Provision = ytdResults.reduce((sum, r) => sum + r.m0_provision, 0);
  const totalM3Provision = ytdResults.reduce((sum, r) => sum + r.m3_provision, 0);
  
  return {
    total_go_lives: totalGoLives,
    total_go_lives_target: totalGoLivesTarget,
    total_terminals: totalTerminals,
    total_subs_target: totalSubsTarget,
    total_subs_actual: totalSubsActual,
    total_subs_achievement: totalSubsTarget > 0 ? totalSubsActual / totalSubsTarget : 0,
    total_pay_target: totalPayTarget,
    total_pay_actual: totalPayActual,
    total_pay_achievement: totalPayTarget > 0 ? totalPayActual / totalPayTarget : 0,
    total_m0_provision: totalM0Provision,
    total_m3_provision: totalM3Provision,
    total_provision: totalM0Provision + totalM3Provision,
    monthly_results: ytdResults
  };
}

/**
 * Berechnet OTE-Projektionen für verschiedene Zielerreichungs-Szenarien
 * Zeigt erwartete Provision bei 100-110%, 110-120%, 120%+ Zielerreichung
 */
export function calculateOTEProjections(settings: AESettings): OTEProjection[] {
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
  const yearlyGoLives = settings.monthly_go_live_targets?.reduce((a, b) => a + b, 0) || 0;

  const subsTiers = settings.subs_tiers || DEFAULT_SUBS_TIERS;
  const payTiers = settings.pay_tiers || DEFAULT_PAY_TIERS;

  return scenarios.map(({ scenario, factor, tierMin, tierMax }) => {
    // Erwarteter ARR bei dieser Zielerreichung
    const expectedSubsArr = yearlySubsTarget * factor;
    const expectedPayArr = yearlyPayTarget * factor;
    const expectedTotalArr = expectedSubsArr + expectedPayArr;

    // Finde die passende Rate für diesen Tier
    const subsRate = subsTiers.find(t => t.min === tierMin)?.rate || 0;
    const payRate = payTiers.find(t => t.min === tierMin)?.rate || 0;

    // Berechne Provisionen
    const subsProvision = expectedSubsArr * subsRate;
    
    // Terminal-Provision (angenommen 70% Penetration → Bonus-Rate)
    const terminalProvision = yearlyGoLives * settings.terminal_bonus;
    
    const payProvision = expectedPayArr * payRate;
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
 */
export function validateOTESettings(settings: AESettings): { 
  valid: boolean; 
  message: string; 
  expectedProvision: number;
  deviation: number;
} {
  const projections = calculateOTEProjections(settings);
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
