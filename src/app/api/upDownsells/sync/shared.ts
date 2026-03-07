import { createClient } from '@supabase/supabase-js';

const UP_DOWNSELLS_AUTO_IMPORT_KEY = 'up_downsells_auto_import_enabled';

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type ParsedUpDownsellRow = {
  rowNumber: number;
  eventMonth: string | null;
  oakId: number | null;
  customerName: string;
  netGrowthArr: number | null;
  netLossArr: number | null;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedUpDownsellRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedUpDownsellRow[];
      validRows: ParsedUpDownsellRow[];
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

function validateRow(row: ParsedUpDownsellRow): string[] {
  const reasons: string[] = [];
  if (!row.eventMonth) reasons.push('Ungueltiges oder fehlendes Upgrade / Downgrade Month');
  if (!row.oakId || row.oakId <= 0) reasons.push('Ungueltige oder fehlende Oak ID');
  if (!row.customerName) reasons.push('Customer Name fehlt');
  if (row.netGrowthArr === null && row.netLossArr === null) {
    reasons.push('Net Growth ARR und Net Loss ARR fehlen beide');
  }
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
      .from('up_downsells_import_runs')
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
      console.error('Up-Downsells Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
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
      const { error: itemError } = await supabase.from('up_downsells_import_run_items').insert(allItems);
      if (itemError) {
        console.error('Up-Downsells Import-Run-Items Logging fehlgeschlagen:', itemError.message);
      }
    }
  } catch (e: any) {
    console.error('Up-Downsells Import-Run Logging Exception:', e?.message || e);
  }
}

export async function getUpDownsellsAutoImportState() {
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
    .eq('key', UP_DOWNSELLS_AUTO_IMPORT_KEY)
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
  const configuredRange =
    process.env.GOOGLE_SHEETS_RANGE_UP_DOWNSELLS ||
    process.env.GOOGLE_SHEETS_RANGE_UPSELL ||
    process.env.GOOGLE_SHEETS_RANGE_UP_DOWNSELL ||
    '';
  const range = configuredRange || "'mirror__Upsell Downsell'!A:Z";

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
    const apiErrorMessage = data?.error?.message || 'Google Sheets API Fehler';
    return {
      success: false,
      status: response.status,
      error:
        apiErrorMessage.includes('Unable to parse range')
          ? `Google Sheets Range ungueltig: ${range}. Bitte GOOGLE_SHEETS_RANGE_UP_DOWNSELLS (oder GOOGLE_SHEETS_RANGE_UPSELL) in .env.local auf den exakten Tab-Namen setzen.`
          : apiErrorMessage,
      details: data,
    };
  }

  const values: string[][] = Array.isArray(data.values) ? data.values : [];
  const headerIndex = values.findIndex(
    (row) => row.includes('Upgrade / Downgrade Month') && row.includes('Oak ID')
  );
  if (headerIndex === -1) {
    return {
      success: false,
      status: 422,
      error: 'Header-Zeile nicht gefunden (erwartet: Upgrade / Downgrade Month + Oak ID)',
      range: data.range,
      rawRowCount: values.length,
    };
  }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = ['Upgrade / Downgrade Month', 'Oak ID', 'Customer Name', 'Net Growth ARR', 'Net Loss ARR'];

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

  const parsedRows: ParsedUpDownsellRow[] = rawRows.map((row, idx) => {
    const eventMonthRaw = getCell(row, headerMap, 'Upgrade / Downgrade Month');
    const oakIdRaw = getCell(row, headerMap, 'Oak ID');
    const customerNameRaw = getCell(row, headerMap, 'Customer Name');
    const netGrowthArrRaw = getCell(row, headerMap, 'Net Growth ARR');
    const netLossArrRaw = getCell(row, headerMap, 'Net Loss ARR');

    const oakIdNum = parseInt(oakIdRaw, 10);
    const oakId = Number.isInteger(oakIdNum) ? oakIdNum : null;

    return {
      rowNumber: headerIndex + 2 + idx,
      eventMonth: parseYearMonthToIsoDate(eventMonthRaw),
      oakId,
      customerName: customerNameRaw.replace(/\s+/g, ' ').trim(),
      netGrowthArr: parseNumber(netGrowthArrRaw),
      netLossArr: parseNumber(netLossArrRaw),
    };
  });

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedUpDownsellRow[] = [];
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

  const rowByMonthAndOak = new Map<string, ParsedUpDownsellRow>();
  const warnings: Array<{ rowNumber: number; oakId: number | null; warning: string }> = [];
  let sourceDuplicates = 0;

  for (const row of extracted.validRows) {
    if (!row.eventMonth || row.oakId === null) continue;
    const key = `${row.eventMonth}-${row.oakId}`;
    const existing = rowByMonthAndOak.get(key);
    if (existing) {
      sourceDuplicates += 1;
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Doppelte Kombination aus Monat + OAK im Sheet: Werte werden zusammengefuehrt',
      });
      rowByMonthAndOak.set(key, {
        rowNumber: row.rowNumber,
        eventMonth: row.eventMonth,
        oakId: row.oakId,
        customerName: row.customerName || existing.customerName,
        netGrowthArr: (existing.netGrowthArr ?? 0) + (row.netGrowthArr ?? 0),
        netLossArr: (existing.netLossArr ?? 0) + (row.netLossArr ?? 0),
      });
      continue;
    }
    rowByMonthAndOak.set(key, row);
  }

  const rowsToProcess = Array.from(rowByMonthAndOak.values());
  const compositeKeys = rowsToProcess
    .filter((r) => r.eventMonth && r.oakId !== null)
    .map((r) => ({ event_month: r.eventMonth as string, oak_id: r.oakId as number }));

  let existingSet = new Set<string>();
  if (compositeKeys.length > 0) {
    const months = Array.from(new Set(compositeKeys.map((k) => k.event_month)));
    const oakIds = Array.from(new Set(compositeKeys.map((k) => k.oak_id)));
    const { data: existingRows, error: existingError } = await supabase
      .from('up_downsells_events')
      .select('event_month, oak_id')
      .in('event_month', months)
      .in('oak_id', oakIds);

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

    existingSet = new Set(
      (existingRows || []).map((r: any) => `${String(r.event_month)}-${Number(r.oak_id)}`)
    );
  }

  const rowsForUpsert: any[] = [];
  const errors: Array<{ rowNumber: number; oakId: number | null; error: string }> = [];

  for (const row of rowsToProcess) {
    if (!row.eventMonth || row.oakId === null || !row.customerName) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    const growth = row.netGrowthArr ?? 0;
    const loss = row.netLossArr ?? 0;
    rowsForUpsert.push({
      event_month: row.eventMonth,
      oak_id: row.oakId,
      customer_name: row.customerName,
      net_growth_arr: growth,
      net_loss_arr: loss,
      net_arr: growth + loss,
      source_tab: 'mirror_Up_Downsells',
      source_row_number: row.rowNumber,
      updated_at: new Date().toISOString(),
    });
  }

  const existingInDbCount = rowsToProcess.filter(
    (r) => r.eventMonth && r.oakId !== null && existingSet.has(`${r.eventMonth}-${r.oakId}`)
  ).length;
  const updated = Math.max(0, Math.min(existingInDbCount, rowsForUpsert.length));
  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('up_downsells_events')
      .upsert(chunk, { onConflict: 'event_month,oak_id', ignoreDuplicates: false });

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
          warning: 'DB-Constraint fuer Upsert fehlt: bitte supabase-up-downsells-import.sql ausfuehren.',
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

