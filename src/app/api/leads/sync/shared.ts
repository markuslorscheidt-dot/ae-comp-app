import { createClient } from '@supabase/supabase-js';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

const LEADS_AUTO_IMPORT_KEY = 'leads_auto_import_enabled';
const LEADS_SOURCE_TAB = 'leads_inbound_raw';
const LEADS_LOG_TAB = 'Import_Log Leads';

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type ParsedLeadsRow = {
  rowNumber: number;
  leadId: string;
  firstName: string;
  lastName: string;
  companyAccount: string;
  leadSource: string;
  demoOrQuote: string;
  numberOfLocations: number | null;
  employeesRange: string;
  salonType: string;
  leadOwner: string;
  leadStatus: string;
  leadSubStatus: string;
  createdDate: string | null;
  lastActivityDate: string | null;
  updatedOnDate: string | null;
  conversionDate: string | null;
  opportunityId: string;
  opportunityOwner: string;
  opportunityName: string;
  opportunityAccount: string;
  opportunityAmountCurrency: string;
  opportunityAmount: number | null;
  opportunityCloseDate: string | null;
  createdBy: string;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedLeadsRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedLeadsRow[];
      validRows: ParsedLeadsRow[];
      invalidRows: InvalidRow[];
    }
  | {
      success: false;
      status: number;
      error: string;
      details?: unknown;
      range?: string;
      rawRowCount?: number;
      header?: string[];
    };

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const raw = value.trim().replace(/\s+/g, '').replace(/€/g, '').replace(/%/g, '');
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes('.') && raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) normalized = raw.replace(',', '.');

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function parseDateToIso(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (isValidDateParts(y, m, d)) return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/.exec(trimmed);
  if (match) {
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(match[3]);
    if (isValidDateParts(y, m, d)) return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return null;
}

function buildHeaderIndexMap(headerRow: string[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, idx) => {
    const key = String(cell || '').trim();
    if (key) map.set(key, idx);
  });
  return map;
}

function getCell(row: string[], map: Map<string, number>, column: string): string {
  const idx = map.get(column);
  if (idx === undefined) return '';
  return String(row[idx] ?? '').trim();
}

function validateRow(row: ParsedLeadsRow): string[] {
  const reasons: string[] = [];
  if (!row.leadId) reasons.push('Fehlende Lead-ID');
  if (!row.companyAccount) reasons.push('Fehlender Firmenname/Account');
  return reasons;
}

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

async function appendGoogleSheetImportLog(params: {
  triggeredBy: ImportTrigger;
  status: ImportStatus;
  autoImportEnabled: boolean;
  sheetRange?: string | null;
  skipped?: boolean;
  reason?: string | null;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport?: number;
    imported?: number;
    failed?: number;
    duplicates?: number;
    updated?: number;
  };
}) {
  try {
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!apiKey || !spreadsheetId) return;

    const logRange = `${LEADS_LOG_TAB}!A:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      logRange
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&key=${apiKey}`;

    const { triggeredBy, status, autoImportEnabled, sheetRange, skipped = false, reason = null, stats } = params;
    const values = [[
      new Date().toISOString(),
      'leads',
      triggeredBy,
      status,
      autoImportEnabled ? 'true' : 'false',
      skipped ? 'true' : 'false',
      sheetRange || '',
      String(stats?.totalRowsFromSheet ?? 0),
      String(stats?.parsedRows ?? 0),
      String(stats?.validRows ?? 0),
      String(stats?.invalidRows ?? 0),
      String(stats?.toImport ?? 0),
      String(stats?.imported ?? 0),
      String(stats?.failed ?? 0),
      String(stats?.duplicates ?? 0),
      String(stats?.updated ?? 0),
      reason || '',
    ]];

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error('Leads Google-Sheet-Log fehlgeschlagen:', data?.error?.message || response.statusText);
    }
  } catch (e: any) {
    console.error('Leads Google-Sheet-Log Exception:', e?.message || e);
  }
}

async function persistImportRun(params: {
  supabase: ReturnType<typeof createClient>;
  triggeredBy: ImportTrigger;
  status: ImportStatus;
  autoImportEnabled: boolean;
  sheetRange?: string | null;
  skipped?: boolean;
  reason?: string | null;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport?: number;
    imported?: number;
    failed?: number;
    duplicates?: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; leadId: string | null; error: string }>;
  warnings?: Array<{ rowNumber: number; leadId: string | null; warning: string }>;
}) {
  try {
    const {
      supabase,
      triggeredBy,
      status,
      autoImportEnabled,
      sheetRange,
      skipped = false,
      reason = null,
      stats,
      errors = [],
      warnings = [],
    } = params;

    await appendGoogleSheetImportLog({
      triggeredBy,
      status,
      autoImportEnabled,
      sheetRange,
      skipped,
      reason,
      stats,
    });

    const { data: run, error: runError } = await supabase
      .from('leads_import_runs')
      .insert({
        triggered_by: triggeredBy,
        status,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        sheet_range: sheetRange || null,
        total_rows: stats?.totalRowsFromSheet ?? 0,
        parsed_rows: stats?.parsedRows ?? 0,
        valid_rows: stats?.validRows ?? 0,
        invalid_rows: stats?.invalidRows ?? 0,
        to_import: stats?.toImport ?? 0,
        imported: stats?.imported ?? 0,
        failed: stats?.failed ?? 0,
        duplicates: stats?.duplicates ?? 0,
        updated: stats?.updated ?? 0,
        auto_import_enabled: autoImportEnabled,
        skipped,
        reason,
      })
      .select('id')
      .single();

    if (runError || !run?.id) {
      console.error('Leads Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
      return;
    }

    const warningItems = warnings.map((w) => ({
      run_id: run.id,
      row_number: w.rowNumber > 0 ? w.rowNumber : null,
      lead_id: w.leadId,
      level: 'warning',
      message: w.warning,
    }));

    const errorItems = errors.map((e) => ({
      run_id: run.id,
      row_number: e.rowNumber > 0 ? e.rowNumber : null,
      lead_id: e.leadId,
      level: 'error',
      message: e.error,
    }));

    const allItems = [...warningItems, ...errorItems];
    if (allItems.length > 0) {
      const { error: itemError } = await supabase.from('leads_import_run_items').insert(allItems);
      if (itemError) {
        console.error('Leads Import-Run-Items Logging fehlgeschlagen:', itemError.message);
      }
    }
  } catch (e: any) {
    console.error('Leads Import-Run Logging Exception:', e?.message || e);
  }
}

export async function getLeadsAutoImportState() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      success: false as const,
      status: 500,
      error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Auto-Import-Flag kann nicht geladen werden.',
    };
  }

  const { data, error } = await supabase
    .from('import_controls')
    .select('enabled, updated_at')
    .eq('key', LEADS_AUTO_IMPORT_KEY)
    .maybeSingle();

  if (error) {
    return {
      success: false as const,
      status: 500,
      error: `Auto-Import-Flag konnte nicht geladen werden: ${error.message}`,
    };
  }

  return {
    success: true as const,
    enabled: Boolean(data?.enabled),
    updatedAt: data?.updated_at || null,
  };
}

export async function extractSheetRows(): Promise<ExtractResult> {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const configuredRange = (process.env.GOOGLE_SHEETS_RANGE_LEADS || '').trim();
  const range = configuredRange && configuredRange !== 'Leads!A:Z' ? configuredRange : `${LEADS_SOURCE_TAB}!A:Z`;

  if (!apiKey || !spreadsheetId) {
    return {
      success: false,
      status: 500,
      error: 'Fehlende ENV Variablen: GOOGLE_SHEETS_API_KEY oder GOOGLE_SHEETS_SPREADSHEET_ID',
    };
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?key=${apiKey}`;

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    const apiErrorMessage = String(data?.error?.message || 'Google Sheets API Fehler');
    return {
      success: false,
      status: response.status,
      error: apiErrorMessage.includes('Unable to parse range')
        ? `Google Sheets Range ungueltig: ${range}. Bitte GOOGLE_SHEETS_RANGE_LEADS in .env.local / Vercel auf den exakten Tab-Namen setzen (z. B. ${LEADS_SOURCE_TAB}!A:Z).`
        : apiErrorMessage,
      details: data,
    };
  }

  const values: string[][] = Array.isArray(data.values) ? data.values : [];
  const headerIndex = values.findIndex((row) => row.includes('Lead-ID') && row.includes('Firma/Account'));
  if (headerIndex === -1) {
    return {
      success: false,
      status: 422,
      error: 'Header-Zeile nicht gefunden (erwartet: Lead-ID + Firma/Account)',
      range: data.range,
      rawRowCount: values.length,
    };
  }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = ['Lead-ID', 'Firma/Account'];
  const missingColumns = requiredColumns.filter((col) => !headerMap.has(col));
  if (missingColumns.length > 0) {
    return {
      success: false,
      status: 422,
      error: `Pflichtspalten fehlen: ${missingColumns.join(', ')}`,
      header,
    };
  }

  const rawRows = values
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell || '').trim() !== ''));

  const parsedRows: ParsedLeadsRow[] = rawRows.map((row, idx) => ({
    rowNumber: headerIndex + 2 + idx,
    leadId: getCell(row, headerMap, 'Lead-ID'),
    firstName: getCell(row, headerMap, 'Vorname'),
    lastName: getCell(row, headerMap, 'Nachname'),
    companyAccount: getCell(row, headerMap, 'Firma/Account'),
    leadSource: getCell(row, headerMap, 'Lead-Quelle'),
    demoOrQuote: getCell(row, headerMap, 'Demo or Quote'),
    numberOfLocations: parseInteger(getCell(row, headerMap, 'Number Of Locations')),
    employeesRange: getCell(row, headerMap, 'No of employees'),
    salonType: getCell(row, headerMap, 'Salon Type'),
    leadOwner: getCell(row, headerMap, 'Lead-Inhaber'),
    leadStatus: getCell(row, headerMap, 'Lead-Status'),
    leadSubStatus: getCell(row, headerMap, 'Lead Sub Status'),
    createdDate: parseDateToIso(getCell(row, headerMap, 'Erstelldatum')),
    lastActivityDate: parseDateToIso(getCell(row, headerMap, 'Letzte Aktivität')),
    updatedOnDate: parseDateToIso(getCell(row, headerMap, 'Zuletzt geändert am')),
    conversionDate: parseDateToIso(getCell(row, headerMap, 'Konvertierungsdatum')),
    opportunityId: getCell(row, headerMap, 'Opportunity-ID'),
    opportunityOwner: getCell(row, headerMap, 'Opportunity-Inhaber'),
    opportunityName: getCell(row, headerMap, 'Opportunity-Name'),
    opportunityAccount: getCell(row, headerMap, 'Opportunity: Account'),
    opportunityAmountCurrency: getCell(row, headerMap, 'Opportunity-Betrag Währung'),
    opportunityAmount: parseNumber(getCell(row, headerMap, 'Opportunity-Betrag')),
    opportunityCloseDate: parseDateToIso(getCell(row, headerMap, 'Oppt.-Schlusstermin')),
    createdBy: getCell(row, headerMap, 'Erstellt von'),
  }));

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedLeadsRow[] = [];
  for (const row of parsedRows) {
    const reasons = validateRow(row);
    if (reasons.length > 0) invalidRows.push({ rowNumber: row.rowNumber, reasons, raw: row });
    else validRows.push(row);
  }

  return {
    success: true,
    range: data.range,
    headerIndex,
    header,
    rawRows,
    parsedRows,
    validRows,
    invalidRows,
  };
}

export async function runCommitImport(context?: { triggeredBy?: ImportTrigger; autoImportEnabled?: boolean }) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      success: false,
      status: 500,
      error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer Commit-Import wird ein Server-Client mit Service Role benoetigt.',
    };
  }

  const triggeredBy: ImportTrigger = context?.triggeredBy || 'manual';
  const autoImportEnabled = context?.autoImportEnabled ?? false;

  const extracted = await extractSheetRows();
  if (!extracted.success) {
    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'failed',
      autoImportEnabled,
      sheetRange: extracted.range || null,
      reason: extracted.error,
    });
    return {
      success: false,
      status: extracted.status,
      error: extracted.error,
      details: extracted.details,
      range: extracted.range,
    };
  }

  const rowByLeadId = new Map<string, ParsedLeadsRow>();
  const warnings: Array<{ rowNumber: number; leadId: string | null; warning: string }> = [];
  let sourceDuplicates = 0;

  for (const row of extracted.validRows) {
    const key = row.leadId.trim();
    if (!key) continue;
    if (rowByLeadId.has(key)) {
      sourceDuplicates += 1;
      warnings.push({
        rowNumber: row.rowNumber,
        leadId: row.leadId || null,
        warning: 'Doppelte Lead-ID im Sheet: letzte Zeile wird verwendet',
      });
    }
    rowByLeadId.set(key, row);
  }

  const rowsToProcess = Array.from(rowByLeadId.values());
  const leadIds = rowsToProcess.map((r) => r.leadId);

  const { data: existingLeadIds, error: existingError } = leadIds.length
    ? await supabase.from('leads_events').select('lead_id').in('lead_id', leadIds)
    : { data: [], error: null };

  if (existingError) {
    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'failed',
      autoImportEnabled,
      sheetRange: extracted.range,
      reason: `Vorab-Check fehlgeschlagen: ${existingError.message}`,
      stats: {
        totalRowsFromSheet: extracted.rawRows.length,
        parsedRows: extracted.parsedRows.length,
        validRows: extracted.validRows.length,
        invalidRows: extracted.invalidRows.length,
      },
      warnings,
    });
    return {
      success: false,
      status: 500,
      error: `Vorab-Check fehlgeschlagen: ${existingError.message}`,
    };
  }

  const existingSet = new Set((existingLeadIds || []).map((e: any) => String(e.lead_id)));
  const rowsForUpsert: any[] = [];
  const errors: Array<{ rowNumber: number; leadId: string | null; error: string }> = [];

  for (const row of rowsToProcess) {
    if (!row.leadId || !row.companyAccount) {
      errors.push({
        rowNumber: row.rowNumber,
        leadId: row.leadId || null,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    rowsForUpsert.push({
      lead_id: row.leadId,
      first_name: row.firstName || null,
      last_name: row.lastName || null,
      company_account: row.companyAccount,
      lead_source: row.leadSource || null,
      demo_or_quote: row.demoOrQuote || null,
      number_of_locations: row.numberOfLocations,
      employees_range: row.employeesRange || null,
      salon_type: row.salonType || null,
      lead_owner: row.leadOwner || null,
      lead_status: row.leadStatus || null,
      lead_sub_status: row.leadSubStatus || null,
      created_date: row.createdDate,
      last_activity_date: row.lastActivityDate,
      updated_on_date: row.updatedOnDate,
      conversion_date: row.conversionDate,
      opportunity_id: row.opportunityId || null,
      opportunity_owner: row.opportunityOwner || null,
      opportunity_name: row.opportunityName || null,
      opportunity_account: row.opportunityAccount || null,
      opportunity_amount_currency: row.opportunityAmountCurrency || null,
      opportunity_amount: row.opportunityAmount,
      opportunity_close_date: row.opportunityCloseDate,
      created_by: row.createdBy || null,
      source_tab: LEADS_SOURCE_TAB,
      source_row_number: row.rowNumber,
      updated_at: new Date().toISOString(),
    });
  }

  const existingInDbCount = rowsToProcess.filter((r) => existingSet.has(r.leadId)).length;
  const updated = Math.max(0, Math.min(existingInDbCount, rowsForUpsert.length));
  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('leads_events')
      .upsert(chunk, { onConflict: 'lead_id', ignoreDuplicates: false });

    if (upsertError) {
      failed += chunk.length;
      chunk.forEach((r) => {
        errors.push({
          rowNumber: r.source_row_number ?? -1,
          leadId: r.lead_id ?? null,
          error: upsertError.message,
        });
      });
      if (
        upsertError.message.includes('there is no unique or exclusion constraint') ||
        upsertError.message.includes('on conflict')
      ) {
        warnings.push({
          rowNumber: -1,
          leadId: null,
          warning: 'DB-Constraint fuer Upsert fehlt: bitte supabase-leads-import.sql ausfuehren.',
        });
      }
    } else {
      imported += chunk.length;
    }
  }

  const finalStats = {
    totalRowsFromSheet: extracted.rawRows.length,
    parsedRows: extracted.parsedRows.length,
    validRows: extracted.validRows.length,
    invalidRows: extracted.invalidRows.length,
    toImport: rowsForUpsert.length,
    imported,
    failed,
    duplicates: sourceDuplicates,
    updated,
  };
  const finalStatus: ImportStatus = failed > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success';

  await persistImportRun({
    supabase,
    triggeredBy,
    status: finalStatus,
    autoImportEnabled,
    sheetRange: extracted.range,
    stats: finalStats,
    errors,
    warnings,
  });

  return {
    success: true,
    mode: 'commit',
    stats: finalStats,
    errors: errors.slice(0, 200),
    warnings: warnings.slice(0, 200),
  };
}
