import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export type SupabaseEnvironment = 'local' | 'online';

export const SUPABASE_ENV_STORAGE_KEY = 'ae-comp-supabase-environment';
export const SUPABASE_ENV_COOKIE_KEY = 'ae_comp_supabase_environment';
export const SUPABASE_ENV_HEADER = 'x-ae-supabase-environment';

const DEFAULT_ENVIRONMENT: SupabaseEnvironment =
  process.env.NEXT_PUBLIC_SUPABASE_DEFAULT_SOURCE === 'online' ? 'online' : 'local';

const browserClients = new Map<SupabaseEnvironment, ReturnType<typeof createSupabaseClient>>();

function normalizeEnvironment(value: unknown): SupabaseEnvironment {
  return value === 'online' ? 'online' : 'local';
}

export function getSupabaseEnvironmentLabel(environment: SupabaseEnvironment) {
  return environment === 'online' ? 'Online' : 'Lokal';
}

function getBrowserEnvironment(): SupabaseEnvironment {
  if (typeof window === 'undefined') return DEFAULT_ENVIRONMENT;
  return normalizeEnvironment(window.localStorage.getItem(SUPABASE_ENV_STORAGE_KEY) || DEFAULT_ENVIRONMENT);
}

function getBrowserConfig(environment: SupabaseEnvironment) {
  const localUrl = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const localAnonKey = process.env.NEXT_PUBLIC_SUPABASE_LOCAL_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const onlineUrl = process.env.NEXT_PUBLIC_SUPABASE_ONLINE_URL;
  const onlineAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ONLINE_ANON_KEY;

  const url = environment === 'online' ? onlineUrl : localUrl;
  const anonKey = environment === 'online' ? onlineAnonKey : localAnonKey;

  if (!url || !anonKey) {
    throw new Error(`Supabase ${getSupabaseEnvironmentLabel(environment)} ist nicht konfiguriert.`);
  }

  return { url, anonKey };
}

function getBrowserClient(environment = getBrowserEnvironment()) {
  const existing = browserClients.get(environment);
  if (existing) return existing;

  const { url, anonKey } = getBrowserConfig(environment);
  const client = createSupabaseClient(url, anonKey, {
    auth: {
      storageKey: `ae-comp-${environment}-auth`,
    },
  });
  browserClients.set(environment, client);
  return client;
}

export function getSupabaseEnvironment(): SupabaseEnvironment {
  return getBrowserEnvironment();
}

export function setSupabaseEnvironment(environment: SupabaseEnvironment) {
  const normalized = normalizeEnvironment(environment);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SUPABASE_ENV_STORAGE_KEY, normalized);
    document.cookie = `${SUPABASE_ENV_COOKIE_KEY}=${normalized}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new CustomEvent('supabase-environment-change', { detail: normalized }));
  }
}

function installFetchEnvironmentHeader() {
  if (typeof window === 'undefined') return;
  const marker = '__aeCompSupabaseEnvironmentFetchPatched';
  const win = window as any;
  if (win[marker]) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const environment = getBrowserEnvironment();
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const isInternalApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);

    if (!isInternalApi) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set(SUPABASE_ENV_HEADER, environment);

    return originalFetch(input, {
      ...init,
      headers,
    });
  };
  win[marker] = true;
}

installFetchEnvironmentHeader();

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_target, prop, receiver) {
    return Reflect.get(getBrowserClient(), prop, receiver);
  },
});

export function createClient() {
  return getBrowserClient();
}
