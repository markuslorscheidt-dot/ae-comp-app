import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUpDownsellsAutoImportState } from '../shared';

const UP_DOWNSELLS_AUTO_IMPORT_KEY = 'up_downsells_auto_import_enabled';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET() {
  const state = await getUpDownsellsAutoImportState();
  if (!state.success) {
    return NextResponse.json(state, { status: state.status || 500 });
  }

  return NextResponse.json({
    success: true,
    enabled: state.enabled,
    updatedAt: state.updatedAt,
  });
}

export async function PUT(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Auto-Import-Flag kann nicht gespeichert werden.',
      },
      { status: 500 }
    );
  }

  let payload: { enabled?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Ungueltiger JSON-Body' }, { status: 400 });
  }

  if (typeof payload.enabled !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'Feld "enabled" muss boolean sein.' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('import_controls')
    .upsert(
      {
        key: UP_DOWNSELLS_AUTO_IMPORT_KEY,
        enabled: payload.enabled,
      },
      { onConflict: 'key' }
    )
    .select('enabled, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Auto-Import-Flag konnte nicht gespeichert werden: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    enabled: Boolean(data?.enabled),
    updatedAt: data?.updated_at || null,
  });
}

