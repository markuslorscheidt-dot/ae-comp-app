'use client';

import { User } from '@/lib/types';

interface DebugPanelProps {
  user: User;
  data: Record<string, any>;
  title?: string;
}

/**
 * Debug Panel - Nur für Country Manager sichtbar
 * 
 * Verwendung:
 * <DebugPanel 
 *   user={user} 
 *   data={{ 
 *     myVariable: someValue,
 *     anotherVar: anotherValue 
 *   }} 
 *   title="Mein Debug Bereich"
 * />
 */
export default function DebugPanel({ user, data, title = "Debug Info" }: DebugPanelProps) {
  // Nur für Country Manager sichtbar
  if (user.role !== 'country_manager') {
    return null;
  }

  return (
    <details className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
      <summary className="font-bold text-yellow-800 cursor-pointer">
        🔧 {title} (klicken zum Öffnen)
      </summary>
      <pre className="mt-4 text-xs overflow-auto bg-white p-4 rounded border max-h-96">
        {JSON.stringify(data, (key, value) => {
          // Maps zu Arrays konvertieren für bessere Lesbarkeit
          if (value instanceof Map) {
            return Array.from(value.entries());
          }
          // UUIDs kürzen für bessere Übersicht
          if (typeof value === 'string' && value.length === 36 && value.includes('-')) {
            return value.substring(0, 8) + '...';
          }
          return value;
        }, 2)}
      </pre>
    </details>
  );
}
