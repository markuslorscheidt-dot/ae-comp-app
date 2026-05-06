import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { google } from 'googleapis';
import Papa from 'papaparse';
import AdmZip from 'adm-zip';

const DACH_CLIENT_NUMBERS_AUTO_IMPORT_KEY = 'dach_client_numbers_auto_import_enabled';
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.readonly'];
const DACH_CLIENT_NUMBERS_FALLBACK_FOLDER_ID = '1bCh2alo1X7a7XlgCXPhebBknkEI1coi5';
const DACH_CLIENT_NUMBERS_ZIP_NAME = 'dach client numbers';

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

type DriveFileMeta = {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  mimeType?: string;
};

type ParsedClientNumbersRow = {
  csvEntryName: string;
  rowNumber: number;
  sourceRowNumber: number;
  payload: Record<string, string>;
};

type InvalidClientNumbersRow = {
  csvEntryName: string;
  rowNumber: number;
  reasons: string[];
  raw: Record<string, string>;
};

type ExtractResult =
  | {
      success: true;
      sourceFile: DriveFileMeta;
      csvEntryName: string;
      csvEntryNames: string[];
      zipEntries: number;
      header: string[];
      rawRows: Record<string, string>[];
      validRows: ParsedClientNumbersRow[];
      invalidRows: InvalidClientNumbersRow[];
      warnings: Array<{ rowNumber: number; warning: string }>;
    }
  | {
      success: false;
      status: number;
      error: string;
    };

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

function extractGoogleDriveFolderId(input: string | null | undefined): string | null {
  const value = String(input || '').trim();
  if (!value) return null;
  const directIdMatch = value.match(/^[A-Za-z0-9_-]{10,}$/);
  if (directIdMatch) return directIdMatch[0];
  const folderPathMatch = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderPathMatch?.[1]) return folderPathMatch[1];
  const idQueryMatch = value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return idQueryMatch?.[1] || null;
}

function getDriveFolderId(): string {
  return (
    extractGoogleDriveFolderId(process.env.GOOGLE_DRIVE_DACH_CLIENT_NUMBERS_FOLDER_ID) ||
    extractGoogleDriveFolderId(process.env.GOOGLE_DRIVE_DACH_CLIENT_NUMBERS_FOLDER_URL) ||
    DACH_CLIENT_NUMBERS_FALLBACK_FOLDER_ID
  );
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

async function listZipFiles(): Promise<{ success: true; files: DriveFileMeta[] } | { success: false; status: number; error: string }> {
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
    q:
      `'${getDriveFolderId()}' in parents and trashed = false and (` +
      `mimeType = 'application/zip' or mimeType = 'application/x-zip' or name contains '.zip')`,
    fields: 'files(id,name,modifiedTime,size,mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });

  const files = (response.data.files || [])
    .filter((f) => f.id && f.name && f.modifiedTime)
    .map((f) => ({
      id: String(f.id),
      name: String(f.name),
      modifiedTime: String(f.modifiedTime),
      size: f.size ? String(f.size) : undefined,
      mimeType: f.mimeType ? String(f.mimeType) : undefined,
    }))
    .filter((f) => f.name.toLowerCase().includes(DACH_CLIENT_NUMBERS_ZIP_NAME));

  return { success: true, files };
}

async function downloadZip(fileId: string): Promise<Buffer> {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Drive Auth fehlt');
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(response.data as ArrayBuffer);
}

async function getLatestUnprocessedZip(supabase: any, force = false) {
  const listResult = await listZipFiles();
  if (!listResult.success) return listResult;
  if (listResult.files.length === 0) {
    return { success: false as const, status: 404, error: 'Keine ZIP-Datei "DACH Client Numbers" im Drive-Ordner gefunden.' };
  }

  if (force) {
    return { success: true as const, file: listResult.files[0] };
  }

  const fileIds = listResult.files.map((f) => f.id);
  const { data, error } = await supabase
    .from('dach_client_numbers_source_files')
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
      error: 'Keine neuen DACH-Client-Numbers-ZIP-Dateien zu verarbeiten (alle bereits importiert).',
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
  const delimiters = [',', ';', '\t', '|'];
  const candidates: Array<{ header: string[]; rows: Record<string, string>[]; score: number }> = [];
  const fatalErrors: string[] = [];

  for (const delimiter of delimiters) {
    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      delimiter,
      header: true,
      skipEmptyLines: true,
    });

    const blockingErrors = (parsed.errors || []).filter(
      (error) => error.code !== 'UndetectableDelimiter' && error.type !== 'FieldMismatch'
    );
    if (blockingErrors.length > 0) {
      fatalErrors.push(`${blockingErrors[0].message} (Delimiter: ${delimiter})`);
      continue;
    }

    const rows = (parsed.data || []).map((row) => normalizeRow(row as Record<string, unknown>));
    const header = (parsed.meta?.fields || []).map((f) => String(f || '').trim()).filter(Boolean);
    const nonEmptyRows = rows.filter((row) => !isRowEffectivelyEmpty(row)).length;
    const score = (header.length > 1 ? 1000 : 0) + header.length * 10 + nonEmptyRows;
    candidates.push({ header, rows, score });
  }

  if (candidates.length === 0) {
    const reason = fatalErrors[0] || 'Keine gueltige CSV-Struktur gefunden.';
    throw new Error(`CSV Parsing-Fehler: ${reason}`);
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return { header: best.header, rows: best.rows };
}

function scoreCsvEntryName(entryName: string): number {
  const name = entryName.toLowerCase();
  let score = 0;
  if (name.includes('dach')) score += 200;
  if (name.includes('client')) score += 150;
  if (name.includes('number')) score += 150;
  if (name.includes('customer')) score += 75;
  return score;
}

function pickPreferredCsvEntryName(csvEntries: AdmZip.IZipEntry[]) {
  const ranked = [...csvEntries]
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((entry) => ({ entry, score: scoreCsvEntryName(entry.entryName) }))
    .sort((a, b) => b.score - a.score || a.entry.entryName.localeCompare(b.entry.entryName));
  return ranked[0]?.entry.entryName || null;
}

async function upsertSourceFileStatus(
  supabase: any,
  sourceFile: DriveFileMeta,
  status: 'processing' | 'success' | 'failed',
  details?: { error?: string | null; imported?: number; updated?: number }
) {
  await supabase
    .from('dach_client_numbers_source_files')
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
  supabase: any;
  triggeredBy: ImportTrigger;
  status: ImportStatus;
  autoImportEnabled: boolean;
  sourceFileName?: string | null;
  csvEntryName?: string | null;
  zipEntries?: number;
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
    csvEntryName,
    zipEntries = 0,
    skipped = false,
    reason = null,
    stats,
    warnings = [],
    errors = [],
  } = params;

  const { data: run, error: runError } = await supabase
    .from('dach_client_numbers_import_runs')
    .insert({
      triggered_by: triggeredBy,
      status,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      source_file_name: sourceFileName || null,
      csv_entry_name: csvEntryName || null,
      zip_entries: zipEntries,
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
    console.error('DACH Client Numbers Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
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
    await supabase.from('dach_client_numbers_import_run_items').insert(allItems);
  }
}

export async function getDachClientNumbersAutoImportState() {
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
    .eq('key', DACH_CLIENT_NUMBERS_AUTO_IMPORT_KEY)
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

export async function extractDachClientNumbersRows(options?: { force?: boolean }): Promise<ExtractResult> {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return { success: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' };
  }

  const latest = await getLatestUnprocessedZip(supabase, Boolean(options?.force));
  if (!latest.success) {
    return { success: false, status: latest.status, error: latest.error };
  }

  const sourceFile = latest.file;
  const zipBuffer = await downloadZip(sourceFile.id);
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const csvEntries = entries.filter((entry) => entry.entryName.toLowerCase().endsWith('.csv'));

  if (csvEntries.length === 0) {
    return {
      success: false,
      status: 422,
      error: 'Die ZIP-Datei enthaelt keine CSV-Datei.',
    };
  }

  const sortedCsvEntries = [...csvEntries].sort((a, b) => a.entryName.localeCompare(b.entryName));
  const preferredCsvName = pickPreferredCsvEntryName(sortedCsvEntries);
  if (!preferredCsvName) {
    return {
      success: false,
      status: 422,
      error: 'Keine geeignete CSV-Datei in der ZIP gefunden.',
    };
  }

  const warnings: Array<{ rowNumber: number; warning: string }> = [];
  const SOURCE_ROW_OFFSET_PER_FILE = 1_000_000;
  if (csvEntries.length > 1) {
    warnings.push({
      rowNumber: 0,
      warning:
        `ZIP enthaelt ${csvEntries.length} CSV-Dateien; alle werden importiert (Row-Offset ${SOURCE_ROW_OFFSET_PER_FILE} pro Datei). ` +
        `Referenz im Run: ${preferredCsvName}. Dateien: ${sortedCsvEntries.map((entry) => entry.entryName).join(', ')}`,
    });
  }

  const headerSet = new Set<string>();
  const rawRows: Record<string, string>[] = [];
  const validRows: ParsedClientNumbersRow[] = [];
  const invalidRows: InvalidClientNumbersRow[] = [];

  sortedCsvEntries.forEach((csvEntry, fileIndex) => {
    const entryName = csvEntry.entryName;
    let parsed: { header: string[]; rows: Record<string, string>[] };
    try {
      parsed = parseCsv(csvEntry.getData().toString('utf8'));
    } catch (err: any) {
      warnings.push({
        rowNumber: 0,
        warning: `CSV uebersprungen (${entryName}): ${err?.message || 'Lesen/Parse fehlgeschlagen'}`,
      });
      return;
    }

    if (parsed.header.length === 0) {
      warnings.push({ rowNumber: 0, warning: `CSV ohne Header uebersprungen: ${entryName}` });
      return;
    }

    parsed.header.forEach((h) => headerSet.add(h));
    const rowOffset = fileIndex * SOURCE_ROW_OFFSET_PER_FILE;

    parsed.rows.forEach((row, idx) => {
      const rowNumber = idx + 2;
      rawRows.push(row);
      if (isRowEffectivelyEmpty(row)) {
        invalidRows.push({
          csvEntryName: entryName,
          rowNumber,
          reasons: [`Leere Zeile (${entryName})`],
          raw: row,
        });
        return;
      }

      validRows.push({
        csvEntryName: entryName,
        rowNumber,
        sourceRowNumber: rowOffset + rowNumber,
        payload: row,
      });
    });
  });

  if (validRows.length === 0) {
    return {
      success: false,
      status: 422,
      error: 'Keine importierbaren Zeilen in der ZIP (alle CSVs leer, fehlerhaft oder ohne Header).',
    };
  }

  return {
    success: true,
    sourceFile,
    csvEntryName: preferredCsvName,
    csvEntryNames: sortedCsvEntries.map((entry) => entry.entryName),
    zipEntries: entries.length,
    header: Array.from(headerSet),
    rawRows,
    validRows,
    invalidRows,
    warnings,
  };
}

export async function runCommitImport(context?: { triggeredBy?: ImportTrigger; autoImportEnabled?: boolean; force?: boolean }) {
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
  const extracted = await extractDachClientNumbersRows({ force: Boolean(context?.force) });

  if (!extracted.success) {
    const status: ImportStatus = extracted.status === 200 ? 'skipped' : 'failed';
    await persistImportRun({
      supabase,
      triggeredBy,
      status,
      autoImportEnabled,
      skipped: status === 'skipped',
      reason: extracted.error,
      stats: { totalRowsFromFile: 0, parsedRows: 0, validRows: 0, invalidRows: 0 },
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
  const warnings: Array<{ rowNumber: number; warning: string }> = [...extracted.warnings];

  try {
    const rowsForUpsert = extracted.validRows.map((row) => ({
      source_file_id: sourceFile.id,
      source_file_name: sourceFile.name,
      source_row_number: row.sourceRowNumber,
      modified_at: sourceFile.modifiedTime,
      csv_entry_name: row.csvEntryName,
      payload: row.payload,
      updated_at: new Date().toISOString(),
    }));

    const rowNumbers = rowsForUpsert.map((r) => r.source_row_number);
    let updated = 0;
    if (rowNumbers.length > 0) {
      const existingSet = new Set<number>();
      const CHUNK_SIZE = 500;
      for (let i = 0; i < rowNumbers.length; i += CHUNK_SIZE) {
        const chunk = rowNumbers.slice(i, i + CHUNK_SIZE);
        const { data: existingRowsChunk, error: existingError } = await supabase
          .from('dach_client_numbers_events')
          .select('source_row_number')
          .eq('source_file_id', sourceFile.id)
          .in('source_row_number', chunk);

        if (existingError) {
          throw new Error(`Vorab-Check fehlgeschlagen: ${existingError.message}`);
        }

        (existingRowsChunk || []).forEach((row: any) => {
          existingSet.add(Number(row.source_row_number));
        });
      }
      updated = rowsForUpsert.filter((r) => existingSet.has(r.source_row_number)).length;
    }

    let imported = 0;
    let failed = 0;
    const BATCH_SIZE = 200;
    for (let i = 0; i < rowsForUpsert.length; i += BATCH_SIZE) {
      const chunk = rowsForUpsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('dach_client_numbers_events')
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
      csvEntryName: extracted.csvEntryName,
      zipEntries: extracted.zipEntries,
      stats,
      warnings,
      errors,
    });

    return {
      success: runStatus !== 'failed',
      mode: 'commit',
      sourceFile,
      csvEntryName: extracted.csvEntryName,
      stats: { ...stats, zipEntries: extracted.zipEntries },
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
      csvEntryName: extracted.csvEntryName,
      zipEntries: extracted.zipEntries,
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
      error: error?.message || 'Unbekannter Fehler beim DACH Client Numbers Import.',
      sourceFile,
    };
  }
}

export async function runDryRun(options?: { force?: boolean }) {
  const extracted = await extractDachClientNumbersRows({ force: Boolean(options?.force) });
  if (!extracted.success) {
    return { success: false as const, status: extracted.status, error: extracted.error };
  }

  return {
    success: true as const,
    mode: 'dry-run',
    sourceFile: extracted.sourceFile,
    csvEntryName: extracted.csvEntryName,
    stats: {
      zipEntries: extracted.zipEntries,
      totalRowsFromFile: extracted.rawRows.length,
      parsedRows: extracted.rawRows.length,
      validRows: extracted.validRows.length,
      invalidRows: extracted.invalidRows.length,
    },
    warnings: extracted.warnings.slice(0, 100),
    preview: {
      valid: extracted.validRows.slice(0, 12),
      invalid: extracted.invalidRows.slice(0, 12),
    },
  };
}
