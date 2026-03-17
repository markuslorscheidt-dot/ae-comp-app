import { NextResponse } from 'next/server';
import { runCommitImport, runDryRun } from './shared';

export async function GET() {
  try {
    const result = await runDryRun();
    if (!result.success) {
      return NextResponse.json(result, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Unbekannter Fehler' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await runCommitImport();
    if (!result.success) {
      return NextResponse.json(result, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Unbekannter Fehler' },
      { status: 500 }
    );
  }
}
