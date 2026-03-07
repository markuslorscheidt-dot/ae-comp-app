import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getChurnAutoImportState, runCommitImport } from '../shared';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET fehlt in den Environment-Variablen.' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const autoImportState = await getChurnAutoImportState();
  if (!autoImportState.success) {
    return NextResponse.json(autoImportState, { status: autoImportState.status || 500 });
  }

  if (!autoImportState.enabled) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await supabase.from('churn_import_runs').insert({
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

