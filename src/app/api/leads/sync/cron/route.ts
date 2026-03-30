import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getLeadsAutoImportState, runCommitImport } from '../shared';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

async function persistSkippedCronRun(reason: string) {
  const supabase = getServerSupabase();
  if (!supabase) return;
  try {
    await supabase.from('leads_import_runs').insert({
      triggered_by: 'cron',
      status: 'skipped',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      auto_import_enabled: true,
      skipped: true,
      reason,
    });
  } catch (e) {
    console.error('Skipped-Run Logging fehlgeschlagen:', e);
  }
}

async function handleCronImport(request: Request) {
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

  const autoImportState = await getLeadsAutoImportState();
  if (!autoImportState.success) {
    return NextResponse.json(autoImportState, { status: autoImportState.status || 500 });
  }

  if (!autoImportState.enabled) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await supabase.from('leads_import_runs').insert({
          triggered_by: 'cron',
          status: 'skipped',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          auto_import_enabled: false,
          skipped: true,
          reason: 'Auto-Import ist deaktiviert',
        });
      } catch (e) {
        console.error('Skipped-Run Logging fehlgeschlagen:', e);
      }
    }

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

  const ingestSecretConfigured = Boolean(process.env.LEADS_DRIVE_INGEST_SECRET?.trim());
  const forceDriveCron = process.env.LEADS_CRON_USE_DRIVE_SYNC === 'true';

  // Leads laufen bevorzugt über Apps Script -> /api/leads/sync/ingest.
  // Ohne explizites Opt-in soll Cron den Legacy-Sheet-Flow nicht ausführen.
  if (ingestSecretConfigured && !forceDriveCron) {
    const reason =
      'Cron-Sheet-Sync uebersprungen: Apps-Script Ingest ist konfiguriert (LEADS_CRON_USE_DRIVE_SYNC!=true).';
    await persistSkippedCronRun(reason);
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

  const result = await runCommitImport({ triggeredBy: 'cron', autoImportEnabled: true });
  if (!result.success) {
    return NextResponse.json(result, { status: result.status || 500 });
  }

  return NextResponse.json({
    ...result,
    triggeredBy: 'cron',
    triggeredAt: new Date().toISOString(),
    autoImportEnabled: true,
    autoImportUpdatedAt: autoImportState.updatedAt,
  });
}

export async function GET(request: Request) {
  return handleCronImport(request);
}

export async function POST(request: Request) {
  return handleCronImport(request);
}
