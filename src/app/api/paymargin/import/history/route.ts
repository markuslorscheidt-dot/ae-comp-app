import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get('year'));
  const goLiveMonth = Number(searchParams.get('goLiveMonth'));

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ success: false, error: 'Ungueltiges Jahr.' }, { status: 400 });
  }
  if (!Number.isInteger(goLiveMonth) || goLiveMonth < 1 || goLiveMonth > 12) {
    return NextResponse.json({ success: false, error: 'Ungueltiger Go-Live-Monat.' }, { status: 400 });
  }

  const selectWithNetMargin =
    'id, mode, status, source_file_name, year, go_live_month, rows_updated, created_at, imported_oak_ids_count, avg_net_margin_monthly';
  const selectLegacy = 'id, mode, status, source_file_name, year, go_live_month, rows_updated, created_at';

  let selectedCohortRuns: any[] | null = null;
  let selectedError: any = null;
  let useLegacySelect = false;

  ({ data: selectedCohortRuns, error: selectedError } = await supabase
    .from('paymargin_import_runs')
    .select(selectWithNetMargin)
    .eq('mode', 'commit')
    .eq('status', 'success')
    .eq('year', year)
    .eq('go_live_month', goLiveMonth)
    .order('created_at', { ascending: false })
    .limit(1));

  const selectedErrorMsg = String(selectedError?.message || '');
  if (
    selectedError &&
    (selectedErrorMsg.includes('avg_net_margin_monthly') ||
      selectedErrorMsg.includes('imported_oak_ids_count'))
  ) {
    useLegacySelect = true;
    ({ data: selectedCohortRuns, error: selectedError } = await supabase
      .from('paymargin_import_runs')
      .select(selectLegacy)
      .eq('mode', 'commit')
      .eq('status', 'success')
      .eq('year', year)
      .eq('go_live_month', goLiveMonth)
      .order('created_at', { ascending: false })
      .limit(1));
  }

  if (selectedError) {
    if (selectedError.message.includes('paymargin_import_runs') || selectedError.message.includes('schema cache')) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Paymargin-Import-Historie ist noch nicht initialisiert. Bitte zuerst supabase-paymargin-import-history.sql in Supabase ausfuehren.',
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Paymargin-Import-Historie konnte nicht geladen werden: ${selectedError.message}` },
      { status: 500 }
    );
  }

  const { data: latestRuns, error: latestError } = await supabase
    .from('paymargin_import_runs')
    .select(useLegacySelect ? selectLegacy : selectWithNetMargin)
    .eq('mode', 'commit')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1);

  if (latestError) {
    return NextResponse.json(
      { success: false, error: `Letzter Paymargin-Import konnte nicht geladen werden: ${latestError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    selectedMonthLastRun: selectedCohortRuns?.[0] || null,
    latestRun: latestRuns?.[0] || null,
  });
}
