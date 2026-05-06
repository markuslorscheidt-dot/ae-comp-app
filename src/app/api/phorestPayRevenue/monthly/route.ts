import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

function parseNumber(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, '').replace(/€/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

type Candidate = {
  month: string;
  dachValue: number;
  sourcePriority: number;
  updatedAt: string;
  sourceRowNumber: number;
};

function getSourcePriority(csvEntryName: string): number {
  const n = String(csvEntryName || '').toLowerCase();
  if (n.includes('phorest_pay_revenue_margin.csv')) return 1;
  if (n.includes('/net_margin__.csv')) return 2;
  if (n.includes('/total_net_margin__.csv')) return 3;
  return 9;
}

function pickMonth(rowPayload: Record<string, string>): string | null {
  const month = String(rowPayload['_1'] || rowPayload['Activity Month'] || '').trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function pickRegionOrChannel(rowPayload: Record<string, string>): string {
  return String(
    rowPayload['Region'] ||
      rowPayload['Phorest Pay channel'] ||
      ''
  ).trim();
}

function pickDachValue(rowPayload: Record<string, string>): number | null {
  return (
    parseNumber(String(rowPayload['DACH'] || '')) ??
    parseNumber(String(rowPayload['Net Margin'] || '')) ??
    parseNumber(String(rowPayload['_3'] || '')) ??
    null
  );
}

export async function GET(request: Request) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const yearRaw = Number(searchParams.get('year') || '');
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : null;
  if (!year) {
    return NextResponse.json({ success: false, error: 'Query-Parameter "year" ist ungueltig.' }, { status: 400 });
  }

  const { data: latestSourceFile, error: latestSourceError } = await supabase
    .from('phorest_pay_revenue_source_files')
    .select('drive_file_id')
    .eq('status', 'success')
    .order('modified_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSourceError) {
    return NextResponse.json(
      { success: false, error: `Aktuelle Source-Datei konnte nicht geladen werden: ${latestSourceError.message}` },
      { status: 500 }
    );
  }

  if (!latestSourceFile?.drive_file_id) {
    return NextResponse.json({ success: true, data: [] });
  }

  const { data: rows, error } = await supabase
    .from('phorest_pay_revenue_events')
    .select('csv_entry_name,payload,updated_at,source_row_number')
    .eq('source_file_id', latestSourceFile.drive_file_id);

  if (error) {
    return NextResponse.json(
      { success: false, error: `Phorest Pay Monatsdaten konnten nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  const byMonth = new Map<string, Candidate>();
  for (const row of rows || []) {
    const csvEntryName = String(row.csv_entry_name || '').toLowerCase();
    if (!csvEntryName.includes('margin')) continue;

    const payload = (row.payload || {}) as Record<string, string>;
    const month = pickMonth(payload);
    if (!month || !month.startsWith(String(year))) continue;

    const channel = pickRegionOrChannel(payload);
    // Wir wollen die Monatstotal-Zeilen (leerer Channel/Region), nicht die Kanalzeilen.
    if (channel) continue;

    const dachValue = pickDachValue(payload);
    if (dachValue === null) continue;

    const sourcePriority = getSourcePriority(String(row.csv_entry_name || ''));
    const updatedAt = String(row.updated_at || '');
    const sourceRowNumber = Number(row.source_row_number || 0);

    const current = byMonth.get(month);
    if (!current) {
      byMonth.set(month, { month, dachValue, sourcePriority, updatedAt, sourceRowNumber });
      continue;
    }

    const shouldReplace =
      sourcePriority < current.sourcePriority ||
      (sourcePriority === current.sourcePriority && updatedAt > current.updatedAt) ||
      (sourcePriority === current.sourcePriority &&
        updatedAt === current.updatedAt &&
        sourceRowNumber > current.sourceRowNumber);

    if (shouldReplace) {
      byMonth.set(month, { month, dachValue, sourcePriority, updatedAt, sourceRowNumber });
    }
  }

  const data = Array.from(byMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({ month: r.month, dachValue: r.dachValue }));

  return NextResponse.json({ success: true, data });
}

