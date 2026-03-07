import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GO_LIVE_MANUAL_LOCK_KEY = 'go_live_manual_write_locked';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

function getPublicSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  return createClient(supabaseUrl, anonKey);
}

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Lock-Status kann nicht geladen werden.' },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from('import_controls')
    .select('enabled, updated_at')
    .eq('key', GO_LIVE_MANUAL_LOCK_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: `Lock-Status konnte nicht geladen werden: ${error.message}` },
      { status: 500 }
    );
  }

  // Default ist "gesperrt", auch wenn kein Datensatz existiert.
  return NextResponse.json({
    success: true,
    enabled: data?.enabled ?? true,
    updatedAt: data?.updated_at || null,
  });
}

export async function PUT(request: Request) {
  const serverSupabase = getServerSupabase();
  const publicSupabase = getPublicSupabase();
  if (!serverSupabase || !publicSupabase) {
    return NextResponse.json(
      { success: false, error: 'Supabase ENV-Konfiguration unvollstaendig.' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!accessToken) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const {
    data: { user },
    error: authError,
  } = await publicSupabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await serverSupabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) {
    return NextResponse.json(
      { success: false, error: `Berechtigung konnte nicht geprueft werden: ${profileError.message}` },
      { status: 500 }
    );
  }

  if (profile?.role !== 'country_manager') {
    return NextResponse.json(
      { success: false, error: 'Nur Country Manager darf den Schreibschutz aendern.' },
      { status: 403 }
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

  const { data, error } = await serverSupabase
    .from('import_controls')
    .upsert(
      {
        key: GO_LIVE_MANUAL_LOCK_KEY,
        enabled: payload.enabled,
      },
      { onConflict: 'key' }
    )
    .select('enabled, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: `Schreibschutz konnte nicht gespeichert werden: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    enabled: Boolean(data?.enabled),
    updatedAt: data?.updated_at || null,
  });
}
