import { NextResponse } from 'next/server';
import { getServerSupabase as getEnvironmentServerSupabase } from '@/lib/supabaseServer';

async function createServiceClient() {
  return getEnvironmentServerSupabase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSafeNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    if (!Number.isFinite(year)) {
      return NextResponse.json({ success: false, error: 'year ist erforderlich.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('forecast_enterprise_deals')
      .select(
        'id, created_at, updated_at, user_id, year, target_month, expected_go_lives, arr_per_go_live, oak_id, account_name, is_active, notes'
      )
      .eq('user_id', userId)
      .eq('year', year)
      .order('target_month', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deals: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Enterprise Deals konnten nicht geladen werden.' },
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
    const targetMonth = Math.max(1, Math.min(12, Math.round(toSafeNumber(body.targetMonth, 1))));
    const expectedGoLives = Math.max(0, toSafeNumber(body.expectedGoLives, 0));
    const arrPerGoLive = Math.max(0, toSafeNumber(body.arrPerGoLive, 0));
    const oakIdRaw = Number(body.oakId);
    const oakId = Number.isFinite(oakIdRaw) && oakIdRaw > 0 ? Math.round(oakIdRaw) : null;
    const accountName = String(body.accountName || '').trim() || null;
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
    const notes = String(body.notes || '').trim() || null;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId ist erforderlich.' }, { status: 400 });
    }
    if (!Number.isFinite(year)) {
      return NextResponse.json({ success: false, error: 'year ist erforderlich.' }, { status: 400 });
    }
    if (!oakId && !accountName) {
      return NextResponse.json({ success: false, error: 'OAK ID oder Accountname ist erforderlich.' }, { status: 400 });
    }
    if (expectedGoLives <= 0 || arrPerGoLive <= 0) {
      return NextResponse.json({ success: false, error: 'Go-Lives und ARR pro Go-Live müssen > 0 sein.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('forecast_enterprise_deals')
      .insert({
        user_id: userId,
        year,
        target_month: targetMonth,
        expected_go_lives: expectedGoLives,
        arr_per_go_live: arrPerGoLive,
        oak_id: oakId,
        account_name: accountName,
        is_active: isActive,
        notes,
      })
      .select(
        'id, created_at, updated_at, user_id, year, target_month, expected_go_lives, arr_per_go_live, oak_id, account_name, is_active, notes'
      )
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deal: data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Enterprise Deal konnte nicht gespeichert werden.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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
    const dealId = String(body.dealId || '').trim();
    const isActive = body.isActive;
    if (!userId || !dealId || typeof isActive !== 'boolean') {
      return NextResponse.json({ success: false, error: 'userId, dealId und isActive sind erforderlich.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('forecast_enterprise_deals')
      .update({ is_active: isActive })
      .eq('id', dealId)
      .eq('user_id', userId)
      .select(
        'id, created_at, updated_at, user_id, year, target_month, expected_go_lives, arr_per_go_live, oak_id, account_name, is_active, notes'
      )
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, deal: data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Enterprise Deal konnte nicht aktualisiert werden.' },
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
    const dealId = String(body.dealId || '').trim();
    if (!userId || !dealId) {
      return NextResponse.json({ success: false, error: 'userId und dealId sind erforderlich.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('forecast_enterprise_deals')
      .delete()
      .eq('id', dealId)
      .eq('user_id', userId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Enterprise Deal konnte nicht gelöscht werden.' },
      { status: 500 }
    );
  }
}
