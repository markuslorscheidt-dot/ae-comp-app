import { createClient } from '@supabase/supabase-js';

const CHURN_AUTO_IMPORT_KEY = 'churn_auto_import_enabled';

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type ParsedChurnRow = {
  rowNumber: number;
  glMonth: string | null;
  churnMonth: string | null;
  oakId: number | null;
  customerName: string;
  coo: string;
  churnReason: string;
  packageName: string;
  totalArrLost: number | null;
  subsRevenueLost: number | null;
  payRevenueLost: number | null;
  scheduled: boolean | null;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedChurnRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedChurnRow[];
      validRows: ParsedChurnRow[];
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

function parseYesNo(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (['ja', 'yes', 'true', '1', 'y', 'j'].includes(v)) return true;
  if (['nein', 'no', 'false', '0', 'n'].includes(v)) return false;
  return null;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const raw = value.trim().replace(/\s+/g, '').replace(/€/g, '');
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

function parseYearMonthToIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
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

function validateRow(row: ParsedChurnRow): string[] {
  const reasons: string[] = [];
  if (!row.churnMonth) reasons.push('Ungueltiges oder fehlendes Churn Month');
  if (!row.oakId || row.oakId <= 0) reasons.push('Ungueltige oder fehlende Oak ID');
  if (!row.customerName) reasons.push('Customer Name fehlt');
  if (row.totalArrLost === null) reasons.push('Total ARR Lost fehlt oder ist ungueltig');
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
      .from('churn_import_runs')
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
      console.error('Churn Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
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
      level: e.error === 'OAKID bereits vorhanden' ? 'duplicate' : 'error',
      message: e.error,
    }));

    const allItems = [...warningItems, ...errorItems];
    if (allItems.length > 0) {
      const { error: itemError } = await supabase.from('churn_import_run_items').insert(allItems);
      if (itemError) {
        console.error('Churn Import-Run-Items Logging fehlgeschlagen:', itemError.message);
      }
    }
  } catch (e: any) {
    console.error('Churn Import-Run Logging Exception:', e?.message || e);
  }
}

export async function getChurnAutoImportState() {
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
    .eq('key', CHURN_AUTO_IMPORT_KEY)
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
  const range = process.env.GOOGLE_SHEETS_RANGE_CHURN || 'mirror_Churn!A:Z';

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
    return {
      success: false,
      status: response.status,
      error: data?.error?.message || 'Google Sheets API Fehler',
      details: data,
    };
  }

  const values: string[][] = Array.isArray(data.values) ? data.values : [];
  const headerIndex = values.findIndex((row) => row.includes('Churn Month') && row.includes('Oak ID'));
  if (headerIndex === -1) {
    return {
      success: false,
      status: 422,
      error: 'Header-Zeile nicht gefunden (erwartet: Churn Month + Oak ID)',
      range: data.range,
      rawRowCount: values.length,
    };
  }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = [
    'GL Month',
    'Churn Month',
    'Oak ID',
    'Customer Name',
    'COO',
    'Churn Reason',
    'Package',
    'Total ARR Lost',
    'Subs Revenue Lost',
    'Pay Revenue Lost',
    'Scheduled',
  ];

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

  const parsedRows: ParsedChurnRow[] = rawRows.map((row, idx) => {
    const glMonthRaw = getCell(row, headerMap, 'GL Month');
    const churnMonthRaw = getCell(row, headerMap, 'Churn Month');
    const oakIdRaw = getCell(row, headerMap, 'Oak ID');
    const customerNameRaw = getCell(row, headerMap, 'Customer Name');
    const cooRaw = getCell(row, headerMap, 'COO');
    const churnReasonRaw = getCell(row, headerMap, 'Churn Reason');
    const packageRaw = getCell(row, headerMap, 'Package');
    const totalArrLostRaw = getCell(row, headerMap, 'Total ARR Lost');
    const subsRevenueLostRaw = getCell(row, headerMap, 'Subs Revenue Lost');
    const payRevenueLostRaw = getCell(row, headerMap, 'Pay Revenue Lost');
    const scheduledRaw = getCell(row, headerMap, 'Scheduled');

    const oakIdNum = parseInt(oakIdRaw, 10);
    const oakId = Number.isInteger(oakIdNum) ? oakIdNum : null;

    return {
      rowNumber: headerIndex + 2 + idx,
      glMonth: parseYearMonthToIsoDate(glMonthRaw),
      churnMonth: parseYearMonthToIsoDate(churnMonthRaw),
      oakId,
      customerName: customerNameRaw.replace(/\s+/g, ' ').trim(),
      coo: cooRaw,
      churnReason: churnReasonRaw,
      packageName: packageRaw,
      totalArrLost: parseNumber(totalArrLostRaw),
      subsRevenueLost: parseNumber(subsRevenueLostRaw),
      payRevenueLost: parseNumber(payRevenueLostRaw),
      scheduled: parseYesNo(scheduledRaw),
    };
  });

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedChurnRow[] = [];
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

  const rowByOakId = new Map<number, ParsedChurnRow>();
  const warnings: Array<{ rowNumber: number; oakId: number | null; warning: string }> = [];
  let sourceDuplicates = 0;

  for (const row of extracted.validRows) {
    if (row.oakId === null) continue;
    if (rowByOakId.has(row.oakId)) {
      sourceDuplicates += 1;
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Doppelte OAK-ID im Sheet: letzte Zeile wird verwendet',
      });
    }
    rowByOakId.set(row.oakId, row);
  }

  const rowsToProcess = Array.from(rowByOakId.values());
  const oakIds = rowsToProcess.map((r) => r.oakId).filter((v): v is number => Number.isInteger(v));
  const { data: existingOakIds, error: existingError } = oakIds.length
    ? await supabase.from('churn_events').select('oak_id').in('oak_id', oakIds)
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

  const existingSet = new Set(
    (existingOakIds || [])
      .map((e: any) => (e.oak_id !== null && e.oak_id !== undefined ? Number(e.oak_id) : null))
      .filter((n: number | null): n is number => n !== null)
  );

  const rowsForUpsert: any[] = [];
  const errors: Array<{ rowNumber: number; oakId: number | null; error: string }> = [];

  for (const row of rowsToProcess) {
    if (!row.churnMonth || row.oakId === null || !row.customerName) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    if (row.subsRevenueLost === null) {
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Subs Revenue Lost fehlt oder ist ungueltig: Wert wird als 0 gespeichert',
      });
    }

    if (row.payRevenueLost === null) {
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Pay Revenue Lost fehlt oder ist ungueltig: Wert wird als 0 gespeichert',
      });
    }

    rowsForUpsert.push({
      oak_id: row.oakId,
      gl_month: row.glMonth,
      churn_month: row.churnMonth,
      customer_name: row.customerName,
      coo: row.coo || null,
      churn_reason: row.churnReason || null,
      package_name: row.packageName || null,
      total_arr_lost: row.totalArrLost,
      subs_revenue_lost: row.subsRevenueLost ?? 0,
      pay_revenue_lost: row.payRevenueLost ?? 0,
      scheduled: row.scheduled ?? false,
      source_tab: 'mirror_Churn',
      source_row_number: row.rowNumber,
      updated_at: new Date().toISOString(),
    });
  }

  const existingInDbCount = rowsToProcess.filter((r) => r.oakId !== null && existingSet.has(r.oakId)).length;
  const updated = Math.max(0, Math.min(existingInDbCount, rowsForUpsert.length));
  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('churn_events')
      .upsert(chunk, { onConflict: 'oak_id', ignoreDuplicates: false });

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
          warning: 'DB-Constraint fuer Upsert fehlt: bitte supabase-churn-import.sql ausfuehren.',
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

