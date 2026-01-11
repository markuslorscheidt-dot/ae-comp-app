'use client';

import { Language, LANGUAGE_LABELS, LANGUAGE_FLAGS } from '@/lib/i18n';
import { useLanguage } from '@/lib/LanguageContext';

interface LanguageSelectorProps {
  variant?: 'dropdown' | 'buttons';
}

export default function LanguageSelector({ variant = 'dropdown' }: LanguageSelectorProps) {
  const { language, setLanguage } = useLanguage();

  const languages: Language[] = ['de', 'en', 'ksh'];

  if (variant === 'buttons') {
    return (
      <div className="flex space-x-1">
        {languages.map((lang) => (
          <button
            key={lang}
            onClick={() => setLanguage(lang)}
            className={`px-2 py-1 text-sm rounded transition ${
              language === lang
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title={LANGUAGE_LABELS[lang]}
          >
            {LANGUAGE_FLAGS[lang]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      className="text-sm border border-gray-300 rounded px-2 py-1 bg-white hover:border-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    >
      {languages.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_FLAGS[lang]} {LANGUAGE_LABELS[lang]}
        </option>
      ))}
    </select>
  );
}
