import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

export async function GET(request: Request) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');
  const limitRaw = Number(searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  if (runId) {
    const { data: items, error } = await supabase
      .from('churn_drive_import_run_items')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      return NextResponse.json(
        { success: false, error: `Import-Details konnten nicht geladen werden: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, items: items || [] });
  }

  const { data: runs, error } = await supabase
    .from('churn_drive_import_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { success: false, error: `Import-Historie konnte nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  const runList = runs || [];
  if (runList.length === 0) {
    return NextResponse.json({ success: true, runs: [] });
  }

  const runIds = runList.map((run: any) => run.id).filter(Boolean);
  const { data: items, error: itemsError } = await supabase
    .from('churn_drive_import_run_items')
    .select('run_id, level, message')
    .in('run_id', runIds);

  if (itemsError) {
    return NextResponse.json(
      { success: false, error: `Import-Run-Items konnten nicht geladen werden: ${itemsError.message}` },
      { status: 500 }
    );
  }

  const byRun: Record<string, { duplicates: number; hint: string | null }> = {};
  (items || []).forEach((item: any) => {
    const runId = String(item.run_id || '');
    if (!runId) return;
    if (!byRun[runId]) byRun[runId] = { duplicates: 0, hint: null };

    const message = String(item.message || '');
    const isDuplicate = item.level === 'duplicate' || /duplikat/i.test(message);
    if (isDuplicate) byRun[runId].duplicates += 1;

    if (!byRun[runId].hint && item.level === 'warning' && message) {
      byRun[runId].hint = message;
    }
  });

  const enrichedRuns = runList.map((run: any) => {
    const meta = byRun[String(run.id)] || { duplicates: 0, hint: null };
    return {
      ...run,
      duplicates: Number(meta.duplicates || 0),
      hint: meta.hint || run.reason || null,
    };
  });

  return NextResponse.json({ success: true, runs: enrichedRuns });
}
