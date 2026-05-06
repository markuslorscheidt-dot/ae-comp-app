import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

function getAppBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) {
    return process.env.VERCEL_URL.startsWith('http')
      ? process.env.VERCEL_URL
      : `https://${process.env.VERCEL_URL}`;
  }
  return '';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();

    if (!name || !email) {
      return NextResponse.json({ success: false, error: 'Name und E-Mail sind erforderlich.' }, { status: 400 });
    }

    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, name, email, is_active')
      .ilike('email', email)
      .maybeSingle();

    // Absichtlich generische Antwort für nicht vorhandene Nutzer.
    if (profileError || !userProfile || !userProfile.is_active) {
      return NextResponse.json({ success: true });
    }

    if (String(userProfile.name || '').trim().toLowerCase() !== name.toLowerCase()) {
      return NextResponse.json({ success: true });
    }

    const appBaseUrl = getAppBaseUrl();

    const redirectTo = appBaseUrl
      ? `${appBaseUrl}/auth/callback?next=/auth/set-password`
      : undefined;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (resetError) {
      return NextResponse.json({ success: false, error: 'E-Mail konnte nicht versendet werden.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Onboarding-Anfrage fehlgeschlagen.' }, { status: 500 });
  }
}
