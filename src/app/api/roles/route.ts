import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getServerSupabase as getEnvironmentServerSupabase,
  getServerSupabaseAnon,
} from '@/lib/supabaseServer';

type RolePayload = {
  role_key: string;
  label: string;
  description?: string | null;
  areas: string[];
};

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

function isValidRoleKey(value: string) {
  return /^[a-z][a-z0-9_]{2,63}$/.test(value);
}

async function getRequestUserRole(request: Request, serviceClient: ReturnType<typeof createClient>) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { role: null as string | null, error: 'Unauthorized' };

  const anonClient = await getServerSupabaseAnon();
  if (!anonClient) return { role: null as string | null, error: 'Auth-Konfiguration fehlt.' };

  const { data: userRes, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !userRes?.user?.id) {
    return { role: null as string | null, error: 'Unauthorized' };
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('users')
    .select('role')
    .eq('id', userRes.user.id)
    .maybeSingle();

  if (profileError || !profile?.role) {
    return { role: null as string | null, error: 'Unauthorized' };
  }

  return { role: String(profile.role), error: null as string | null };
}

export async function GET(request: Request) {
  try {
    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const auth = await getRequestUserRole(request, supabase);
    if (auth.error || !auth.role) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('custom_roles')
      .select('role_key, label, description, areas, is_active')
      .eq('is_active', true)
      .order('label', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, roles: data || [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Rollen konnten nicht geladen werden.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const auth = await getRequestUserRole(request, supabase);
    if (auth.error || !auth.role) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!['country_manager', 'dlt_member'].includes(auth.role)) {
      return NextResponse.json({ success: false, error: 'Keine Berechtigung.' }, { status: 403 });
    }

    const payload = (await request.json()) as RolePayload;
    const roleKey = String(payload?.role_key || '').trim().toLowerCase();
    const label = String(payload?.label || '').trim();
    const description = payload?.description ? String(payload.description).trim() : null;
    const areas = Array.isArray(payload?.areas) ? payload.areas.filter(Boolean) : [];

    if (!isValidRoleKey(roleKey)) {
      return NextResponse.json(
        { success: false, error: 'Ungültiger Rollen-Key. Erlaubt: Kleinbuchstaben, Zahlen, Unterstrich.' },
        { status: 400 }
      );
    }
    if (!label) {
      return NextResponse.json({ success: false, error: 'Label ist erforderlich.' }, { status: 400 });
    }
    if (areas.length === 0) {
      return NextResponse.json({ success: false, error: 'Mindestens ein Bereich ist erforderlich.' }, { status: 400 });
    }

    const { error: roleError } = await supabase.from('custom_roles').upsert(
      {
        role_key: roleKey,
        label,
        description,
        areas,
        is_active: true,
      },
      { onConflict: 'role_key' }
    );

    if (roleError) {
      return NextResponse.json({ success: false, error: roleError.message }, { status: 500 });
    }

    await supabase.from('role_permissions').upsert(
      {
        role: roleKey,
        view_all_users: false,
        enter_own_go_lives: false,
        enter_go_lives_for_others: false,
        enter_pay_arr: false,
        edit_settings: false,
        edit_tiers: false,
        manage_users: false,
        assign_roles: false,
        view_all_reports: false,
        export_reports: false,
        has_admin_access: false,
      },
      { onConflict: 'role' }
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Rolle konnte nicht erstellt werden.' }, { status: 500 });
  }
}
