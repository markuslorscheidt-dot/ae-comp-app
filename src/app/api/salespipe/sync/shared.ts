import { createClient } from '@supabase/supabase-js';

const SALESPIPE_AUTO_IMPORT_KEY = 'salespipe_auto_import_enabled';

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type ParsedSalespipeRow = {
  rowNumber: number;
  opportunityName: string;
  rating: string;
  nextStep: string;
  closeDate: string | null;
  lastActivityDate: string | null;
  stage: string;
  estimatedArr: number | null;
  probability: number | null;
  leadSource: string;
  oakId: number | null;
  opportunityId: string;
  daysDemoToClosure: number | null;
  daysSentQuoteToClose: number | null;
  decisionCriteria: string;
  createdDate: string | null;
  opportunityOwner: string;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedSalespipeRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedSalespipeRow[];
      validRows: ParsedSalespipeRow[];
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
  if (raw.includes('.') && raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function resolveOpportunityOwnerAlias(name: string): string {
  const normalized = normalizeName(name);

  // Temporary business mapping requested by sales operations:
  // Source rows for "Kubi Akyürek" should be assigned to Silke.
  if (normalized === normalizeName('Kubi Akyürek')) {
    return 'Silke Hecht-Späth';
  }

  return name;
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
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/.exec(trimmed);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
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

function validateRow(row: ParsedSalespipeRow): string[] {
  const reasons: string[] = [];
  if (!row.opportunityId) reasons.push('Fehlende Opportunity-ID');
  if (!row.opportunityName) reasons.push('Fehlender Opportunity-Name');
  return reasons;
}

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
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
  errors?: Array<{ rowNumber: number; oakId: number | null; error: string }>;
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
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

    const { data: run, error: runError } = await supabase
      .from('salespipe_import_runs')
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
      console.error('Salespipe Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
      return;
    }

    const warningItems = warnings.map((w) => ({
      run_id: run.id,
      row_number: w.rowNumber > 0 ? w.rowNumber : null,
      oak_id: w.oakId,
      level: 'warning',
      message: w.warning,
    }));

    const errorItems = errors.map((e) => ({
      run_id: run.id,
      row_number: e.rowNumber > 0 ? e.rowNumber : null,
      oak_id: e.oakId,
      level: e.error === 'Opportunity-ID bereits vorhanden' ? 'duplicate' : 'error',
      message: e.error,
    }));

    const allItems = [...warningItems, ...errorItems];
    if (allItems.length > 0) {
      const { error: itemError } = await supabase.from('salespipe_import_run_items').insert(allItems);
      if (itemError) {
        console.error('Salespipe Import-Run-Items Logging fehlgeschlagen:', itemError.message);
      }
    }
  } catch (e: any) {
    console.error('Salespipe Import-Run Logging Exception:', e?.message || e);
  }
}

export async function getSalespipeAutoImportState() {
  const supabase = getServerSupabase();
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
    .eq('key', SALESPIPE_AUTO_IMPORT_KEY)
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
  const range = process.env.GOOGLE_SHEETS_RANGE_SALESPIPE || 'mirror_salespipe_raw!A:Z';

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
        ? `Google Sheets Range ungueltig: ${range}. Bitte GOOGLE_SHEETS_RANGE_SALESPIPE in .env.local / Vercel auf den exakten Tab-Namen setzen (z. B. mirror_salespipe_raw!A:Z).`
        : apiErrorMessage,
      details: data,
    };
  }

  const values: string[][] = Array.isArray(data.values) ? data.values : [];
  const headerIndex = values.findIndex((row) => row.includes('Opportunity-Name') && row.includes('Opportunity-ID'));
  if (headerIndex === -1) {
    return {
      success: false,
      status: 422,
      error: 'Header-Zeile nicht gefunden (erwartet: Opportunity-Name + Opportunity-ID)',
      range: data.range,
      rawRowCount: values.length,
    };
  }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = ['Opportunity-Name', 'Opportunity-ID'];
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

  const parsedRows: ParsedSalespipeRow[] = rawRows.map((row, idx) => {
    const opportunityNameRaw = getCell(row, headerMap, 'Opportunity-Name');
    const ratingRaw = getCell(row, headerMap, 'Rating');
    const nextStepRaw = getCell(row, headerMap, 'Nächster Schritt');
    const closeDateRaw = getCell(row, headerMap, 'Schlusstermin');
    const lastActivityRaw = getCell(row, headerMap, 'Letzte Aktivität');
    const stageRaw = getCell(row, headerMap, 'Phase');
    const estimatedArrRaw = getCell(row, headerMap, 'Estimated ARR');
    const probabilityRaw = getCell(row, headerMap, 'Wahrscheinlichkeit (%)');
    const leadSourceRaw = getCell(row, headerMap, 'Lead-Quelle');
    const oakIdRaw = getCell(row, headerMap, 'OAKID');
    const opportunityIdRaw = getCell(row, headerMap, 'Opportunity-ID');
    const daysDemoRaw = getCell(row, headerMap, 'Days from Demo to Closure');
    const daysQuoteRaw = getCell(row, headerMap, 'Days from SentQuote to Close');
    const decisionCriteriaRaw = getCell(row, headerMap, 'Decision Criteria');
    const createdDateRaw = getCell(row, headerMap, 'Erstelldatum');
    const ownerRaw = getCell(row, headerMap, 'Opportunity-Inhaber');
    const ownerResolved = resolveOpportunityOwnerAlias(ownerRaw);

    return {
      rowNumber: headerIndex + 2 + idx,
      opportunityName: opportunityNameRaw.replace(/\s+/g, ' ').trim(),
      rating: ratingRaw,
      nextStep: nextStepRaw,
      closeDate: parseDateToIso(closeDateRaw),
      lastActivityDate: parseDateToIso(lastActivityRaw),
      stage: stageRaw,
      estimatedArr: parseNumber(estimatedArrRaw),
      probability: parseNumber(probabilityRaw),
      leadSource: leadSourceRaw,
      oakId: parseInteger(oakIdRaw),
      opportunityId: opportunityIdRaw,
      daysDemoToClosure: parseInteger(daysDemoRaw),
      daysSentQuoteToClose: parseInteger(daysQuoteRaw),
      decisionCriteria: decisionCriteriaRaw,
      createdDate: parseDateToIso(createdDateRaw),
      opportunityOwner: ownerResolved,
    };
  });

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedSalespipeRow[] = [];
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
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      success: false,
      status: 500,
      error:
        'SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer Commit-Import wird ein Server-Client mit Service Role benoetigt.',
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

  const rowByOpportunityId = new Map<string, ParsedSalespipeRow>();
  const warnings: Array<{ rowNumber: number; oakId: number | null; warning: string }> = [];
  let sourceDuplicates = 0;

  for (const row of extracted.validRows) {
    const key = row.opportunityId.trim();
    if (!key) continue;
    if (rowByOpportunityId.has(key)) {
      sourceDuplicates += 1;
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Doppelte Opportunity-ID im Sheet: letzte Zeile wird verwendet',
      });
    }
    rowByOpportunityId.set(key, row);
  }

  const rowsToProcess = Array.from(rowByOpportunityId.values());
  const opportunityIds = rowsToProcess.map((r) => r.opportunityId);

  const { data: existingOppIds, error: existingError } = opportunityIds.length
    ? await supabase.from('salespipe_events').select('opportunity_id').in('opportunity_id', opportunityIds)
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

  const existingSet = new Set((existingOppIds || []).map((e: any) => String(e.opportunity_id)));
  const rowsForUpsert: any[] = [];
  const errors: Array<{ rowNumber: number; oakId: number | null; error: string }> = [];

  for (const row of rowsToProcess) {
    if (!row.opportunityId || !row.opportunityName) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    rowsForUpsert.push({
      opportunity_id: row.opportunityId,
      oak_id: row.oakId,
      opportunity_name: row.opportunityName,
      rating: row.rating || null,
      next_step: row.nextStep || null,
      close_date: row.closeDate,
      last_activity_date: row.lastActivityDate,
      stage: row.stage || null,
      estimated_arr: row.estimatedArr,
      probability: row.probability,
      lead_source: row.leadSource || null,
      days_demo_to_closure: row.daysDemoToClosure,
      days_sentquote_to_close: row.daysSentQuoteToClose,
      decision_criteria: row.decisionCriteria || null,
      created_date: row.createdDate,
      opportunity_owner: row.opportunityOwner || null,
      source_tab: 'mirror_salespipe_raw',
      source_row_number: row.rowNumber,
      updated_at: new Date().toISOString(),
    });
  }

  const existingInDbCount = rowsToProcess.filter((r) => existingSet.has(r.opportunityId)).length;
  const updated = Math.max(0, Math.min(existingInDbCount, rowsForUpsert.length));
  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('salespipe_events')
      .upsert(chunk, { onConflict: 'opportunity_id', ignoreDuplicates: false });

    if (upsertError) {
      failed += chunk.length;
      chunk.forEach((r) => {
        errors.push({
          rowNumber: r.source_row_number ?? -1,
          oakId: r.oak_id ?? null,
          error: upsertError.message,
        });
      });
      if (
        upsertError.message.includes('there is no unique or exclusion constraint') ||
        upsertError.message.includes('on conflict')
      ) {
        warnings.push({
          rowNumber: -1,
          oakId: null,
          warning: 'DB-Constraint fuer Upsert fehlt: bitte supabase-salespipe-import.sql ausfuehren.',
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
