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
  const runId = searchParams.get('runId');
  const limitRaw = Number(searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  if (runId) {
    const { data: items, error } = await supabase
      .from('up_downsells_import_run_items')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      if (error.message.includes('up_downsells_import_run_items') || error.message.includes('schema cache')) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Import-Historie ist noch nicht initialisiert. Bitte zuerst supabase-up-downsells-import.sql in Supabase ausfuehren.',
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Import-Details konnten nicht geladen werden: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, items: items || [] });
  }

  const { data: runs, error } = await supabase
    .from('up_downsells_import_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (error.message.includes('up_downsells_import_runs') || error.message.includes('schema cache')) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Import-Historie ist noch nicht initialisiert. Bitte zuerst supabase-up-downsells-import.sql in Supabase ausfuehren.',
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Import-Historie konnte nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, runs: runs || [] });
}

