import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSalespipe2AutoImportState } from '../shared';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

async function persistSkippedCronRun(autoImportEnabled: boolean, reason: string) {
  const supabase = getServerSupabase();
  if (!supabase) return;
  try {
    await supabase.from('salespipe2_import_runs').insert({
      triggered_by: 'cron',
      status: 'skipped',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      auto_import_enabled: autoImportEnabled,
      skipped: true,
      reason,
    });
  } catch (e) {
    console.error('Salespipe2 Skipped-Run Logging fehlgeschlagen:', e);
  }
}

async function handleCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET fehlt in den Environment-Variablen.' },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = (request.headers.get('x-cron-secret') || '').trim();
  const querySecret = (url.searchParams.get('cronSecret') || '').trim();
  const providedSecret = bearerToken || headerSecret || querySecret;

  if (providedSecret !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const autoImportState = await getSalespipe2AutoImportState();
  if (!autoImportState.success) {
    return NextResponse.json(autoImportState, { status: autoImportState.status || 500 });
  }

  if (!autoImportState.enabled) {
    await persistSkippedCronRun(false, 'Auto-Import ist deaktiviert');
    return NextResponse.json({
      success: true,
      mode: 'commit',
      skipped: true,
      reason: 'Auto-Import ist deaktiviert',
      triggeredBy: 'cron',
      triggeredAt: new Date().toISOString(),
      autoImportEnabled: false,
      autoImportUpdatedAt: autoImportState.updatedAt,
    });
  }

  const ingestSecretConfigured = Boolean(process.env.SALESPIPE2_DRIVE_INGEST_SECRET?.trim());
  const reason = ingestSecretConfigured
    ? 'Cron-Pull uebersprungen: Apps-Script Ingest ist aktiv (/api/salespipe2/sync/ingest).'
    : 'Cron-Pull nicht eingerichtet: bitte Apps-Script Ingest konfigurieren.';

  await persistSkippedCronRun(true, reason);
  return NextResponse.json({
    success: true,
    mode: 'commit',
    skipped: true,
    reason,
    triggeredBy: 'cron',
    triggeredAt: new Date().toISOString(),
    autoImportEnabled: true,
    autoImportUpdatedAt: autoImportState.updatedAt,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

