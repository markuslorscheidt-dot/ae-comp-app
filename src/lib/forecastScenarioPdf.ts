import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface SavedForecastScenarioRecord {
  id: string;
  created_at: string;
  year: number;
  title: string;
  scenario_payload?: Record<string, unknown> | null;
  report_headline?: string | null;
  report_narrative?: string | null;
  report_summary?: string[] | null;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(value);
}

function sanitizeFilename(value: string) {
  return String(value || 'report')
    .replace(/[^a-zA-Z0-9äöüÄÖÜß _.-]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function wrapText(text: string, maxChars = 105) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const proposal = current ? `${current} ${word}` : word;
    if (proposal.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = proposal;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export async function buildScenarioReportPdf(scenario: SavedForecastScenarioRecord) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const payload = (scenario.scenario_payload || {}) as Record<string, unknown>;
  const reportSnapshot = payload.reportSnapshot && typeof payload.reportSnapshot === 'object'
    ? (payload.reportSnapshot as Record<string, unknown>)
    : null;

  const leadConversion = asNumber(payload.leadToGoLiveForecastPercent, NaN);
  const leadVolume = asNumber(payload.futureLeadVolumeScenarioMonthlyLeads, NaN);
  const churnFactor = asNumber(payload.futureChurnScenarioFactorPercent, NaN);

  const scenarioNetArr = reportSnapshot ? asNumber((reportSnapshot.scenarioDelta as any)?.scenarioNetArr, NaN) : NaN;
  const baselineNetArr = reportSnapshot ? asNumber((reportSnapshot.scenarioDelta as any)?.baselineNetArr, NaN) : NaN;
  const netGap = reportSnapshot ? asNumber(reportSnapshot.netGapArr, NaN) : NaN;

  let y = 805;
  const left = 42;

  page.drawText('Szenario Report', { x: left, y, size: 18, font: fontBold, color: rgb(0.09, 0.12, 0.2) });
  y -= 24;
  page.drawText(scenario.title || 'Gespeichertes Szenario', { x: left, y, size: 11, font, color: rgb(0.18, 0.2, 0.24) });
  y -= 16;
  page.drawText(`Erstellt: ${new Date(scenario.created_at).toLocaleString('de-DE')}`, { x: left, y, size: 9, font, color: rgb(0.4, 0.4, 0.45) });
  y -= 24;

  page.drawText('Kernwerte', { x: left, y, size: 12, font: fontBold, color: rgb(0.14, 0.16, 0.2) });
  y -= 16;

  const lines = [
    Number.isFinite(leadConversion) ? `Lead Conversion: ${leadConversion.toFixed(1)}%` : null,
    Number.isFinite(leadVolume) ? `Lead Volumen: ${leadVolume.toFixed(0)} Leads/Monat` : null,
    Number.isFinite(churnFactor) ? `Churn Faktor: ${churnFactor.toFixed(1)}%` : null,
    Number.isFinite(scenarioNetArr) ? `Forecast Summe NET ARR: ${formatCurrency(scenarioNetArr)}` : null,
    Number.isFinite(baselineNetArr) ? `Baseline NET ARR: ${formatCurrency(baselineNetArr)}` : null,
    Number.isFinite(netGap) ? `NET Gap: ${formatCurrency(netGap)}` : null,
  ].filter(Boolean) as string[];

  for (const line of lines) {
    page.drawText(`- ${line}`, { x: left, y, size: 10, font, color: rgb(0.2, 0.22, 0.26) });
    y -= 14;
  }

  y -= 8;
  if (scenario.report_headline) {
    page.drawText('Report-Headline', { x: left, y, size: 12, font: fontBold, color: rgb(0.14, 0.16, 0.2) });
    y -= 16;
    for (const line of wrapText(String(scenario.report_headline), 95)) {
      page.drawText(line, { x: left, y, size: 10, font, color: rgb(0.2, 0.22, 0.26) });
      y -= 13;
    }
  }

  const summaryLines = Array.isArray(scenario.report_summary) ? scenario.report_summary : [];
  if (summaryLines.length > 0 && y > 120) {
    y -= 8;
    page.drawText('Zusammenfassung', { x: left, y, size: 12, font: fontBold, color: rgb(0.14, 0.16, 0.2) });
    y -= 16;
    for (const summary of summaryLines.slice(0, 6)) {
      for (const line of wrapText(String(summary), 98)) {
        page.drawText(`- ${line}`, { x: left, y, size: 10, font, color: rgb(0.2, 0.22, 0.26) });
        y -= 13;
      }
      if (y < 100) break;
    }
  }

  if (scenario.report_narrative && y > 120) {
    y -= 8;
    page.drawText('Narrative', { x: left, y, size: 12, font: fontBold, color: rgb(0.14, 0.16, 0.2) });
    y -= 16;
    for (const line of wrapText(String(scenario.report_narrative), 105).slice(0, 26)) {
      if (y < 60) break;
      page.drawText(line, { x: left, y, size: 9.5, font, color: rgb(0.2, 0.22, 0.26) });
      y -= 12;
    }
  }

  page.drawText(`Szenario-ID: ${scenario.id}`, { x: left, y: 20, size: 8, font, color: rgb(0.55, 0.55, 0.6) });

  const pdfBytes = await pdfDoc.save();
  const filename = `${sanitizeFilename(scenario.title || 'szenario-report')}.pdf`;
  return { pdfBytes, filename };
}
