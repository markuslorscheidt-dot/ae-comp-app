import { NextResponse } from 'next/server';
import { extractSmsRows, runCommitImport } from './shared';

export async function GET() {
  try {
    const extracted = await extractSmsRows();
    if (!extracted.success) {
      return NextResponse.json(
        {
          success: false,
          error: extracted.error,
        },
        { status: extracted.status }
      );
    }

    return NextResponse.json({
      success: true,
      mode: 'dry-run',
      sourceFile: extracted.sourceFile,
      header: extracted.header,
      stats: {
        totalRowsFromFile: extracted.rawRows.length,
        parsedRows: extracted.rawRows.length,
        validRows: extracted.validRows.length,
        invalidRows: extracted.invalidRows.length,
      },
      preview: {
        valid: extracted.validRows.slice(0, 12),
        invalid: extracted.invalidRows.slice(0, 12),
      },
    });
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

export async function POST() {
  try {
    const result = await runCommitImport();
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

