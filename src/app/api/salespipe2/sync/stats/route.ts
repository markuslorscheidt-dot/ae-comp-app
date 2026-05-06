import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

export async function GET() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  const { count, error } = await supabase
    .from('salespipe_events')
    .select('*', { count: 'exact', head: true })
    .eq('source_tab', 'drive_salespipe2_csv');

  if (error) {
    return NextResponse.json(
      { success: false, error: `Salespipe 2 Statistik konnte nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  const total = Number(count || 0);
  return NextResponse.json({
    success: true,
    count: total,
    hasData: total > 0,
  });
}

