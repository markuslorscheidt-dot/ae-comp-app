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

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/\s+/g, '').replace(/€/g, '').replace(/%/g, '');
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes('.') && raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) normalized = raw.replace(',', '.');

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
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

function buildHeaderMap(header: string[]) {
  const map = new Map<string, number>();
  header.forEach((h, idx) => {
    const key = String(h || '').trim();
    if (key) map.set(key, idx);
  });
  return map;
}

function getCell(row: string[], map: Map<string, number>, column: string): string {
  const idx = map.get(column);
  if (idx === undefined) return '';
  return String(row[idx] ?? '').trim();
}

function normalizeLevel(level: 'warning' | 'error' | 'duplicate') {
  return level;
}

export async function POST(request: Request) {
  const configuredSecret = process.env.LEADS_DRIVE_INGEST_SECRET?.trim();
  if (!configuredSecret) {
    return NextResponse.json(
      { success: false, error: 'LEADS_DRIVE_INGEST_SECRET fehlt in den ENV-Variablen.' },
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
  const required = ['Lead-ID', 'Firma/Account'];
  const missing = required.filter((c) => !map.has(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { success: false, error: `Pflichtspalten fehlen: ${missing.join(', ')}` },
      { status: 422 }
    );
  }

  const warnings: Array<{ row_number: number | null; lead_id: string | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];
  const errors: Array<{ row_number: number | null; lead_id: string | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];

  const byLead = new Map<string, any>();
  rows.forEach((r, idx) => {
    const row = Array.isArray(r) ? r : [];
    const rowNumber = idx + 2;
    const leadId = getCell(row, map, 'Lead-ID');
    const companyAccount = getCell(row, map, 'Firma/Account');

    if (!leadId || !companyAccount) {
      errors.push({
        row_number: rowNumber,
        lead_id: leadId || null,
        level: normalizeLevel('error'),
        message: 'Pflichtdaten fehlen (Lead-ID / Firma/Account).',
      });
      return;
    }

    if (byLead.has(leadId)) {
      warnings.push({
        row_number: rowNumber,
        lead_id: leadId,
        level: normalizeLevel('duplicate'),
        message: 'Doppelte Lead-ID in CSV: letzte Zeile wird verwendet.',
      });
    }

    byLead.set(leadId, {
      lead_id: leadId,
      first_name: getCell(row, map, 'Vorname') || null,
      last_name: getCell(row, map, 'Nachname') || null,
      company_account: companyAccount,
      lead_source: getCell(row, map, 'Lead-Quelle') || null,
      demo_or_quote: getCell(row, map, 'Demo or Quote') || null,
      number_of_locations: parseInteger(getCell(row, map, 'Number Of Locations')),
      employees_range: getCell(row, map, 'No of employees') || null,
      salon_type: getCell(row, map, 'Salon Type') || null,
      lead_owner: getCell(row, map, 'Lead-Inhaber') || null,
      lead_status: getCell(row, map, 'Lead-Status') || null,
      lead_sub_status: getCell(row, map, 'Lead Sub Status') || null,
      created_date: parseDateToIso(getCell(row, map, 'Erstelldatum')),
      last_activity_date: parseDateToIso(getCell(row, map, 'Letzte Aktivität')),
      updated_on_date: parseDateToIso(getCell(row, map, 'Zuletzt geändert am')),
      conversion_date: parseDateToIso(getCell(row, map, 'Konvertierungsdatum')),
      opportunity_id: getCell(row, map, 'Opportunity-ID') || null,
      opportunity_owner: getCell(row, map, 'Opportunity-Inhaber') || null,
      opportunity_name: getCell(row, map, 'Opportunity-Name') || null,
      opportunity_account: getCell(row, map, 'Opportunity: Account') || null,
      opportunity_amount_currency: getCell(row, map, 'Opportunity-Betrag Währung') || null,
      opportunity_amount: parseNumber(getCell(row, map, 'Opportunity-Betrag')),
      opportunity_close_date: parseDateToIso(getCell(row, map, 'Oppt.-Schlusstermin')),
      created_by: getCell(row, map, 'Erstellt von') || null,
      source_tab: 'drive_leads_csv',
      source_row_number: rowNumber,
      updated_at: new Date().toISOString(),
    });
  });

  const upsertRows = Array.from(byLead.values());
  const leadIds = upsertRows.map((r) => r.lead_id);

  const { data: existing, error: existingError } = leadIds.length
    ? await supabase.from('leads_events').select('lead_id').in('lead_id', leadIds)
    : { data: [], error: null as any };

  if (existingError) {
    return NextResponse.json(
      { success: false, error: `Vorab-Check fehlgeschlagen: ${existingError.message}` },
      { status: 500 }
    );
  }

  const existingSet = new Set((existing || []).map((e: any) => String(e.lead_id)));
  const updated = upsertRows.filter((r) => existingSet.has(r.lead_id)).length;

  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;
  for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
    const chunk = upsertRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('leads_events').upsert(chunk, {
      onConflict: 'lead_id',
      ignoreDuplicates: false,
    });
    if (error) {
      failed += chunk.length;
      chunk.forEach((c) => {
        errors.push({
          row_number: c.source_row_number ?? null,
          lead_id: c.lead_id ?? null,
          level: normalizeLevel('error'),
          message: error.message,
        });
      });
    } else {
      imported += chunk.length;
    }
  }

  const status: 'success' | 'partial' | 'failed' = failed > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success';
  const sheetRange = `drive:${payload.sourceFile?.name || 'leads.csv'}`;

  const { data: run, error: runError } = await supabase
    .from('leads_import_runs')
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
      lead_id: x.lead_id,
      level: x.level,
      message: x.message,
    }));
    if (items.length > 0) {
      await supabase.from('leads_import_run_items').insert(items);
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
