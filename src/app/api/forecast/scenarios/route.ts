import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  try {
    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const url = new URL(request.url);
    const userId = String(url.searchParams.get('userId') || '').trim();
    const year = Number(url.searchParams.get('year') || '');
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId ist erforderlich.' }, { status: 400 });
    }

    let query = supabase
      .from('forecast_saved_scenarios')
      .select(
        'id, created_at, updated_at, user_id, year, title, scenario_payload, report_headline, report_narrative, report_summary'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (Number.isFinite(year)) {
      query = query.eq('year', year);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, scenarios: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Szenarien konnten nicht geladen werden.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isRecord(body)) {
      return NextResponse.json({ success: false, error: 'Ungültiger Payload.' }, { status: 400 });
    }

    const userId = String(body.userId || '').trim();
    const year = Number(body.year);
    const title = String(body.title || '').trim();
    const scenarioPayload = isRecord(body.scenarioPayload) ? body.scenarioPayload : {};
    const reportHeadline = String(body.reportHeadline || '').trim();
    const reportNarrative = body.reportNarrative ? String(body.reportNarrative) : null;
    const reportSummary = Array.isArray(body.reportSummary)
      ? body.reportSummary.map((item) => String(item)).slice(0, 20)
      : [];

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId ist erforderlich.' }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ success: false, error: 'year ist erforderlich.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('forecast_saved_scenarios')
      .insert({
        user_id: userId,
        year,
        title: title || `Szenario ${year}`,
        scenario_payload: scenarioPayload,
        report_headline: reportHeadline || null,
        report_narrative: reportNarrative,
        report_summary: reportSummary,
      })
      .select(
        'id, created_at, updated_at, user_id, year, title, scenario_payload, report_headline, report_narrative, report_summary'
      )
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, scenario: data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Szenario konnte nicht gespeichert werden.' },
      { status: 500 }
    );
  }
}


export async function DELETE(request: Request) {
  try {
    const supabase = await createServiceClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isRecord(body)) {
      return NextResponse.json({ success: false, error: 'Ungültiger Payload.' }, { status: 400 });
    }

    const userId = String(body.userId || '').trim();
    const scenarioId = String(body.scenarioId || '').trim();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId ist erforderlich.' }, { status: 400 });
    }
    if (!scenarioId) {
      return NextResponse.json({ success: false, error: 'scenarioId ist erforderlich.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('forecast_saved_scenarios')
      .delete()
      .eq('id', scenarioId)
      .eq('user_id', userId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Szenario konnte nicht gelöscht werden.' },
      { status: 500 }
    );
  }
}
