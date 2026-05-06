import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';
import { buildScenarioReportPdf } from '@/lib/forecastScenarioPdf';

export const runtime = 'nodejs';

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ scenarioId: string }> | { scenarioId: string } }
) {
  try {
    const params = await context.params;
    const scenarioId = String((params as any)?.scenarioId || '').trim();
    const url = new URL(request.url);
    const userId = String(url.searchParams.get('userId') || '').trim();

    if (!scenarioId || !userId) {
      return NextResponse.json({ success: false, error: 'scenarioId und userId sind erforderlich.' }, { status: 400 });
    }

    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const { data, error } = await supabase
      .from('forecast_saved_scenarios')
      .select('id, created_at, year, title, scenario_payload, report_headline, report_narrative, report_summary, user_id')
      .eq('id', scenarioId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Szenario nicht gefunden.' }, { status: 404 });
    }

    const { pdfBytes, filename } = await buildScenarioReportPdf(data as any);
    const buffer = Buffer.from(pdfBytes);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'PDF konnte nicht erzeugt werden.' },
      { status: 500 }
    );
  }
}
