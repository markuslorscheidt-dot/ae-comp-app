import { NextResponse } from 'next/server';
import { runCommitFromPayload, type ChurnDriveIngestPayload } from '../shared';

function isAuthorized(request: Request): boolean {
  const configuredSecret = process.env.CHURN_DRIVE_INGEST_SECRET?.trim();
  if (!configuredSecret) return false;

  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const secretHeader = request.headers.get('x-ingest-secret')?.trim() || '';
  return bearerToken === configuredSecret || secretHeader === configuredSecret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Bitte CHURN_DRIVE_INGEST_SECRET als Bearer Token oder x-ingest-secret senden.',
      },
      { status: 401 }
    );
  }

  let payload: ChurnDriveIngestPayload;
  try {
    payload = (await request.json()) as ChurnDriveIngestPayload;
  } catch {
    return NextResponse.json({ success: false, error: 'Ungueltiger JSON-Body.' }, { status: 400 });
  }

  if (!payload?.parsed) {
    return NextResponse.json({ success: false, error: 'Payload unvollstaendig: parsed fehlt.' }, { status: 400 });
  }

  const result = await runCommitFromPayload(payload, { triggeredBy: 'manual', autoImportEnabled: true });
  if (!result.success) {
    return NextResponse.json(result, { status: result.status || 500 });
  }

  return NextResponse.json(result);
}
