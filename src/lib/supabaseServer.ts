import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_ENV_COOKIE_KEY,
  SUPABASE_ENV_HEADER,
  getSupabaseEnvironmentLabel,
  type SupabaseEnvironment,
} from './supabase';

function normalizeEnvironment(value: unknown): SupabaseEnvironment {
  return value === 'online' ? 'online' : 'local';
}

function getServerConfig(environment: SupabaseEnvironment) {
  const localUrl = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const onlineUrl = process.env.NEXT_PUBLIC_SUPABASE_ONLINE_URL;
  const onlineServiceRoleKey = process.env.SUPABASE_ONLINE_SERVICE_ROLE_KEY;

  const url = environment === 'online' ? onlineUrl : localUrl;
  const serviceRoleKey = environment === 'online' ? onlineServiceRoleKey : localServiceRoleKey;

  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export async function getSupabaseEnvironmentFromRequest(): Promise<SupabaseEnvironment> {
  const [{ cookies }, { headers }] = await Promise.all([
    import('next/headers'),
    import('next/headers'),
  ]);
  const headerStore = await headers();
  const cookieStore = await cookies();
  return normalizeEnvironment(
    headerStore.get(SUPABASE_ENV_HEADER) ||
      cookieStore.get(SUPABASE_ENV_COOKIE_KEY)?.value ||
      process.env.NEXT_PUBLIC_SUPABASE_DEFAULT_SOURCE
  );
}

export async function getServerSupabase() {
  const environment = await getSupabaseEnvironmentFromRequest();
  const config = getServerConfig(environment);
  if (!config) return null;
  return createClient(config.url, config.serviceRoleKey);
}

export async function getServerSupabaseAnon() {
  const environment = await getSupabaseEnvironmentFromRequest();
  const localUrl = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const localAnonKey = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const onlineUrl = process.env.NEXT_PUBLIC_SUPABASE_ONLINE_URL;
  const onlineAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ONLINE_ANON_KEY;

  const url = environment === 'online' ? onlineUrl : localUrl;
  const anonKey = environment === 'online' ? onlineAnonKey : localAnonKey;

  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

export async function getRequiredServerSupabase() {
  const environment = await getSupabaseEnvironmentFromRequest();
  const config = getServerConfig(environment);
  if (!config) {
    throw new Error(`Supabase ${getSupabaseEnvironmentLabel(environment)} ist serverseitig nicht konfiguriert.`);
  }
  return createClient(config.url, config.serviceRoleKey);
}
