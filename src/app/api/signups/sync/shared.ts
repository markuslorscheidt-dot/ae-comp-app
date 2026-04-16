import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Papa from 'papaparse';

const SIGNUPS_AUTO_IMPORT_KEY = 'signups_auto_import_enabled';
const SIGNUPS_SOURCE_TAB = 'drive_signups_csv';
const SIGNUPS_LOG_TAB = 'sign_ups_import_log';
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.readonly'];

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type ParsedSignupsRow = {
  rowNumber: number;
  oakId: number | null;
  accountName: string;
  businessType: string;
  numberOfLocations: number | null;
  employeesRange: string;
  signupPackage: string;
  goLiveDate: string | null;
  customerInfoStage: string;
  accountOwner: string;
  accountNameWithOakId: string;
  accountId: string;
  signupDate: string | null;
  germanyGoLiveDay: string;
  month: number | null;
  region: string;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedSignupsRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedSignupsRow[];
      validRows: ParsedSignupsRow[];
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

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
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

function validateRow(row: ParsedSignupsRow): string[] {
  const reasons: string[] = [];
  if (!row.accountId) reasons.push('Fehlende Account-ID');
  if (!row.accountName) reasons.push('Fehlender Accountname');
  return reasons;
}

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

type DriveCsvFileMeta = {
  id: string;
  name: string;
  modifiedTime: string;
  mimeType?: string;
};

function getDriveFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_SIGNUPS_FOLDER_ID?.trim() || null;
}

function getDriveAuth() {
  const clientEmail = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) return null;
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: DRIVE_SCOPE,
  });
}

async function listSignupsCsvFiles(): Promise<
  { success: true; files: DriveCsvFileMeta[] } | { success: false; status: number; error: string }
> {
  const folderId = getDriveFolderId();
  if (!folderId) {
    return { success: false, status: 500, error: 'GOOGLE_DRIVE_SIGNUPS_FOLDER_ID fehlt.' };
  }

  const auth = getDriveAuth();
  if (!auth) {
    return {
      success: false,
      status: 500,
      error: 'GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL oder GOOGLE_DRIVE_PRIVATE_KEY fehlt.',
    };
  }

  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,modifiedTime,mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
  });

  const files = (response.data.files || [])
    .filter((f) => f.id && f.name && f.modifiedTime)
    .map((f) => ({
      id: String(f.id),
      name: String(f.name),
      modifiedTime: String(f.modifiedTime),
      mimeType: f.mimeType ? String(f.mimeType) : undefined,
    }))
    .filter((f) => f.name.toLowerCase().endsWith('.csv'));

  return { success: true, files };
}

async function downloadDriveFile(fileId: string): Promise<string> {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Drive Auth fehlt');
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' as any });
  return String(response.data || '');
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

    const logRange = `${SIGNUPS_LOG_TAB}!A:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      logRange
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&key=${apiKey}`;

    const { triggeredBy, status, autoImportEnabled, sheetRange, skipped = false, reason = null, stats } = params;
    const values = [[
      new Date().toISOString(),
      'signups',
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
      console.error('Signups Google-Sheet-Log fehlgeschlagen:', data?.error?.message || response.statusText);
    }
  } catch (e: any) {
    console.error('Signups Google-Sheet-Log Exception:', e?.message || e);
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
      .from('signups_import_runs')
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
      console.error('Signups Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
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
      level: 'error',
      message: e.error,
    }));

    const allItems = [...warningItems, ...errorItems];
    if (allItems.length > 0) {
      const { error: itemError } = await supabase.from('signups_import_run_items').insert(allItems);
      if (itemError) {
        console.error('Signups Import-Run-Items Logging fehlgeschlagen:', itemError.message);
      }
    }
  } catch (e: any) {
    console.error('Signups Import-Run Logging Exception:', e?.message || e);
  }
}

export async function getSignupsAutoImportState() {
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
    .eq('key', SIGNUPS_AUTO_IMPORT_KEY)
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
  try {
    const listResult = await listSignupsCsvFiles();
    if (!listResult.success) {
      return {
        success: false,
        status: listResult.status,
        error: listResult.error,
      };
    }

    if (listResult.files.length === 0) {
      return {
        success: false,
        status: 404,
        error: 'Keine Sign-ups CSV im Drive-Ordner gefunden.',
      };
    }

    const latest = listResult.files[0];
    const csvText = await downloadDriveFile(latest.id);
    const parsedCsv = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
    if (parsedCsv.errors?.length) {
      return {
        success: false,
        status: 422,
        error: `CSV Parsing-Fehler: ${parsedCsv.errors[0].message}`,
        details: parsedCsv.errors.slice(0, 20),
      };
    }

    const values: string[][] = Array.isArray(parsedCsv.data) ? (parsedCsv.data as string[][]) : [];
    const headerIndex = values.findIndex((row) => row.includes('OAKID') && row.includes('Account-ID'));
    if (headerIndex === -1) {
      return {
        success: false,
        status: 422,
        error: 'Header-Zeile nicht gefunden (erwartet: OAKID + Account-ID)',
        range: `drive:${latest.name}`,
        rawRowCount: values.length,
      };
    }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = ['OAKID', 'Accountname', 'Account-ID'];
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

  const parsedRows: ParsedSignupsRow[] = rawRows.map((row, idx) => ({
    rowNumber: headerIndex + 2 + idx,
    oakId: parseInteger(getCell(row, headerMap, 'OAKID')),
    accountName: getCell(row, headerMap, 'Accountname'),
    businessType: getCell(row, headerMap, 'Business Type'),
    numberOfLocations: parseInteger(getCell(row, headerMap, 'Number Of Locations')),
    employeesRange: getCell(row, headerMap, 'No of employees'),
    signupPackage: getCell(row, headerMap, 'Signup Package'),
    goLiveDate: parseDateToIso(getCell(row, headerMap, 'Go Live Date')),
    customerInfoStage: getCell(row, headerMap, 'Customer Info Stage'),
    accountOwner: getCell(row, headerMap, 'Accountinhaber'),
    accountNameWithOakId: getCell(row, headerMap, 'Account Name With OAK Id'),
    accountId: getCell(row, headerMap, 'Account-ID'),
    signupDate: parseDateToIso(getCell(row, headerMap, 'Signup Date')),
    germanyGoLiveDay: getCell(row, headerMap, 'Germany Go Live Day'),
    month: parseInteger(getCell(row, headerMap, 'Month')),
    region: getCell(row, headerMap, 'Region'),
  }));

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedSignupsRow[] = [];
  for (const row of parsedRows) {
    const reasons = validateRow(row);
    if (reasons.length > 0) invalidRows.push({ rowNumber: row.rowNumber, reasons, raw: row });
    else validRows.push(row);
  }

    return {
      success: true,
      range: `drive:${latest.name}`,
      headerIndex,
      header,
      rawRows,
      parsedRows,
      validRows,
      invalidRows,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 500,
      error: error?.message || 'Sign-ups CSV aus Drive konnte nicht gelesen werden.',
    };
  }
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

  const rowByAccountId = new Map<string, ParsedSignupsRow>();
  const warnings: Array<{ rowNumber: number; oakId: number | null; warning: string }> = [];
  let sourceDuplicates = 0;

  for (const row of extracted.validRows) {
    const key = row.accountId.trim();
    if (!key) continue;
    if (rowByAccountId.has(key)) {
      sourceDuplicates += 1;
      warnings.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        warning: 'Doppelte Account-ID in der CSV-Quelle: letzte Zeile wird verwendet',
      });
    }
    rowByAccountId.set(key, row);
  }

  const rowsToProcess = Array.from(rowByAccountId.values());
  const accountIds = rowsToProcess.map((r) => r.accountId);

  const { data: existingIds, error: existingError } = accountIds.length
    ? await supabase.from('signups_events').select('account_id').in('account_id', accountIds)
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

  const existingSet = new Set((existingIds || []).map((e: any) => String(e.account_id)));
  const rowsForUpsert: any[] = [];
  const errors: Array<{ rowNumber: number; oakId: number | null; error: string }> = [];

  for (const row of rowsToProcess) {
    if (!row.accountId || !row.accountName) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    rowsForUpsert.push({
      account_id: row.accountId,
      oak_id: row.oakId,
      account_name: row.accountName,
      business_type: row.businessType || null,
      number_of_locations: row.numberOfLocations,
      employees_range: row.employeesRange || null,
      signup_package: row.signupPackage || null,
      go_live_date: row.goLiveDate,
      customer_info_stage: row.customerInfoStage || null,
      account_owner: row.accountOwner || null,
      account_name_with_oak_id: row.accountNameWithOakId || null,
      signup_date: row.signupDate,
      germany_go_live_day: row.germanyGoLiveDay || null,
      source_month: row.month,
      region: row.region || null,
      source_tab: SIGNUPS_SOURCE_TAB,
      source_row_number: row.rowNumber,
      updated_at: new Date().toISOString(),
    });
  }

  const existingInDbCount = rowsToProcess.filter((r) => existingSet.has(r.accountId)).length;
  const updated = Math.max(0, Math.min(existingInDbCount, rowsForUpsert.length));
  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from('signups_events')
      .upsert(chunk, { onConflict: 'account_id', ignoreDuplicates: false });

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
          warning: 'DB-Constraint fuer Upsert fehlt: bitte supabase-signups-import.sql ausfuehren.',
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
