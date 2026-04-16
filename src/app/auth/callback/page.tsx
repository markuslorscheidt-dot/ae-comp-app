'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const code = searchParams.get('code');
      const next = searchParams.get('next') || '/';

      if (!code) {
        setError('Ungültiger Link. Bitte fordere einen neuen Passwort-Link an.');
        return;
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        setError('Der Link ist ungültig oder abgelaufen. Bitte erneut anfordern.');
        return;
      }

      router.replace(next);
    };

    run();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-6 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">Link konnte nicht verarbeitet werden</h1>
            <p className="text-sm text-gray-600">{error}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">Anmeldung wird vorbereitet</h1>
            <p className="text-sm text-gray-600">Bitte kurz warten...</p>
          </>
        )}
      </div>
    </div>
  );
}

function AuthCallbackFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Anmeldung wird vorbereitet</h1>
        <p className="text-sm text-gray-600">Bitte kurz warten...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackFallback />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
