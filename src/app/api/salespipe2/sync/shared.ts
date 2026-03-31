import { createClient } from '@supabase/supabase-js';

const SALESPIPE2_AUTO_IMPORT_KEY = 'salespipe2_auto_import_enabled';

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getSalespipe2AutoImportState() {
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
    .eq('key', SALESPIPE2_AUTO_IMPORT_KEY)
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

