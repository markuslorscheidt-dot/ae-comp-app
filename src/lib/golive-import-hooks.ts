// ============================================================================
// GO-LIVE IMPORT HOOKS
// Version: v3.17.0
// CSV Parsing, Matching, Filtering, Batch-Import
// ============================================================================

import Papa from 'papaparse';
import { supabase } from './supabase';
import {
  GoLiveCSVRow,
  GoLiveStagingRow,
  GoLiveFilters,
  GoLiveCountry,
  Partner,
  SubscriptionPackage,
  UserOption,
  OpportunityOption,
  GoLiveImportResult,
  ImportProgressCallback,
  COUNTRY_VARIANTS,
  validateStagingRow,
} from './golive-types';

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Parst eine CSV-Datei und transformiert sie in Staging-Rows
 * 
 * @param file - Die hochgeladene CSV-Datei
 * @returns Promise mit transformierten Staging-Rows
 */
export function parseGoLiveCSV(file: File): Promise<GoLiveStagingRow[]> {
  return new Promise((resolve, reject) => {
    // FileReader für ISO-8859-1 Encoding (wichtig für Umlaute!)
    const reader = new FileReader();
    
    reader.onload = (event) => {
      const csvText = event.target?.result as string;
      
      Papa.parse<GoLiveCSVRow>(csvText, {
        delimiter: ';',
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          try {
            // Validierung: Erforderliche Spalten prüfen
            const requiredColumns = [
              'OAKID',
              'Opportunity-Name',
              'Land (Rechnungsanschrift)',
              'Accountinhaber',
              'Go Live Date'
            ];

            const headers = Object.keys(results.data[0] || {});
            const missingColumns = requiredColumns.filter(col => !headers.includes(col));

            if (missingColumns.length > 0) {
              reject(new Error(`CSV fehlen Spalten: ${missingColumns.join(', ')}`));
              return;
            }

            // Transformation
            const transformed: GoLiveStagingRow[] = results.data
              .filter(row => row.OAKID && row.OAKID.trim()) // Leere Zeilen filtern
              .map(row => ({
                // Aus CSV
                oakid: row.OAKID?.trim() || '',
                salonName: cleanSalonName(row['Opportunity-Name']),
                country: normalizeCountry(row['Land (Rechnungsanschrift)']),
                stage: row['Customer Info Stage']?.trim() || '',
                accountOwner: row.Accountinhaber?.trim() || '',
                opportunityOwner: row['Opportunity-Inhaber']?.trim() || '',
                goLiveDate: parseGoLiveDate(row['Go Live Date']),
                month: getMonthFromDate(row['Go Live Date']),

                // Initialisierung (wird später durch Matching gefüllt)
                matchedUserId: null,
                matchedUserName: null,
                matchedOpportunityId: null,
                matchedOpportunityName: null,
                arr: null,
                partnerId: null,
                isEnterprise: false,
                isDuplicate: false,
                isImportable: true,
                validationErrors: []
              }));

            resolve(transformed);
          } catch (error) {
            reject(error);
          }
        },
        error: (error: Error) => {
          reject(new Error(`CSV Parsing Fehler: ${error.message}`));
        }
      });
    };

    reader.onerror = () => {
      reject(new Error('Datei konnte nicht gelesen werden'));
    };

    // ISO-8859-1 Encoding für deutsche Umlaute
    reader.readAsText(file, 'ISO-8859-1');
  });
}

/**
 * Bereinigt Salon-Namen (entfernt trailing "-")
 */
function cleanSalonName(name: string | undefined): string {
  if (!name) return '';
  return name.trim().replace(/-\s*$/, '').trim();
}

/**
 * Normalisiert Ländernamen zu einheitlichem Format
 */
function normalizeCountry(land: string | undefined): GoLiveCountry | string {
  if (!land) return '';
  const normalized = land.trim().toLowerCase();
  return COUNTRY_VARIANTS[normalized] || land.trim();
}

/**
 * Parst deutsches Datumsformat zu ISO
 * Format: "06.01.2026 01:00" → "2026-01-06T01:00:00"
 */
function parseGoLiveDate(dateStr: string | undefined): string {
  if (!dateStr) return '';

  const trimmed = dateStr.trim();
  const [datePart, timePart] = trimmed.split(' ');
  
  if (!datePart) return '';
  
  const [day, month, year] = datePart.split('.');
  
  if (!day || !month || !year) return '';
  
  const [hour, minute] = (timePart || '00:00').split(':');

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${(hour || '00').padStart(2, '0')}:${(minute || '00').padStart(2, '0')}:00`;
}

/**
 * Extrahiert den Monat (1-12) aus einem Datumsstring
 */
function getMonthFromDate(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  
  const isoDate = parseGoLiveDate(dateStr);
  if (!isoDate) return 0;
  
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? 0 : date.getMonth() + 1; // 1-12
}

// ============================================================================
// AUTO-MATCHING
// ============================================================================

/**
 * Führt Auto-Matching für Users und Opportunities durch
 * und prüft auf Duplikate
 */
export async function performMatching(
  rows: GoLiveStagingRow[]
): Promise<GoLiveStagingRow[]> {
  // 1. Alle Users laden
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name, email');

  if (usersError) {
    console.error('Fehler beim Laden der Users:', usersError);
    throw new Error('Users konnten nicht geladen werden');
  }

  // 2. Alle Opportunities laden
  const { data: opportunities, error: oppsError } = await supabase
    .from('opportunities')
    .select('id, name, user_id');

  if (oppsError) {
    console.error('Fehler beim Laden der Opportunities:', oppsError);
    // Kein throw - Opportunity-Matching ist optional
  }

  // 3. Bestehende OAKIDs laden (Duplikat-Check)
  const oakids = rows.map(r => r.oakid).filter(Boolean);
  
  let existingOakidSet = new Set<string>();
  
  if (oakids.length > 0) {
    const { data: existingOakids, error: oakError } = await supabase
      .from('go_lives')
      .select('oakid')
      .in('oakid', oakids);

    if (!oakError && existingOakids) {
      existingOakidSet = new Set(existingOakids.map(e => e.oakid).filter(Boolean));
    }
  }

  // 4. Matching durchführen
  const matched = rows.map(row => {
    // User-Matching (STRICT)
    const user = findUserMatch(row.accountOwner, users || []);

    // Opportunity-Matching (STRICT)
    const opportunity = findOpportunityMatch(row.salonName, opportunities || []);

    // Duplikat-Check
    const isDuplicate = existingOakidSet.has(row.oakid);

    // Validierung
    const errors: string[] = [];
    if (!user) errors.push('Kein User-Match gefunden');
    if (isDuplicate) errors.push('OAKID bereits importiert');

    return {
      ...row,
      matchedUserId: user?.id || null,
      matchedUserName: user?.name || null,
      matchedOpportunityId: opportunity?.id || null,
      matchedOpportunityName: opportunity?.name || null,
      isDuplicate,
      isImportable: !isDuplicate && user !== null,
      validationErrors: errors
    };
  });

  return matched;
}

/**
 * Findet einen User-Match basierend auf dem Namen aus der CSV
 * STRICT: Nur exakte Matches oder alle Namens-Teile müssen vorkommen
 */
function findUserMatch(csvName: string, users: UserOption[]): UserOption | null {
  if (!csvName || !users.length) return null;

  const csvNameLower = csvName.toLowerCase().trim();

  // 1. Exakte Übereinstimmung (case-insensitive)
  const exactMatch = users.find(u =>
    u.name.toLowerCase().trim() === csvNameLower
  );
  if (exactMatch) return exactMatch;

  // 2. Fallback: Alle Wort-Teile (>2 Zeichen) müssen vorkommen
  const nameParts = csvName.split(/[\s-]+/).filter(p => p.length > 2);
  
  if (nameParts.length === 0) return null;

  const partialMatch = users.find(u => {
    const userNameLower = u.name.toLowerCase();
    return nameParts.every(part =>
      userNameLower.includes(part.toLowerCase())
    );
  });

  return partialMatch || null;
}

/**
 * Findet einen Opportunity-Match basierend auf dem Salon-Namen
 * STRICT: Nur exakte Übereinstimmung
 */
function findOpportunityMatch(
  csvName: string,
  opportunities: OpportunityOption[]
): OpportunityOption | null {
  if (!csvName || !opportunities.length) return null;

  // CSV hat oft trailing "-" → wurde bereits in cleanSalonName entfernt
  const cleanedName = csvName.toLowerCase().trim();

  // Exakte Übereinstimmung
  return opportunities.find(o =>
    o.name.toLowerCase().trim() === cleanedName ||
    o.name.toLowerCase().trim().replace(/-\s*$/, '') === cleanedName
  ) || null;
}

// ============================================================================
// FILTERING
// ============================================================================

/**
 * Filtert Staging-Rows nach Country, Stage und Monat
 */
export function applyFilters(
  data: GoLiveStagingRow[],
  filters: GoLiveFilters
): GoLiveStagingRow[] {
  let filtered = [...data];

  // Country Filter
  if (filters.countries.length > 0) {
    filtered = filtered.filter(row =>
      filters.countries.includes(row.country as GoLiveCountry)
    );
  }

  // Stage Filter
  if (filters.stages.length > 0 && !filters.stages.includes('all')) {
    filtered = filtered.filter(row =>
      filters.stages.includes(row.stage)
    );
  }

  // Month Filter
  if (filters.month !== 'all') {
    filtered = filtered.filter(row =>
      row.month === filters.month
    );
  }

  return filtered;
}

/**
 * Berechnet Filter-Statistiken (wie viele pro Land/Stage/Monat)
 */
export function calculateFilterStats(data: GoLiveStagingRow[]): {
  countries: Record<string, number>;
  stages: Record<string, number>;
  months: Record<number, number>;
} {
  const countries: Record<string, number> = {};
  const stages: Record<string, number> = {};
  const months: Record<number, number> = {};

  data.forEach(row => {
    // Countries
    countries[row.country] = (countries[row.country] || 0) + 1;
    
    // Stages
    if (row.stage) {
      stages[row.stage] = (stages[row.stage] || 0) + 1;
    }
    
    // Months
    if (row.month > 0) {
      months[row.month] = (months[row.month] || 0) + 1;
    }
  });

  return { countries, stages, months };
}

// ============================================================================
// BATCH IMPORT
// ============================================================================

/**
 * Importiert Go-Lives in Batches mit Progress-Callback
 */
export async function importGoLives(
  rows: GoLiveStagingRow[],
  onProgress?: ImportProgressCallback
): Promise<GoLiveImportResult> {
  const BATCH_SIZE = 10;
  
  // Nur importierbare Zeilen (nicht Duplikate, mit User-Match und ARR)
  const importableRows = rows.filter(r =>
    r.isImportable &&
    r.matchedUserId &&
    r.arr && r.arr > 0 &&
    !r.isDuplicate
  );

  const total = importableRows.length;
  let success = 0;
  let failed = 0;
  const errors: GoLiveImportResult['errors'] = [];

  if (total === 0) {
    return { success: 0, failed: 0, duplicates: rows.filter(r => r.isDuplicate).length, errors: [] };
  }

  // Batch-Processing
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = importableRows.slice(i, i + BATCH_SIZE);

    // Transform für DB-Insert
    const inserts = batch.map(row => ({
      user_id: row.matchedUserId,
      opportunity_id: row.matchedOpportunityId || null,
      customer_name: row.salonName,
      go_live_date: row.goLiveDate,
      year: new Date(row.goLiveDate).getFullYear(),
      month: row.month,
      subs_monthly: Math.round((row.arr || 0) / 12), // ARR → monatlich
      subs_arr: row.arr,
      has_terminal: false, // Default
      pay_arr: null,
      commission_relevant: true, // Default für AE Go-Lives
      partner_id: row.partnerId || null,
      is_enterprise: row.isEnterprise,
      oakid: row.oakid,
      notes: `Import aus Salesforce Report (${new Date().toLocaleDateString('de-DE')})`
    }));

    // Insert
    const { data, error } = await supabase
      .from('go_lives')
      .insert(inserts)
      .select('id');

    if (error) {
      console.error('Batch-Import-Fehler:', error);
      failed += batch.length;
      batch.forEach((row, idx) => {
        errors.push({
          row: i + idx + 1,
          oakid: row.oakid,
          error: error.message
        });
      });
    } else {
      success += batch.length;
    }

    // Progress-Callback
    if (onProgress) {
      const current = Math.min(i + BATCH_SIZE, total);
      const progress = Math.round((current / total) * 100);
      onProgress(progress, current, total);
    }

    // Kurze Pause für UI-Updates
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return {
    success,
    failed,
    duplicates: rows.filter(r => r.isDuplicate).length,
    errors
  };
}

// ============================================================================
// PARTNER MANAGEMENT
// ============================================================================

/**
 * Lädt alle Partner aus der Datenbank
 */
export async function loadPartners(): Promise<Partner[]> {
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .order('name');

  if (error) {
    console.error('Fehler beim Laden der Partner:', error);
    return [];
  }

  return data || [];
}

/**
 * Erstellt einen neuen Partner
 */
export async function createPartner(name: string): Promise<Partner | null> {
  const { data, error } = await supabase
    .from('partners')
    .insert({ name: name.trim() })
    .select()
    .single();

  if (error) {
    console.error('Fehler beim Anlegen des Partners:', error);
    throw new Error(`Partner konnte nicht angelegt werden: ${error.message}`);
  }

  return data;
}

/**
 * Löscht einen Partner
 */
export async function deletePartner(id: string): Promise<void> {
  const { error } = await supabase
    .from('partners')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Fehler beim Löschen des Partners:', error);
    throw new Error(`Partner konnte nicht gelöscht werden: ${error.message}`);
  }
}

// ============================================================================
// SUBSCRIPTION PACKAGES CRUD
// ============================================================================

/**
 * Lädt alle Subscription Packages
 */
export async function loadSubscriptionPackages(): Promise<SubscriptionPackage[]> {
  const { data, error } = await supabase
    .from('subscription_packages')
    .select('*')
    .order('name');

  if (error) {
    console.error('Fehler beim Laden der Subscription Packages:', error);
    return [];
  }

  return data || [];
}

/**
 * Erstellt ein neues Subscription Package
 */
export async function createSubscriptionPackage(name: string): Promise<SubscriptionPackage | null> {
  const { data, error } = await supabase
    .from('subscription_packages')
    .insert({ name: name.trim() })
    .select()
    .single();

  if (error) {
    console.error('Fehler beim Anlegen des Subscription Packages:', error);
    throw new Error(`Subscription Package konnte nicht angelegt werden: ${error.message}`);
  }

  return data;
}

/**
 * Löscht ein Subscription Package
 */
export async function deleteSubscriptionPackage(id: string): Promise<void> {
  const { error } = await supabase
    .from('subscription_packages')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Fehler beim Löschen des Subscription Packages:', error);
    throw new Error(`Subscription Package konnte nicht gelöscht werden: ${error.message}`);
  }
}

// ============================================================================
// HOOKS (React Query kompatibel)
// ============================================================================

/**
 * Hook zum Laden aller User (für Dropdown)
 */
export async function loadAllUsers(): Promise<UserOption[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email')
    .order('name');

  if (error) {
    console.error('Fehler beim Laden der Users:', error);
    return [];
  }

  return data || [];
}

/**
 * Prüft ob eine OAKID bereits in der DB existiert
 */
export async function checkOakidExists(oakid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('go_lives')
    .select('id')
    .eq('oakid', oakid)
    .limit(1);

  if (error) {
    console.error('Fehler beim OAKID-Check:', error);
    return false;
  }

  return (data?.length || 0) > 0;
}
