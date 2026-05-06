import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { getSmsAutoImportState } from '../shared';

const SMS_AUTO_IMPORT_KEY = 'sms_auto_import_enabled';

async function getServerSupabase() {
  return getEnvironmentServerSupabase();
}

export async function GET() {
  const state = await getSmsAutoImportState();
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
  const supabase = await getServerSupabase();
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
        key: SMS_AUTO_IMPORT_KEY,
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

