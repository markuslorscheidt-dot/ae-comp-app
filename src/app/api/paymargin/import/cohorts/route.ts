import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { paymarginCohortKey } from '@/lib/calculations';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

export async function GET() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('paymargin_import_runs')
    .select('year, go_live_month')
    .eq('mode', 'commit')
    .eq('status', 'success');

  if (error) {
    if (error.message.includes('paymargin_import_runs') || error.message.includes('schema cache')) {
      return NextResponse.json({
        success: true,
        cohortKeys: [] as string[],
        hint: 'paymargin_import_runs fehlt — keine Kohorten markiert.',
      });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const unique = new Set<string>();
  for (const row of data || []) {
    const y = Number(row.year);
    const m = Number(row.go_live_month);
    if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
      unique.add(paymarginCohortKey(y, m));
    }
  }

  return NextResponse.json({ success: true, cohortKeys: Array.from(unique) });
}
