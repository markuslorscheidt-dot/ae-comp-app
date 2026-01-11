'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, translations, getTranslation, formatTranslation, getSavedLanguage, saveLanguage } from './i18n';
import { supabase } from './supabase';

// ============================================
// LANGUAGE CONTEXT
// ============================================

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// ============================================
// LANGUAGE PROVIDER
// ============================================

interface LanguageProviderProps {
  children: ReactNode;
  userId?: string;
}

export function LanguageProvider({ children, userId }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>('de');
  const [initialized, setInitialized] = useState(false);

  // Beim Mount: Sprache laden
  useEffect(() => {
    const initLanguage = async () => {
      // 1. Erst localStorage prüfen (Fallback)
      const savedLang = getSavedLanguage();
      setLanguageState(savedLang);

      // 2. Wenn User eingeloggt, Sprache aus DB laden
      if (userId) {
        const { data } = await supabase
          .from('users')
          .select('language')
          .eq('id', userId)
          .single();

        if (data?.language && ['de', 'en', 'ksh'].includes(data.language)) {
          setLanguageState(data.language as Language);
          saveLanguage(data.language as Language);
        }
      }

      setInitialized(true);
    };

    initLanguage();
  }, [userId]);

  // Sprache ändern
  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    saveLanguage(lang);

    // In DB speichern wenn User eingeloggt
    if (userId) {
      await supabase
        .from('users')
        .update({ language: lang })
        .eq('id', userId);
    }
  };

  // Übersetzungsfunktion
  const t = (path: string, params?: Record<string, string | number>): string => {
    const text = getTranslation(language, path);
    return params ? formatTranslation(text, params) : text;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ============================================
// HOOK
// ============================================

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// ============================================
// STANDALONE HOOK (ohne Context, für einfache Fälle)
// ============================================

export function useTranslation() {
  const [language, setLanguageState] = useState<Language>('de');

  useEffect(() => {
    setLanguageState(getSavedLanguage());
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    saveLanguage(lang);
  };

  const t = (path: string, params?: Record<string, string | number>): string => {
    const text = getTranslation(language, path);
    return params ? formatTranslation(text, params) : text;
  };

  return { language, setLanguage, t };
}
