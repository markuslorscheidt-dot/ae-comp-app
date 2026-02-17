'use client';

import { useState, useRef, useCallback } from 'react';
import { exportToPDF, formatPDFFilename, PDFExportOptions } from '@/lib/pdf-export';
import { useLanguage } from '@/lib/LanguageContext';

interface PDFExportButtonProps {
  /** Das Element, das exportiert werden soll (ID oder Ref) */
  targetId?: string;
  targetRef?: React.RefObject<HTMLElement>;
  /** Basis-Dateiname für das PDF */
  baseFilename: string;
  /** Optionaler Benutzername für den Dateinamen */
  userName?: string;
  /** Jahr für den Dateinamen */
  year?: number;
  /** Titel im PDF-Header */
  title?: string;
  /** Untertitel im PDF-Header */
  subtitle?: string;
  /** PDF-Orientierung */
  orientation?: 'portrait' | 'landscape';
  /** Button-Variante */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Button-Größe */
  size?: 'sm' | 'md' | 'lg';
  /** Zusätzliche CSS-Klassen */
  className?: string;
  /** Callback nach erfolgreichem Export */
  onSuccess?: () => void;
  /** Callback bei Fehler */
  onError?: (error: Error) => void;
}

export default function PDFExportButton({
  targetId,
  targetRef,
  baseFilename,
  userName,
  year,
  title,
  subtitle,
  orientation = 'portrait',
  variant = 'primary',
  size = 'md',
  className = '',
  onSuccess,
  onError,
}: PDFExportButtonProps) {
  const { t } = useLanguage();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = useCallback(async () => {
    // Element finden
    let element: HTMLElement | null = null;
    
    if (targetRef?.current) {
      element = targetRef.current;
    } else if (targetId) {
      element = document.getElementById(targetId);
    }

    if (!element) {
      const error = new Error('Export-Element nicht gefunden');
      onError?.(error);
      console.error(error);
      return;
    }

    setIsExporting(true);
    setProgress(0);

    try {
      const filename = formatPDFFilename(baseFilename, userName, year);
      
      const options: PDFExportOptions = {
        filename,
        title,
        subtitle,
        orientation,
        format: 'a4',
        margin: 10,
        quality: 2,
        onProgress: setProgress,
      };

      await exportToPDF(element, options);
      onSuccess?.();
    } catch (error) {
      console.error('PDF Export Error:', error);
      onError?.(error as Error);
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  }, [targetId, targetRef, baseFilename, userName, year, title, subtitle, orientation, onSuccess, onError]);

  // Button-Styles
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500 border border-gray-300',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-500',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2',
  };

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      title={t('pdfExport.exportPDF')}
    >
      {isExporting ? (
        <>
          {/* Loading Spinner */}
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{progress > 0 ? `${progress}%` : t('pdfExport.preparing')}</span>
        </>
      ) : (
        <>
          {/* PDF Icon */}
          <svg 
            className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
            />
          </svg>
          <span>{t('pdfExport.exportPDF')}</span>
        </>
      )}
    </button>
  );
}

/**
 * Kompakter Export-Button nur mit Icon
 */
export function PDFExportIconButton({
  targetId,
  targetRef,
  baseFilename,
  userName,
  year,
  title,
  subtitle,
  orientation = 'portrait',
  className = '',
  onSuccess,
  onError,
}: Omit<PDFExportButtonProps, 'variant' | 'size'>) {
  const { t } = useLanguage();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = useCallback(async () => {
    let element: HTMLElement | null = null;
    
    if (targetRef?.current) {
      element = targetRef.current;
    } else if (targetId) {
      element = document.getElementById(targetId);
    }

    if (!element) {
      onError?.(new Error('Export-Element nicht gefunden'));
      return;
    }

    setIsExporting(true);
    setProgress(0);

    try {
      const filename = formatPDFFilename(baseFilename, userName, year);
      
      await exportToPDF(element, {
        filename,
        title,
        subtitle,
        orientation,
        format: 'a4',
        margin: 10,
        quality: 2,
        onProgress: setProgress,
      });
      
      onSuccess?.();
    } catch (error) {
      onError?.(error as Error);
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  }, [targetId, targetRef, baseFilename, userName, year, title, subtitle, orientation, onSuccess, onError]);

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className={`p-2 rounded-lg transition-colors hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      title={t('pdfExport.exportPDF')}
    >
      {isExporting ? (
        <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <svg 
          className="h-5 w-5 text-gray-600 hover:text-blue-600" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
          />
        </svg>
      )}
    </button>
  );
}
