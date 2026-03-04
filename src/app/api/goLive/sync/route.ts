import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const GO_LIVE_AUTO_IMPORT_KEY = 'go_live_auto_import_enabled';

type ParsedGoLiveRow = {
  rowNumber: number;
  goLiveDate: string | null;
  oakId: number | null;
  customerName: string;
  coo: string;
  monthlySubs: number | null;
  packageName: string;
  hasTerminal: boolean | null;
  ae: string;
  commissionRelevant: boolean | null;
  partnershipsEnabled: boolean | null;
  partnershipName: string;
  enterprise: boolean | null;
  payValueAfter3Month: number | null;
};

type InvalidRow = {
  rowNumber: number;
  reasons: string[];
  raw: ParsedGoLiveRow;
};

type ExtractResult =
  | {
      success: true;
      range: string;
      headerIndex: number;
      header: string[];
      rawRows: string[][];
      parsedRows: ParsedGoLiveRow[];
      validRows: ParsedGoLiveRow[];
      invalidRows: InvalidRow[];
    }
  | {
      success: false;
      status: number;
      error: string;
      details?: unknown;
      range?: string;
      rawRowCount?: number;
      header?: string[];
    };

function parseYesNo(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (['ja', 'yes', 'true', '1'].includes(v)) return true;
  if (['nein', 'no', 'false', '0'].includes(v)) return false;
  return null;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseDateDeToIso(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`;
}

function buildHeaderIndexMap(headerRow: string[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, idx) => {
    const key = String(cell || '').trim();
    if (key) map.set(key, idx);
  });
  return map;
}

function getCell(row: string[], map: Map<string, number>, column: string): string {
  const idx = map.get(column);
  if (idx === undefined) return '';
  return String(row[idx] ?? '').trim();
}

function validateRow(row: ParsedGoLiveRow): string[] {
  const reasons: string[] = [];
  if (!row.goLiveDate) reasons.push('Ungueltiges oder fehlendes GL-Date');
  if (!row.oakId) reasons.push('Ungueltige oder fehlende Oak ID');
  if (!row.customerName) reasons.push('Customer Name fehlt');
  if (!row.ae) reasons.push('AE fehlt');
  if (row.monthlySubs === null || row.monthlySubs <= 0) {
    reasons.push('monthly subs fehlt oder ist <= 0');
  }
  return reasons;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function findUserMatch(
  csvName: string,
  users: Array<{ id: string; name: string; email?: string | null }>
): { id: string; name: string; email?: string | null } | null {
  if (!csvName || !users.length) return null;
  const csvNameLower = normalizeName(csvName);
  const exactMatch = users.find((u) => normalizeName(u.name) === csvNameLower);
  if (exactMatch) return exactMatch;
  const nameParts = normalizeName(csvName).split(/[\s-]+/).filter((p) => p.length > 2);
  if (nameParts.length === 0) return null;
  const partialMatch = users.find((u) => {
    const userNameLower = normalizeName(u.name);
    return nameParts.every((part) => userNameLower.includes(part));
  });
  return partialMatch || null;
}

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getGoLiveAutoImportState() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      success: false as const,
      status: 500,
      error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Auto-Import-Flag kann nicht geladen werden.',
    };
  }

  const { data, error } = await supabase
    .from('import_controls')
    .select('enabled, updated_at')
    .eq('key', GO_LIVE_AUTO_IMPORT_KEY)
    .maybeSingle();

  if (error) {
    return {
      success: false as const,
      status: 500,
      error: `Auto-Import-Flag konnte nicht geladen werden: ${error.message}`,
    };
  }

  return {
    success: true as const,
    enabled: Boolean(data?.enabled),
    updatedAt: data?.updated_at || null,
  };
}

async function extractSheetRows(): Promise<ExtractResult> {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE_GOLIVE;

  if (!apiKey || !spreadsheetId || !range) {
    return {
      success: false,
      status: 500,
      error:
        'Fehlende ENV Variablen: GOOGLE_SHEETS_API_KEY, GOOGLE_SHEETS_SPREADSHEET_ID oder GOOGLE_SHEETS_RANGE_GOLIVE',
    };
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?key=${apiKey}`;

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: data?.error?.message || 'Google Sheets API Fehler',
      details: data,
    };
  }

  const values: string[][] = Array.isArray(data.values) ? data.values : [];
  const headerIndex = values.findIndex((row) => row.includes('GL-Date') && row.includes('Oak ID'));
  if (headerIndex === -1) {
    return {
      success: false,
      status: 422,
      error: 'Header-Zeile nicht gefunden (erwartet: GL-Date + Oak ID)',
      range: data.range,
      rawRowCount: values.length,
    };
  }

  const header = values[headerIndex];
  const headerMap = buildHeaderIndexMap(header);
  const requiredColumns = [
    'GL-Date',
    'Oak ID',
    'Customer Name',
    'monthly subs',
    'Package',
    'Terminal sold',
    'AE',
    'Provisionsrelevant',
    'Partnerships J/N',
    'Partnerschaftsname',
    'Enterprise',
    'Pay Value after 3 month',
  ];

  const missingColumns = requiredColumns.filter((col) => !headerMap.has(col));
  if (missingColumns.length > 0) {
    return {
      success: false,
      status: 422,
      error: `Pflichtspalten fehlen: ${missingColumns.join(', ')}`,
      header,
    };
  }

  const rawRows = values
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell || '').trim() !== ''));

  const parsedRows: ParsedGoLiveRow[] = rawRows.map((row, idx) => {
    const goLiveDateRaw = getCell(row, headerMap, 'GL-Date');
    const oakIdRaw = getCell(row, headerMap, 'Oak ID');
    const customerNameRaw = getCell(row, headerMap, 'Customer Name');
    const cooRaw = getCell(row, headerMap, 'COO');
    const monthlySubsRaw = getCell(row, headerMap, 'monthly subs');
    const packageRaw = getCell(row, headerMap, 'Package');
    const terminalRaw = getCell(row, headerMap, 'Terminal sold');
    const aeRaw = getCell(row, headerMap, 'AE');
    const commissionRelevantRaw = getCell(row, headerMap, 'Provisionsrelevant');
    const partnershipsRaw = getCell(row, headerMap, 'Partnerships J/N');
    const partnershipNameRaw = getCell(row, headerMap, 'Partnerschaftsname');
    const enterpriseRaw = getCell(row, headerMap, 'Enterprise');
    const payValueRaw = getCell(row, headerMap, 'Pay Value after 3 month');

    const oakIdNum = parseInt(oakIdRaw, 10);
    const oakId = Number.isInteger(oakIdNum) ? oakIdNum : null;

    return {
      rowNumber: headerIndex + 2 + idx,
      goLiveDate: parseDateDeToIso(goLiveDateRaw),
      oakId,
      customerName: customerNameRaw.replace(/\s+/g, ' ').trim(),
      coo: cooRaw,
      monthlySubs: parseNumber(monthlySubsRaw),
      packageName: packageRaw,
      hasTerminal: parseYesNo(terminalRaw),
      ae: aeRaw,
      commissionRelevant: parseYesNo(commissionRelevantRaw),
      partnershipsEnabled: parseYesNo(partnershipsRaw),
      partnershipName: partnershipNameRaw,
      enterprise: parseYesNo(enterpriseRaw),
      payValueAfter3Month: parseNumber(payValueRaw),
    };
  });

  const invalidRows: InvalidRow[] = [];
  const validRows: ParsedGoLiveRow[] = [];
  for (const row of parsedRows) {
    const reasons = validateRow(row);
    if (reasons.length > 0) invalidRows.push({ rowNumber: row.rowNumber, reasons, raw: row });
    else validRows.push(row);
  }

  return {
    success: true,
    range: data.range,
    headerIndex,
    header,
    rawRows,
    parsedRows,
    validRows,
    invalidRows,
  };
}

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

export async function runCommitImport() {
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      success: false,
      status: 500,
      error:
        'SUPABASE_SERVICE_ROLE_KEY fehlt. Fuer Commit-Import wird ein Server-Client mit Service Role benoetigt.',
    };
  }

  const extracted = await extractSheetRows();
  if (!extracted.success) {
    return {
      success: false,
      status: extracted.status,
      error: extracted.error,
      details: extracted.details,
      range: extracted.range,
    };
  }

  const { data: users, error: usersError } = await supabase.from('users').select('id, name, email');
  if (usersError) {
    return {
      success: false,
      status: 500,
      error: `Users konnten nicht geladen werden: ${usersError.message}`,
    };
  }

  const oakIds = extracted.validRows.map((r) => r.oakId).filter((v): v is number => Number.isInteger(v));
  const { data: existingOakIds, error: existingError } = oakIds.length
    ? await supabase.from('go_lives').select('oak_id').in('oak_id', oakIds)
    : { data: [], error: null };

  if (existingError) {
    return {
      success: false,
      status: 500,
      error: `Duplikat-Check fehlgeschlagen: ${existingError.message}`,
    };
  }

  const existingSet = new Set(
    (existingOakIds || [])
      .map((e: any) => (e.oak_id !== null && e.oak_id !== undefined ? Number(e.oak_id) : null))
      .filter((n: number | null): n is number => n !== null)
  );

  const rowsForInsert: any[] = [];
  const errors: Array<{ rowNumber: number; oakId: number | null; error: string }> = [];
  let duplicates = 0;

  for (const row of extracted.validRows) {
    if (row.oakId !== null && existingSet.has(row.oakId)) {
      duplicates += 1;
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'OAKID bereits vorhanden',
      });
      continue;
    }

    const matchedUser = findUserMatch(row.ae, users || []);
    if (!matchedUser) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: `Kein User-Match fuer AE "${row.ae}"`,
      });
      continue;
    }

    if (!row.goLiveDate || !row.monthlySubs || row.oakId === null) {
      errors.push({
        rowNumber: row.rowNumber,
        oakId: row.oakId,
        error: 'Pflichtdaten fehlen',
      });
      continue;
    }

    const year = new Date(row.goLiveDate).getFullYear();
    const month = new Date(row.goLiveDate).getMonth() + 1;

    rowsForInsert.push({
      user_id: matchedUser.id,
      customer_name: row.customerName,
      go_live_date: row.goLiveDate,
      year,
      month,
      subs_monthly: row.monthlySubs,
      subs_arr: row.monthlySubs * 12,
      has_terminal: row.hasTerminal ?? false,
      pay_arr: row.payValueAfter3Month,
      commission_relevant: row.commissionRelevant ?? true,
      is_enterprise: row.enterprise ?? false,
      oak_id: row.oakId,
      notes: `Import aus Google-Sheet API (${new Date().toLocaleDateString('de-DE')})`,
    });

    existingSet.add(row.oakId);
  }

  let imported = 0;
  let failed = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < rowsForInsert.length; i += BATCH_SIZE) {
    const chunk = rowsForInsert.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase.from('go_lives').insert(chunk);
    if (insertError) {
      failed += chunk.length;
      chunk.forEach((r) => {
        errors.push({
          rowNumber: -1,
          oakId: r.oak_id ?? null,
          error: insertError.message,
        });
      });
    } else {
      imported += chunk.length;
    }
  }

  return {
    success: true,
    mode: 'commit',
    stats: {
      totalRowsFromSheet: extracted.rawRows.length,
      parsedRows: extracted.parsedRows.length,
      validRows: extracted.validRows.length,
      invalidRows: extracted.invalidRows.length,
      toImport: rowsForInsert.length,
      imported,
      failed,
      duplicates,
    },
    errors: errors.slice(0, 200),
  };
}