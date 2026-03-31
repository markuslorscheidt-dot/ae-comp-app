import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
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
  const configuredSecret = process.env.SALESPIPE2_DRIVE_INGEST_SECRET?.trim();
  if (!configuredSecret) {
    return NextResponse.json(
      { success: false, error: 'SALESPIPE2_DRIVE_INGEST_SECRET fehlt in den ENV-Variablen.' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const altSecret = request.headers.get('x-ingest-secret')?.trim() || '';
  if (bearer !== configuredSecret && altSecret !== configuredSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = getServerSupabase();
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
  const required = ['Opportunity-ID', 'Opportunity-Name'];
  const missing = required.filter((c) => !map.has(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { success: false, error: `Pflichtspalten fehlen: ${missing.join(', ')}` },
      { status: 422 }
    );
  }

  const warnings: Array<{ row_number: number | null; opportunity_id: string | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];
  const errors: Array<{ row_number: number | null; opportunity_id: string | null; level: 'warning' | 'error' | 'duplicate'; message: string }> = [];

  const byOpportunity = new Map<string, any>();
  rows.forEach((r, idx) => {
    const row = Array.isArray(r) ? r : [];
    const rowNumber = idx + 2;
    const opportunityId = getCell(row, map, 'Opportunity-ID');
    const opportunityName = getCell(row, map, 'Opportunity-Name');

    if (!opportunityId || !opportunityName) {
      errors.push({
        row_number: rowNumber,
        opportunity_id: opportunityId || null,
        level: normalizeLevel('error'),
        message: 'Pflichtdaten fehlen (Opportunity-ID / Opportunity-Name).',
      });
      return;
    }

    if (byOpportunity.has(opportunityId)) {
      warnings.push({
        row_number: rowNumber,
        opportunity_id: opportunityId,
        level: normalizeLevel('duplicate'),
        message: 'Doppelte Opportunity-ID in CSV: letzte Zeile wird verwendet.',
      });
    }

    byOpportunity.set(opportunityId, {
      opportunity_id: opportunityId,
      oak_id: parseInteger(getCell(row, map, 'OAKID')),
      opportunity_name: opportunityName,
      rating: getCell(row, map, 'Prognosekategorie') || null,
      next_step: getCell(row, map, 'Nächster Schritt') || null,
      close_date: parseDateToIso(getCell(row, map, 'Schlusstermin')),
      last_activity_date: parseDateToIso(getCell(row, map, 'Letzte Aktivität')),
      stage: getCell(row, map, 'Phase') || null,
      estimated_arr: parseNumber(getCell(row, map, 'Estimated ARR')),
      probability: parseNumber(getCell(row, map, 'Wahrscheinlichkeit (%)')),
      lead_source: getCell(row, map, 'Lead-Quelle') || null,
      created_date: parseDateToIso(getCell(row, map, 'Erstelldatum')),
      opportunity_owner: getCell(row, map, 'Opportunity-Inhaber') || null,
      source_tab: 'drive_salespipe2_csv',
      source_row_number: rowNumber,
      updated_at: new Date().toISOString(),
    });
  });

  const upsertRows = Array.from(byOpportunity.values());
  const opportunityIds = upsertRows.map((r) => r.opportunity_id);

  const { data: existing, error: existingError } = opportunityIds.length
    ? await supabase
        .from('salespipe_events')
        .select(
          'opportunity_id, oak_id, opportunity_name, rating, next_step, close_date, last_activity_date, stage, estimated_arr, probability, lead_source, created_date, opportunity_owner, days_demo_to_closure, days_sentquote_to_close, decision_criteria'
        )
        .in('opportunity_id', opportunityIds)
    : { data: [], error: null as any };

  if (existingError) {
    return NextResponse.json(
      { success: false, error: `Vorab-Check fehlgeschlagen: ${existingError.message}` },
      { status: 500 }
    );
  }

  const existingMap = new Map<string, any>((existing || []).map((e: any) => [String(e.opportunity_id), e]));
  const existingSet = new Set((existing || []).map((e: any) => String(e.opportunity_id)));
  const updated = upsertRows.filter((r) => existingSet.has(r.opportunity_id)).length;

  const finalRows = upsertRows.map((row) => {
    const existingRow = existingMap.get(row.opportunity_id);
    if (!existingRow) {
      return {
        ...row,
        days_demo_to_closure: null,
        days_sentquote_to_close: null,
        decision_criteria: null,
      };
    }

    return {
      ...row,
      oak_id: row.oak_id ?? existingRow.oak_id ?? null,
      opportunity_name: row.opportunity_name || existingRow.opportunity_name || null,
      rating: row.rating ?? existingRow.rating ?? null,
      next_step: row.next_step ?? existingRow.next_step ?? null,
      close_date: row.close_date ?? existingRow.close_date ?? null,
      last_activity_date: row.last_activity_date ?? existingRow.last_activity_date ?? null,
      stage: row.stage ?? existingRow.stage ?? null,
      estimated_arr: row.estimated_arr ?? existingRow.estimated_arr ?? null,
      probability: row.probability ?? existingRow.probability ?? null,
      lead_source: row.lead_source ?? existingRow.lead_source ?? null,
      created_date: row.created_date ?? existingRow.created_date ?? null,
      opportunity_owner: row.opportunity_owner ?? existingRow.opportunity_owner ?? null,
      days_demo_to_closure: existingRow.days_demo_to_closure ?? null,
      days_sentquote_to_close: existingRow.days_sentquote_to_close ?? null,
      decision_criteria: existingRow.decision_criteria ?? null,
    };
  });

  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 100;
  for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
    const chunk = finalRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('salespipe_events').upsert(chunk, {
      onConflict: 'opportunity_id',
      ignoreDuplicates: false,
    });
    if (error) {
      failed += chunk.length;
      chunk.forEach((c) => {
        errors.push({
          row_number: c.source_row_number ?? null,
          opportunity_id: c.opportunity_id ?? null,
          level: normalizeLevel('error'),
          message: error.message,
        });
      });
    } else {
      imported += chunk.length;
    }
  }

  const status: 'success' | 'partial' | 'failed' = failed > 0 ? (imported > 0 ? 'partial' : 'failed') : 'success';
  const sheetRange = `drive:${payload.sourceFile?.name || 'salespipe2.csv'}`;

  const { data: run, error: runError } = await supabase
    .from('salespipe2_import_runs')
    .insert({
      triggered_by: 'manual',
      status,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      sheet_range: sheetRange,
      total_rows: rows.length,
      parsed_rows: rows.length,
      valid_rows: finalRows.length,
      invalid_rows: errors.filter((e) => e.message.includes('Pflichtdaten fehlen')).length,
      to_import: finalRows.length,
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
      opportunity_id: x.opportunity_id,
      level: x.level,
      message: x.message,
    }));
    if (items.length > 0) {
      await supabase.from('salespipe2_import_run_items').insert(items);
    }
  }

  return NextResponse.json({
    success: failed === 0,
    mode: 'commit',
    stats: {
      totalRowsFromSheet: rows.length,
      parsedRows: rows.length,
      validRows: finalRows.length,
      invalidRows: errors.filter((e) => e.message.includes('Pflichtdaten fehlen')).length,
      toImport: finalRows.length,
      imported,
      failed,
      duplicates: warnings.length,
      updated,
    },
    warnings: warnings.slice(0, 100),
    errors: errors.slice(0, 100),
  });
}

