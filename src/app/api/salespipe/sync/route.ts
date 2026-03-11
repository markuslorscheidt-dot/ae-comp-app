import { NextResponse } from 'next/server';
import { extractSheetRows, runCommitImport } from './shared';

export async function GET() {
  try {
    const extracted = await extractSheetRows();
    if (!extracted.success) {
      return NextResponse.json(
        {
          success: false,
          error: extracted.error,
          details: extracted.details,
          range: extracted.range,
          rawRowCount: extracted.rawRowCount,
          header: extracted.header,
        },
        { status: extracted.status }
      );
    }

    return NextResponse.json({
      success: true,
      mode: 'dry-run',
      range: extracted.range,
      headerIndex: extracted.headerIndex,
      header: extracted.header,
      stats: {
        totalRowsFromSheet: extracted.rawRows.length,
        parsedRows: extracted.parsedRows.length,
        validRows: extracted.validRows.length,
        invalidRows: extracted.invalidRows.length,
      },
      preview: {
        valid: extracted.validRows.slice(0, 10),
        invalid: extracted.invalidRows.slice(0, 10),
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
