import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

function normalizeSmsAccountingMonth(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const isoPrefix = s.match(/^(\d{4}-\d{2})(?:-\d{2}|T|$)/);
  if (isoPrefix) return isoPrefix[1];
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}`;
  return null;
}

function parseSmsNumeric(raw: string): number | null {
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

export async function GET(request: Request) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const yearRaw = Number(searchParams.get('year') || '');
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : null;
  if (!year) {
    return NextResponse.json({ success: false, error: 'Query-Parameter "year" ist ungueltig.' }, { status: 400 });
  }

  const { data: rows, error } = await supabase.from('sms_events').select('payload');
  if (error) {
    return NextResponse.json(
      { success: false, error: `SMS-Monatsdaten konnten nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  const byMonth = new Map<string, number>();
  for (const row of rows || []) {
    const payload = row.payload as Record<string, string> | null;
    if (!payload) continue;

    const monthRaw =
      String(payload['Accounting Month'] || '').trim() ||
      String(payload['Region'] || '').trim();
    const monthKey = normalizeSmsAccountingMonth(monthRaw);
    if (!monthKey || !monthKey.startsWith(String(year))) continue;

    const mrr = parseSmsNumeric(String(payload['DACH'] || ''));
    if (mrr === null) continue;

    const existing = byMonth.get(monthKey) ?? 0;
    if (mrr > existing) byMonth.set(monthKey, mrr);
  }

  const data = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, mrr]) => ({ month, mrr }));

  return NextResponse.json({ success: true, data });
}

