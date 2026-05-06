import { createClient } from '@supabase/supabase-js';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { google } from 'googleapis';
import Papa from 'papaparse';
import AdmZip from 'adm-zip';

const UP_DOWNSELLS_AUTO_IMPORT_KEY = 'up_downsells_auto_import_enabled';
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

type ExtractSuccess = {
  success: true;
  sourceFile: DriveFileMeta;
  csvEntryName: string;
  zipEntries: number;
  header: string[];
  rawRowCount: number;
  parsedRows: ParsedUpDownsellRow[];
  validRows: ParsedUpDownsellRow[];
  invalidRows: InvalidRow[];
  warnings: Array<{ rowNumber: number; warning: string }>;
};

type ExtractFailure = {
  success: false;
  status: number;
  error: string;
};

type ExtractResult = ExtractSuccess | ExtractFailure;

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

function getDriveFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_UP_DOWNSELLS_FOLDER_ID?.trim() || null;
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
  const folderId = getDriveFolderId();
  if (!folderId) {
    return { success: false, status: 500, error: 'GOOGLE_DRIVE_UP_DOWNSELLS_FOLDER_ID fehlt.' };
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
    q:
      `'${folderId}' in parents and trashed = false and (` +
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
    }));

  return { success: true, files };
}

async function downloadZip(fileId: string): Promise<Buffer> {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Drive Auth fehlt');
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(response.data as ArrayBuffer);
}

async function getLatestUnprocessedZip(supabase: ReturnType<typeof createClient>, force = false) {
  const listResult = await listZipFiles();
  if (!listResult.success) return listResult;
  if (listResult.files.length === 0) {
    return { success: false as const, status: 404, error: 'Keine ZIP-Dateien im Drive-Ordner gefunden.' };
  }

  if (force) {
    return { success: true as const, file: listResult.files[0] };
  }

  const fileIds = listResult.files.map((f) => f.id);
  const { data, error } = await supabase
    .from('up_downsells_source_files')
    .select('drive_file_id, status')
    .in('drive_file_id', fileIds);

  if (error) {
    return {
      success: false as const,
      status: 500,
      error: `Source-File-Status konnte nicht geladen werden: ${error.message}`,
    };
  }

  const processedSet = new Set(
    (data || []).filter((r: { status?: string }) => r.status === 'success').map((r: { drive_file_id: string }) => String(r.drive_file_id))
  );
  const pending = listResult.files.find((f) => !processedSet.has(f.id));
  if (!pending) {
    return {
      success: false as const,
      status: 200,
      error: 'Keine neuen ZIP-Dateien zu verarbeiten (alle bereits importiert).',
    };
  }
  return { success: true as const, file: pending };
}

function normalizeRow(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    const k = String(key || '')
      .replace(/^\ufeff/, '')
      .trim();
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
  const header = (parsed.meta?.fields || [])
    .map((f) => String(f || '').replace(/^\ufeff/, '').trim())
    .filter(Boolean);
  return { header, rows };
}

function scoreUpDownsellsCsvEntry(entryName: string): number {
  const n = entryName.toLowerCase();
  let score = 0;
  if (n.includes('salon_level_details')) score += 80;
  if (n.includes('salon_level')) score += 50;
  if (n.includes('package') && (n.includes('upgrade') || n.includes('downgrade'))) score += 45;
  if (n.includes('dashboard-package')) score += 10;
  return score;
}

function pickSortedCsvEntries(zip: AdmZip): AdmZip.IZipEntry[] {
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const csvEntries = entries.filter((entry) => entry.entryName.toLowerCase().endsWith('.csv'));
  return [...csvEntries].sort((a, b) => scoreUpDownsellsCsvEntry(b.entryName) - scoreUpDownsellsCsvEntry(a.entryName));
}

const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  mär: 3,
  mrz: 3,
  maerz: 3,
  märz: 3,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  okt: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  dez: 12,
};

function normalizeMonthToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .trim();
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

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function parseYearMonthToIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let match = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (isValidDateParts(year, month, 1)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }

  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/.exec(trimmed);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }

  return null;
}

function parseUsageMonth(raw: string | undefined): string | null {
  if (!raw) return null;
  const fromStandard = parseYearMonthToIsoDate(raw);
  if (fromStandard) return fromStandard;

  const trimmed = raw.trim();
  const wordMonth = /^([A-Za-zäöüÄÖÜß]+)\s+(\d{4})$/.exec(trimmed);
  if (wordMonth) {
    const mon = MONTH_NAME_TO_NUM[normalizeMonthToken(wordMonth[1])];
    const y = Number(wordMonth[2]);
    if (mon && y >= 2000 && y <= 2100) {
      return `${y}-${String(mon).padStart(2, '0')}-01`;
    }
  }

  return null;
}

function firstMatchingHeader(header: string[], candidates: string[]): string | null {
  const set = new Set(header.map((h) => h.trim()));
  for (const c of candidates) {
    if (set.has(c)) return c;
  }
  return null;
}

function resolveNetPackageGrowthHeader(header: string[]): string | null {
  const exact = firstMatchingHeader(header, ['Net Package fee growth Amount(ARR)']);
  if (exact) return exact;
  const fuzzy = header.find((h) => /net package fee growth/i.test(h) && /arr/i.test(h));
  return fuzzy || null;
}

function resolveDifferenceFeeHeader(header: string[]): string | null {
  const upgradeExact = firstMatchingHeader(header, ['Difference in fee amounts']);
  if (upgradeExact) return upgradeExact;

  const downgradeExact = firstMatchingHeader(header, ['Difference in fee amount', 'Difference in Fee Amount']);
  if (downgradeExact) return downgradeExact;

  const fuzzy = header.find((h) => /difference in fee amount(s)?/i.test(h));
  return fuzzy || null;
}

function resolveUsageMonthHeader(header: string[]): string | null {
  return firstMatchingHeader(header, [
    'Usage Month',
    'Upgrade / Downgrade Month',
    'Created Month',
    'Created month',
    'Event Date',
  ]);
}

function resolveOakHeader(header: string[]): string | null {
  return firstMatchingHeader(header, ['OAK ID', 'Oak ID']);
}

function resolveCustomerHeader(header: string[]): string | null {
  return firstMatchingHeader(header, ['Branch Name', 'Customer Name']);
}

function resolveEventTypeHeader(header: string[]): string | null {
  return firstMatchingHeader(header, ['Event Type']);
}

function validateRow(row: ParsedUpDownsellRow): string[] {
  const reasons: string[] = [];
  if (!row.eventMonth) reasons.push('Ungueltiges oder fehlendes Nutzungs-/Monatsfeld');
  if (!row.oakId || row.oakId <= 0) reasons.push('Ungueltige oder fehlende Oak ID');
  if (!row.customerName) reasons.push('Kundenname fehlt');
  if (row.netGrowthArr === null && row.netLossArr === null) {
    reasons.push('Net-ARR-Betrag fehlt oder nicht parsebar');
  }
  return reasons;
}

function mapNetAmountToGrowthLoss(net: number | null): { growth: number | null; loss: number | null } {
  if (net === null) return { growth: null, loss: null };
  if (net > 0) return { growth: net, loss: 0 };
  if (net < 0) return { growth: 0, loss: net };
  return { growth: 0, loss: 0 };
}

function mapDifferenceToGrowthLoss(
  difference: number | null,
  type: 'upgrade' | 'downgrade'
): { growth: number | null; loss: number | null } {
  if (difference === null) return { growth: null, loss: null };
  const arrDelta = difference * 12;
  if (type === 'upgrade') {
    return { growth: Math.abs(arrDelta), loss: 0 };
  }
  return { growth: 0, loss: -Math.abs(arrDelta) };
}

function inferDifferenceType(params: {
  entryName: string;
  row: Record<string, string>;
  eventTypeKey: string | null;
  differenceValue: number | null;
}): 'upgrade' | 'downgrade' {
  const { entryName, row, eventTypeKey, differenceValue } = params;
  const eventType = eventTypeKey ? String(row[eventTypeKey] || '').trim().toLowerCase() : '';
  if (eventType.includes('upgrade')) return 'upgrade';
  if (eventType.includes('downgrade')) return 'downgrade';

  const name = entryName.toLowerCase();
  if (name.includes('for_upgrades')) return 'upgrade';
  if (name.includes('for_downgrades')) return 'downgrade';
  if (name.includes('upgrades') && !name.includes('downgrades')) return 'upgrade';
  if (name.includes('downgrades') && !name.includes('upgrades')) return 'downgrade';

  // Fallback: positives Delta als Upgrade, negatives als Downgrade interpretieren.
  if ((differenceValue ?? 0) < 0) return 'downgrade';
  return 'upgrade';
}

async function upsertSourceFileStatus(
  supabase: ReturnType<typeof createClient>,
  sourceFile: DriveFileMeta,
  status: 'processing' | 'success' | 'failed',
  details?: { error?: string | null; imported?: number; updated?: number }
) {
  await supabase.from('up_downsells_source_files').upsert(
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
  sheetRange?: string | null;
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
      sourceFileName,
      csvEntryName,
      zipEntries = 0,
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Up-Downsells Import-Run Logging Exception:', msg);
  }
}

export async function getUpDownsellsAutoImportState() {
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

export async function extractUpDownsellsRows(options?: { force?: boolean }): Promise<ExtractResult> {
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
  const allEntries = zip.getEntries().filter((e) => !e.isDirectory);
  const sortedCsv = pickSortedCsvEntries(zip);

  if (sortedCsv.length === 0) {
    return { success: false, status: 422, error: 'Die ZIP-Datei enthaelt keine CSV-Datei.' };
  }

  const warnings: Array<{ rowNumber: number; warning: string }> = [];

  const parsedUpDown: ParsedUpDownsellRow[] = [];
  const invalidRows: InvalidRow[] = [];
  const headerSet = new Set<string>();
  const usedCsvEntries: string[] = [];
  let totalRawRows = 0;
  let firstUsedCsvEntryName: string | null = null;

  sortedCsv.forEach((entry) => {
    let parsed: { header: string[]; rows: Record<string, string>[] };
    try {
      const csvText = entry.getData().toString('utf8');
      parsed = parseCsv(csvText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lesen/Parse fehlgeschlagen';
      warnings.push({ rowNumber: 0, warning: `CSV uebersprungen (${entry.entryName}): ${msg}` });
      return;
    }

    const usageKey = resolveUsageMonthHeader(parsed.header);
    const oakKey = resolveOakHeader(parsed.header);
    const customerKey = resolveCustomerHeader(parsed.header);
    const differenceKey = resolveDifferenceFeeHeader(parsed.header);
    const eventTypeKey = resolveEventTypeHeader(parsed.header);
    const legacyNetKey = resolveNetPackageGrowthHeader(parsed.header);

    const mode: 'difference' | 'legacy' | null = differenceKey
      ? 'difference'
      : usageKey && oakKey && customerKey && legacyNetKey
        ? 'legacy'
        : null;

    if (!mode || !usageKey || !oakKey || !customerKey) {
      return;
    }

    if (!firstUsedCsvEntryName) firstUsedCsvEntryName = entry.entryName;
    usedCsvEntries.push(entry.entryName);
    parsed.header.forEach((h) => headerSet.add(h));
    totalRawRows += parsed.rows.length;

    parsed.rows.forEach((row, idx) => {
      const rowNumber = idx + 2;
      if (isRowEffectivelyEmpty(row)) {
        invalidRows.push({
          rowNumber,
          reasons: ['Leere Zeile'],
          raw: {
            rowNumber,
            eventMonth: null,
            oakId: null,
            customerName: '',
            netGrowthArr: null,
            netLossArr: null,
          },
        });
        return;
      }

      const usageRaw = row[usageKey] ?? '';
      const oakRaw = row[oakKey] ?? '';
      const customerRaw = row[customerKey] ?? '';

      const oakIdNum = parseInt(oakRaw, 10);
      const oakId = Number.isInteger(oakIdNum) ? oakIdNum : null;

      let growth: number | null = null;
      let loss: number | null = null;
      if (mode === 'difference' && differenceKey) {
        const diffRaw = row[differenceKey] ?? '';
        const diffValue = parseNumber(diffRaw);
        const type = inferDifferenceType({
          entryName: entry.entryName,
          row,
          eventTypeKey,
          differenceValue: diffValue,
        });
        const mapped = mapDifferenceToGrowthLoss(diffValue, type);
        growth = mapped.growth;
        loss = mapped.loss;
      } else if (mode === 'legacy' && legacyNetKey) {
        const netRaw = row[legacyNetKey] ?? '';
        const netParsed = parseNumber(netRaw);
        const mapped = mapNetAmountToGrowthLoss(netParsed);
        growth = mapped.growth;
        loss = mapped.loss;
      }

      const parsedRow: ParsedUpDownsellRow = {
        rowNumber,
        eventMonth: parseUsageMonth(usageRaw),
        oakId,
        customerName: customerRaw.replace(/\s+/g, ' ').trim(),
        netGrowthArr: growth,
        netLossArr: loss,
      };

      parsedUpDown.push(parsedRow);
      const reasons = validateRow(parsedRow);
      if (reasons.length > 0) {
        invalidRows.push({ rowNumber, reasons, raw: parsedRow });
      }
    });
  });

  if (!firstUsedCsvEntryName) {
    return {
      success: false,
      status: 422,
      error:
        'Keine passende CSV in der ZIP (erwartete Spalten: Usage/Created/Upgrade Month, OAK ID, Branch/Customer Name plus Difference in fee amount(s) oder Net Package fee growth Amount(ARR)).',
    };
  }

  if (usedCsvEntries.length > 1) {
    warnings.push({
      rowNumber: 0,
      warning: `ZIP enthaelt mehrere passende CSV-Dateien; zusammen verarbeitet: ${usedCsvEntries.join(', ')}`,
    });
  }

  const invalidSet = new Set(invalidRows.map((r) => r.rowNumber));
  const validRows = parsedUpDown.filter((r) => !invalidSet.has(r.rowNumber));

  if (validRows.length === 0) {
    return {
      success: false,
      status: 422,
      error: 'Keine importierbaren Zeilen in der gewaehlten CSV (alle ungueltig oder leer).',
    };
  }

  return {
    success: true,
    sourceFile,
    csvEntryName: firstUsedCsvEntryName,
    zipEntries: allEntries.length,
    header: Array.from(headerSet),
    rawRowCount: totalRawRows,
    parsedRows: parsedUpDown,
    validRows,
    invalidRows,
    warnings,
  };
}

export async function runDryRun(options?: { force?: boolean }) {
  const extracted = await extractUpDownsellsRows({ force: Boolean(options?.force) });
  if (!extracted.success) {
    return { success: false as const, status: extracted.status, error: extracted.error };
  }

  return {
    success: true as const,
    mode: 'dry-run',
    sourceFile: extracted.sourceFile,
    csvEntryName: extracted.csvEntryName,
    zipEntries: extracted.zipEntries,
    header: extracted.header,
    stats: {
      totalRowsFromFile: extracted.rawRowCount,
      parsedRows: extracted.parsedRows.length,
      validRows: extracted.validRows.length,
      invalidRows: extracted.invalidRows.length,
    },
    warnings: extracted.warnings.slice(0, 100),
    preview: {
      valid: extracted.validRows.slice(0, 12).map((r) => ({
        rowNumber: r.rowNumber,
        eventMonth: r.eventMonth,
        oakId: r.oakId,
        customerName: r.customerName,
        netGrowthArr: r.netGrowthArr,
        netLossArr: r.netLossArr,
      })),
      invalid: extracted.invalidRows.slice(0, 12).map((r) => ({
        rowNumber: r.rowNumber,
        reasons: r.reasons,
        raw: { customerName: r.raw.customerName, oakId: r.raw.oakId },
      })),
    },
  };
}

export async function runCommitImport(context?: { triggeredBy?: ImportTrigger; autoImportEnabled?: boolean; force?: boolean }) {
  const supabase = await getServerSupabase();
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
  const extracted = await extractUpDownsellsRows({ force: Boolean(context?.force) });

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

  const warnings: Array<{ rowNumber: number; oakId: number | null; warning: string }> = extracted.warnings.map((w) => ({
    rowNumber: w.rowNumber,
    oakId: null,
    warning: w.warning,
  }));

  try {
    const rowByMonthAndOak = new Map<string, ParsedUpDownsellRow>();
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
          warning: 'Doppelte Kombination aus Monat + OAK in der CSV: Werte werden zusammengefuehrt',
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
        await upsertSourceFileStatus(supabase, sourceFile, 'failed', { error: existingError.message });
        await persistImportRun({
          supabase,
          triggeredBy,
          status: 'failed',
          autoImportEnabled,
          sourceFileName: sourceFile.name,
          csvEntryName: extracted.csvEntryName,
          zipEntries: extracted.zipEntries,
          sheetRange: sourceFile.name,
          reason: `Vorab-Check fehlgeschlagen: ${existingError.message}`,
          stats: {
            totalRowsFromFile: extracted.rawRowCount,
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

      existingSet = new Set((existingRows || []).map((r: { event_month: string; oak_id: number }) => `${String(r.event_month)}-${Number(r.oak_id)}`));
    }

    const rowsForUpsert: Array<{
      event_month: string;
      oak_id: number;
      customer_name: string;
      net_growth_arr: number;
      net_loss_arr: number;
      net_arr: number;
      source_tab: string;
      source_row_number: number;
      updated_at: string;
    }> = [];
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
        source_tab: `looker_zip:${extracted.csvEntryName}`,
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
      totalRowsFromFile: extracted.rawRowCount,
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

    await upsertSourceFileStatus(supabase, sourceFile, finalStatus === 'failed' ? 'failed' : 'success', {
      imported,
      updated,
      error: finalStatus === 'failed' ? 'Alle Upserts fehlgeschlagen' : null,
    });

    await persistImportRun({
      supabase,
      triggeredBy,
      status: finalStatus,
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      csvEntryName: extracted.csvEntryName,
      zipEntries: extracted.zipEntries,
      sheetRange: sourceFile.name,
      stats: finalStats,
      errors,
      warnings,
    });

    return {
      success: finalStatus !== 'failed',
      mode: 'commit',
      sourceFile,
      csvEntryName: extracted.csvEntryName,
      stats: { ...finalStats, zipEntries: extracted.zipEntries },
      errors: errors.slice(0, 200),
      warnings: warnings.slice(0, 200),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    await upsertSourceFileStatus(supabase, sourceFile, 'failed', { error: message });
    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'failed',
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      csvEntryName: extracted.csvEntryName,
      zipEntries: extracted.zipEntries,
      sheetRange: sourceFile.name,
      reason: message,
      stats: {
        totalRowsFromFile: extracted.rawRowCount,
        parsedRows: extracted.parsedRows.length,
        validRows: extracted.validRows.length,
        invalidRows: extracted.invalidRows.length,
        toImport: extracted.validRows.length,
        imported: 0,
        failed: extracted.validRows.length,
        duplicates: 0,
        updated: 0,
      },
      warnings,
    });
    return {
      success: false,
      status: 500,
      error: message,
      sourceFile,
    };
  }
}
