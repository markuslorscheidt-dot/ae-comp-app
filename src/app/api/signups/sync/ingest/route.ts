import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

type IngestPayload = {
  sourceFile?: {
    id?: string;
    name?: string;
    modifiedTime?: string;
  };
  csv?: {
    header?: string[];
    rows?: string[][];
  };
};

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/\s+/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function parseDateToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidDateParts(y, mo, d)) {
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+.*)?$/.exec(raw);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (isValidDateParts(y, mo, d)) {
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function getCell(row: string[], map: Map<string, number>, column: string): string {
  const idx = map.get(column);
  if (idx === undefined) return '';
  return String(row[idx] ?? '').trim();
}

function buildHeaderMap(header: string[]) {
  const map = new Map<string, number>();
  header.forEach((h, idx) => {
    const key = String(h || '').trim();
    if (key) map.set(key, idx);
  });
  return map;
}

function normalizeLevel(level: 'warning' | 'error' | 'duplicate') {
  return level;
}

export async function POST(request: Request) {
  const configuredSecret = process.env.SIGNUPS_DRIVE_INGEST_SECRET?.trim();
  if (!configuredSecret) {
    return NextResponse.json(
      { success: false, error: 'SIGNUPS_DRIVE_INGEST_SECRET fehlt in den ENV-Variablen.' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const altSecret = request.headers.get('x-ingest-secret')?.trim() || '';
  if (bearer !== configuredSecret && altSecret !== configuredSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  let payload: IngestPayload;
  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ success: false, error: 'Ungueltiger JSON-Body.' }, { status: 400 });
  }

  const header = payload.csv?.header || [];
  const rows = payload.csv?.rows || [];
  if (!Array.isArray(header) || !Array.isArray(rows) || header.length === 0) {
    return NextResponse.json({ success: false, error: 'Payload unvollstaendig: csv.header/csv.rows fehlen.' }, { status: 400 });
  }

  const map = buildHeaderMap(header);
  const required = ['Account-ID', 'Accountname'];
  const missing = required.filter((c) => !map.has(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { success: false, error: `Pflichtspalten fehlen: ${missing.join(', ')}` },
      { status: 422 }
    );
  }

  const warnings: Array<{ row_number: number | null; oak_id: number | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];
  const errors: Array<{ row_number: number | null; oak_id: number | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];

  const byAccount = new Map<string, any>();
  rows.forEach((r, idx) => {
    const row = Array.isArray(r) ? r : [];
    const rowNumber = idx + 2;
    const accountId = getCell(row, map, 'Account-ID');
    const accountName = getCell(row, map, 'Accountname');
    const oakId = parseInteger(getCell(row, map, 'OAKID'));

    if (!accountId || !accountName) {
      errors.push({
        row_number: rowNumber,
        oak_id: oakId,
        level: normalizeLevel('error'),
        message: 'Pflichtdaten fehlen (Account-ID / Accountname).',
      });
      return;
    }

    if (byAccount.has(accountId)) {
      warnings.push({
        row_number: rowNumber,
        oak_id: oakId,
        level: normalizeLevel('duplicate'),
        message: 'Doppelte Account-ID in CSV: letzte Zeile wird verwendet.',
      });
    }

    byAccount.set(accountId, {
      account_id: accountId,
      oak_id: oakId,
      account_name: accountName,
      business_type: getCell(row, map, 'Business Type') || null,
      number_of_locations: parseInteger(getCell(row, map, 'Number Of Locations')),
      employees_range: getCell(row, map, 'No of employees') || null,
      signup_package: getCell(row, map, 'Signup Package') || null,
      go_live_date: parseDateToIso(getCell(row, map, 'Go Live Date')),
      customer_info_stage: getCell(row, map, 'Customer Info Stage') || null,
      account_owner: getCell(row, map, 'Accountinhaber') || null,
      account_name_with_oak_id: getCell(row, map, 'Account Name With OAK Id') || null,
      signup_date: parseDateToIso(getCell(row, map, 'Signup Date')),
      germany_go_live_day: getCell(row, map, 'Germany Go Live Day') || null,
      source_month: parseInteger(getCell(row, map, 'Month')),
      region: getCell(row, map, 'Region') || null,
      source_tab: 'drive_signups_csv',
      source_row_number: rowNumber,
      updated_at: new Date().toISOString(),
    });
  });

  const upsertRows = Array.from(byAccount.values());
  const accountIds = upsertRows.map((r) => r.account_id);

  const { data: existing, error: existingError } = accountIds.length
    ? await supabase.from('signups_events').select('account_id').in('account_id', accountIds)
    : { data: [], error: null as any };

  if (existingError) {
    return NextResponse.json(
      { success: false, error: `Vorab-Check fehlgeschlagen: ${existingError.message}` },
      { status: 500 }
    );
  }

  const existingSet = new Set((existing || []).map((e: any) => String(e.account_id)));
  const updated = upsertRows.filter((r) => existingSet.has(r.account_id)).length;

  let imported = 0;
  let failed = 0;

  const BATCH_SIZE = 100;
  for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
    const chunk = upsertRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('signups_events').upsert(chunk, {
      onConflict: 'account_id',
      ignoreDuplicates: false,
    });

    if (error) {
      failed += chunk.length;
      chunk.forEach((c) => {
        errors.push({
          row_number: c.source_row_number ?? null,
          oak_id: c.oak_id ?? null,
          level: normalizeLevel('error'),
          message: error.message,
        });
      });
    } else {
      imported += chunk.length;
    }
  }

  const status: 'success' | 'partial' | 'failed' = failed > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success';

  const sheetRange = `drive:${payload.sourceFile?.name || 'signups.csv'}`;

  const { data: run, error: runError } = await supabase
    .from('signups_import_runs')
    .insert({
      triggered_by: 'manual',
      status,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      sheet_range: sheetRange,
      total_rows: rows.length,
      parsed_rows: rows.length,
      valid_rows: upsertRows.length,
      invalid_rows: errors.filter((e) => e.message.includes('Pflichtdaten fehlen')).length,
      to_import: upsertRows.length,
      imported,
      failed,
      duplicates: warnings.length,
      updated,
      auto_import_enabled: true,
      skipped: false,
      reason: failed > 0 ? 'Teilweise Fehler beim Upsert.' : null,
    })
    .select('id')
    .single();

  if (!runError && run?.id) {
    const items = [...warnings, ...errors].map((x) => ({
      run_id: run.id,
      row_number: x.row_number,
      oak_id: x.oak_id,
      level: x.level,
      message: x.message,
    }));
    if (items.length > 0) {
      await supabase.from('signups_import_run_items').insert(items);
    }
  }

  return NextResponse.json({
    success: failed === 0,
    mode: 'commit',
    stats: {
      totalRowsFromSheet: rows.length,
      parsedRows: rows.length,
      validRows: upsertRows.length,
      invalidRows: errors.filter((e) => e.message.includes('Pflichtdaten fehlen')).length,
      toImport: upsertRows.length,
      imported,
      failed,
      duplicates: warnings.length,
      updated,
    },
    warnings: warnings.slice(0, 100),
    errors: errors.slice(0, 100),
  });
}