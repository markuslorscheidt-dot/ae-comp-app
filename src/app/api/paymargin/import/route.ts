import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import Papa from 'papaparse';

type ParsedCsvRow = {
  oakId: number;
  netMarginMonthly: number;
};

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/\s+/g, '').replace(/€/g, '');
  if (!raw) return null;

  // Handles both "1,234.56" and "1.234,56".
  let normalized = raw;
  if (raw.includes('.') && raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseOakId(value: unknown): number | null {
  const n = parseNumber(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : null;
}

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

async function persistPaymarginImportRun(params: {
  supabase: ReturnType<typeof createClient>;
  mode: 'dry-run' | 'commit';
  status: 'success' | 'failed';
  sourceFileName: string;
  year: number;
  goLiveMonth: number;
  seasonalFactor: number;
  stats: {
    rowsParsed: number;
    rowsValid: number;
    rowsSkippedNoOak: number;
    rowsSkippedInvalidMargin: number;
    rowsSkippedNoMatch: number;
    rowsMatchedGoLives: number;
    rowsWouldUpdate: number;
    rowsUpdated: number;
    duplicateOakRows: number;
    importedOakIdsCount: number;
    avgNetMarginMonthly: number | null;
  };
  reason?: string;
}) {
  const { supabase, mode, status, sourceFileName, year, goLiveMonth, seasonalFactor, stats, reason } = params;
  const payload = {
    mode,
    status,
    source_file_name: sourceFileName,
    year,
    go_live_month: goLiveMonth,
    seasonal_factor: seasonalFactor,
    rows_parsed: stats.rowsParsed,
    rows_valid: stats.rowsValid,
    rows_skipped_no_oak: stats.rowsSkippedNoOak,
    rows_skipped_invalid_margin: stats.rowsSkippedInvalidMargin,
    rows_skipped_no_match: stats.rowsSkippedNoMatch,
    rows_matched_go_lives: stats.rowsMatchedGoLives,
    rows_would_update: stats.rowsWouldUpdate,
    rows_updated: stats.rowsUpdated,
    duplicate_oak_rows: stats.duplicateOakRows,
    imported_oak_ids_count: stats.importedOakIdsCount,
    avg_net_margin_monthly: stats.avgNetMarginMonthly,
    reason: reason || null,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('paymargin_import_runs').insert(payload);

  if (!error) return;

  const errMsg = String(error.message || '');
  const missingNewColumns =
    errMsg.includes('avg_net_margin_monthly') || errMsg.includes('imported_oak_ids_count');

  if (missingNewColumns) {
    const { error: fallbackError } = await supabase.from('paymargin_import_runs').insert({
      mode,
      status,
      source_file_name: sourceFileName,
      year,
      go_live_month: goLiveMonth,
      seasonal_factor: seasonalFactor,
      rows_parsed: stats.rowsParsed,
      rows_valid: stats.rowsValid,
      rows_skipped_no_oak: stats.rowsSkippedNoOak,
      rows_skipped_invalid_margin: stats.rowsSkippedInvalidMargin,
      rows_skipped_no_match: stats.rowsSkippedNoMatch,
      rows_matched_go_lives: stats.rowsMatchedGoLives,
      rows_would_update: stats.rowsWouldUpdate,
      rows_updated: stats.rowsUpdated,
      duplicate_oak_rows: stats.duplicateOakRows,
      reason: reason || null,
      created_at: new Date().toISOString(),
    });
    if (!fallbackError) return;
    console.error('Paymargin Import-Run Logging fehlgeschlagen:', fallbackError.message);
    return;
  }

  // Logging darf den Import nicht scheitern lassen.
  console.error('Paymargin Import-Run Logging fehlgeschlagen:', error.message);
}

export async function POST(request: Request) {
  try {
    const supabase = await getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt fuer CSV-Import.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const year = Number(formData.get('year'));
    const goLiveMonth = Number(formData.get('goLiveMonth'));
    const seasonalFactorsRaw = String(formData.get('seasonalFactors') || '');
    const dryRun = String(formData.get('dryRun') || 'true') === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'CSV-Datei fehlt.' }, { status: 400 });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ success: false, error: 'Ungueltiges Jahr.' }, { status: 400 });
    }
    if (!Number.isInteger(goLiveMonth) || goLiveMonth < 1 || goLiveMonth > 12) {
      return NextResponse.json({ success: false, error: 'Ungueltiger Go-Live-Monat.' }, { status: 400 });
    }

    let seasonalFactors: number[] = [];
    try {
      const parsed = JSON.parse(seasonalFactorsRaw);
      if (!Array.isArray(parsed) || parsed.length !== 12) throw new Error('invalid');
      seasonalFactors = parsed.map((v) => Number(v));
      if (seasonalFactors.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('invalid');
    } catch {
      return NextResponse.json(
        { success: false, error: 'Saisonfaktoren muessen 12 positive Zahlen enthalten.' },
        { status: 400 }
      );
    }

    const sourceFileName = file.name || 'unknown.csv';
    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      return NextResponse.json(
        { success: false, error: `CSV Parsing-Fehler: ${parsed.errors[0].message}` },
        { status: 400 }
      );
    }

    const rows = parsed.data || [];
    let rowsSkippedNoOak = 0;
    let rowsSkippedInvalidMargin = 0;
    const byOak = new Map<number, ParsedCsvRow>();
    let duplicateOakRows = 0;

    for (const row of rows) {
      const oakId = parseOakId(row['OAK ID']);
      if (oakId === null) {
        rowsSkippedNoOak += 1;
        continue;
      }

      const netMarginMonthly = parseNumber(row['Net Margin']);
      if (netMarginMonthly === null) {
        rowsSkippedInvalidMargin += 1;
        continue;
      }

      if (byOak.has(oakId)) duplicateOakRows += 1;
      byOak.set(oakId, { oakId, netMarginMonthly });
    }

    const validRows = Array.from(byOak.values());
    const oakIds = validRows.map((r) => r.oakId);

    if (oakIds.length === 0) {
      const stats = {
        year,
        goLiveMonth,
        rowsParsed: rows.length,
        rowsValid: 0,
        rowsSkippedNoOak,
        rowsSkippedInvalidMargin,
        rowsSkippedNoMatch: 0,
        rowsMatchedGoLives: 0,
        rowsWouldUpdate: 0,
        rowsUpdated: 0,
        duplicateOakRows,
        importedOakIdsCount: 0,
        avgNetMarginMonthly: null,
      };

      if (!dryRun) {
        await persistPaymarginImportRun({
          supabase,
          mode: 'commit',
          status: 'success',
          sourceFileName,
          year,
          goLiveMonth,
          seasonalFactor: seasonalFactors[goLiveMonth - 1] || 1,
          stats,
          reason: 'Keine verwertbaren OAK IDs in der CSV gefunden.',
        });
      }

      return NextResponse.json({
        success: true,
        mode: dryRun ? 'dry-run' : 'commit',
        sourceFileName,
        warning: 'Keine verwertbaren OAK IDs in der CSV gefunden.',
        stats,
        preview: [],
      });
    }

    const { data: goLives, error: goLivesError } = await supabase
      .from('go_lives')
      .select('id, oak_id')
      .eq('year', year)
      .eq('month', goLiveMonth)
      .in('oak_id', oakIds);

    if (goLivesError) {
      return NextResponse.json(
        { success: false, error: `Go-Lives konnten nicht geladen werden: ${goLivesError.message}` },
        { status: 500 }
      );
    }

    const goLivesByOak = new Map<number, Array<{ id: string }>>();
    (goLives || []).forEach((gl: any) => {
      const oakId = Number(gl.oak_id);
      if (!Number.isInteger(oakId)) return;
      const existing = goLivesByOak.get(oakId) || [];
      existing.push({ id: gl.id });
      goLivesByOak.set(oakId, existing);
    });

    const seasonalFactor = seasonalFactors[goLiveMonth - 1] || 1;
    let rowsSkippedNoMatch = 0;
    let rowsMatchedGoLives = 0;
    let rowsWouldUpdate = 0;
    let rowsUpdated = 0;
    let importedOakIdsCount = 0;
    let importedNetMarginSum = 0;

    const preview: Array<{
      oakId: number;
      netMarginMonthly: number;
      normalizedMonthly: number;
      payArr: number;
      matchedGoLiveIds: string[];
    }> = [];

    for (const row of validRows) {
      const matches = goLivesByOak.get(row.oakId) || [];
      if (matches.length === 0) {
        rowsSkippedNoMatch += 1;
        continue;
      }

      importedOakIdsCount += 1;
      importedNetMarginSum += row.netMarginMonthly;
      rowsMatchedGoLives += matches.length;
      rowsWouldUpdate += matches.length;
      const normalizedMonthly = Math.round((row.netMarginMonthly / seasonalFactor) * 100) / 100;
      const payArr = Math.round(normalizedMonthly * 12 * 100) / 100;

      if (!dryRun) {
        for (const gl of matches) {
          const { error: updateError } = await supabase
            .from('go_lives')
            .update({ pay_arr: payArr, updated_at: new Date().toISOString() })
            .eq('id', gl.id);

          if (!updateError) rowsUpdated += 1;
        }
      }

      if (preview.length < 20) {
        preview.push({
          oakId: row.oakId,
          netMarginMonthly: row.netMarginMonthly,
          normalizedMonthly,
          payArr,
          matchedGoLiveIds: matches.map((m) => m.id),
        });
      }
    }

    const avgNetMarginMonthlyRaw =
      importedOakIdsCount > 0 ? importedNetMarginSum / importedOakIdsCount : null;
    const avgNetMarginMonthly =
      avgNetMarginMonthlyRaw === null ? null : Math.round(avgNetMarginMonthlyRaw * 100) / 100;

    const stats = {
      year,
      goLiveMonth,
      rowsParsed: rows.length,
      rowsValid: validRows.length,
      rowsSkippedNoOak,
      rowsSkippedInvalidMargin,
      rowsSkippedNoMatch,
      rowsMatchedGoLives,
      rowsWouldUpdate,
      rowsUpdated,
      duplicateOakRows,
      importedOakIdsCount,
      avgNetMarginMonthly,
    };

    if (!dryRun) {
      await persistPaymarginImportRun({
        supabase,
        mode: 'commit',
        status: 'success',
        sourceFileName,
        year,
        goLiveMonth,
        seasonalFactor,
        stats,
      });
    }

    return NextResponse.json({
      success: true,
      mode: dryRun ? 'dry-run' : 'commit',
      sourceFileName,
      warning: duplicateOakRows > 0
        ? `Es wurden ${duplicateOakRows} doppelte OAK-Zeilen gefunden. Je OAK wurde die letzte Zeile verwendet.`
        : undefined,
      stats,
      preview,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Unbekannter Fehler beim Paymargin-Import.' },
      { status: 500 }
    );
  }
}
