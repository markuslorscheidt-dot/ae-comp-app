import { NextResponse } from 'next/server';
import { runCommitImport } from '../route';

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

  const result = await runCommitImport();
  if (!result.success) {
    return NextResponse.json(result, { status: result.status || 500 });
  }

  return NextResponse.json({
    ...result,
    triggeredBy: 'cron',
    triggeredAt: new Date().toISOString(),
  });
}
