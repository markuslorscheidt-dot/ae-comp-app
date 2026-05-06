import { NextResponse } from 'next/server';
import { runCommitImport, runDryRun } from './shared';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRaw = (url.searchParams.get('force') || '').toLowerCase();
    const force = forceRaw === '1' || forceRaw === 'true' || forceRaw === 'yes';
    const result = await runDryRun({ force });
    if (!result.success) {
      return NextResponse.json(result, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Unbekannter Fehler',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRaw = (url.searchParams.get('force') || '').toLowerCase();
    const force = forceRaw === '1' || forceRaw === 'true' || forceRaw === 'yes';
    const result = await runCommitImport({ force });
    if (!result.success) {
      return NextResponse.json(result, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Unbekannter Fehler',
      },
      { status: 500 }
    );
  }
}

