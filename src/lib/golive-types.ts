// ============================================================================
// GO-LIVE IMPORT TYPES
// Version: v3.17.0
// ============================================================================

// CSV Row (roh geparst aus Salesforce Export)
export interface GoLiveCSVRow {
  OAKID: string;
  'Opportunity-Name': string;
  'Land (Rechnungsanschrift)': string;
  'Customer Info Stage': string;
  Accountinhaber: string;
  'Go Live Date': string;
  'Opportunity-Inhaber': string;
}

// Unterstützte Länder
export type GoLiveCountry = 'Germany' | 'Austria' | 'Switzerland';

// Transformierte Zeile für Staging/Review
export interface GoLiveStagingRow {
  // Aus CSV extrahiert
  oakid: string;
  salonName: string;
  country: GoLiveCountry | string;
  stage: string;
  accountOwner: string;
  opportunityOwner: string;
  goLiveDate: string; // ISO format (YYYY-MM-DDTHH:mm:ss)
  month: number; // 1-12

  // Auto-Matching Ergebnisse
  matchedUserId: string | null;
  matchedUserName: string | null;
  matchedOpportunityId: string | null;
  matchedOpportunityName: string | null;

  // User-Eingaben (editierbar in der Tabelle)
  arr: number | null; // commission_subs / subs_arr
  partnerId: string | null;
  isEnterprise: boolean;

  // Status-Flags
  isDuplicate: boolean; // OAKID bereits in DB vorhanden
  isImportable: boolean; // false wenn Duplikat oder kritische Daten fehlen
  validationErrors: string[];
}

// Partner (aus DB)
export interface Partner {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// Filter-State für Import-Dialog
export interface GoLiveFilters {
  countries: GoLiveCountry[]; // ['Germany', 'Austria', 'Switzerland']
  stages: string[]; // ['Adoption', 'Implementation', 'Grow', 'all']
  month: number | 'all'; // 1-12 oder 'all'
}

// Import-Ergebnis
export interface GoLiveImportResult {
  success: number;
  failed: number;
  duplicates: number;
  errors: Array<{
    row: number;
    oakid: string;
    error: string;
  }>;
}

// Progress-Callback für Batch-Import
export type ImportProgressCallback = (
  progress: number, // 0-100
  current: number, // Aktuelle Zeile
  total: number // Gesamtanzahl
) => void;

// ============================================================================
// HELPER TYPES
// ============================================================================

// Für User-Dropdown (aus bestehenden Users)
export interface UserOption {
  id: string;
  name: string;
  email?: string;
}

// Für Opportunity-Matching
export interface OpportunityOption {
  id: string;
  name: string;
  user_id: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Unterstützte Länder mit Varianten (für Normalisierung)
export const COUNTRY_VARIANTS: Record<string, GoLiveCountry> = {
  'germany': 'Germany',
  'deutschland': 'Germany',
  'de': 'Germany',
  'austria': 'Austria',
  'österreich': 'Austria',
  'at': 'Austria',
  'switzerland': 'Switzerland',
  'schweiz': 'Switzerland',
  'ch': 'Switzerland',
};

// Land-Konfiguration für Filter
export const COUNTRIES_CONFIG: Record<GoLiveCountry, {
  label: string;
  labelDe: string;
  flag: string;
}> = {
  Germany: { label: 'Germany', labelDe: 'Deutschland', flag: '🇩🇪' },
  Austria: { label: 'Austria', labelDe: 'Österreich', flag: '🇦🇹' },
  Switzerland: { label: 'Switzerland', labelDe: 'Schweiz', flag: '🇨🇭' },
};

// Stages die im Import vorkommen können
export const GO_LIVE_STAGES = [
  'Adoption',
  'Implementation',
  'Grow',
] as const;

// Monatsnamen (Deutsch)
export const MONTH_NAMES_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validiert eine Staging-Zeile und gibt Fehler zurück
 */
export function validateStagingRow(row: GoLiveStagingRow): string[] {
  const errors: string[] = [];

  // Pflicht-Felder
  if (!row.oakid) {
    errors.push('OAKID fehlt');
  }
  if (!row.salonName) {
    errors.push('Salon-Name fehlt');
  }
  if (!row.goLiveDate) {
    errors.push('Go-Live Datum fehlt');
  }
  if (!row.matchedUserId) {
    errors.push('Kein AE zugeordnet');
  }
  if (!row.arr || row.arr <= 0) {
    errors.push('ARR muss eingegeben werden');
  }

  // Duplikat
  if (row.isDuplicate) {
    errors.push('OAKID bereits importiert');
  }

  return errors;
}

/**
 * Prüft ob alle Zeilen importierbar sind
 */
export function canImportAll(rows: GoLiveStagingRow[]): boolean {
  return rows.every(row =>
    row.isImportable &&
    row.matchedUserId &&
    row.arr && row.arr > 0 &&
    !row.isDuplicate
  );
}

/**
 * Zählt importierbare Zeilen
 */
export function countImportable(rows: GoLiveStagingRow[]): number {
  return rows.filter(row =>
    row.isImportable &&
    row.matchedUserId &&
    row.arr && row.arr > 0 &&
    !row.isDuplicate
  ).length;
}
