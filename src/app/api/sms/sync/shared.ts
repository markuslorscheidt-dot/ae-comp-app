import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Papa from 'papaparse';

const SMS_AUTO_IMPORT_KEY = 'sms_auto_import_enabled';
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.readonly'];

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type DriveFileMeta = {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  mimeType?: string;
};

type ParsedSmsRow = {
  rowNumber: number;
  payload: Record<string, string>;
};

type InvalidSmsRow = {
  rowNumber: number;
  reasons: string[];
  raw: Record<string, string>;
};

type ExtractResult =
  | {
      success: true;
      sourceFile: DriveFileMeta;
      header: string[];
      rawRows: Record<string, string>[];
      validRows: ParsedSmsRow[];
      invalidRows: InvalidSmsRow[];
    }
  | {
      success: false;
      status: number;
      error: string;
    };

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

function getDriveFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_SMS_FOLDER_ID?.trim() || null;
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

async function listCsvFiles(): Promise<{ success: true; files: DriveFileMeta[] } | { success: false; status: number; error: string }> {
  const folderId = getDriveFolderId();
  if (!folderId) {
    return { success: false, status: 500, error: 'GOOGLE_DRIVE_SMS_FOLDER_ID fehlt.' };
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
    fields: 'files(id,name,modifiedTime,size,mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
  });

  const files = (response.data.files || [])
    .filter((f) => f.id && f.name && f.modifiedTime)
    .filter((f) => {
      const name = String(f.name || '').toLowerCase();
      const mime = String(f.mimeType || '').toLowerCase();
      return name.endsWith('.csv') || mime.includes('csv') || mime.includes('excel');
    })
    .map((f) => ({
      id: String(f.id),
      name: String(f.name),
      modifiedTime: String(f.modifiedTime),
      size: f.size ? String(f.size) : undefined,
      mimeType: f.mimeType ? String(f.mimeType) : undefined,
    }));

  return { success: true, files };
}

async function downloadFile(fileId: string): Promise<string> {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Drive Auth fehlt');
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data as ArrayBuffer).toString('utf8');
}

async function getLatestUnprocessedCsv(supabase: ReturnType<typeof createClient>) {
  const listResult = await listCsvFiles();
  if (!listResult.success) return listResult;
  if (listResult.files.length === 0) {
    return { success: false as const, status: 404, error: 'Keine CSV-Dateien im SMS-Drive-Ordner gefunden.' };
  }

  const fileIds = listResult.files.map((f) => f.id);
  const { data, error } = await supabase
    .from('sms_source_files')
    .select('drive_file_id, status')
    .in('drive_file_id', fileIds);

  if (error) {
    return { success: false as const, status: 500, error: `Source-File-Status konnte nicht geladen werden: ${error.message}` };
  }

  const processedSet = new Set(
    (data || []).filter((r: any) => r.status === 'success').map((r: any) => String(r.drive_file_id))
  );
  const pending = listResult.files.find((f) => !processedSet.has(f.id));
  if (!pending) {
    return {
      success: false as const,
      status: 200,
      error: 'Keine neuen SMS-Dateien zu verarbeiten (alle bereits importiert).',
    };
  }
  return { success: true as const, file: pending };
}

function normalizeRow(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    const k = String(key || '').trim();
    if (!k) return;
    result[k] = value === null || value === undefined ? '' : String(value).trim();
  });
  return result;
}

function isRowEffectivelyEmpty(row: Record<string, string>): boolean {
  return Object.values(row).every((value) => String(value || '').trim() === '');
}

function parseCsv(csvText: string): { header: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors?.length) {
    throw new Error(`CSV Parsing-Fehler: ${parsed.errors[0].message}`);
  }

  const rows = (parsed.data || []).map((row) => normalizeRow(row as Record<string, unknown>));
  const header = (parsed.meta?.fields || []).map((f) => String(f || '').trim()).filter(Boolean);
  return { header, rows };
}

async function upsertSourceFileStatus(
  supabase: ReturnType<typeof createClient>,
  sourceFile: DriveFileMeta,
  status: 'processing' | 'success' | 'failed',
  details?: { error?: string | null; imported?: number; updated?: number }
) {
  await supabase
    .from('sms_source_files')
    .upsert(
      {
        drive_file_id: sourceFile.id,
        file_name: sourceFile.name,
        modified_at: sourceFile.modifiedTime,
        processed_at: new Date().toISOString(),
        status,
        error_message: details?.error || null,
        imported_rows: details?.imported ?? null,
        updated_rows: details?.updated ?? null,
      },
      { onConflict: 'drive_file_id' }
    );
}

async function persistImportRun(params: {
  supabase: ReturnType<typeof createClient>;
  triggeredBy: ImportTrigger;
  status: ImportStatus;
  autoImportEnabled: boolean;
  sourceFileName?: string | null;
  skipped?: boolean;
  reason?: string | null;
  stats?: {
    totalRowsFromFile: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport?: number;
    imported?: number;
    failed?: number;
    duplicates?: number;
    updated?: number;
  };
  warnings?: Array<{ rowNumber: number; warning: string }>;
  errors?: Array<{ rowNumber: number; error: string }>;
}) {
  const {
    supabase,
    triggeredBy,
    status,
    autoImportEnabled,
    sourceFileName,
    skipped = false,
    reason = null,
    stats,
    warnings = [],
    errors = [],
  } = params;

  const { data: run, error: runError } = await supabase
    .from('sms_import_runs')
    .insert({
      triggered_by: triggeredBy,
      status,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      source_file_name: sourceFileName || null,
      total_rows: stats?.totalRowsFromFile ?? 0,
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
    console.error('SMS Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
    return;
  }

  const warningItems = warnings.map((w) => ({
    run_id: run.id,
    row_number: w.rowNumber > 0 ? w.rowNumber : null,
    level: 'warning',
    message: w.warning,
  }));
  const errorItems = errors.map((e) => ({
    run_id: run.id,
    row_number: e.rowNumber > 0 ? e.rowNumber : null,
    level: 'error',
    message: e.error,
  }));
  const allItems = [...warningItems, ...errorItems];
  if (allItems.length > 0) {
    await supabase.from('sms_import_run_items').insert(allItems);
  }
}

export async function getSmsAutoImportState() {
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
    .eq('key', SMS_AUTO_IMPORT_KEY)
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

export async function extractSmsRows(supabase?: ReturnType<typeof createClient>): Promise<ExtractResult> {
  const client = supabase || getServerSupabase();
  if (!client) {
    return { success: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' };
  }

  const latest = await getLatestUnprocessedCsv(client);
  if (!latest.success) {
    return { success: false, status: latest.status, error: latest.error };
  }

  const sourceFile = latest.file;
  const csvText = await downloadFile(sourceFile.id);
  const parsed = parseCsv(csvText);

  if (parsed.header.length === 0) {
    return { success: false, status: 422, error: 'CSV Header leer oder nicht lesbar.' };
  }

  const validRows: ParsedSmsRow[] = [];
  const invalidRows: InvalidSmsRow[] = [];

  parsed.rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    if (isRowEffectivelyEmpty(row)) {
      invalidRows.push({ rowNumber, reasons: ['Leere Zeile'], raw: row });
      return;
    }
    validRows.push({ rowNumber, payload: row });
  });

  return {
    success: true,
    sourceFile,
    header: parsed.header,
    rawRows: parsed.rows,
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
      error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer Commit-Import wird ein Server-Client mit Service Role benoetigt.',
    };
  }

  const triggeredBy: ImportTrigger = context?.triggeredBy || 'manual';
  const autoImportEnabled = context?.autoImportEnabled ?? false;
  const extracted = await extractSmsRows(supabase);

  if (!extracted.success) {
    const status: ImportStatus = extracted.status === 200 ? 'skipped' : 'failed';
    await persistImportRun({
      supabase,
      triggeredBy,
      status,
      autoImportEnabled,
      skipped: status === 'skipped',
      reason: extracted.error,
      stats: {
        totalRowsFromFile: 0,
        parsedRows: 0,
        validRows: 0,
        invalidRows: 0,
      },
    });
    return {
      success: status === 'skipped',
      status: extracted.status,
      error: extracted.error,
      skipped: status === 'skipped',
    };
  }

  const sourceFile = extracted.sourceFile;
  await upsertSourceFileStatus(supabase, sourceFile, 'processing');

  const errors: Array<{ rowNumber: number; error: string }> = [];
  const warnings: Array<{ rowNumber: number; warning: string }> = [];

  try {
    const rowsForUpsert = extracted.validRows.map((row) => ({
      source_file_id: sourceFile.id,
      source_file_name: sourceFile.name,
      source_row_number: row.rowNumber,
      modified_at: sourceFile.modifiedTime,
      payload: row.payload,
      updated_at: new Date().toISOString(),
    }));

    const rowNumbers = rowsForUpsert.map((r) => r.source_row_number);
    const { data: existingRows, error: existingError } = rowNumbers.length
      ? await supabase
          .from('sms_events')
          .select('source_row_number')
          .eq('source_file_id', sourceFile.id)
          .in('source_row_number', rowNumbers)
      : { data: [], error: null as any };

    if (existingError) {
      throw new Error(`Vorab-Check fehlgeschlagen: ${existingError.message}`);
    }

    const existingSet = new Set((existingRows || []).map((r: any) => Number(r.source_row_number)));
    const updated = rowsForUpsert.filter((r) => existingSet.has(r.source_row_number)).length;

    let imported = 0;
    let failed = 0;
    const BATCH_SIZE = 200;
    for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
      const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('sms_events')
        .upsert(chunk, { onConflict: 'source_file_id,source_row_number', ignoreDuplicates: false });
      if (error) {
        failed += chunk.length;
        chunk.forEach((row) => {
          errors.push({ rowNumber: row.source_row_number, error: error.message });
        });
      } else {
        imported += chunk.length;
      }
    }

    const stats = {
      totalRowsFromFile: extracted.rawRows.length,
      parsedRows: extracted.rawRows.length,
      validRows: extracted.validRows.length,
      invalidRows: extracted.invalidRows.length,
      toImport: rowsForUpsert.length,
      imported,
      failed,
      duplicates: 0,
      updated,
    };

    const runStatus: ImportStatus = failed > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success';
    await upsertSourceFileStatus(supabase, sourceFile, runStatus === 'failed' ? 'failed' : 'success', {
      imported,
      updated,
      error: runStatus === 'failed' ? 'Alle Upserts fehlgeschlagen' : null,
    });

    await persistImportRun({
      supabase,
      triggeredBy,
      status: runStatus,
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      stats,
      warnings,
      errors,
    });

    return {
      success: runStatus !== 'failed',
      mode: 'commit',
      sourceFile,
      stats,
      warnings: warnings.slice(0, 200),
      errors: errors.slice(0, 200),
    };
  } catch (error: any) {
    await upsertSourceFileStatus(supabase, sourceFile, 'failed', {
      error: error?.message || 'Unbekannter Fehler',
    });
    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'failed',
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      reason: error?.message || 'Unbekannter Fehler',
      stats: {
        totalRowsFromFile: extracted.rawRows.length,
        parsedRows: extracted.rawRows.length,
        validRows: extracted.validRows.length,
        invalidRows: extracted.invalidRows.length,
        toImport: extracted.validRows.length,
        imported: 0,
        failed: extracted.validRows.length,
        duplicates: 0,
        updated: 0,
      },
      warnings,
      errors,
    });
    return {
      success: false,
      status: 500,
      error: error?.message || 'Unbekannter Fehler beim SMS-Import.',
      sourceFile,
    };
  }
}

