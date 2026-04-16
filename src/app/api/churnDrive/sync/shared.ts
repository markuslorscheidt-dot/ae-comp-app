import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Papa from 'papaparse';
import AdmZip from 'adm-zip';

const CHURN_DRIVE_AUTO_IMPORT_KEY = 'churn_drive_auto_import_enabled';
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.readonly'];

type ImportTrigger = 'manual' | 'cron';
type ImportStatus = 'success' | 'partial' | 'failed' | 'skipped';

export type DriveFileMeta = {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  mimeType?: string;
};

export type ParsedCsvSet = {
  clientListRows: Record<string, unknown>[];
  scheduledDetailRows: Record<string, unknown>[];
  summaryRows: Array<{ type: string; rows: Record<string, unknown>[] }>;
  fileNames: {
    clientList?: string;
    scheduledDetail?: string;
    summaries: string[];
  };
};

export type ChurnDriveIngestPayload = {
  sourceFile?: Partial<DriveFileMeta>;
  parsed: ParsedCsvSet;
};

type ExtractResult =
  | {
      success: true;
      sourceFile: DriveFileMeta;
      stats: {
        zipEntries: number;
        clientListRows: number;
        scheduledDetailRows: number;
        summaryRows: number;
      };
      parsed: ParsedCsvSet;
    }
  | {
      success: false;
      status: number;
      error: string;
      details?: unknown;
    };

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/\s+/g, '').replace(/€/g, '');
  if (!raw) return null;

  let normalized = raw;

  // Support both US (1,234.56) and DE (1.234,56) number formats.
  if (raw.includes(',') && raw.includes('.')) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastDot > lastComma) {
      // US format: comma as thousands separator, dot as decimal separator.
      normalized = raw.replace(/,/g, '');
    } else {
      // DE format: dot as thousands separator, comma as decimal separator.
      normalized = raw.replace(/\./g, '').replace(/,/g, '.');
    }
  } else if (raw.includes(',')) {
    const commaCount = (raw.match(/,/g) || []).length;
    if (commaCount > 1) {
      // Multiple commas are most likely thousands separators.
      normalized = raw.replace(/,/g, '');
    } else {
      const [left, right = ''] = raw.split(',');
      // Single comma with 1-2 trailing digits is likely decimal comma.
      if (right.length > 0 && right.length <= 2) normalized = `${left}.${right}`;
      else normalized = raw.replace(/,/g, '');
    }
  } else if (raw.includes('.')) {
    const dotCount = (raw.match(/\./g) || []).length;
    if (dotCount > 1) {
      // Multiple dots are most likely thousands separators.
      normalized = raw.replace(/\./g, '');
    }
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(value: unknown): number | null {
  const n = parseNumber(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : null;
}

function parseMonthToIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/.exec(raw);
  if (match) {
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    }
  }

  return null;
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    const trimmed = String(key || '').trim();
    if (trimmed) normalized[trimmed] = value;
  });
  return normalized;
}

function identifyCsvType(fileName: string): 'client_list' | 'scheduled_detail' | 'summary' | null {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('client_list')) return 'client_list';
  if (normalized === 'scheduled_churn_arr.csv') return 'scheduled_detail';
  if (normalized.includes('messenger_churn_arr_(excl_scheduled_churn).csv')) return 'summary';
  if (normalized.includes('messenger_new_client_churn_arr_(excl_scheduled_churn).csv')) return 'summary';
  if (normalized.includes('messenger_existing_client_churn_arr_(excl_scheduled_churn).csv')) return 'summary';
  if (normalized.includes('ytd_messenger_churn_arr_(excl_scheduled_churn).csv')) return 'summary';
  if (normalized.includes('scheduled_churn_arr_1.csv')) return 'summary';
  return null;
}

function getSummaryType(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('ytd_messenger_churn_arr')) return 'ytd_excl_scheduled';
  if (normalized.includes('messenger_new_client_churn_arr')) return 'monthly_new_clients_excl_scheduled';
  if (normalized.includes('messenger_existing_client_churn_arr')) return 'monthly_existing_clients_excl_scheduled';
  if (normalized.includes('messenger_churn_arr_(excl_scheduled_churn).csv')) return 'monthly_total_excl_scheduled';
  if (normalized.includes('scheduled_churn_arr_1.csv')) return 'scheduled_summary';
  return 'summary_unknown';
}

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

function getDriveFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_CHURN_FOLDER_ID?.trim() || null;
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
    return { success: false, status: 500, error: 'GOOGLE_DRIVE_CHURN_FOLDER_ID fehlt.' };
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
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data as ArrayBuffer);
}

async function getLatestUnprocessedZip(supabase: ReturnType<typeof createClient>, force = false) {
  const listResult = await listZipFiles();
  if (!listResult.success) return listResult;

  const driveFiles = listResult.files;
  if (driveFiles.length === 0) {
    return { success: false as const, status: 404, error: 'Keine ZIP-Dateien im Drive-Ordner gefunden.' };
  }

  if (force) {
    return { success: true as const, file: driveFiles[0] };
  }

  const fileIds = driveFiles.map((f) => f.id);
  const { data: processedRows, error } = await supabase
    .from('churn_drive_source_files')
    .select('drive_file_id, status')
    .in('drive_file_id', fileIds);

  if (error) {
    return { success: false as const, status: 500, error: `Source-File-Status konnte nicht geladen werden: ${error.message}` };
  }

  const processedSet = new Set(
    (processedRows || [])
      .filter((r: any) => r.status === 'success')
      .map((r: any) => String(r.drive_file_id))
  );

  const pending = driveFiles.find((f) => !processedSet.has(f.id));
  if (!pending) {
    return {
      success: false as const,
      status: 200,
      error: 'Keine neuen ZIP-Dateien zu verarbeiten (alle bereits importiert).',
    };
  }

  return { success: true as const, file: pending };
}

function parseCsvText(csvText: string): Record<string, unknown>[] {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors?.length) {
    throw new Error(`CSV Parsing-Fehler: ${parsed.errors[0].message}`);
  }
  return (parsed.data || []).map((row) => normalizeRowKeys(row as Record<string, unknown>));
}

export async function extractDriveZipData(
  supabase: ReturnType<typeof createClient>,
  options?: { force?: boolean }
): Promise<ExtractResult> {
  const latest = await getLatestUnprocessedZip(supabase, Boolean(options?.force));
  if (!latest.success) {
    return { success: false, status: latest.status, error: latest.error };
  }

  const sourceFile = latest.file;
  const zipBuffer = await downloadZip(sourceFile.id);
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const parsed: ParsedCsvSet = {
    clientListRows: [],
    scheduledDetailRows: [],
    summaryRows: [],
    fileNames: { summaries: [] },
  };

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.split('/').pop() || entry.entryName;
    const type = identifyCsvType(entryName);
    if (!type || !entryName.toLowerCase().endsWith('.csv')) continue;

    const csvText = entry.getData().toString('utf8');
    const rows = parseCsvText(csvText);

    if (type === 'client_list') {
      parsed.clientListRows = rows;
      parsed.fileNames.clientList = entryName;
    } else if (type === 'scheduled_detail') {
      parsed.scheduledDetailRows = rows;
      parsed.fileNames.scheduledDetail = entryName;
    } else {
      parsed.summaryRows.push({ type: getSummaryType(entryName), rows });
      parsed.fileNames.summaries.push(entryName);
    }
  }

  return {
    success: true,
    sourceFile,
    stats: {
      zipEntries: entries.length,
      clientListRows: parsed.clientListRows.length,
      scheduledDetailRows: parsed.scheduledDetailRows.length,
      summaryRows: parsed.summaryRows.reduce((sum, s) => sum + s.rows.length, 0),
    },
    parsed,
  };
}

async function upsertSourceFileStatus(
  supabase: ReturnType<typeof createClient>,
  sourceFile: DriveFileMeta,
  status: 'processing' | 'success' | 'failed',
  details?: { error?: string | null; imported?: number; updated?: number }
) {
  await supabase
    .from('churn_drive_source_files')
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

async function isSourceFileAlreadyProcessed(
  supabase: ReturnType<typeof createClient>,
  sourceFileId: string
) {
  const { data, error } = await supabase
    .from('churn_drive_source_files')
    .select('drive_file_id, status')
    .eq('drive_file_id', sourceFileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Source-File-Status konnte nicht geladen werden: ${error.message}`);
  }

  return data?.status === 'success';
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
    zipEntries: number;
    clientListRows: number;
    scheduledDetailRows: number;
    summaryRows: number;
    imported?: number;
    updated?: number;
    failed?: number;
  };
  warnings?: string[];
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
  } = params;

  const { data: run, error: runError } = await supabase
    .from('churn_drive_import_runs')
    .insert({
      triggered_by: triggeredBy,
      status,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      source_file_name: sourceFileName || null,
      zip_entries: stats?.zipEntries ?? 0,
      client_list_rows: stats?.clientListRows ?? 0,
      scheduled_detail_rows: stats?.scheduledDetailRows ?? 0,
      summary_rows: stats?.summaryRows ?? 0,
      imported: stats?.imported ?? 0,
      updated: stats?.updated ?? 0,
      failed: stats?.failed ?? 0,
      auto_import_enabled: autoImportEnabled,
      skipped,
      reason,
    })
    .select('id')
    .single();

  if (runError || !run?.id) {
    console.error('ChurnDrive Import-Run Logging fehlgeschlagen:', runError?.message || 'Keine run.id');
    return;
  }

  if (warnings.length > 0) {
    const items = warnings.map((warning) => ({
      run_id: run.id,
      level: 'warning',
      message: warning,
      created_at: new Date().toISOString(),
    }));
    await supabase.from('churn_drive_import_run_items').insert(items);
  }
}

function getRowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

async function upsertClientListRows(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
  sourceFile: DriveFileMeta
) {
  const warnings: string[] = [];
  const validRows: any[] = [];

  rows.forEach((raw, idx) => {
    const row = normalizeRowKeys(raw);
    const oakId = parseInteger(row['OAK ID']);
    const churnMonth = parseMonthToIsoDate(row['Event Month']);
    const glMonth = parseMonthToIsoDate(row['Golive Month']);
    const customerName = getRowString(row, 'Business Name');
    const totalArrLost = parseNumber(row['Messenger Churn - Total Lost ARR (excl scheduled)']);
    const subsLost = parseNumber(row['Messenger Churn - Total Lost Subs Revenue (excl scheduled)']);
    const payLost = parseNumber(row['Messenger Churn - Total Lost Pay Revenue (excl scheduled)']);

    if (!oakId || !churnMonth || !customerName) {
      warnings.push(`client_list Zeile ${idx + 2}: Pflichtfelder fehlen (OAK/Event Month/Business Name).`);
      return;
    }

    validRows.push({
      oak_id: oakId,
      gl_month: glMonth,
      churn_month: churnMonth,
      customer_name: customerName,
      coo: getRowString(row, 'Business Advisor') || null,
      churn_reason: getRowString(row, 'Churn Reason') || null,
      package_name: getRowString(row, 'Package Tier Number') || null,
      total_arr_lost: totalArrLost ?? 0,
      subs_revenue_lost: subsLost ?? 0,
      pay_revenue_lost: payLost ?? 0,
      scheduled: false,
      source_tab: 'drive_client_list',
      source_row_number: idx + 2,
      updated_at: new Date().toISOString(),
    });
  });

  const dedupedByOakId = new Map<number, any>();
  validRows.forEach((row) => {
    // Last row wins to avoid ON CONFLICT touching the same row multiple times in one statement.
    dedupedByOakId.set(row.oak_id, row);
  });
  const dedupedRows = Array.from(dedupedByOakId.values());
  const duplicateCount = validRows.length - dedupedRows.length;
  if (duplicateCount > 0) {
    warnings.push(`client_list: ${duplicateCount} Duplikate nach OAK ID im Source-File erkannt und konsolidiert.`);
  }

  const oakIds = dedupedRows.map((r) => r.oak_id);
  const { data: existingRows } = oakIds.length
    ? await supabase.from('churn_events').select('oak_id').in('oak_id', oakIds)
    : { data: [] as any[] };
  const existingSet = new Set((existingRows || []).map((r: any) => Number(r.oak_id)));

  const { error } = dedupedRows.length
    ? await supabase.from('churn_events').upsert(dedupedRows, { onConflict: 'oak_id', ignoreDuplicates: false })
    : { error: null as any };
  if (error) {
    throw new Error(`Client-List Upsert fehlgeschlagen: ${error.message}`);
  }

  const updated = dedupedRows.filter((r) => existingSet.has(r.oak_id)).length;
  const imported = dedupedRows.length;

  return { imported, updated, warnings };
}

async function upsertScheduledRows(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
  sourceFile: DriveFileMeta
) {
  const warnings: string[] = [];
  const validRows: any[] = [];

  rows.forEach((raw, idx) => {
    const row = normalizeRowKeys(raw);
    const oakId = parseInteger(row['OAK ID']);
    const churnMonth = parseMonthToIsoDate(row['Schdule Churn Month'] ?? row['Schedule Churn Month']);
    const glMonth = parseMonthToIsoDate(row['Golive Month']);
    const businessName = getRowString(row, 'Business Name');
    if (!oakId || !churnMonth || !businessName) {
      warnings.push(`scheduled_detail Zeile ${idx + 2}: Pflichtfelder fehlen (OAK/Churn Month/Business Name).`);
      return;
    }

    validRows.push({
      oak_id: oakId,
      churn_month: churnMonth,
      gl_month: glMonth,
      business_name: businessName,
      branch_name: getRowString(row, 'Branch Name') || null,
      package_tier_number: getRowString(row, 'Package Tier number') || null,
      business_advisor: getRowString(row, 'Business Advisor') || null,
      pay_account_executive: getRowString(row, 'Phorest Pay Account Executive') || null,
      health_score: parseNumber(row['Health Score']),
      billing_currency: getRowString(row, 'Billing Currency') || null,
      churn_reason: getRowString(row, 'Churn Reason') || null,
      schedule_churn_arr: parseNumber(row['Schedule Churn ARR']) ?? 0,
      estimated_lost_bill: parseNumber(row['Estimate Lost Bill From Scheduled Churn']) ?? 0,
      source_file_id: sourceFile.id,
      source_file_name: sourceFile.name,
      source_row_number: idx + 2,
      updated_at: new Date().toISOString(),
    });
  });

  const dedupedByOakId = new Map<number, any>();
  validRows.forEach((row) => {
    // Last row wins to avoid ON CONFLICT touching the same row multiple times in one statement.
    dedupedByOakId.set(row.oak_id, row);
  });
  const dedupedRows = Array.from(dedupedByOakId.values());
  const duplicateCount = validRows.length - dedupedRows.length;
  if (duplicateCount > 0) {
    warnings.push(`scheduled_detail: ${duplicateCount} Duplikate nach OAK ID im Source-File erkannt und konsolidiert.`);
  }

  const oakIds = dedupedRows.map((r) => r.oak_id);
  const { data: existingRows } = oakIds.length
    ? await supabase.from('churn_scheduled_events').select('oak_id').in('oak_id', oakIds)
    : { data: [] as any[] };
  const existingSet = new Set((existingRows || []).map((r: any) => Number(r.oak_id)));

  const { error } = dedupedRows.length
    ? await supabase.from('churn_scheduled_events').upsert(dedupedRows, { onConflict: 'oak_id', ignoreDuplicates: false })
    : { error: null as any };
  if (error) {
    throw new Error(`Scheduled-Detail Upsert fehlgeschlagen: ${error.message}`);
  }

  const updated = dedupedRows.filter((r) => existingSet.has(r.oak_id)).length;
  const imported = dedupedRows.length;
  return { imported, updated, warnings };
}

async function upsertSummaryRows(
  supabase: ReturnType<typeof createClient>,
  summaries: Array<{ type: string; rows: Record<string, unknown>[] }>,
  sourceFile: DriveFileMeta
) {
  const snapshotDate = sourceFile.modifiedTime.slice(0, 10);
  const upserts: any[] = [];
  const warnings: string[] = [];

  summaries.forEach((summary) => {
    summary.rows.forEach((rawRow) => {
      const row = normalizeRowKeys(rawRow);
      const eventMonth = parseMonthToIsoDate(row['Event Month']);
      const eventMonthKey = eventMonth || 'ALL';

      upserts.push({
        snapshot_date: snapshotDate,
        metric_type: summary.type,
        event_month: eventMonth,
        event_month_key: eventMonthKey,
        number_of_net_churns: parseNumber(row['Number of Net Churns']),
        total_lost_arr: parseNumber(row['Messenger Churn - Total Lost ARR (excl scheduled)']),
        avg_bill_of_churned_client: parseNumber(row['Avg Bill of Messenger Churned Client']),
        number_of_scheduled_churns: parseNumber(row['Number of Scheduled Churns']),
        scheduled_churn_arr: parseNumber(row['Scheduled Churn ARR']),
        expected_lost_bill_scheduled: parseNumber(row['Expected Lost Bill from Scheduled Churn'] ?? row['Expected Lost Bill From Scheduled Churn']),
        source_file_id: sourceFile.id,
        source_file_name: sourceFile.name,
        updated_at: new Date().toISOString(),
      });
    });
  });

  const dedupedByKey = new Map<string, any>();
  upserts.forEach((row) => {
    const key = `${row.snapshot_date}|${row.metric_type}|${row.event_month_key}`;
    // Last row wins to avoid ON CONFLICT touching same target row multiple times.
    dedupedByKey.set(key, row);
  });
  const dedupedUpserts = Array.from(dedupedByKey.values());
  const duplicateCount = upserts.length - dedupedUpserts.length;
  if (duplicateCount > 0) {
    warnings.push(`summary: ${duplicateCount} Duplikate nach snapshot_date/metric_type/event_month erkannt und konsolidiert.`);
  }

  const { error } = dedupedUpserts.length
    ? await supabase
        .from('churn_rollup_events')
        .upsert(dedupedUpserts, { onConflict: 'snapshot_date,metric_type,event_month_key', ignoreDuplicates: false })
    : { error: null as any };

  if (error) {
    throw new Error(`Summary Upsert fehlgeschlagen: ${error.message}`);
  }

  return { imported: dedupedUpserts.length, updated: 0, warnings };
}

export async function getChurnDriveAutoImportState() {
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
    .eq('key', CHURN_DRIVE_AUTO_IMPORT_KEY)
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

export async function runDryRun(options?: { force?: boolean }) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { success: false as const, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' };
  }

  const extracted = await extractDriveZipData(supabase, options);
  if (!extracted.success) {
    return { success: false as const, status: extracted.status, error: extracted.error };
  }

  return {
    success: true as const,
    mode: 'dry-run',
    sourceFile: extracted.sourceFile,
    stats: extracted.stats,
    preview: {
      clientList: extracted.parsed.clientListRows.slice(0, 5),
      scheduledDetail: extracted.parsed.scheduledDetailRows.slice(0, 5),
      summaries: extracted.parsed.summaryRows.map((s) => ({ type: s.type, sample: s.rows.slice(0, 2) })),
    },
  };
}

export async function runCommitImport(
  context?: { triggeredBy?: ImportTrigger; autoImportEnabled?: boolean; force?: boolean }
) {
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

  const extracted = await extractDriveZipData(supabase, { force: Boolean(context?.force) });
  if (!extracted.success) {
    const status: ImportStatus = extracted.status === 200 ? 'skipped' : 'failed';
    await persistImportRun({
      supabase,
      triggeredBy,
      status,
      autoImportEnabled,
      sourceFileName: null,
      skipped: status === 'skipped',
      reason: extracted.error,
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

  try {
    const warnings: string[] = [];
    let imported = 0;
    let updated = 0;

    const clientRes = await upsertClientListRows(supabase, extracted.parsed.clientListRows, sourceFile);
    imported += clientRes.imported;
    updated += clientRes.updated;
    warnings.push(...clientRes.warnings);

    const scheduledRes = await upsertScheduledRows(supabase, extracted.parsed.scheduledDetailRows, sourceFile);
    imported += scheduledRes.imported;
    updated += scheduledRes.updated;
    warnings.push(...scheduledRes.warnings);

    const summaryRes = await upsertSummaryRows(supabase, extracted.parsed.summaryRows, sourceFile);
    imported += summaryRes.imported;
    updated += summaryRes.updated;
    warnings.push(...summaryRes.warnings);

    await upsertSourceFileStatus(supabase, sourceFile, 'success', { imported, updated });

    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'success',
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      stats: {
        ...extracted.stats,
        imported,
        updated,
        failed: 0,
      },
      warnings,
    });

    return {
      success: true,
      mode: 'commit',
      sourceFile,
      stats: {
        ...extracted.stats,
        imported,
        updated,
        failed: 0,
      },
      warnings: warnings.slice(0, 200),
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
        ...extracted.stats,
        imported: 0,
        updated: 0,
        failed: 1,
      },
    });

    return {
      success: false,
      status: 500,
      error: error?.message || 'Unbekannter Fehler beim Churn-Drive-Import.',
      sourceFile,
    };
  }
}

export async function runCommitFromPayload(
  payload: ChurnDriveIngestPayload,
  context?: { triggeredBy?: ImportTrigger; autoImportEnabled?: boolean }
) {
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

  const sourceFileName = String(payload.sourceFile?.name || 'apps-script-churn.zip');
  const sourceFileId = String(
    payload.sourceFile?.id ||
      `apps-script-${sourceFileName}-${Date.now()}`
  );
  const sourceModifiedTime = String(payload.sourceFile?.modifiedTime || new Date().toISOString());

  const sourceFile: DriveFileMeta = {
    id: sourceFileId,
    name: sourceFileName,
    modifiedTime: sourceModifiedTime,
  };

  if (await isSourceFileAlreadyProcessed(supabase, sourceFile.id)) {
    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'skipped',
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      skipped: true,
      reason: 'Datei bereits verarbeitet',
    });
    return {
      success: true,
      skipped: true,
      mode: 'commit',
      reason: 'Datei bereits verarbeitet',
      sourceFile,
    };
  }

  await upsertSourceFileStatus(supabase, sourceFile, 'processing');

  try {
    const parsed = payload.parsed || {
      clientListRows: [],
      scheduledDetailRows: [],
      summaryRows: [],
      fileNames: { summaries: [] },
    };

    const warnings: string[] = [];
    let imported = 0;
    let updated = 0;

    const clientRes = await upsertClientListRows(supabase, parsed.clientListRows || [], sourceFile);
    imported += clientRes.imported;
    updated += clientRes.updated;
    warnings.push(...clientRes.warnings);

    const scheduledRes = await upsertScheduledRows(supabase, parsed.scheduledDetailRows || [], sourceFile);
    imported += scheduledRes.imported;
    updated += scheduledRes.updated;
    warnings.push(...scheduledRes.warnings);

    const summaryRes = await upsertSummaryRows(supabase, parsed.summaryRows || [], sourceFile);
    imported += summaryRes.imported;
    updated += summaryRes.updated;
    warnings.push(...summaryRes.warnings);

    await upsertSourceFileStatus(supabase, sourceFile, 'success', { imported, updated });

    const stats = {
      zipEntries: 0,
      clientListRows: parsed.clientListRows?.length || 0,
      scheduledDetailRows: parsed.scheduledDetailRows?.length || 0,
      summaryRows: (parsed.summaryRows || []).reduce((sum, s) => sum + (s.rows?.length || 0), 0),
      imported,
      updated,
      failed: 0,
    };

    await persistImportRun({
      supabase,
      triggeredBy,
      status: 'success',
      autoImportEnabled,
      sourceFileName: sourceFile.name,
      stats,
      warnings,
    });

    return {
      success: true,
      mode: 'commit',
      sourceFile,
      stats,
      warnings: warnings.slice(0, 200),
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
        zipEntries: 0,
        clientListRows: payload.parsed?.clientListRows?.length || 0,
        scheduledDetailRows: payload.parsed?.scheduledDetailRows?.length || 0,
        summaryRows: (payload.parsed?.summaryRows || []).reduce((sum, s) => sum + (s.rows?.length || 0), 0),
        imported: 0,
        updated: 0,
        failed: 1,
      },
    });

    return {
      success: false,
      status: 500,
      error: error?.message || 'Unbekannter Fehler beim Churn-Drive-Ingest.',
      sourceFile,
    };
  }
}
