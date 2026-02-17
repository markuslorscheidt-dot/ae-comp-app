'use client';

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export interface PDFExportOptions {
  filename: string;
  title?: string;
  subtitle?: string;
  orientation?: 'portrait' | 'landscape';
  format?: 'a4' | 'letter';
  margin?: number;
  quality?: number;
  onProgress?: (progress: number) => void;
}

const DEFAULT_OPTIONS: PDFExportOptions = {
  filename: 'export.pdf',
  orientation: 'portrait',
  format: 'a4',
  margin: 10,
  quality: 2,
};

/**
 * Exportiert ein HTML-Element als PDF
 * Unterstützt SVG-Charts (Recharts), Tabellen und beliebige HTML-Inhalte
 */
export async function exportToPDF(
  element: HTMLElement,
  options: PDFExportOptions
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { filename, title, subtitle, orientation, format, margin, quality, onProgress } = opts;

  try {
    onProgress?.(10);

    // HTML zu Canvas konvertieren
    const canvas = await html2canvas(element, {
      scale: quality,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      // Wichtig für Recharts SVG
      onclone: (clonedDoc) => {
        // SVG-Elemente für bessere Qualität anpassen
        const svgs = clonedDoc.querySelectorAll('svg');
        svgs.forEach((svg) => {
          svg.setAttribute('width', svg.getBoundingClientRect().width.toString());
          svg.setAttribute('height', svg.getBoundingClientRect().height.toString());
        });
      },
    });

    onProgress?.(50);

    // PDF Dimensionen
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin! * 2;
    
    // Header hinzufügen
    let yOffset = margin!;
    
    if (title) {
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(title, margin!, yOffset + 6);
      yOffset += 10;
    }
    
    if (subtitle) {
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100);
      pdf.text(subtitle, margin!, yOffset + 4);
      yOffset += 8;
      pdf.setTextColor(0);
    }

    // Datum hinzufügen
    pdf.setFontSize(9);
    pdf.setTextColor(150);
    const dateStr = new Date().toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    pdf.text(`Erstellt: ${dateStr}`, pageWidth - margin! - 45, margin! + 4);
    pdf.setTextColor(0);

    yOffset += 5;

    onProgress?.(70);

    // Canvas zu Bild konvertieren
    const imgData = canvas.toDataURL('image/png', 1.0);
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Mehrseitige PDFs unterstützen
    const availableHeight = pageHeight - yOffset - margin!;
    
    if (imgHeight <= availableHeight) {
      // Passt auf eine Seite
      pdf.addImage(imgData, 'PNG', margin!, yOffset, imgWidth, imgHeight);
    } else {
      // Mehrere Seiten nötig
      let remainingHeight = imgHeight;
      let sourceY = 0;
      let isFirstPage = true;
      
      while (remainingHeight > 0) {
        const currentAvailableHeight = isFirstPage ? availableHeight : pageHeight - margin! * 2;
        const sliceHeight = Math.min(remainingHeight, currentAvailableHeight);
        const sliceRatio = sliceHeight / imgHeight;
        
        // Berechne die Quell-Koordinaten im Canvas
        const sourceHeight = canvas.height * sliceRatio;
        
        // Erstelle ein temporäres Canvas für den Ausschnitt
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = sourceHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          tempCtx.drawImage(
            canvas,
            0, sourceY, canvas.width, sourceHeight,
            0, 0, canvas.width, sourceHeight
          );
          
          const sliceImgData = tempCanvas.toDataURL('image/png', 1.0);
          const sliceImgHeight = (sourceHeight * imgWidth) / canvas.width;
          
          if (!isFirstPage) {
            pdf.addPage();
          }
          
          pdf.addImage(
            sliceImgData,
            'PNG',
            margin!,
            isFirstPage ? yOffset : margin!,
            imgWidth,
            sliceImgHeight
          );
        }
        
        sourceY += sourceHeight;
        remainingHeight -= sliceHeight;
        isFirstPage = false;
      }
    }

    onProgress?.(90);

    // Footer auf jeder Seite
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(
        `Seite ${i} von ${totalPages}`,
        pageWidth / 2,
        pageHeight - 5,
        { align: 'center' }
      );
    }

    onProgress?.(100);

    // PDF speichern
    pdf.save(filename);
  } catch (error) {
    console.error('PDF Export Error:', error);
    throw new Error('PDF-Export fehlgeschlagen. Bitte versuchen Sie es erneut.');
  }
}

/**
 * Hook für PDF-Export mit Loading-State
 */
export function usePDFExport() {
  const exportElementToPDF = async (
    elementId: string,
    options: PDFExportOptions
  ): Promise<boolean> => {
    const element = document.getElementById(elementId);
    
    if (!element) {
      console.error(`Element mit ID "${elementId}" nicht gefunden.`);
      return false;
    }

    try {
      await exportToPDF(element, options);
      return true;
    } catch (error) {
      console.error('PDF Export failed:', error);
      return false;
    }
  };

  const exportRefToPDF = async (
    ref: React.RefObject<HTMLElement>,
    options: PDFExportOptions
  ): Promise<boolean> => {
    if (!ref.current) {
      console.error('Ref-Element nicht verfügbar.');
      return false;
    }

    try {
      await exportToPDF(ref.current, options);
      return true;
    } catch (error) {
      console.error('PDF Export failed:', error);
      return false;
    }
  };

  return {
    exportElementToPDF,
    exportRefToPDF,
  };
}

/**
 * Formatiert einen Dateinamen für den PDF-Export
 */
export function formatPDFFilename(baseName: string, userName?: string, year?: number): string {
  const sanitizedBase = baseName.replace(/[^a-zA-Z0-9äöüÄÖÜß\-_]/g, '_');
  const sanitizedUser = userName?.replace(/[^a-zA-Z0-9äöüÄÖÜß\-_]/g, '_') || '';
  const dateStr = new Date().toISOString().split('T')[0];
  
  const parts = [sanitizedBase];
  if (sanitizedUser) parts.push(sanitizedUser);
  if (year) parts.push(year.toString());
  parts.push(dateStr);
  
  return `${parts.join('_')}.pdf`;
}
