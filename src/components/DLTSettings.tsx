'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, UserRoleHistoryRecord, ProvisionTier, AESettings, GoLive, isPlannable, canReceiveGoLives, getDefaultCommissionRelevant, BUSINESS_AREA_LABELS, BusinessArea, DEFAULT_SETTINGS, DEFAULT_SUBS_TIERS, DEFAULT_PAY_TIERS, DEFAULT_TOTAL_ARR_TIERS, calculateMonthlySubsTargets, calculateTotalGoLives } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useAllSettings, useGoLivesForUser } from '@/lib/hooks';
import { getPermissions } from '@/lib/permissions';
import {
  formatCurrency,
  calculateOTEProjections,
  validateOTESettings,
  calculateMultipleCalibration,
  getProvisionRate,
  calculateOtc,
  calculateQuotaFromMultiple,
  calculateRequiredGrossMarginPctForPayback,
  calculateRequiredArrMultipleForPayback,
} from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import GoLiveForm from './GoLiveForm';
import PartnerManagement from './PartnerManagement';
import SubscriptionPackageManagement from './SubscriptionPackageManagement';

// DLT Planzahlen Datenstruktur
interface DLTPlanzahlen {
  id?: string;
  year: number;
  region: string;
  // NEW ARR
  business_inbound: number[];
  business_outbound: number[];
  business_partnerships: number[];
  business_pay_terminals: number[];
  business_terminal_sales: number[];
  business_tipping: number[];
  pay_terminals_percent: number;
  terminal_penetration_threshold: number;
  terminal_sales_percent: number;
  tipping_percent: number;
  avg_subs_bill: number;
  avg_pay_bill_terminal: number;
  avg_pay_bill_tipping: number;
  // Weitere Bereiche (Platzhalter für spätere Implementierung)
  expanding_arr_data?: Record<string, unknown>;
  churn_arr_data?: Record<string, unknown>;
  new_clients_data?: Record<string, unknown>;
  churned_clients_data?: Record<string, unknown>;
  ending_clients_data?: Record<string, unknown>;
  // Meta
  created_at?: string;
  updated_at?: string;
}

type RoleHistorySlice = Pick<UserRoleHistoryRecord, 'role' | 'effective_from' | 'effective_to'>;

interface DLTSettingsProps {
  user: User;
}

interface GoLiveBatchValidRowPreview {
  rowNumber: number;
  goLiveDate: string | null;
  oakId: number | null;
  customerName: string;
  monthlySubs: number | null;
  hasTerminal: boolean | null;
  ae: string;
  commissionRelevant: boolean | null;
  partnershipsEnabled: boolean | null;
  partnershipName: string;
  enterprise: boolean | null;
  payValueAfter3Month: number | null;
}

interface GoLiveDryRunResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: GoLiveBatchValidRowPreview[];
    invalid: Array<{ rowNumber: number; reasons: string[]; raw: { customerName: string; ae: string; oakId: number | null } }>;
  };
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
  error?: string;
}

interface GoLiveCommitResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; oakId: number | null; error: string }>;
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
  error?: string;
}

interface GoLiveAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface ChurnDryRunResponse {
  success: boolean;
  mode?: string;
  sourceFile?: { id?: string; name?: string; modifiedTime?: string };
  stats?: {
    totalRowsFromSheet?: number;
    parsedRows?: number;
    validRows?: number;
    invalidRows?: number;
    zipEntries?: number;
    clientListRows?: number;
    scheduledDetailRows?: number;
    summaryRows?: number;
  };
  preview?: {
    valid: Array<{
      rowNumber: number;
      glMonth: string | null;
      churnMonth: string | null;
      oakId: number | null;
      customerName: string;
      churnReason: string;
      packageName: string;
      totalArrLost: number | null;
      subsRevenueLost: number | null;
      payRevenueLost: number | null;
      scheduled: boolean | null;
    }>;
    invalid: Array<{
      rowNumber: number;
      reasons: string[];
      raw: { customerName: string; oakId: number | null };
    }>;
  };
  error?: string;
}

interface ChurnCommitResponse {
  success: boolean;
  mode?: string;
  skipped?: boolean;
  reason?: string;
  sourceFile?: { id?: string; name?: string; modifiedTime?: string };
  stats?: {
    totalRowsFromSheet?: number;
    parsedRows?: number;
    validRows?: number;
    invalidRows?: number;
    toImport?: number;
    imported?: number;
    failed?: number;
    duplicates?: number;
    updated?: number;
    zipEntries?: number;
    clientListRows?: number;
    scheduledDetailRows?: number;
    summaryRows?: number;
  };
  errors?: Array<{ rowNumber: number; oakId: number | null; error: string }>;
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
  error?: string;
}

interface ChurnAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface UpDownsellsDryRunResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: Array<{
      rowNumber: number;
      eventMonth: string | null;
      oakId: number | null;
      customerName: string;
      netGrowthArr: number | null;
      netLossArr: number | null;
    }>;
    invalid: Array<{
      rowNumber: number;
      reasons: string[];
      raw: { customerName: string; oakId: number | null };
    }>;
  };
  error?: string;
}

interface UpDownsellsCommitResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; oakId: number | null; error: string }>;
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
  error?: string;
}

interface UpDownsellsAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface SmsDryRunResponse {
  success: boolean;
  mode?: string;
  sourceFile?: {
    id: string;
    name: string;
    modifiedTime: string;
  };
  header?: string[];
  stats?: {
    totalRowsFromFile: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: Array<{ rowNumber: number; payload: Record<string, string> }>;
    invalid: Array<{ rowNumber: number; reasons: string[]; raw: Record<string, string> }>;
  };
  error?: string;
}

interface SmsCommitResponse {
  success: boolean;
  mode?: string;
  sourceFile?: {
    id: string;
    name: string;
    modifiedTime: string;
  };
  stats?: {
    totalRowsFromFile: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; error: string }>;
  warnings?: Array<{ rowNumber: number; warning: string }>;
  error?: string;
}

interface SmsAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface PayStripeTerminalInstallationDryRunResponse {
  success: boolean;
  mode?: string;
  sourceFile?: {
    id: string;
    name: string;
    modifiedTime: string;
  };
  csvEntryName?: string;
  stats?: {
    zipEntries?: number;
    totalRowsFromFile: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: Array<{ rowNumber: number; payload: Record<string, string> }>;
    invalid: Array<{ rowNumber: number; reasons: string[]; raw: Record<string, string> }>;
  };
  warnings?: Array<{ rowNumber: number; warning: string }>;
  error?: string;
}

interface PayStripeTerminalInstallationCommitResponse {
  success: boolean;
  mode?: string;
  sourceFile?: {
    id: string;
    name: string;
    modifiedTime: string;
  };
  csvEntryName?: string;
  stats?: {
    zipEntries?: number;
    totalRowsFromFile: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  warnings?: Array<{ rowNumber: number; warning: string }>;
  errors?: Array<{ rowNumber: number; error: string }>;
  error?: string;
}

interface PayStripeTerminalInstallationAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

type PhorestPayRevenueDryRunResponse = PayStripeTerminalInstallationDryRunResponse;
type PhorestPayRevenueCommitResponse = PayStripeTerminalInstallationCommitResponse;
type PhorestPayRevenueAutoImportResponse = PayStripeTerminalInstallationAutoImportResponse;
type LookerLeadsDryRunResponse = PayStripeTerminalInstallationDryRunResponse;
type LookerLeadsCommitResponse = PayStripeTerminalInstallationCommitResponse;
type LookerLeadsAutoImportResponse = PayStripeTerminalInstallationAutoImportResponse;

interface SalespipeDryRunResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: Array<{
      rowNumber: number;
      opportunityName: string;
      stage: string;
      oakId: number | null;
      opportunityId: string;
      estimatedArr: number | null;
      probability: number | null;
      closeDate: string | null;
      opportunityOwner: string;
    }>;
    invalid: Array<{
      rowNumber: number;
      reasons: string[];
      raw: { opportunityName: string; oakId: number | null; opportunityId: string };
    }>;
  };
  error?: string;
}

interface SalespipeCommitResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; oakId: number | null; error: string }>;
  warnings?: Array<{ rowNumber: number; oakId: number | null; warning: string }>;
  error?: string;
}

interface SalespipeAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface LeadsDryRunResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
  };
  preview?: {
    valid: Array<{
      rowNumber: number;
      leadId: string;
      companyAccount: string;
      leadSource: string;
      leadStatus: string;
      opportunityId: string;
      conversionDate: string | null;
      leadOwner: string;
    }>;
    invalid: Array<{
      rowNumber: number;
      reasons: string[];
      raw: { leadId: string; companyAccount: string };
    }>;
  };
  warnings?: Array<{ rowNumber: number; leadId: string | null; warning: string }>;
  error?: string;
}

interface LeadsCommitResponse {
  success: boolean;
  mode?: string;
  stats?: {
    totalRowsFromSheet: number;
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    toImport: number;
    imported: number;
    failed: number;
    duplicates: number;
    updated?: number;
  };
  errors?: Array<{ rowNumber: number; leadId: string | null; error: string }>;
  warnings?: Array<{ rowNumber: number; leadId: string | null; warning: string }>;
  error?: string;
}

interface LeadsAutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface Salespipe2AutoImportResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface SignupsStatsResponse {
  success: boolean;
  count?: number;
  hasData?: boolean;
  error?: string;
}

interface LeadsStatsResponse {
  success: boolean;
  count?: number;
  hasData?: boolean;
  error?: string;
}

interface Salespipe2StatsResponse {
  success: boolean;
  count?: number;
  hasData?: boolean;
  error?: string;
}

interface PaymarginImportResponse {
  success: boolean;
  mode?: 'dry-run' | 'commit';
  sourceFileName?: string;
  stats?: {
    year: number;
    goLiveMonth: number;
    rowsParsed: number;
    rowsValid: number;
    rowsSkippedNoOak: number;
    rowsSkippedInvalidMargin: number;
    rowsSkippedNoMatch: number;
    rowsMatchedGoLives: number;
    rowsWouldUpdate: number;
    rowsUpdated: number;
    duplicateOakRows: number;
    importedOakIdsCount?: number;
    avgNetMarginMonthly?: number | null;
  };
  preview?: Array<{
    oakId: number;
    netMarginMonthly: number;
    normalizedMonthly: number;
    payArr: number;
    matchedGoLiveIds: string[];
  }>;
  warning?: string;
  error?: string;
}

interface PaymarginImportRun {
  id: string;
  mode: 'dry-run' | 'commit';
  status: 'success' | 'failed';
  source_file_name: string;
  year: number;
  go_live_month: number;
  rows_updated: number;
  imported_oak_ids_count?: number | null;
  avg_net_margin_monthly?: number | null;
  created_at: string;
}

interface PaymarginImportHistoryResponse {
  success: boolean;
  selectedMonthLastRun?: PaymarginImportRun | null;
  latestRun?: PaymarginImportRun | null;
  error?: string;
}

interface GoLiveManualLockResponse {
  success: boolean;
  enabled?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface GoLiveImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface GoLiveImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  oak_id: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface ChurnImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  source_file_name?: string | null;
  imported: number;
  failed: number;
  duplicates?: number;
  updated?: number;
  to_import?: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
  hint?: string | null;
}

interface ChurnImportRunItem {
  id: string;
  run_id: string;
  row_number?: number | null;
  oak_id?: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface UpDownsellsImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface UpDownsellsImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  oak_id: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface SmsImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  source_file_name?: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface SmsImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface PayStripeTerminalInstallationImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  source_file_name: string | null;
  csv_entry_name: string | null;
  zip_entries: number;
  total_rows: number;
  parsed_rows: number;
  valid_rows: number;
  invalid_rows: number;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface PayStripeTerminalInstallationImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

type PhorestPayRevenueImportRun = PayStripeTerminalInstallationImportRun;
type PhorestPayRevenueImportRunItem = PayStripeTerminalInstallationImportRunItem;
type LookerLeadsImportRun = PayStripeTerminalInstallationImportRun;
type LookerLeadsImportRunItem = PayStripeTerminalInstallationImportRunItem;

interface SalespipeImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface SalespipeImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  oak_id: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface LeadsImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface LeadsImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  lead_id: string | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface SignupsImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface SignupsImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  oak_id: number | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

interface Salespipe2ImportRun {
  id: string;
  triggered_by: 'manual' | 'cron';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  imported: number;
  failed: number;
  duplicates: number;
  updated?: number;
  to_import: number;
  auto_import_enabled: boolean;
  skipped: boolean;
  reason: string | null;
}

interface Salespipe2ImportRunItem {
  id: string;
  run_id: string;
  row_number: number | null;
  opportunity_id: string | null;
  level: 'error' | 'warning' | 'duplicate';
  message: string;
  created_at: string;
}

const GO_LIVE_BATCH_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  { source: 'GL-Date', target: 'go_lives.go_live_date', transform: 'dd.mm.yyyy -> ISO Datum', required: true },
  { source: 'Oak ID', target: 'go_lives.oak_id', transform: 'Integer', required: true },
  { source: 'Customer Name', target: 'go_lives.customer_name', transform: 'Trim / String', required: true },
  { source: 'monthly subs', target: 'go_lives.subs_monthly', transform: 'Numerisch', required: true },
  { source: 'monthly subs', target: 'go_lives.subs_arr', transform: 'subs_monthly x 12' },
  { source: 'Terminal sold', target: 'go_lives.has_terminal', transform: 'Ja/Nein -> Boolean' },
  { source: 'Provisionsrelevant', target: 'go_lives.commission_relevant', transform: 'Ja/Nein -> Boolean' },
  { source: 'Partnerships J/N', target: 'go_lives.partner_id', transform: 'Ja -> Partner-Matching aktiv' },
  { source: 'Partnerschaftsname', target: 'go_lives.partner_id', transform: 'Name-Matching auf partners.id' },
  { source: 'Enterprise', target: 'go_lives.is_enterprise', transform: 'Ja/Nein -> Boolean' },
  { source: 'Pay Value after 3 month', target: 'go_lives.pay_arr', transform: 'Numerisch (ARR)' },
  { source: 'AE', target: 'go_lives.user_id', transform: 'Name-Matching auf users.id', required: true },
];

const CHURN_BATCH_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  { source: 'GL Month', target: 'churn_events.gl_month', transform: 'YYYY-MM -> YYYY-MM-01', required: true },
  { source: 'Churn Month', target: 'churn_events.churn_month', transform: 'YYYY-MM -> YYYY-MM-01', required: true },
  { source: 'Oak ID', target: 'churn_events.oak_id', transform: 'Integer (Business Key)', required: true },
  { source: 'Customer Name', target: 'churn_events.customer_name', transform: 'Trim / String', required: true },
  { source: 'COO', target: 'churn_events.coo', transform: 'String (optional)' },
  { source: 'Churn Reason', target: 'churn_events.churn_reason', transform: 'String' },
  { source: 'Package', target: 'churn_events.package_name', transform: 'String' },
  { source: 'Total ARR Lost', target: 'churn_events.total_arr_lost', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Subs Revenue Lost', target: 'churn_events.subs_revenue_lost', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Pay Revenue Lost', target: 'churn_events.pay_revenue_lost', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Scheduled', target: 'churn_events.scheduled', transform: 'Y/N oder Ja/Nein -> Boolean' },
];

const UP_DOWNSELLS_BATCH_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  {
    source: 'Upgrade / Downgrade Month',
    target: 'up_downsells_events.event_month',
    transform: 'YYYY-MM -> YYYY-MM-01',
    required: true,
  },
  { source: 'Oak ID', target: 'up_downsells_events.oak_id', transform: 'Integer', required: true },
  { source: 'Customer Name', target: 'up_downsells_events.customer_name', transform: 'Trim / String', required: true },
  { source: 'Net Growth ARR', target: 'up_downsells_events.net_growth_arr', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Net Loss ARR', target: 'up_downsells_events.net_loss_arr', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Net Growth + Net Loss', target: 'up_downsells_events.net_arr', transform: 'Berechnet' },
];

const SALESPIPE_BATCH_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  { source: 'Opportunity-ID', target: 'salespipe_events.opportunity_id', transform: 'String (Business Key)', required: true },
  { source: 'Opportunity-Name', target: 'salespipe_events.opportunity_name', transform: 'Trim / String', required: true },
  { source: 'OAKID', target: 'salespipe_events.oak_id', transform: 'Integer (optional)' },
  { source: 'Rating', target: 'salespipe_events.rating', transform: 'String (optional)' },
  { source: 'Nächster Schritt', target: 'salespipe_events.next_step', transform: 'String (optional)' },
  { source: 'Schlusstermin', target: 'salespipe_events.close_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Letzte Aktivität', target: 'salespipe_events.last_activity_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Phase', target: 'salespipe_events.stage', transform: 'String (optional)' },
  { source: 'Estimated ARR', target: 'salespipe_events.estimated_arr', transform: 'Numerisch (DE/EN Format)' },
  { source: 'Wahrscheinlichkeit (%)', target: 'salespipe_events.probability', transform: 'Numerisch' },
  { source: 'Lead-Quelle', target: 'salespipe_events.lead_source', transform: 'String (optional)' },
  { source: 'Days from Demo to Closure', target: 'salespipe_events.days_demo_to_closure', transform: 'Integer (optional)' },
  { source: 'Days from SentQuote to Close', target: 'salespipe_events.days_sentquote_to_close', transform: 'Integer (optional)' },
  { source: 'Decision Criteria', target: 'salespipe_events.decision_criteria', transform: 'String (optional)' },
  { source: 'Erstelldatum', target: 'salespipe_events.created_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Opportunity-Inhaber', target: 'salespipe_events.opportunity_owner', transform: 'String (optional)' },
];

const LEADS_BATCH_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  { source: 'Lead-ID', target: 'leads_events.lead_id', transform: 'String (Business Key)', required: true },
  { source: 'Firma/Account', target: 'leads_events.company_account', transform: 'Trim / String', required: true },
  { source: 'Vorname', target: 'leads_events.first_name', transform: 'String (optional)' },
  { source: 'Nachname', target: 'leads_events.last_name', transform: 'String (optional)' },
  { source: 'Lead-Quelle', target: 'leads_events.lead_source', transform: 'String (optional)' },
  { source: 'Demo or Quote', target: 'leads_events.demo_or_quote', transform: 'String (optional)' },
  { source: 'Lead-Status', target: 'leads_events.lead_status', transform: 'String (optional)' },
  { source: 'Lead Sub Status', target: 'leads_events.lead_sub_status', transform: 'String (optional)' },
  { source: 'Lead-Inhaber', target: 'leads_events.lead_owner', transform: 'String (optional)' },
  { source: 'Erstelldatum', target: 'leads_events.created_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Letzte Aktivität', target: 'leads_events.last_activity_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Zuletzt geändert am', target: 'leads_events.updated_on_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Konvertierungsdatum', target: 'leads_events.conversion_date', transform: 'dd.mm.yyyy -> ISO Datum' },
  { source: 'Opportunity-ID', target: 'leads_events.opportunity_id', transform: 'String (optional)' },
  { source: 'Opportunity-Name', target: 'leads_events.opportunity_name', transform: 'String (optional)' },
];

const PAY_STRIPE_TERMINAL_INSTALLATION_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  {
    source: 'ZIP-Datei aus Drive-Ordner',
    target: 'pay_stripe_terminal_installation_source_files',
    transform: 'Neueste unverarbeitete ZIP-Datei (inkrementell via drive_file_id)',
    required: true,
  },
  {
    source: 'CSV in ZIP',
    target: 'pay_stripe_terminal_installation_events.csv_entry_name',
    transform: 'Erste CSV-Datei aus ZIP (falls mehrere: Warning + erste Datei wird genutzt)',
    required: true,
  },
  {
    source: 'CSV Zeile',
    target: 'pay_stripe_terminal_installation_events.source_row_number',
    transform: 'Business Key mit source_file_id (Upsert-idempotent)',
    required: true,
  },
  {
    source: 'Alle CSV-Spalten',
    target: 'pay_stripe_terminal_installation_events.payload',
    transform: 'Dynamisch als JSONB gespeichert',
    required: true,
  },
];

const PHOREST_PAY_REVENUE_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  {
    source: 'ZIP-Datei aus Drive-Ordner',
    target: 'phorest_pay_revenue_source_files',
    transform: 'Neueste unverarbeitete ZIP-Datei (inkrementell via drive_file_id)',
    required: true,
  },
  {
    source: 'CSV in ZIP',
    target: 'phorest_pay_revenue_events.csv_entry_name',
    transform: 'Erste CSV-Datei aus ZIP (falls mehrere: Warning + erste Datei wird genutzt)',
    required: true,
  },
  {
    source: 'CSV Zeile',
    target: 'phorest_pay_revenue_events.source_row_number',
    transform: 'Business Key mit source_file_id (Upsert-idempotent)',
    required: true,
  },
  {
    source: 'Alle CSV-Spalten',
    target: 'phorest_pay_revenue_events.payload',
    transform: 'Dynamisch als JSONB gespeichert',
    required: true,
  },
];

const LOOKER_LEADS_FIELD_MAPPING: Array<{
  source: string;
  target: string;
  transform: string;
  required?: boolean;
}> = [
  {
    source: 'ZIP-Datei aus Drive-Ordner',
    target: 'looker_leads_source_files',
    transform: 'Neueste unverarbeitete ZIP-Datei (inkrementell via drive_file_id)',
    required: true,
  },
  {
    source: 'CSV in ZIP',
    target: 'looker_leads_events.csv_entry_name',
    transform: 'Alle CSV-Dateien werden verarbeitet; priorisierte CSV als Referenz im Run',
    required: true,
  },
  {
    source: 'CSV Zeile',
    target: 'looker_leads_events.source_row_number',
    transform: 'Business Key mit source_file_id (idempotent; bei mehreren CSVs mit technischem Offset)',
    required: true,
  },
  {
    source: 'Alle CSV-Spalten',
    target: 'looker_leads_events.payload',
    transform: 'Dynamisch als JSONB gespeichert',
    required: true,
  },
];

// Role display names
const ROLE_LABELS: Record<UserRole, string> = {
  country_manager: 'Country Manager',
  dlt_member: 'DLT Member',
  line_manager_new_business: 'Line Manager (New Business)',
  ae_subscription_sales: 'AE Subscription Sales',
  ae_payments: 'AE Payments',
  commercial_director: 'Commercial Director',
  head_of_partnerships: 'Head of Partnerships',
  head_of_expanding_revenue: 'Head of Expanding Revenue',
  line_manager_expanding_business: 'Line Manager Expanding Business',
  cs_account_executive: 'CS Account Executive',
  cs_account_manager: 'CS Account Manager',
  cs_sdr: 'CS SDR',
  head_of_marketing: 'Head of Marketing',
  marketing_specialist: 'Marketing Specialist',
  marketing_executive: 'Marketing Executive',
  demand_generation_specialist: 'Demand Generation Specialist',
  sonstiges: 'Sonstiges'
};

// Role colors
const ROLE_COLORS: Partial<Record<UserRole, string>> = {
  country_manager: 'bg-purple-100 text-purple-700',
  dlt_member: 'bg-indigo-100 text-indigo-700',
  line_manager_new_business: 'bg-blue-100 text-blue-700',
  ae_subscription_sales: 'bg-green-100 text-green-700',
  ae_payments: 'bg-emerald-100 text-emerald-700',
  commercial_director: 'bg-cyan-100 text-cyan-700',
  head_of_partnerships: 'bg-teal-100 text-teal-700',
  head_of_expanding_revenue: 'bg-orange-100 text-orange-700',
  line_manager_expanding_business: 'bg-amber-100 text-amber-700',
  head_of_marketing: 'bg-pink-100 text-pink-700'
};

// Months for Business Targets
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DEFAULT_SEASONAL_FACTORS = [0.85, 0.9, 1.0, 0.93, 1.0, 1.03, 0.92, 0.88, 1.02, 1.08, 1.15, 1.24];

// Defaultwerte für NEW ARR (DLT Planzahlen Übersicht)
const NEW_ARR_DEFAULTS = {
  inbound: [33, 23, 26, 20, 23, 23, 25, 16, 24, 20, 25, 17],
  outbound: [0, 2, 1, 3, 3, 3, 2, 2, 2, 4, 4, 2],
  partnerships: [0, 1, 3, 4, 8, 6, 11, 6, 11, 10, 11, 1],
  payTerminalsPercent: 70,
  terminalSalesPercent: 70,
  tippingPercent: 25,
  avgSubsBill: 159,
  avgPayBillTerminal: 164,
  avgPayBillTipping: 30,
};

const EXPANDING_ARR_DEFAULTS = {
  totalUpgrades: [12, 27, 45, 53, 50, 45, 44, 50, 36, 36, 30, 32],
  totalDowngrades: [-2, -3, -1, 0, -3, -2, -2, -1, -1, -1, -1, -3],
  netUpgradeDowngradeArr: [14440, 18565, 18565, 22691, 20629, 18565, 18565, 20628, 18061, 18060, 10567, 6946],
};

const EMPTY_MONTH_VALUES = Array.from({ length: 12 }, () => 0);

interface ExpandingArrData {
  upgrade_downgrade: {
    total_upgrades: number[];
    total_downgrades: number[];
    net_upgrade_downgrade_arr: number[];
  };
}

interface ChurnArrData {
  invoiced_churn: {
    target_count: number[];
    actual_count: number[];
    target_arr: number[];
    actual_arr: number[];
  };
  in_month_churn: {
    target_count: number[];
    target_arr: number[];
  };
}

interface SalesCyclePlanRules {
  lead_to_demo_booked_days: number;
  demo_booked_to_sent_quote_20_days: number;
  sent_quote_20_to_sent_quote_50_days: number;
  sent_quote_50_to_sent_quote_70_days: number;
  sent_quote_70_to_sent_quote_90_days: number;
}

interface DynamicRoleConfig {
  role_key: string;
  label: string;
  description?: string | null;
  areas: BusinessArea[];
  is_active: boolean;
}

function normalizeMonthlyArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [...EMPTY_MONTH_VALUES];
  const sanitized = value.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  const firstTwelve = sanitized.slice(0, 12);
  if (firstTwelve.length < 12) {
    return [...firstTwelve, ...Array.from({ length: 12 - firstTwelve.length }, () => 0)];
  }
  return firstTwelve;
}

function parseChurnArrData(raw: unknown): ChurnArrData {
  const data = raw && typeof raw === 'object' ? (raw as any) : {};
  const invoiced = data.invoiced_churn && typeof data.invoiced_churn === 'object' ? data.invoiced_churn : {};
  const inMonth = data.in_month_churn && typeof data.in_month_churn === 'object' ? data.in_month_churn : {};

  return {
    invoiced_churn: {
      target_count: normalizeMonthlyArray(invoiced.target_count),
      actual_count: normalizeMonthlyArray(invoiced.actual_count),
      target_arr: normalizeMonthlyArray(invoiced.target_arr),
      actual_arr: normalizeMonthlyArray(invoiced.actual_arr),
    },
    in_month_churn: {
      target_count: normalizeMonthlyArray(inMonth.target_count),
      target_arr: normalizeMonthlyArray(inMonth.target_arr),
    },
  };
}

function parseExpandingArrData(raw: unknown): ExpandingArrData {
  const data = raw && typeof raw === 'object' ? (raw as any) : {};
  const upgradeDowngrade =
    data.upgrade_downgrade && typeof data.upgrade_downgrade === 'object' ? data.upgrade_downgrade : {};

  const upgrades = normalizeMonthlyArray(upgradeDowngrade.total_upgrades);
  const downgrades = normalizeMonthlyArray(upgradeDowngrade.total_downgrades);
  const netArr = normalizeMonthlyArray(upgradeDowngrade.net_upgrade_downgrade_arr);

  const hasAnyData =
    upgrades.some((v) => v !== 0) || downgrades.some((v) => v !== 0) || netArr.some((v) => v !== 0);

  if (!hasAnyData) {
    return {
      upgrade_downgrade: {
        total_upgrades: [...EXPANDING_ARR_DEFAULTS.totalUpgrades],
        total_downgrades: [...EXPANDING_ARR_DEFAULTS.totalDowngrades],
        net_upgrade_downgrade_arr: [...EXPANDING_ARR_DEFAULTS.netUpgradeDowngradeArr],
      },
    };
  }

  return {
    upgrade_downgrade: {
      total_upgrades: upgrades,
      total_downgrades: downgrades,
      net_upgrade_downgrade_arr: netArr,
    },
  };
}

const SALES_CYCLE_DEFAULTS: SalesCyclePlanRules = {
  lead_to_demo_booked_days: 10,
  demo_booked_to_sent_quote_20_days: 21,
  sent_quote_20_to_sent_quote_50_days: 14,
  sent_quote_50_to_sent_quote_70_days: 10,
  sent_quote_70_to_sent_quote_90_days: 7,
};

function parseSalesCyclePlanRules(raw: unknown): SalesCyclePlanRules {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const readInt = (key: keyof SalesCyclePlanRules, fallback: number) => {
    const value = Number(data[key]);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  };

  return {
    lead_to_demo_booked_days: readInt(
      'lead_to_demo_booked_days',
      SALES_CYCLE_DEFAULTS.lead_to_demo_booked_days
    ),
    demo_booked_to_sent_quote_20_days: readInt(
      'demo_booked_to_sent_quote_20_days',
      SALES_CYCLE_DEFAULTS.demo_booked_to_sent_quote_20_days
    ),
    sent_quote_20_to_sent_quote_50_days: readInt(
      'sent_quote_20_to_sent_quote_50_days',
      SALES_CYCLE_DEFAULTS.sent_quote_20_to_sent_quote_50_days
    ),
    sent_quote_50_to_sent_quote_70_days: readInt(
      'sent_quote_50_to_sent_quote_70_days',
      SALES_CYCLE_DEFAULTS.sent_quote_50_to_sent_quote_70_days
    ),
    sent_quote_70_to_sent_quote_90_days: readInt(
      'sent_quote_70_to_sent_quote_90_days',
      SALES_CYCLE_DEFAULTS.sent_quote_70_to_sent_quote_90_days
    ),
  };
}

type SettingsTab = 'users' | 'imports' | 'permissions' | 'areas' | 'planning' | 'system';
type ImportSubTab =
  | 'newBusinessGoLives'
  | 'churnImports'
  | 'upDownsellsImport'
  | 'smsImport'
  | 'payStripeTerminalInstallationImport'
  | 'phorestPayRevenueImport'
  | 'lookerLeadsImport'
  | 'salespipeImport'
  | 'salespipe2Import'
  | 'leadsImport'
  | 'signupsImport'
  | 'paymarginImport';

export default function DLTSettings({ user }: DLTSettingsProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const [activeImportSubTab, setActiveImportSubTab] = useState<ImportSubTab>('newBusinessGoLives');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<string | 'all'>('all');
  const [dynamicRoles, setDynamicRoles] = useState<DynamicRoleConfig[]>([]);
  const [dynamicRolesLoading, setDynamicRolesLoading] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRoleAreas, setNewRoleAreas] = useState<BusinessArea[]>(['new_business']);
  const [createRoleLoading, setCreateRoleLoading] = useState(false);
  const [createRoleMessage, setCreateRoleMessage] = useState('');
  const [createRoleError, setCreateRoleError] = useState('');
  const [planningYear, setPlanningYear] = useState(currentYear);
  const [goLiveUserId, setGoLiveUserId] = useState('');
  const [goLiveSaveMessage, setGoLiveSaveMessage] = useState('');
  const [goLiveImportMode, setGoLiveImportMode] = useState<'manual' | 'automatic'>('manual');
  const [manualGoLiveWriteLocked, setManualGoLiveWriteLocked] = useState(true);
  const [manualGoLiveWriteLockLoading, setManualGoLiveWriteLockLoading] = useState(false);
  const [manualGoLiveWriteLockSaving, setManualGoLiveWriteLockSaving] = useState(false);
  const [manualGoLiveWriteLockMessage, setManualGoLiveWriteLockMessage] = useState('');
  const [autoImportEnabled, setAutoImportEnabled] = useState(false);
  const [autoImportLoading, setAutoImportLoading] = useState(false);
  const [autoImportSaving, setAutoImportSaving] = useState(false);
  const [autoImportMessage, setAutoImportMessage] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<GoLiveDryRunResponse | null>(null);
  const [lastBatchCheckAt, setLastBatchCheckAt] = useState<string | null>(null);
  const [batchImportLoading, setBatchImportLoading] = useState(false);
  const [batchImportError, setBatchImportError] = useState('');
  const [batchImportResult, setBatchImportResult] = useState<GoLiveCommitResponse | null>(null);
  const [lastBatchImportAt, setLastBatchImportAt] = useState<string | null>(null);
  const [importHistoryLoading, setImportHistoryLoading] = useState(false);
  const [importHistoryError, setImportHistoryError] = useState('');
  const [importRuns, setImportRuns] = useState<GoLiveImportRun[]>([]);
  const [selectedImportRunId, setSelectedImportRunId] = useState<string | null>(null);
  const [selectedImportRunItems, setSelectedImportRunItems] = useState<GoLiveImportRunItem[]>([]);
  const [churnImportMode, setChurnImportMode] = useState<'manual' | 'automatic'>('manual');
  const [churnAutoImportEnabled, setChurnAutoImportEnabled] = useState(false);
  const [churnAutoImportLoading, setChurnAutoImportLoading] = useState(false);
  const [churnAutoImportSaving, setChurnAutoImportSaving] = useState(false);
  const [churnAutoImportMessage, setChurnAutoImportMessage] = useState('');
  const [churnBatchLoading, setChurnBatchLoading] = useState(false);
  const [churnBatchError, setChurnBatchError] = useState('');
  const [churnBatchResult, setChurnBatchResult] = useState<ChurnDryRunResponse | null>(null);
  const [lastChurnBatchCheckAt, setLastChurnBatchCheckAt] = useState<string | null>(null);
  const [churnBatchImportLoading, setChurnBatchImportLoading] = useState(false);
  const [churnBatchImportError, setChurnBatchImportError] = useState('');
  const [churnBatchImportResult, setChurnBatchImportResult] = useState<ChurnCommitResponse | null>(null);
  const [lastChurnBatchImportAt, setLastChurnBatchImportAt] = useState<string | null>(null);
  const [churnImportHistoryLoading, setChurnImportHistoryLoading] = useState(false);
  const [churnImportHistoryError, setChurnImportHistoryError] = useState('');
  const [churnImportRuns, setChurnImportRuns] = useState<ChurnImportRun[]>([]);
  const [selectedChurnImportRunId, setSelectedChurnImportRunId] = useState<string | null>(null);
  const [selectedChurnImportRunItems, setSelectedChurnImportRunItems] = useState<ChurnImportRunItem[]>([]);
  const [upDownsellsImportMode, setUpDownsellsImportMode] = useState<'manual' | 'automatic'>('manual');
  const [upDownsellsAutoImportEnabled, setUpDownsellsAutoImportEnabled] = useState(false);
  const [upDownsellsAutoImportLoading, setUpDownsellsAutoImportLoading] = useState(false);
  const [upDownsellsAutoImportSaving, setUpDownsellsAutoImportSaving] = useState(false);
  const [upDownsellsAutoImportMessage, setUpDownsellsAutoImportMessage] = useState('');
  const [upDownsellsBatchLoading, setUpDownsellsBatchLoading] = useState(false);
  const [upDownsellsBatchError, setUpDownsellsBatchError] = useState('');
  const [upDownsellsBatchResult, setUpDownsellsBatchResult] = useState<UpDownsellsDryRunResponse | null>(null);
  const [lastUpDownsellsBatchCheckAt, setLastUpDownsellsBatchCheckAt] = useState<string | null>(null);
  const [upDownsellsBatchImportLoading, setUpDownsellsBatchImportLoading] = useState(false);
  const [upDownsellsBatchImportError, setUpDownsellsBatchImportError] = useState('');
  const [upDownsellsBatchImportResult, setUpDownsellsBatchImportResult] = useState<UpDownsellsCommitResponse | null>(null);
  const [lastUpDownsellsBatchImportAt, setLastUpDownsellsBatchImportAt] = useState<string | null>(null);
  const [upDownsellsImportHistoryLoading, setUpDownsellsImportHistoryLoading] = useState(false);
  const [upDownsellsImportHistoryError, setUpDownsellsImportHistoryError] = useState('');
  const [upDownsellsImportRuns, setUpDownsellsImportRuns] = useState<UpDownsellsImportRun[]>([]);
  const [selectedUpDownsellsImportRunId, setSelectedUpDownsellsImportRunId] = useState<string | null>(null);
  const [selectedUpDownsellsImportRunItems, setSelectedUpDownsellsImportRunItems] = useState<
    UpDownsellsImportRunItem[]
  >([]);
  const [smsImportMode, setSmsImportMode] = useState<'manual' | 'automatic'>('manual');
  const [smsAutoImportEnabled, setSmsAutoImportEnabled] = useState(false);
  const [smsAutoImportLoading, setSmsAutoImportLoading] = useState(false);
  const [smsAutoImportSaving, setSmsAutoImportSaving] = useState(false);
  const [smsAutoImportMessage, setSmsAutoImportMessage] = useState('');
  const [smsBatchLoading, setSmsBatchLoading] = useState(false);
  const [smsBatchError, setSmsBatchError] = useState('');
  const [smsBatchResult, setSmsBatchResult] = useState<SmsDryRunResponse | null>(null);
  const [lastSmsBatchCheckAt, setLastSmsBatchCheckAt] = useState<string | null>(null);
  const [smsBatchImportLoading, setSmsBatchImportLoading] = useState(false);
  const [smsBatchImportError, setSmsBatchImportError] = useState('');
  const [smsBatchImportResult, setSmsBatchImportResult] = useState<SmsCommitResponse | null>(null);
  const [lastSmsBatchImportAt, setLastSmsBatchImportAt] = useState<string | null>(null);
  const [smsImportHistoryLoading, setSmsImportHistoryLoading] = useState(false);
  const [smsImportHistoryError, setSmsImportHistoryError] = useState('');
  const [smsImportRuns, setSmsImportRuns] = useState<SmsImportRun[]>([]);
  const [selectedSmsImportRunId, setSelectedSmsImportRunId] = useState<string | null>(null);
  const [selectedSmsImportRunItems, setSelectedSmsImportRunItems] = useState<SmsImportRunItem[]>([]);
  const [payStripeTerminalInstallationImportMode, setPayStripeTerminalInstallationImportMode] = useState<
    'manual' | 'automatic'
  >('manual');
  const [payStripeTerminalInstallationAutoImportEnabled, setPayStripeTerminalInstallationAutoImportEnabled] = useState(false);
  const [payStripeTerminalInstallationAutoImportLoading, setPayStripeTerminalInstallationAutoImportLoading] = useState(false);
  const [payStripeTerminalInstallationAutoImportSaving, setPayStripeTerminalInstallationAutoImportSaving] = useState(false);
  const [payStripeTerminalInstallationAutoImportMessage, setPayStripeTerminalInstallationAutoImportMessage] = useState('');
  const [payStripeTerminalInstallationBatchLoading, setPayStripeTerminalInstallationBatchLoading] = useState(false);
  const [payStripeTerminalInstallationBatchError, setPayStripeTerminalInstallationBatchError] = useState('');
  const [payStripeTerminalInstallationBatchResult, setPayStripeTerminalInstallationBatchResult] =
    useState<PayStripeTerminalInstallationDryRunResponse | null>(null);
  const [lastPayStripeTerminalInstallationBatchCheckAt, setLastPayStripeTerminalInstallationBatchCheckAt] = useState<
    string | null
  >(null);
  const [payStripeTerminalInstallationBatchImportLoading, setPayStripeTerminalInstallationBatchImportLoading] =
    useState(false);
  const [payStripeTerminalInstallationBatchImportError, setPayStripeTerminalInstallationBatchImportError] = useState('');
  const [payStripeTerminalInstallationBatchImportResult, setPayStripeTerminalInstallationBatchImportResult] =
    useState<PayStripeTerminalInstallationCommitResponse | null>(null);
  const [lastPayStripeTerminalInstallationBatchImportAt, setLastPayStripeTerminalInstallationBatchImportAt] = useState<
    string | null
  >(null);
  const [payStripeTerminalInstallationImportHistoryLoading, setPayStripeTerminalInstallationImportHistoryLoading] =
    useState(false);
  const [payStripeTerminalInstallationImportHistoryError, setPayStripeTerminalInstallationImportHistoryError] =
    useState('');
  const [payStripeTerminalInstallationImportRuns, setPayStripeTerminalInstallationImportRuns] = useState<
    PayStripeTerminalInstallationImportRun[]
  >([]);
  const [selectedPayStripeTerminalInstallationImportRunId, setSelectedPayStripeTerminalInstallationImportRunId] =
    useState<string | null>(null);
  const [
    selectedPayStripeTerminalInstallationImportRunItems,
    setSelectedPayStripeTerminalInstallationImportRunItems,
  ] = useState<PayStripeTerminalInstallationImportRunItem[]>([]);
  const [phorestPayRevenueImportMode, setPhorestPayRevenueImportMode] = useState<'manual' | 'automatic'>('manual');
  const [phorestPayRevenueAutoImportEnabled, setPhorestPayRevenueAutoImportEnabled] = useState(false);
  const [phorestPayRevenueAutoImportLoading, setPhorestPayRevenueAutoImportLoading] = useState(false);
  const [phorestPayRevenueAutoImportSaving, setPhorestPayRevenueAutoImportSaving] = useState(false);
  const [phorestPayRevenueAutoImportMessage, setPhorestPayRevenueAutoImportMessage] = useState('');
  const [phorestPayRevenueBatchLoading, setPhorestPayRevenueBatchLoading] = useState(false);
  const [phorestPayRevenueBatchError, setPhorestPayRevenueBatchError] = useState('');
  const [phorestPayRevenueBatchResult, setPhorestPayRevenueBatchResult] =
    useState<PhorestPayRevenueDryRunResponse | null>(null);
  const [lastPhorestPayRevenueBatchCheckAt, setLastPhorestPayRevenueBatchCheckAt] = useState<string | null>(null);
  const [phorestPayRevenueBatchImportLoading, setPhorestPayRevenueBatchImportLoading] = useState(false);
  const [phorestPayRevenueBatchImportError, setPhorestPayRevenueBatchImportError] = useState('');
  const [phorestPayRevenueBatchImportResult, setPhorestPayRevenueBatchImportResult] =
    useState<PhorestPayRevenueCommitResponse | null>(null);
  const [lastPhorestPayRevenueBatchImportAt, setLastPhorestPayRevenueBatchImportAt] = useState<string | null>(null);
  const [phorestPayRevenueImportHistoryLoading, setPhorestPayRevenueImportHistoryLoading] = useState(false);
  const [phorestPayRevenueImportHistoryError, setPhorestPayRevenueImportHistoryError] = useState('');
  const [phorestPayRevenueImportRuns, setPhorestPayRevenueImportRuns] = useState<PhorestPayRevenueImportRun[]>([]);
  const [selectedPhorestPayRevenueImportRunId, setSelectedPhorestPayRevenueImportRunId] = useState<string | null>(null);
  const [selectedPhorestPayRevenueImportRunItems, setSelectedPhorestPayRevenueImportRunItems] = useState<
    PhorestPayRevenueImportRunItem[]
  >([]);
  const [lookerLeadsImportMode, setLookerLeadsImportMode] = useState<'manual' | 'automatic'>('manual');
  const [lookerLeadsAutoImportEnabled, setLookerLeadsAutoImportEnabled] = useState(false);
  const [lookerLeadsAutoImportLoading, setLookerLeadsAutoImportLoading] = useState(false);
  const [lookerLeadsAutoImportSaving, setLookerLeadsAutoImportSaving] = useState(false);
  const [lookerLeadsAutoImportMessage, setLookerLeadsAutoImportMessage] = useState('');
  const [lookerLeadsBatchLoading, setLookerLeadsBatchLoading] = useState(false);
  const [lookerLeadsBatchError, setLookerLeadsBatchError] = useState('');
  const [lookerLeadsBatchResult, setLookerLeadsBatchResult] = useState<LookerLeadsDryRunResponse | null>(null);
  const [lastLookerLeadsBatchCheckAt, setLastLookerLeadsBatchCheckAt] = useState<string | null>(null);
  const [lookerLeadsBatchImportLoading, setLookerLeadsBatchImportLoading] = useState(false);
  const [lookerLeadsBatchImportError, setLookerLeadsBatchImportError] = useState('');
  const [lookerLeadsBatchImportResult, setLookerLeadsBatchImportResult] = useState<LookerLeadsCommitResponse | null>(
    null
  );
  const [lastLookerLeadsBatchImportAt, setLastLookerLeadsBatchImportAt] = useState<string | null>(null);
  const [lookerLeadsImportHistoryLoading, setLookerLeadsImportHistoryLoading] = useState(false);
  const [lookerLeadsImportHistoryError, setLookerLeadsImportHistoryError] = useState('');
  const [lookerLeadsImportRuns, setLookerLeadsImportRuns] = useState<LookerLeadsImportRun[]>([]);
  const [selectedLookerLeadsImportRunId, setSelectedLookerLeadsImportRunId] = useState<string | null>(null);
  const [selectedLookerLeadsImportRunItems, setSelectedLookerLeadsImportRunItems] = useState<LookerLeadsImportRunItem[]>(
    []
  );
  const [salespipeImportMode, setSalespipeImportMode] = useState<'manual' | 'automatic'>('manual');
  const [salespipeAutoImportEnabled, setSalespipeAutoImportEnabled] = useState(false);
  const [salespipeAutoImportLoading, setSalespipeAutoImportLoading] = useState(false);
  const [salespipeAutoImportSaving, setSalespipeAutoImportSaving] = useState(false);
  const [salespipeAutoImportMessage, setSalespipeAutoImportMessage] = useState('');
  const [salespipeBatchLoading, setSalespipeBatchLoading] = useState(false);
  const [salespipeBatchError, setSalespipeBatchError] = useState('');
  const [salespipeBatchResult, setSalespipeBatchResult] = useState<SalespipeDryRunResponse | null>(null);
  const [lastSalespipeBatchCheckAt, setLastSalespipeBatchCheckAt] = useState<string | null>(null);
  const [salespipeBatchImportLoading, setSalespipeBatchImportLoading] = useState(false);
  const [salespipeBatchImportError, setSalespipeBatchImportError] = useState('');
  const [salespipeBatchImportResult, setSalespipeBatchImportResult] = useState<SalespipeCommitResponse | null>(
    null
  );
  const [lastSalespipeBatchImportAt, setLastSalespipeBatchImportAt] = useState<string | null>(null);
  const [salespipeImportHistoryLoading, setSalespipeImportHistoryLoading] = useState(false);
  const [salespipeImportHistoryError, setSalespipeImportHistoryError] = useState('');
  const [salespipeImportRuns, setSalespipeImportRuns] = useState<SalespipeImportRun[]>([]);
  const [selectedSalespipeImportRunId, setSelectedSalespipeImportRunId] = useState<string | null>(null);
  const [selectedSalespipeImportRunItems, setSelectedSalespipeImportRunItems] = useState<SalespipeImportRunItem[]>(
    []
  );
  const [leadsImportMode, setLeadsImportMode] = useState<'manual' | 'automatic'>('manual');
  const [leadsAutoImportEnabled, setLeadsAutoImportEnabled] = useState(false);
  const [leadsAutoImportLoading, setLeadsAutoImportLoading] = useState(false);
  const [leadsAutoImportSaving, setLeadsAutoImportSaving] = useState(false);
  const [leadsAutoImportMessage, setLeadsAutoImportMessage] = useState('');
  const [leadsBatchLoading, setLeadsBatchLoading] = useState(false);
  const [leadsBatchError, setLeadsBatchError] = useState('');
  const [leadsBatchResult, setLeadsBatchResult] = useState<LeadsDryRunResponse | null>(null);
  const [lastLeadsBatchCheckAt, setLastLeadsBatchCheckAt] = useState<string | null>(null);
  const [leadsBatchImportLoading, setLeadsBatchImportLoading] = useState(false);
  const [leadsBatchImportError, setLeadsBatchImportError] = useState('');
  const [leadsBatchImportResult, setLeadsBatchImportResult] = useState<LeadsCommitResponse | null>(null);
  const [lastLeadsBatchImportAt, setLastLeadsBatchImportAt] = useState<string | null>(null);
  const [leadsImportHistoryLoading, setLeadsImportHistoryLoading] = useState(false);
  const [leadsImportHistoryError, setLeadsImportHistoryError] = useState('');
  const [leadsImportRuns, setLeadsImportRuns] = useState<LeadsImportRun[]>([]);
  const [selectedLeadsImportRunId, setSelectedLeadsImportRunId] = useState<string | null>(null);
  const [selectedLeadsImportRunItems, setSelectedLeadsImportRunItems] = useState<LeadsImportRunItem[]>([]);
  const [salespipe2AutoImportEnabled, setSalespipe2AutoImportEnabled] = useState(false);
  const [salespipe2AutoImportLoading, setSalespipe2AutoImportLoading] = useState(false);
  const [salespipe2AutoImportSaving, setSalespipe2AutoImportSaving] = useState(false);
  const [salespipe2AutoImportMessage, setSalespipe2AutoImportMessage] = useState('');
  const [salespipe2ImportHistoryLoading, setSalespipe2ImportHistoryLoading] = useState(false);
  const [salespipe2ImportHistoryError, setSalespipe2ImportHistoryError] = useState('');
  const [salespipe2ImportRuns, setSalespipe2ImportRuns] = useState<Salespipe2ImportRun[]>([]);
  const [selectedSalespipe2ImportRunId, setSelectedSalespipe2ImportRunId] = useState<string | null>(null);
  const [selectedSalespipe2ImportRunItems, setSelectedSalespipe2ImportRunItems] = useState<
    Salespipe2ImportRunItem[]
  >([]);
  const [salespipe2EventsCountLoading, setSalespipe2EventsCountLoading] = useState(false);
  const [salespipe2EventsCountError, setSalespipe2EventsCountError] = useState('');
  const [salespipe2EventsCount, setSalespipe2EventsCount] = useState<number | null>(null);
  const [signupsImportHistoryLoading, setSignupsImportHistoryLoading] = useState(false);
  const [signupsImportHistoryError, setSignupsImportHistoryError] = useState('');
  const [signupsImportRuns, setSignupsImportRuns] = useState<SignupsImportRun[]>([]);
  const [selectedSignupsImportRunId, setSelectedSignupsImportRunId] = useState<string | null>(null);
  const [selectedSignupsImportRunItems, setSelectedSignupsImportRunItems] = useState<SignupsImportRunItem[]>([]);
  const [leadsEventsCountLoading, setLeadsEventsCountLoading] = useState(false);
  const [leadsEventsCountError, setLeadsEventsCountError] = useState('');
  const [leadsEventsCount, setLeadsEventsCount] = useState<number | null>(null);
  const [signupsEventsCountLoading, setSignupsEventsCountLoading] = useState(false);
  const [signupsEventsCountError, setSignupsEventsCountError] = useState('');
  const [signupsEventsCount, setSignupsEventsCount] = useState<number | null>(null);
  const [paymarginCsvFile, setPaymarginCsvFile] = useState<File | null>(null);
  const [paymarginImportYear, setPaymarginImportYear] = useState(currentYear);
  const [paymarginGoLiveMonth, setPaymarginGoLiveMonth] = useState(1);
  const [paymarginSeasonalFactors, setPaymarginSeasonalFactors] = useState<number[]>([...DEFAULT_SEASONAL_FACTORS]);
  const [paymarginImportMode, setPaymarginImportMode] = useState<'dry-run' | 'commit'>('dry-run');
  const [paymarginImportLoading, setPaymarginImportLoading] = useState(false);
  const [paymarginImportError, setPaymarginImportError] = useState('');
  const [paymarginImportResult, setPaymarginImportResult] = useState<PaymarginImportResponse | null>(null);
  const [paymarginHistoryLoading, setPaymarginHistoryLoading] = useState(false);
  const [paymarginHistoryError, setPaymarginHistoryError] = useState('');
  const [paymarginSelectedMonthLastRun, setPaymarginSelectedMonthLastRun] = useState<PaymarginImportRun | null>(null);
  const [paymarginLatestRun, setPaymarginLatestRun] = useState<PaymarginImportRun | null>(null);
  const [paymarginCohortOakIds, setPaymarginCohortOakIds] = useState<number[]>([]);
  const [paymarginCohortOakIdsLoading, setPaymarginCohortOakIdsLoading] = useState(false);
  const [paymarginCohortOakIdsError, setPaymarginCohortOakIdsError] = useState('');
  const [paymarginCohortOakIdsCopyMessage, setPaymarginCohortOakIdsCopyMessage] = useState('');
  
  // ========== NEW ARR: GRUNDEINSTELLUNGEN ==========
  const [newArrYear, setNewArrYear] = useState(currentYear);
  const [newArrRegion, setNewArrRegion] = useState('DACH');
  
  // ========== NEW ARR: BUSINESS TARGETS (100%) ==========
  const [businessInbound, setBusinessInbound] = useState<number[]>(
    NEW_ARR_DEFAULTS.inbound
  );
  const [businessOutbound, setBusinessOutbound] = useState<number[]>(
    NEW_ARR_DEFAULTS.outbound
  );
  const [businessPartnerships, setBusinessPartnerships] = useState<number[]>(
    NEW_ARR_DEFAULTS.partnerships
  );
  
  // Prozentsätze für Pay Terminals, Terminal Sales und Tipping
  const [payTerminalsPercent, setPayTerminalsPercent] = useState(NEW_ARR_DEFAULTS.payTerminalsPercent);
  const [terminalPenetrationThreshold, setTerminalPenetrationThreshold] = useState(75);
  const [terminalSalesPercent, setTerminalSalesPercent] = useState(NEW_ARR_DEFAULTS.terminalSalesPercent);
  const [tippingPercent, setTippingPercent] = useState(NEW_ARR_DEFAULTS.tippingPercent);
  // Refs für aktuelle Prozentwerte (vermeidet stale closure beim Klick auf "Berechnen")
  const payTerminalsPercentRef = useRef(payTerminalsPercent);
  const terminalSalesPercentRef = useRef(terminalSalesPercent);
  const tippingPercentRef = useRef(tippingPercent);
  const loadingFromDbRef = useRef(false);
  const churnLoadingFromDbRef = useRef(false);
  /** Immer aktuelle savePlanzahlen-Implementierung (verhindert stale closure im Tab-Cleanup). */
  const savePlanzahlenRef = useRef<() => Promise<void>>(async () => {});

  // Business Pay Terminals, Terminal Sales und Tipping (monatlich)
  const [businessPayTerminals, setBusinessPayTerminals] = useState<number[]>([]);
  const [businessTerminalSales, setBusinessTerminalSales] = useState<number[]>([]);
  const [businessTipping, setBusinessTipping] = useState<number[]>([]);
  
  // ========== NEW ARR: UMSATZ-BERECHNUNG ==========
  const [avgSubsBill, setAvgSubsBill] = useState(NEW_ARR_DEFAULTS.avgSubsBill);
  const [avgPayBillTerminal, setAvgPayBillTerminal] = useState(NEW_ARR_DEFAULTS.avgPayBillTerminal);
  const [avgPayBillTipping, setAvgPayBillTipping] = useState(NEW_ARR_DEFAULTS.avgPayBillTipping);

  // ========== 2. EXPANDING ARR (manuelle Eingabe) ==========
  const [expandingTotalUpgrades, setExpandingTotalUpgrades] = useState<number[]>([
    ...EXPANDING_ARR_DEFAULTS.totalUpgrades,
  ]);
  const [expandingTotalDowngrades, setExpandingTotalDowngrades] = useState<number[]>([
    ...EXPANDING_ARR_DEFAULTS.totalDowngrades,
  ]);
  const [expandingNetUpgradeDowngradeArr, setExpandingNetUpgradeDowngradeArr] = useState<number[]>([
    ...EXPANDING_ARR_DEFAULTS.netUpgradeDowngradeArr,
  ]);

  // ========== 3. CHURN ARR (manuelle Eingabe) ==========
  const [invoicedChurnTargetCount, setInvoicedChurnTargetCount] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [invoicedChurnActualCount, setInvoicedChurnActualCount] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [invoicedChurnTargetArr, setInvoicedChurnTargetArr] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [invoicedChurnActualArr, setInvoicedChurnActualArr] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [inMonthChurnTargetCount, setInMonthChurnTargetCount] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [inMonthChurnTargetArr, setInMonthChurnTargetArr] = useState<number[]>([...EMPTY_MONTH_VALUES]);
  const [salesCyclePlanRules, setSalesCyclePlanRules] = useState<SalesCyclePlanRules>({
    ...SALES_CYCLE_DEFAULTS,
  });
  const [churnAutoSaving, setChurnAutoSaving] = useState(false);
  const [lastChurnAutoSaveAt, setLastChurnAutoSaveAt] = useState<string | null>(null);
  const [churnAutoSaveError, setChurnAutoSaveError] = useState<string | null>(null);
  
  // UI State
  const [businessTargetsExpanded, setBusinessTargetsExpanded] = useState(true);
  const [aeBusinessTargetsExpanded, setAeBusinessTargetsExpanded] = useState(true);
  const [planningSectionsExpanded, setPlanningSectionsExpanded] = useState({
    newArr: true,
    expandingArr: true,
    churnArr: true,
    newClients: true,
    churnedClients: true,
    endingClients: true,
    salesCycle: true,
  });
  const [saving, setSaving] = useState(false);
  const [loadingPlanzahlen, setLoadingPlanzahlen] = useState(true);
  const [saveMessage, setSaveMessage] = useState('');
  const [planzahlenId, setPlanzahlenId] = useState<string | null>(null);

  // ========== AE-SPEZIFISCHE NEW ARR SETTINGS ==========
  const [selectedAEId, setSelectedAEId] = useState<string | null>(null);
  const [aePercentages, setAePercentages] = useState<Map<string, number>>(new Map());
  const [aeOTEs, setAeOTEs] = useState<Map<string, number>>(new Map());
  const [aeBaseSalaries, setAeBaseSalaries] = useState<Map<string, number>>(new Map());
  const [aeVariableOTEs, setAeVariableOTEs] = useState<Map<string, number>>(new Map());
  const [aeArrMultiples, setAeArrMultiples] = useState<Map<string, number>>(new Map());
  const [aeGrossMargins, setAeGrossMargins] = useState<Map<string, number>>(new Map());
  const [aeTerminalBase, setAeTerminalBase] = useState<Map<string, number>>(new Map());
  const [aeTerminalBonus, setAeTerminalBonus] = useState<Map<string, number>>(new Map());
  const [aeSubsTiers, setAeSubsTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  const [aePayTiers, setAePayTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  const [aeTotalArrTiers, setAeTotalArrTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  const [whatIfTargetPaybackMonths, setWhatIfTargetPaybackMonths] = useState(6);
  const [whatIfSolveFor, setWhatIfSolveFor] = useState<'margin' | 'multiple'>('margin');
  const [whatIfAcv, setWhatIfAcv] = useState(3300);
  const [tierGuideTargetPayoutAt100, setTierGuideTargetPayoutAt100] = useState(DEFAULT_SETTINGS.variable_ote);
  const [tierGuideProfile, setTierGuideProfile] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const lastTierGuideAEIdRef = useRef<string | null>(null);
  
  // Load all users
  const { users, loading, refetch: refetchUsers, updateUserRole } = useAllUsers();
  const { settings: allSettings } = useAllSettings(newArrYear);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userEditError, setUserEditError] = useState('');
  const [roleHistory, setRoleHistory] = useState<UserRoleHistoryRecord[]>([]);
  const [aeRoleHistoryByUser, setAeRoleHistoryByUser] = useState<Record<string, RoleHistorySlice[]>>({});
  const [plannedRoleChanges, setPlannedRoleChanges] = useState<Record<string, { role: string; effective_from: string }>>({});
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [roleEffectiveFrom, setRoleEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [userEditData, setUserEditData] = useState({
    name: '',
    phone: '',
    region: 'DACH',
    employee_id: '',
    start_date: '',
    entry_date: '',
    exit_date: '',
    is_active: true,
    manager_id: '',
  });

  const assignableGoLiveUsers = useMemo(
    () => users.filter((u) => canReceiveGoLives(u.role)),
    [users]
  );

  useEffect(() => {
    if (!goLiveUserId && assignableGoLiveUsers.length > 0) {
      setGoLiveUserId(assignableGoLiveUsers[0].id);
    }
  }, [goLiveUserId, assignableGoLiveUsers]);

  const selectedGoLiveTargetUser =
    assignableGoLiveUsers.find((u) => u.id === goLiveUserId) || assignableGoLiveUsers[0] || user;

  const { addGoLive: addGoLiveForTargetUser, refetch: refetchGoLivesForTargetUser } = useGoLivesForUser(
    goLiveUserId || undefined,
    currentYear
  );

  const handleManualGoLiveSubmit = async (goLive: Partial<GoLive>) => {
    if (manualGoLiveWriteLocked) {
      return { error: { message: 'Manuelle Go-Live-Erfassung ist aktuell schreibgeschuetzt.' } };
    }

    if (!goLiveUserId) {
      return { error: { message: 'Bitte zuerst einen Ziel-User auswählen.' } };
    }

    const result = await addGoLiveForTargetUser({
      ...goLive,
      user_id: goLiveUserId,
      year: currentYear,
    });

    if (!result.error) {
      setGoLiveSaveMessage('Go-Live wurde erfolgreich gespeichert.');
      refetchGoLivesForTargetUser();
      setTimeout(() => setGoLiveSaveMessage(''), 2000);
    }

    return result;
  };

  const handleRunGoLiveBatchCheck = async () => {
    setBatchLoading(true);
    setBatchError('');
    try {
      const response = await fetch('/api/goLive/sync', { method: 'GET' });
      const data = (await response.json()) as GoLiveDryRunResponse;
      if (!response.ok || !data.success) {
        setBatchResult(null);
        setBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setBatchResult(data);
      setLastBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setBatchResult(null);
      setBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleRunGoLiveBatchImport = async () => {
    setBatchImportLoading(true);
    setBatchImportError('');
    try {
      const response = await fetch('/api/goLive/sync', { method: 'POST' });
      const data = (await response.json()) as GoLiveCommitResponse;
      if (!response.ok || !data.success) {
        setBatchImportResult(null);
        setBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setBatchImportResult(data);
      setLastBatchImportAt(new Date().toISOString());
      await loadImportHistory();
    } catch (err: any) {
      setBatchImportResult(null);
      setBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setBatchImportLoading(false);
    }
  };

  const loadImportHistory = useCallback(async () => {
    setImportHistoryLoading(true);
    setImportHistoryError('');
    try {
      const response = await fetch('/api/goLive/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as GoLiveImportRun[];
      setImportRuns(runs);
      if (!selectedImportRunId && runs.length > 0) {
        setSelectedImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setImportHistoryLoading(false);
    }
  }, [selectedImportRunId]);

  const loadImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/goLive/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedImportRunItems((data.items || []) as GoLiveImportRunItem[]);
    } catch (err: any) {
      setImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunChurnBatchCheck = async () => {
    setChurnBatchLoading(true);
    setChurnBatchError('');
    try {
      const response = await fetch('/api/churnDrive/sync', { method: 'GET' });
      const data = (await response.json()) as ChurnDryRunResponse;
      if (!response.ok || !data.success) {
        setChurnBatchResult(null);
        setChurnBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setChurnBatchResult(data);
      setLastChurnBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setChurnBatchResult(null);
      setChurnBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setChurnBatchLoading(false);
    }
  };

  const handleRunChurnBatchImport = async () => {
    setChurnBatchImportLoading(true);
    setChurnBatchImportError('');
    try {
      const response = await fetch('/api/churnDrive/sync', { method: 'POST' });
      const data = (await response.json()) as ChurnCommitResponse;
      if (!response.ok || !data.success) {
        setChurnBatchImportResult(null);
        setChurnBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setChurnBatchImportResult(data);
      setLastChurnBatchImportAt(new Date().toISOString());
      await loadChurnImportHistory();
    } catch (err: any) {
      setChurnBatchImportResult(null);
      setChurnBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setChurnBatchImportLoading(false);
    }
  };

  const loadChurnImportHistory = useCallback(async () => {
    setChurnImportHistoryLoading(true);
    setChurnImportHistoryError('');
    try {
      const response = await fetch('/api/churnDrive/sync/history?limit=50', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setChurnImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as ChurnImportRun[];
      setChurnImportRuns(runs);
      if (!selectedChurnImportRunId && runs.length > 0) {
        setSelectedChurnImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setChurnImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setChurnImportHistoryLoading(false);
    }
  }, [selectedChurnImportRunId]);

  const loadChurnImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/churnDrive/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setChurnImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedChurnImportRunItems((data.items || []) as ChurnImportRunItem[]);
    } catch (err: any) {
      setChurnImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunUpDownsellsBatchCheck = async () => {
    setUpDownsellsBatchLoading(true);
    setUpDownsellsBatchError('');
    try {
      const response = await fetch('/api/upDownsells/sync', { method: 'GET' });
      const data = (await response.json()) as UpDownsellsDryRunResponse;
      if (!response.ok || !data.success) {
        setUpDownsellsBatchResult(null);
        setUpDownsellsBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setUpDownsellsBatchResult(data);
      setLastUpDownsellsBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setUpDownsellsBatchResult(null);
      setUpDownsellsBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setUpDownsellsBatchLoading(false);
    }
  };

  const handleRunUpDownsellsBatchImport = async () => {
    setUpDownsellsBatchImportLoading(true);
    setUpDownsellsBatchImportError('');
    try {
      const response = await fetch('/api/upDownsells/sync', { method: 'POST' });
      const data = (await response.json()) as UpDownsellsCommitResponse;
      if (!response.ok || !data.success) {
        setUpDownsellsBatchImportResult(null);
        setUpDownsellsBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setUpDownsellsBatchImportResult(data);
      setLastUpDownsellsBatchImportAt(new Date().toISOString());
      await loadUpDownsellsImportHistory();
    } catch (err: any) {
      setUpDownsellsBatchImportResult(null);
      setUpDownsellsBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setUpDownsellsBatchImportLoading(false);
    }
  };

  const loadUpDownsellsImportHistory = useCallback(async () => {
    setUpDownsellsImportHistoryLoading(true);
    setUpDownsellsImportHistoryError('');
    try {
      const response = await fetch('/api/upDownsells/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setUpDownsellsImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as UpDownsellsImportRun[];
      setUpDownsellsImportRuns(runs);
      if (!selectedUpDownsellsImportRunId && runs.length > 0) {
        setSelectedUpDownsellsImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setUpDownsellsImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setUpDownsellsImportHistoryLoading(false);
    }
  }, [selectedUpDownsellsImportRunId]);

  const loadUpDownsellsImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/upDownsells/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setUpDownsellsImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedUpDownsellsImportRunItems((data.items || []) as UpDownsellsImportRunItem[]);
    } catch (err: any) {
      setUpDownsellsImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunSmsBatchCheck = async () => {
    setSmsBatchLoading(true);
    setSmsBatchError('');
    try {
      const response = await fetch('/api/sms/sync', { method: 'GET' });
      const data = (await response.json()) as SmsDryRunResponse;
      if (!response.ok || !data.success) {
        setSmsBatchResult(null);
        setSmsBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setSmsBatchResult(data);
      setLastSmsBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setSmsBatchResult(null);
      setSmsBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setSmsBatchLoading(false);
    }
  };

  const handleRunSmsBatchImport = async () => {
    setSmsBatchImportLoading(true);
    setSmsBatchImportError('');
    try {
      const response = await fetch('/api/sms/sync', { method: 'POST' });
      const data = (await response.json()) as SmsCommitResponse;
      if (!response.ok || !data.success) {
        setSmsBatchImportResult(null);
        setSmsBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setSmsBatchImportResult(data);
      setLastSmsBatchImportAt(new Date().toISOString());
      await loadSmsImportHistory();
    } catch (err: any) {
      setSmsBatchImportResult(null);
      setSmsBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setSmsBatchImportLoading(false);
    }
  };

  const loadSmsImportHistory = useCallback(async () => {
    setSmsImportHistoryLoading(true);
    setSmsImportHistoryError('');
    try {
      const response = await fetch('/api/sms/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSmsImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as SmsImportRun[];
      setSmsImportRuns(runs);
      if (!selectedSmsImportRunId && runs.length > 0) {
        setSelectedSmsImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setSmsImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setSmsImportHistoryLoading(false);
    }
  }, [selectedSmsImportRunId]);

  const loadSmsImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/sms/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSmsImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedSmsImportRunItems((data.items || []) as SmsImportRunItem[]);
    } catch (err: any) {
      setSmsImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunPayStripeTerminalInstallationBatchCheck = async () => {
    setPayStripeTerminalInstallationBatchLoading(true);
    setPayStripeTerminalInstallationBatchError('');
    try {
      const response = await fetch('/api/payStripeTerminalInstallation/sync', { method: 'GET' });
      const data = (await response.json()) as PayStripeTerminalInstallationDryRunResponse;
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationBatchResult(null);
        setPayStripeTerminalInstallationBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setPayStripeTerminalInstallationBatchResult(data);
      setLastPayStripeTerminalInstallationBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setPayStripeTerminalInstallationBatchResult(null);
      setPayStripeTerminalInstallationBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setPayStripeTerminalInstallationBatchLoading(false);
    }
  };

  const handleRunPayStripeTerminalInstallationBatchImport = async () => {
    setPayStripeTerminalInstallationBatchImportLoading(true);
    setPayStripeTerminalInstallationBatchImportError('');
    try {
      const response = await fetch('/api/payStripeTerminalInstallation/sync', { method: 'POST' });
      const data = (await response.json()) as PayStripeTerminalInstallationCommitResponse;
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationBatchImportResult(null);
        setPayStripeTerminalInstallationBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setPayStripeTerminalInstallationBatchImportResult(data);
      setLastPayStripeTerminalInstallationBatchImportAt(new Date().toISOString());
      await loadPayStripeTerminalInstallationImportHistory();
    } catch (err: any) {
      setPayStripeTerminalInstallationBatchImportResult(null);
      setPayStripeTerminalInstallationBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setPayStripeTerminalInstallationBatchImportLoading(false);
    }
  };

  const loadPayStripeTerminalInstallationImportHistory = useCallback(async () => {
    setPayStripeTerminalInstallationImportHistoryLoading(true);
    setPayStripeTerminalInstallationImportHistoryError('');
    try {
      const response = await fetch('/api/payStripeTerminalInstallation/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as PayStripeTerminalInstallationImportRun[];
      setPayStripeTerminalInstallationImportRuns(runs);
      if (!selectedPayStripeTerminalInstallationImportRunId && runs.length > 0) {
        setSelectedPayStripeTerminalInstallationImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setPayStripeTerminalInstallationImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setPayStripeTerminalInstallationImportHistoryLoading(false);
    }
  }, [selectedPayStripeTerminalInstallationImportRunId]);

  const loadPayStripeTerminalInstallationImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/payStripeTerminalInstallation/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedPayStripeTerminalInstallationImportRunItems(
        (data.items || []) as PayStripeTerminalInstallationImportRunItem[]
      );
    } catch (err: any) {
      setPayStripeTerminalInstallationImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunPhorestPayRevenueBatchCheck = async () => {
    setPhorestPayRevenueBatchLoading(true);
    setPhorestPayRevenueBatchError('');
    try {
      const response = await fetch('/api/phorestPayRevenue/sync', { method: 'GET' });
      const data = (await response.json()) as PhorestPayRevenueDryRunResponse;
      if (!response.ok || !data.success) {
        setPhorestPayRevenueBatchResult(null);
        setPhorestPayRevenueBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setPhorestPayRevenueBatchResult(data);
      setLastPhorestPayRevenueBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setPhorestPayRevenueBatchResult(null);
      setPhorestPayRevenueBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setPhorestPayRevenueBatchLoading(false);
    }
  };

  const handleRunPhorestPayRevenueBatchImport = async () => {
    setPhorestPayRevenueBatchImportLoading(true);
    setPhorestPayRevenueBatchImportError('');
    try {
      const response = await fetch('/api/phorestPayRevenue/sync', { method: 'POST' });
      const data = (await response.json()) as PhorestPayRevenueCommitResponse;
      if (!response.ok || !data.success) {
        setPhorestPayRevenueBatchImportResult(null);
        setPhorestPayRevenueBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setPhorestPayRevenueBatchImportResult(data);
      setLastPhorestPayRevenueBatchImportAt(new Date().toISOString());
      await loadPhorestPayRevenueImportHistory();
    } catch (err: any) {
      setPhorestPayRevenueBatchImportResult(null);
      setPhorestPayRevenueBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setPhorestPayRevenueBatchImportLoading(false);
    }
  };

  const loadPhorestPayRevenueImportHistory = useCallback(async () => {
    setPhorestPayRevenueImportHistoryLoading(true);
    setPhorestPayRevenueImportHistoryError('');
    try {
      const response = await fetch('/api/phorestPayRevenue/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPhorestPayRevenueImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as PhorestPayRevenueImportRun[];
      setPhorestPayRevenueImportRuns(runs);
      if (!selectedPhorestPayRevenueImportRunId && runs.length > 0) {
        setSelectedPhorestPayRevenueImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setPhorestPayRevenueImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setPhorestPayRevenueImportHistoryLoading(false);
    }
  }, [selectedPhorestPayRevenueImportRunId]);

  const loadPhorestPayRevenueImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/phorestPayRevenue/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setPhorestPayRevenueImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedPhorestPayRevenueImportRunItems((data.items || []) as PhorestPayRevenueImportRunItem[]);
    } catch (err: any) {
      setPhorestPayRevenueImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunLookerLeadsBatchCheck = async () => {
    setLookerLeadsBatchLoading(true);
    setLookerLeadsBatchError('');
    try {
      const response = await fetch('/api/lookerLeads/sync', { method: 'GET' });
      const data = (await response.json()) as LookerLeadsDryRunResponse;
      if (!response.ok || !data.success) {
        setLookerLeadsBatchResult(null);
        setLookerLeadsBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setLookerLeadsBatchResult(data);
      setLastLookerLeadsBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setLookerLeadsBatchResult(null);
      setLookerLeadsBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setLookerLeadsBatchLoading(false);
    }
  };

  const handleRunLookerLeadsBatchImport = async () => {
    setLookerLeadsBatchImportLoading(true);
    setLookerLeadsBatchImportError('');
    try {
      const response = await fetch('/api/lookerLeads/sync', { method: 'POST' });
      const data = (await response.json()) as LookerLeadsCommitResponse;
      if (!response.ok || !data.success) {
        setLookerLeadsBatchImportResult(null);
        setLookerLeadsBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setLookerLeadsBatchImportResult(data);
      setLastLookerLeadsBatchImportAt(new Date().toISOString());
      await loadLookerLeadsImportHistory();
    } catch (err: any) {
      setLookerLeadsBatchImportResult(null);
      setLookerLeadsBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setLookerLeadsBatchImportLoading(false);
    }
  };

  const loadLookerLeadsImportHistory = useCallback(async () => {
    setLookerLeadsImportHistoryLoading(true);
    setLookerLeadsImportHistoryError('');
    try {
      const response = await fetch('/api/lookerLeads/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLookerLeadsImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as LookerLeadsImportRun[];
      setLookerLeadsImportRuns(runs);
      if (!selectedLookerLeadsImportRunId && runs.length > 0) {
        setSelectedLookerLeadsImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setLookerLeadsImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setLookerLeadsImportHistoryLoading(false);
    }
  }, [selectedLookerLeadsImportRunId]);

  const loadLookerLeadsImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/lookerLeads/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLookerLeadsImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedLookerLeadsImportRunItems((data.items || []) as LookerLeadsImportRunItem[]);
    } catch (err: any) {
      setLookerLeadsImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunSalespipeBatchCheck = async () => {
    setSalespipeBatchLoading(true);
    setSalespipeBatchError('');
    try {
      const response = await fetch('/api/salespipe/sync', { method: 'GET' });
      const data = (await response.json()) as SalespipeDryRunResponse;
      if (!response.ok || !data.success) {
        setSalespipeBatchResult(null);
        setSalespipeBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setSalespipeBatchResult(data);
      setLastSalespipeBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setSalespipeBatchResult(null);
      setSalespipeBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setSalespipeBatchLoading(false);
    }
  };

  const handleRunSalespipeBatchImport = async () => {
    setSalespipeBatchImportLoading(true);
    setSalespipeBatchImportError('');
    try {
      const response = await fetch('/api/salespipe/sync', { method: 'POST' });
      const data = (await response.json()) as SalespipeCommitResponse;
      if (!response.ok || !data.success) {
        setSalespipeBatchImportResult(null);
        setSalespipeBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setSalespipeBatchImportResult(data);
      setLastSalespipeBatchImportAt(new Date().toISOString());
      await loadSalespipeImportHistory();
    } catch (err: any) {
      setSalespipeBatchImportResult(null);
      setSalespipeBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setSalespipeBatchImportLoading(false);
    }
  };

  const loadSalespipeImportHistory = useCallback(async () => {
    setSalespipeImportHistoryLoading(true);
    setSalespipeImportHistoryError('');
    try {
      const response = await fetch('/api/salespipe/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSalespipeImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as SalespipeImportRun[];
      setSalespipeImportRuns(runs);
      if (!selectedSalespipeImportRunId && runs.length > 0) {
        setSelectedSalespipeImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setSalespipeImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setSalespipeImportHistoryLoading(false);
    }
  }, [selectedSalespipeImportRunId]);

  const loadSalespipeImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/salespipe/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSalespipeImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedSalespipeImportRunItems((data.items || []) as SalespipeImportRunItem[]);
    } catch (err: any) {
      setSalespipeImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const handleRunLeadsBatchCheck = async () => {
    setLeadsBatchLoading(true);
    setLeadsBatchError('');
    try {
      const response = await fetch('/api/leads/sync', { method: 'GET' });
      const data = (await response.json()) as LeadsDryRunResponse;
      if (!response.ok || !data.success) {
        setLeadsBatchResult(null);
        setLeadsBatchError(data.error || 'Batch-Pruefung fehlgeschlagen');
        return;
      }
      setLeadsBatchResult(data);
      setLastLeadsBatchCheckAt(new Date().toISOString());
    } catch (err: any) {
      setLeadsBatchResult(null);
      setLeadsBatchError(err?.message || 'Batch-Pruefung fehlgeschlagen');
    } finally {
      setLeadsBatchLoading(false);
    }
  };

  const handleRunLeadsBatchImport = async () => {
    setLeadsBatchImportLoading(true);
    setLeadsBatchImportError('');
    try {
      const response = await fetch('/api/leads/sync', { method: 'POST' });
      const data = (await response.json()) as LeadsCommitResponse;
      if (!response.ok || !data.success) {
        setLeadsBatchImportResult(null);
        setLeadsBatchImportError(data.error || 'Manueller Import fehlgeschlagen');
        return;
      }
      setLeadsBatchImportResult(data);
      setLastLeadsBatchImportAt(new Date().toISOString());
      await loadLeadsImportHistory();
    } catch (err: any) {
      setLeadsBatchImportResult(null);
      setLeadsBatchImportError(err?.message || 'Manueller Import fehlgeschlagen');
    } finally {
      setLeadsBatchImportLoading(false);
    }
  };

  const loadLeadsImportHistory = useCallback(async () => {
    setLeadsImportHistoryLoading(true);
    setLeadsImportHistoryError('');
    try {
      const response = await fetch('/api/leads/sync/history?limit=20', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLeadsImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as LeadsImportRun[];
      setLeadsImportRuns(runs);
      if (!selectedLeadsImportRunId && runs.length > 0) {
        setSelectedLeadsImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setLeadsImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setLeadsImportHistoryLoading(false);
    }
  }, [selectedLeadsImportRunId]);

  const loadLeadsImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/leads/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLeadsImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedLeadsImportRunItems((data.items || []) as LeadsImportRunItem[]);
    } catch (err: any) {
      setLeadsImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const loadSalespipe2ImportHistory = useCallback(async () => {
    setSalespipe2ImportHistoryLoading(true);
    setSalespipe2ImportHistoryError('');
    try {
      const response = await fetch('/api/salespipe2/sync/history?limit=50', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSalespipe2ImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as Salespipe2ImportRun[];
      setSalespipe2ImportRuns(runs);
      if (!selectedSalespipe2ImportRunId && runs.length > 0) {
        setSelectedSalespipe2ImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setSalespipe2ImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setSalespipe2ImportHistoryLoading(false);
    }
  }, [selectedSalespipe2ImportRunId]);

  const loadSalespipe2ImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/salespipe2/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSalespipe2ImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedSalespipe2ImportRunItems((data.items || []) as Salespipe2ImportRunItem[]);
    } catch (err: any) {
      setSalespipe2ImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const loadSignupsImportHistory = useCallback(async () => {
    setSignupsImportHistoryLoading(true);
    setSignupsImportHistoryError('');
    try {
      const response = await fetch('/api/signups/sync/history?limit=50', { method: 'GET' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSignupsImportHistoryError(data.error || 'Import-Historie konnte nicht geladen werden.');
        return;
      }
      const runs = (data.runs || []) as SignupsImportRun[];
      setSignupsImportRuns(runs);
      if (!selectedSignupsImportRunId && runs.length > 0) {
        setSelectedSignupsImportRunId(runs[0].id);
      }
    } catch (err: any) {
      setSignupsImportHistoryError(err?.message || 'Import-Historie konnte nicht geladen werden.');
    } finally {
      setSignupsImportHistoryLoading(false);
    }
  }, [selectedSignupsImportRunId]);

  const loadSignupsImportRunItems = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/signups/sync/history?runId=${encodeURIComponent(runId)}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setSignupsImportHistoryError(data.error || 'Import-Details konnten nicht geladen werden.');
        return;
      }
      setSelectedSignupsImportRunItems((data.items || []) as SignupsImportRunItem[]);
    } catch (err: any) {
      setSignupsImportHistoryError(err?.message || 'Import-Details konnten nicht geladen werden.');
    }
  }, []);

  const loadLeadsEventsStats = useCallback(async () => {
    setLeadsEventsCountLoading(true);
    setLeadsEventsCountError('');
    try {
      const response = await fetch('/api/leads/sync/stats', { method: 'GET' });
      const data = (await response.json()) as LeadsStatsResponse;
      if (!response.ok || !data.success) {
        setLeadsEventsCountError(data.error || 'Leads Datenbank-Status konnte nicht geladen werden.');
        return;
      }
      setLeadsEventsCount(typeof data.count === 'number' ? data.count : 0);
    } catch (err: any) {
      setLeadsEventsCountError(err?.message || 'Leads Datenbank-Status konnte nicht geladen werden.');
    } finally {
      setLeadsEventsCountLoading(false);
    }
  }, []);

  const loadSignupsEventsStats = useCallback(async () => {
    setSignupsEventsCountLoading(true);
    setSignupsEventsCountError('');
    try {
      const response = await fetch('/api/signups/sync/stats', { method: 'GET' });
      const data = (await response.json()) as SignupsStatsResponse;
      if (!response.ok || !data.success) {
        setSignupsEventsCountError(data.error || 'Sign-ups Datenbank-Status konnte nicht geladen werden.');
        return;
      }
      setSignupsEventsCount(typeof data.count === 'number' ? data.count : 0);
    } catch (err: any) {
      setSignupsEventsCountError(err?.message || 'Sign-ups Datenbank-Status konnte nicht geladen werden.');
    } finally {
      setSignupsEventsCountLoading(false);
    }
  }, []);

  const loadSalespipe2EventsStats = useCallback(async () => {
    setSalespipe2EventsCountLoading(true);
    setSalespipe2EventsCountError('');
    try {
      const response = await fetch('/api/salespipe2/sync/stats', { method: 'GET' });
      const data = (await response.json()) as Salespipe2StatsResponse;
      if (!response.ok || !data.success) {
        setSalespipe2EventsCountError(data.error || 'Salespipe 2 Datenbank-Status konnte nicht geladen werden.');
        return;
      }
      setSalespipe2EventsCount(typeof data.count === 'number' ? data.count : 0);
    } catch (err: any) {
      setSalespipe2EventsCountError(err?.message || 'Salespipe 2 Datenbank-Status konnte nicht geladen werden.');
    } finally {
      setSalespipe2EventsCountLoading(false);
    }
  }, []);

  const handlePaymarginFactorChange = (idx: number, value: number) => {
    setPaymarginSeasonalFactors((prev) => {
      const next = [...prev];
      next[idx] = Number.isFinite(value) ? value : 1;
      return next;
    });
  };

  const loadPaymarginImportHistory = useCallback(async (year: number, goLiveMonth: number) => {
    setPaymarginHistoryLoading(true);
    setPaymarginHistoryError('');
    try {
      const response = await fetch(
        `/api/paymargin/import/history?year=${encodeURIComponent(String(year))}&goLiveMonth=${encodeURIComponent(
          String(goLiveMonth)
        )}`,
        { method: 'GET' }
      );
      const data = (await response.json()) as PaymarginImportHistoryResponse;
      if (!response.ok || !data.success) {
        setPaymarginHistoryError(data.error || 'Paymargin-Import-Historie konnte nicht geladen werden.');
        return;
      }
      setPaymarginSelectedMonthLastRun(data.selectedMonthLastRun || null);
      setPaymarginLatestRun(data.latestRun || null);
    } catch (err: any) {
      setPaymarginHistoryError(err?.message || 'Paymargin-Import-Historie konnte nicht geladen werden.');
    } finally {
      setPaymarginHistoryLoading(false);
    }
  }, []);

  const handleRunPaymarginCsvImport = async (dryRun: boolean) => {
    if (!paymarginCsvFile) {
      setPaymarginImportError('Bitte zuerst eine CSV-Datei auswählen.');
      return;
    }
    setPaymarginImportLoading(true);
    setPaymarginImportError('');
    setPaymarginImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', paymarginCsvFile);
      formData.append('year', String(paymarginImportYear));
      formData.append('goLiveMonth', String(paymarginGoLiveMonth));
      formData.append('seasonalFactors', JSON.stringify(paymarginSeasonalFactors));
      formData.append('dryRun', dryRun ? 'true' : 'false');

      const response = await fetch('/api/paymargin/import', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as PaymarginImportResponse;
      if (!response.ok || !data.success) {
        setPaymarginImportError(data.error || 'Paymargin-Import fehlgeschlagen.');
        return;
      }
      setPaymarginImportResult(data);
      if (!dryRun) {
        await loadPaymarginImportHistory(paymarginImportYear, paymarginGoLiveMonth);
      }
    } catch (err: any) {
      setPaymarginImportError(err?.message || 'Paymargin-Import fehlgeschlagen.');
    } finally {
      setPaymarginImportLoading(false);
    }
  };

  const loadAutoImportState = useCallback(async () => {
    setAutoImportLoading(true);
    setAutoImportMessage('');
    try {
      const response = await fetch('/api/goLive/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as GoLiveAutoImportResponse;
      if (!response.ok || !data.success) {
        setAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setAutoImportLoading(false);
    }
  }, []);

  const loadChurnAutoImportState = useCallback(async () => {
    setChurnAutoImportLoading(true);
    setChurnAutoImportMessage('');
    try {
      const response = await fetch('/api/churnDrive/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as ChurnAutoImportResponse;
      if (!response.ok || !data.success) {
        setChurnAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setChurnAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setChurnAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setChurnAutoImportLoading(false);
    }
  }, []);

  const loadUpDownsellsAutoImportState = useCallback(async () => {
    setUpDownsellsAutoImportLoading(true);
    setUpDownsellsAutoImportMessage('');
    try {
      const response = await fetch('/api/upDownsells/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as UpDownsellsAutoImportResponse;
      if (!response.ok || !data.success) {
        setUpDownsellsAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setUpDownsellsAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setUpDownsellsAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setUpDownsellsAutoImportLoading(false);
    }
  }, []);

  const loadSmsAutoImportState = useCallback(async () => {
    setSmsAutoImportLoading(true);
    setSmsAutoImportMessage('');
    try {
      const response = await fetch('/api/sms/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as SmsAutoImportResponse;
      if (!response.ok || !data.success) {
        setSmsAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setSmsAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setSmsAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setSmsAutoImportLoading(false);
    }
  }, []);

  const loadPayStripeTerminalInstallationAutoImportState = useCallback(async () => {
    setPayStripeTerminalInstallationAutoImportLoading(true);
    setPayStripeTerminalInstallationAutoImportMessage('');
    try {
      const response = await fetch('/api/payStripeTerminalInstallation/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as PayStripeTerminalInstallationAutoImportResponse;
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationAutoImportMessage(
          data.error || 'Auto-Import-Status konnte nicht geladen werden.'
        );
        return;
      }
      setPayStripeTerminalInstallationAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setPayStripeTerminalInstallationAutoImportMessage(
        err?.message || 'Auto-Import-Status konnte nicht geladen werden.'
      );
    } finally {
      setPayStripeTerminalInstallationAutoImportLoading(false);
    }
  }, []);

  const loadPhorestPayRevenueAutoImportState = useCallback(async () => {
    setPhorestPayRevenueAutoImportLoading(true);
    setPhorestPayRevenueAutoImportMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/phorestPayRevenue/sync/auto-import', {
        method: 'GET',
        signal: controller.signal,
      });
      const data = (await response.json()) as PhorestPayRevenueAutoImportResponse;
      if (!response.ok || !data.success) {
        setPhorestPayRevenueAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setPhorestPayRevenueAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPhorestPayRevenueAutoImportMessage('Auto-Import-Status Timeout. Bitte Seite neu laden.');
      } else {
        setPhorestPayRevenueAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
      }
    } finally {
      clearTimeout(timeout);
      setPhorestPayRevenueAutoImportLoading(false);
    }
  }, []);

  const loadLookerLeadsAutoImportState = useCallback(async () => {
    setLookerLeadsAutoImportLoading(true);
    setLookerLeadsAutoImportMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/lookerLeads/sync/auto-import', {
        method: 'GET',
        signal: controller.signal,
      });
      const data = (await response.json()) as LookerLeadsAutoImportResponse;
      if (!response.ok || !data.success) {
        setLookerLeadsAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setLookerLeadsAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setLookerLeadsAutoImportMessage('Auto-Import-Status Timeout. Bitte Seite neu laden.');
      } else {
        setLookerLeadsAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
      }
    } finally {
      clearTimeout(timeout);
      setLookerLeadsAutoImportLoading(false);
    }
  }, []);

  const loadSalespipeAutoImportState = useCallback(async () => {
    setSalespipeAutoImportLoading(true);
    setSalespipeAutoImportMessage('');
    try {
      const response = await fetch('/api/salespipe/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as SalespipeAutoImportResponse;
      if (!response.ok || !data.success) {
        setSalespipeAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setSalespipeAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setSalespipeAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setSalespipeAutoImportLoading(false);
    }
  }, []);

  const loadLeadsAutoImportState = useCallback(async () => {
    setLeadsAutoImportLoading(true);
    setLeadsAutoImportMessage('');
    try {
      const response = await fetch('/api/leads/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as LeadsAutoImportResponse;
      if (!response.ok || !data.success) {
        setLeadsAutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setLeadsAutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setLeadsAutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setLeadsAutoImportLoading(false);
    }
  }, []);

  const loadSalespipe2AutoImportState = useCallback(async () => {
    setSalespipe2AutoImportLoading(true);
    setSalespipe2AutoImportMessage('');
    try {
      const response = await fetch('/api/salespipe2/sync/auto-import', { method: 'GET' });
      const data = (await response.json()) as Salespipe2AutoImportResponse;
      if (!response.ok || !data.success) {
        setSalespipe2AutoImportMessage(data.error || 'Auto-Import-Status konnte nicht geladen werden.');
        return;
      }
      setSalespipe2AutoImportEnabled(Boolean(data.enabled));
    } catch (err: any) {
      setSalespipe2AutoImportMessage(err?.message || 'Auto-Import-Status konnte nicht geladen werden.');
    } finally {
      setSalespipe2AutoImportLoading(false);
    }
  }, []);

  const loadManualGoLiveWriteLockState = useCallback(async () => {
    setManualGoLiveWriteLockLoading(true);
    setManualGoLiveWriteLockMessage('');
    try {
      const response = await fetch('/api/goLive/manual-lock', { method: 'GET' });
      const data = (await response.json()) as GoLiveManualLockResponse;
      if (!response.ok || !data.success) {
        setManualGoLiveWriteLockMessage(data.error || 'Schreibschutz-Status konnte nicht geladen werden.');
        return;
      }
      setManualGoLiveWriteLocked(Boolean(data.enabled));
    } catch (err: any) {
      setManualGoLiveWriteLockMessage(err?.message || 'Schreibschutz-Status konnte nicht geladen werden.');
    } finally {
      setManualGoLiveWriteLockLoading(false);
    }
  }, []);

  const loadDynamicRoles = useCallback(async () => {
    setDynamicRolesLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setDynamicRoles([]);
        return;
      }

      const response = await fetch('/api/roles', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        return;
      }
      setDynamicRoles(Array.isArray(data.roles) ? data.roles : []);
    } catch (_err) {
      // no-op: bestehende Rollenverwaltung bleibt nutzbar
    } finally {
      setDynamicRolesLoading(false);
    }
  }, []);

  const handleCreateDynamicRole = useCallback(async () => {
    setCreateRoleError('');
    setCreateRoleMessage('');
    const roleKey = newRoleKey.trim().toLowerCase();
    const label = newRoleLabel.trim();
    const description = newRoleDescription.trim();

    if (!roleKey || !label) {
      setCreateRoleError('Rollen-Key und Label sind erforderlich.');
      return;
    }
    if (newRoleAreas.length === 0) {
      setCreateRoleError('Bitte mindestens einen Bereich auswählen.');
      return;
    }

    setCreateRoleLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setCreateRoleError('Nicht eingeloggt. Bitte neu anmelden.');
        return;
      }

      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role_key: roleKey,
          label,
          description: description || null,
          areas: newRoleAreas,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        setCreateRoleError(data?.error || 'Rolle konnte nicht erstellt werden.');
        return;
      }
      setCreateRoleMessage('Rolle wurde erstellt.');
      setNewRoleKey('');
      setNewRoleLabel('');
      setNewRoleDescription('');
      setNewRoleAreas(['new_business']);
      await loadDynamicRoles();
    } catch (_err) {
      setCreateRoleError('Rolle konnte nicht erstellt werden.');
    } finally {
      setCreateRoleLoading(false);
    }
  }, [loadDynamicRoles, newRoleAreas, newRoleDescription, newRoleKey, newRoleLabel]);

  useEffect(() => {
    if (activeTab === 'imports') {
      loadManualGoLiveWriteLockState();
      loadAutoImportState();
      loadImportHistory();
      loadChurnAutoImportState();
      loadChurnImportHistory();
      loadUpDownsellsAutoImportState();
      loadUpDownsellsImportHistory();
      loadSmsAutoImportState();
      loadSmsImportHistory();
      loadPayStripeTerminalInstallationAutoImportState();
      loadPayStripeTerminalInstallationImportHistory();
      loadPhorestPayRevenueAutoImportState();
      loadPhorestPayRevenueImportHistory();
      loadLookerLeadsAutoImportState();
      loadLookerLeadsImportHistory();
      loadSalespipeAutoImportState();
      loadSalespipeImportHistory();
      loadLeadsAutoImportState();
      loadLeadsImportHistory();
      loadLeadsEventsStats();
      loadSalespipe2AutoImportState();
      loadSalespipe2ImportHistory();
      loadSalespipe2EventsStats();
      loadSignupsImportHistory();
      loadSignupsEventsStats();
    }
    if (activeTab === 'permissions' || activeTab === 'users') {
      loadDynamicRoles();
    }
  }, [
    activeTab,
    loadManualGoLiveWriteLockState,
    loadAutoImportState,
    loadChurnAutoImportState,
    loadImportHistory,
    loadChurnImportHistory,
    loadUpDownsellsAutoImportState,
    loadUpDownsellsImportHistory,
    loadSmsAutoImportState,
    loadSmsImportHistory,
    loadPayStripeTerminalInstallationAutoImportState,
    loadPayStripeTerminalInstallationImportHistory,
    loadPhorestPayRevenueAutoImportState,
    loadPhorestPayRevenueImportHistory,
    loadLookerLeadsAutoImportState,
    loadLookerLeadsImportHistory,
    loadSalespipeAutoImportState,
    loadSalespipeImportHistory,
    loadLeadsAutoImportState,
    loadLeadsImportHistory,
    loadLeadsEventsStats,
    loadSalespipe2AutoImportState,
    loadSalespipe2ImportHistory,
    loadSalespipe2EventsStats,
    loadSignupsImportHistory,
    loadSignupsEventsStats,
    loadDynamicRoles,
  ]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedImportRunId) return;
    loadImportRunItems(selectedImportRunId);
  }, [activeTab, selectedImportRunId, loadImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedChurnImportRunId) return;
    loadChurnImportRunItems(selectedChurnImportRunId);
  }, [activeTab, selectedChurnImportRunId, loadChurnImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedUpDownsellsImportRunId) return;
    loadUpDownsellsImportRunItems(selectedUpDownsellsImportRunId);
  }, [activeTab, selectedUpDownsellsImportRunId, loadUpDownsellsImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedSmsImportRunId) return;
    loadSmsImportRunItems(selectedSmsImportRunId);
  }, [activeTab, selectedSmsImportRunId, loadSmsImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedPayStripeTerminalInstallationImportRunId) return;
    loadPayStripeTerminalInstallationImportRunItems(selectedPayStripeTerminalInstallationImportRunId);
  }, [
    activeTab,
    selectedPayStripeTerminalInstallationImportRunId,
    loadPayStripeTerminalInstallationImportRunItems,
  ]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedPhorestPayRevenueImportRunId) return;
    loadPhorestPayRevenueImportRunItems(selectedPhorestPayRevenueImportRunId);
  }, [activeTab, selectedPhorestPayRevenueImportRunId, loadPhorestPayRevenueImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedLookerLeadsImportRunId) return;
    loadLookerLeadsImportRunItems(selectedLookerLeadsImportRunId);
  }, [activeTab, selectedLookerLeadsImportRunId, loadLookerLeadsImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedSalespipeImportRunId) return;
    loadSalespipeImportRunItems(selectedSalespipeImportRunId);
  }, [activeTab, selectedSalespipeImportRunId, loadSalespipeImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedLeadsImportRunId) return;
    loadLeadsImportRunItems(selectedLeadsImportRunId);
  }, [activeTab, selectedLeadsImportRunId, loadLeadsImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedSalespipe2ImportRunId) return;
    loadSalespipe2ImportRunItems(selectedSalespipe2ImportRunId);
  }, [activeTab, selectedSalespipe2ImportRunId, loadSalespipe2ImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || !selectedSignupsImportRunId) return;
    loadSignupsImportRunItems(selectedSignupsImportRunId);
  }, [activeTab, selectedSignupsImportRunId, loadSignupsImportRunItems]);

  useEffect(() => {
    if (activeTab !== 'imports' || activeImportSubTab !== 'paymarginImport') return;
    loadPaymarginImportHistory(paymarginImportYear, paymarginGoLiveMonth);
  }, [
    activeTab,
    activeImportSubTab,
    paymarginImportYear,
    paymarginGoLiveMonth,
    loadPaymarginImportHistory,
  ]);

  useEffect(() => {
    if (activeTab !== 'imports' || activeImportSubTab !== 'paymarginImport') return;
    let cancelled = false;
    const loadPaymarginCohortOakIds = async () => {
      setPaymarginCohortOakIdsLoading(true);
      setPaymarginCohortOakIdsError('');
      setPaymarginCohortOakIdsCopyMessage('');
      try {
        const { data, error } = await supabase
          .from('go_lives')
          .select('oak_id')
          .eq('year', paymarginImportYear)
          .eq('month', paymarginGoLiveMonth)
          .eq('has_terminal', true)
          .not('oak_id', 'is', null);

        if (error) {
          throw error;
        }

        const uniqueOakIds = Array.from(
          new Set(
            (data || [])
              .map((row) => Number(row.oak_id))
              .filter((value) => Number.isFinite(value) && value > 0)
          )
        ).sort((a, b) => a - b);

        if (!cancelled) {
          setPaymarginCohortOakIds(uniqueOakIds);
        }
      } catch (err: any) {
        if (!cancelled) {
          setPaymarginCohortOakIds([]);
          setPaymarginCohortOakIdsError(
            err?.message || 'OAK-IDs fuer die gewaehlte Kohorte konnten nicht geladen werden.'
          );
        }
      } finally {
        if (!cancelled) {
          setPaymarginCohortOakIdsLoading(false);
        }
      }
    };

    loadPaymarginCohortOakIds();
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeImportSubTab, paymarginImportYear, paymarginGoLiveMonth]);

  const paymarginCohortOakIdsCsv = useMemo(
    () => paymarginCohortOakIds.join(','),
    [paymarginCohortOakIds]
  );

  const handleAutoImportToggle = async (enabled: boolean) => {
    setAutoImportEnabled(enabled);
    setAutoImportSaving(true);
    setAutoImportMessage('');
    try {
      const response = await fetch('/api/goLive/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as GoLiveAutoImportResponse;
      if (!response.ok || !data.success) {
        setAutoImportEnabled(!enabled);
        setAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setAutoImportEnabled(Boolean(data.enabled));
      setAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setAutoImportEnabled(!enabled);
      setAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setAutoImportSaving(false);
    }
  };

  const handleChurnAutoImportToggle = async (enabled: boolean) => {
    setChurnAutoImportEnabled(enabled);
    setChurnAutoImportSaving(true);
    setChurnAutoImportMessage('');
    try {
      const response = await fetch('/api/churnDrive/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as ChurnAutoImportResponse;
      if (!response.ok || !data.success) {
        setChurnAutoImportEnabled(!enabled);
        setChurnAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setChurnAutoImportEnabled(Boolean(data.enabled));
      setChurnAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setChurnAutoImportEnabled(!enabled);
      setChurnAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setChurnAutoImportSaving(false);
    }
  };

  const handleUpDownsellsAutoImportToggle = async (enabled: boolean) => {
    setUpDownsellsAutoImportEnabled(enabled);
    setUpDownsellsAutoImportSaving(true);
    setUpDownsellsAutoImportMessage('');
    try {
      const response = await fetch('/api/upDownsells/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as UpDownsellsAutoImportResponse;
      if (!response.ok || !data.success) {
        setUpDownsellsAutoImportEnabled(!enabled);
        setUpDownsellsAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setUpDownsellsAutoImportEnabled(Boolean(data.enabled));
      setUpDownsellsAutoImportMessage(
        enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.'
      );
    } catch (err: any) {
      setUpDownsellsAutoImportEnabled(!enabled);
      setUpDownsellsAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setUpDownsellsAutoImportSaving(false);
    }
  };

  const handleSmsAutoImportToggle = async (enabled: boolean) => {
    setSmsAutoImportEnabled(enabled);
    setSmsAutoImportSaving(true);
    setSmsAutoImportMessage('');
    try {
      const response = await fetch('/api/sms/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as SmsAutoImportResponse;
      if (!response.ok || !data.success) {
        setSmsAutoImportEnabled(!enabled);
        setSmsAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setSmsAutoImportEnabled(Boolean(data.enabled));
      setSmsAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setSmsAutoImportEnabled(!enabled);
      setSmsAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setSmsAutoImportSaving(false);
    }
  };

  const handlePayStripeTerminalInstallationAutoImportToggle = async (enabled: boolean) => {
    setPayStripeTerminalInstallationAutoImportEnabled(enabled);
    setPayStripeTerminalInstallationAutoImportSaving(true);
    setPayStripeTerminalInstallationAutoImportMessage('');
    try {
      const response = await fetch('/api/payStripeTerminalInstallation/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as PayStripeTerminalInstallationAutoImportResponse;
      if (!response.ok || !data.success) {
        setPayStripeTerminalInstallationAutoImportEnabled(!enabled);
        setPayStripeTerminalInstallationAutoImportMessage(
          data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.'
        );
        return;
      }
      setPayStripeTerminalInstallationAutoImportEnabled(Boolean(data.enabled));
      setPayStripeTerminalInstallationAutoImportMessage(
        enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.'
      );
    } catch (err: any) {
      setPayStripeTerminalInstallationAutoImportEnabled(!enabled);
      setPayStripeTerminalInstallationAutoImportMessage(
        err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.'
      );
    } finally {
      setPayStripeTerminalInstallationAutoImportSaving(false);
    }
  };

  const handlePhorestPayRevenueAutoImportToggle = async (enabled: boolean) => {
    setPhorestPayRevenueAutoImportEnabled(enabled);
    setPhorestPayRevenueAutoImportSaving(true);
    setPhorestPayRevenueAutoImportMessage('');
    try {
      const response = await fetch('/api/phorestPayRevenue/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as PhorestPayRevenueAutoImportResponse;
      if (!response.ok || !data.success) {
        setPhorestPayRevenueAutoImportEnabled(!enabled);
        setPhorestPayRevenueAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setPhorestPayRevenueAutoImportEnabled(Boolean(data.enabled));
      setPhorestPayRevenueAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setPhorestPayRevenueAutoImportEnabled(!enabled);
      setPhorestPayRevenueAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setPhorestPayRevenueAutoImportSaving(false);
    }
  };

  const handleLookerLeadsAutoImportToggle = async (enabled: boolean) => {
    setLookerLeadsAutoImportEnabled(enabled);
    setLookerLeadsAutoImportSaving(true);
    setLookerLeadsAutoImportMessage('');
    try {
      const response = await fetch('/api/lookerLeads/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as LookerLeadsAutoImportResponse;
      if (!response.ok || !data.success) {
        setLookerLeadsAutoImportEnabled(!enabled);
        setLookerLeadsAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setLookerLeadsAutoImportEnabled(Boolean(data.enabled));
      setLookerLeadsAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setLookerLeadsAutoImportEnabled(!enabled);
      setLookerLeadsAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setLookerLeadsAutoImportSaving(false);
    }
  };

  const handleSalespipeAutoImportToggle = async (enabled: boolean) => {
    setSalespipeAutoImportEnabled(enabled);
    setSalespipeAutoImportSaving(true);
    setSalespipeAutoImportMessage('');
    try {
      const response = await fetch('/api/salespipe/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as SalespipeAutoImportResponse;
      if (!response.ok || !data.success) {
        setSalespipeAutoImportEnabled(!enabled);
        setSalespipeAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setSalespipeAutoImportEnabled(Boolean(data.enabled));
      setSalespipeAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setSalespipeAutoImportEnabled(!enabled);
      setSalespipeAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setSalespipeAutoImportSaving(false);
    }
  };

  const handleLeadsAutoImportToggle = async (enabled: boolean) => {
    setLeadsAutoImportEnabled(enabled);
    setLeadsAutoImportSaving(true);
    setLeadsAutoImportMessage('');
    try {
      const response = await fetch('/api/leads/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as LeadsAutoImportResponse;
      if (!response.ok || !data.success) {
        setLeadsAutoImportEnabled(!enabled);
        setLeadsAutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setLeadsAutoImportEnabled(Boolean(data.enabled));
      setLeadsAutoImportMessage(enabled ? 'Auto-Import ist jetzt aktiviert.' : 'Auto-Import ist jetzt deaktiviert.');
    } catch (err: any) {
      setLeadsAutoImportEnabled(!enabled);
      setLeadsAutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setLeadsAutoImportSaving(false);
    }
  };

  const handleSalespipe2AutoImportToggle = async (enabled: boolean) => {
    setSalespipe2AutoImportSaving(true);
    setSalespipe2AutoImportMessage('');
    try {
      const response = await fetch('/api/salespipe2/sync/auto-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as Salespipe2AutoImportResponse;
      if (!response.ok || !data.success) {
        setSalespipe2AutoImportMessage(data.error || 'Auto-Import-Flag konnte nicht gespeichert werden.');
        return;
      }
      setSalespipe2AutoImportEnabled(Boolean(data.enabled));
      setSalespipe2AutoImportMessage(
        `Auto-Import ${data.enabled ? 'aktiviert' : 'deaktiviert'}${data.updatedAt ? ` (Stand: ${new Date(data.updatedAt).toLocaleString('de-DE')})` : ''}`
      );
      await loadSalespipe2ImportHistory();
    } catch (err: any) {
      setSalespipe2AutoImportMessage(err?.message || 'Auto-Import-Flag konnte nicht gespeichert werden.');
    } finally {
      setSalespipe2AutoImportSaving(false);
    }
  };

  const handleManualGoLiveWriteLockToggle = async (enabled: boolean) => {
    if (!canToggleManualGoLiveWriteLock) return;

    setManualGoLiveWriteLocked(enabled);
    setManualGoLiveWriteLockSaving(true);
    setManualGoLiveWriteLockMessage('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setManualGoLiveWriteLocked(!enabled);
        setManualGoLiveWriteLockMessage('Keine aktive Session gefunden. Bitte neu einloggen.');
        return;
      }

      const response = await fetch('/api/goLive/manual-lock', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as GoLiveManualLockResponse;
      if (!response.ok || !data.success) {
        setManualGoLiveWriteLocked(!enabled);
        setManualGoLiveWriteLockMessage(data.error || 'Schreibschutz konnte nicht gespeichert werden.');
        return;
      }

      setManualGoLiveWriteLocked(Boolean(data.enabled));
      setManualGoLiveWriteLockMessage(
        enabled
          ? 'Manuelle Go-Live-Erfassung ist jetzt schreibgeschuetzt.'
          : 'Manuelle Go-Live-Erfassung ist jetzt freigegeben.'
      );
    } catch (err: any) {
      setManualGoLiveWriteLocked(!enabled);
      setManualGoLiveWriteLockMessage(err?.message || 'Schreibschutz konnte nicht gespeichert werden.');
    } finally {
      setManualGoLiveWriteLockSaving(false);
    }
  };

  const formatBatchPreviewDate = (value: string | null) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('de-DE');
  };

  const formatBatchPreviewMonth = (value: string | null) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
  };

  const formatBatchPreviewBoolean = (value: boolean | null) => {
    if (value === null || value === undefined) return '-';
    return value ? 'Ja' : 'Nein';
  };

  const getImportRunStatusLabel = (status: GoLiveImportRun['status']) => {
    if (status === 'success') return 'Erfolgreich';
    if (status === 'partial') return 'Teilweise';
    if (status === 'failed') return 'Fehlgeschlagen';
    return 'Uebersprungen';
  };

  const latestAutoRun = useMemo(
    () => importRuns.find((run) => run.triggered_by === 'cron') || null,
    [importRuns]
  );

  const latestChurnAutoRun = useMemo(
    () => churnImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [churnImportRuns]
  );

  const latestUpDownsellsAutoRun = useMemo(
    () => upDownsellsImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [upDownsellsImportRuns]
  );

  const latestSmsAutoRun = useMemo(
    () => smsImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [smsImportRuns]
  );

  const latestPayStripeTerminalInstallationAutoRun = useMemo(
    () => payStripeTerminalInstallationImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [payStripeTerminalInstallationImportRuns]
  );

  const latestPhorestPayRevenueAutoRun = useMemo(
    () => phorestPayRevenueImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [phorestPayRevenueImportRuns]
  );

  const latestLookerLeadsAutoRun = useMemo(
    () => lookerLeadsImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [lookerLeadsImportRuns]
  );

  const latestSalespipeAutoRun = useMemo(
    () => salespipeImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [salespipeImportRuns]
  );

  const latestLeadsAutoRun = useMemo(
    () => leadsImportRuns.find((run) => run.triggered_by === 'cron') || null,
    [leadsImportRuns]
  );
  
  // ========== PLANZAHLEN: LADEN ==========
  const loadPlanzahlen = useCallback(async (year: number) => {
    setLoadingPlanzahlen(true);
    setLastChurnAutoSaveAt(null);
    setChurnAutoSaveError(null);
    try {
      const { data, error } = await supabase
        .from('dlt_planzahlen')
        .select('*')
        .eq('year', year)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Fehler beim Laden der Planzahlen:', error);
        return;
      }
      
      if (data) {
        loadingFromDbRef.current = true;
        churnLoadingFromDbRef.current = true;
        setPlanzahlenId(data.id);
        setNewArrRegion(data.region || 'DACH');
        setBusinessInbound(data.business_inbound || NEW_ARR_DEFAULTS.inbound);
        setBusinessOutbound(data.business_outbound || NEW_ARR_DEFAULTS.outbound);
        setBusinessPartnerships(data.business_partnerships || NEW_ARR_DEFAULTS.partnerships);
        setBusinessPayTerminals(data.business_pay_terminals || []);
        setBusinessTerminalSales(data.business_terminal_sales || []);
        setBusinessTipping(data.business_tipping || []);
        const pPay = data.pay_terminals_percent ?? NEW_ARR_DEFAULTS.payTerminalsPercent;
        const pTerm = data.terminal_sales_percent ?? NEW_ARR_DEFAULTS.terminalSalesPercent;
        const pTip = data.tipping_percent ?? NEW_ARR_DEFAULTS.tippingPercent;
        setPayTerminalsPercent(pPay);
        payTerminalsPercentRef.current = pPay;
        setTerminalPenetrationThreshold(data.terminal_penetration_threshold ?? 75);
        setTerminalSalesPercent(pTerm);
        terminalSalesPercentRef.current = pTerm;
        setTippingPercent(pTip);
        tippingPercentRef.current = pTip;
        setAvgSubsBill(data.avg_subs_bill || NEW_ARR_DEFAULTS.avgSubsBill);
        setAvgPayBillTerminal(data.avg_pay_bill_terminal || NEW_ARR_DEFAULTS.avgPayBillTerminal);
        setAvgPayBillTipping(data.avg_pay_bill_tipping || NEW_ARR_DEFAULTS.avgPayBillTipping);

        const expanding = parseExpandingArrData(data.expanding_arr_data);
        setExpandingTotalUpgrades(expanding.upgrade_downgrade.total_upgrades);
        setExpandingTotalDowngrades(expanding.upgrade_downgrade.total_downgrades);
        setExpandingNetUpgradeDowngradeArr(expanding.upgrade_downgrade.net_upgrade_downgrade_arr);

        const churn = parseChurnArrData(data.churn_arr_data);
        setInvoicedChurnTargetCount(churn.invoiced_churn.target_count);
        setInvoicedChurnActualCount(churn.invoiced_churn.actual_count);
        setInvoicedChurnTargetArr(churn.invoiced_churn.target_arr);
        setInvoicedChurnActualArr(churn.invoiced_churn.actual_arr);
        setInMonthChurnTargetCount(churn.in_month_churn.target_count);
        setInMonthChurnTargetArr(churn.in_month_churn.target_arr);

        const salesCycleRaw =
          data.new_clients_data &&
          typeof data.new_clients_data === 'object' &&
          'sales_cycle_plan_rules' in data.new_clients_data
            ? (data.new_clients_data as Record<string, unknown>).sales_cycle_plan_rules
            : null;
        setSalesCyclePlanRules(parseSalesCyclePlanRules(salesCycleRaw));
      } else {
        setPlanzahlenId(null);
        setExpandingTotalUpgrades([...EXPANDING_ARR_DEFAULTS.totalUpgrades]);
        setExpandingTotalDowngrades([...EXPANDING_ARR_DEFAULTS.totalDowngrades]);
        setExpandingNetUpgradeDowngradeArr([...EXPANDING_ARR_DEFAULTS.netUpgradeDowngradeArr]);
        churnLoadingFromDbRef.current = true;
        setInvoicedChurnTargetCount([...EMPTY_MONTH_VALUES]);
        setInvoicedChurnActualCount([...EMPTY_MONTH_VALUES]);
        setInvoicedChurnTargetArr([...EMPTY_MONTH_VALUES]);
        setInvoicedChurnActualArr([...EMPTY_MONTH_VALUES]);
        setInMonthChurnTargetCount([...EMPTY_MONTH_VALUES]);
        setInMonthChurnTargetArr([...EMPTY_MONTH_VALUES]);
        setSalesCyclePlanRules({ ...SALES_CYCLE_DEFAULTS });
      }
    } catch (err) {
      console.error('Fehler beim Laden:', err);
    } finally {
      setLoadingPlanzahlen(false);
    }
  }, []);
  
  // Planzahlen beim Start und bei Jahr-Änderung laden
  useEffect(() => {
    loadPlanzahlen(newArrYear);
  }, [newArrYear, loadPlanzahlen]);
  
  // ========== PLANZAHLEN: SPEICHERN ==========
  const buildExpandingArrPayload = useCallback(
    () => ({
      upgrade_downgrade: {
        total_upgrades: expandingTotalUpgrades,
        total_downgrades: expandingTotalDowngrades,
        net_upgrade_downgrade_arr: expandingNetUpgradeDowngradeArr,
      },
      source_note: 'Manual app entry',
    }),
    [expandingTotalUpgrades, expandingTotalDowngrades, expandingNetUpgradeDowngradeArr]
  );

  const buildChurnArrPayload = useCallback(
    () => ({
      invoiced_churn: {
        target_count: invoicedChurnTargetCount,
        actual_count: invoicedChurnActualCount,
        target_arr: invoicedChurnTargetArr,
        actual_arr: invoicedChurnActualArr,
      },
      in_month_churn: {
        target_count: inMonthChurnTargetCount,
        target_arr: inMonthChurnTargetArr,
      },
      source_note: 'Manual app entry',
    }),
    [
      invoicedChurnTargetCount,
      invoicedChurnActualCount,
      invoicedChurnTargetArr,
      invoicedChurnActualArr,
      inMonthChurnTargetCount,
      inMonthChurnTargetArr,
    ]
  );

  const savePlanzahlen = async () => {
    setSaving(true);
    setSaveMessage('');
    
    try {
      const planzahlenData: Partial<DLTPlanzahlen> = {
        year: newArrYear,
        region: newArrRegion,
        // NEW ARR
        business_inbound: businessInbound,
        business_outbound: businessOutbound,
        business_partnerships: businessPartnerships,
        business_pay_terminals: businessPayTerminals,
        business_terminal_sales: businessTerminalSales,
        business_tipping: businessTipping,
        pay_terminals_percent: payTerminalsPercent,
        terminal_penetration_threshold: terminalPenetrationThreshold,
        terminal_sales_percent: terminalSalesPercent,
        tipping_percent: tippingPercent,
        avg_subs_bill: avgSubsBill,
        avg_pay_bill_terminal: avgPayBillTerminal,
        avg_pay_bill_tipping: avgPayBillTipping,
        // Platzhalter für weitere Bereiche
        expanding_arr_data: buildExpandingArrPayload(),
        churn_arr_data: buildChurnArrPayload(),
        new_clients_data: {
          sales_cycle_plan_rules: salesCyclePlanRules,
          source_note: 'Manual app entry',
        },
        churned_clients_data: {},
        ending_clients_data: {},
        updated_at: new Date().toISOString(),
      };
      
      let result;
      if (planzahlenId) {
        // Update existierender Datensatz
        result = await supabase
          .from('dlt_planzahlen')
          .update(planzahlenData)
          .eq('id', planzahlenId);
      } else {
        // Neuer Datensatz
        result = await supabase
          .from('dlt_planzahlen')
          .insert({ ...planzahlenData, created_at: new Date().toISOString() })
          .select()
          .single();
        
        if (result.data) {
          setPlanzahlenId(result.data.id);
        }
      }
      
      if (result.error) {
        throw result.error;
      }

      // DLT ist ab jetzt die zentrale Quelle für New ARR/Commission Settings pro AE.
      for (const ae of plannableUsers) {
        const percentage = aePercentages.get(ae.id) ?? 0;
        const activeInfo = aeActivityByUser.get(ae.id) || { activeFlags: new Array(12).fill(true), activeMonths: 12 };
        const inboundTargetsRaw = calculateFromPercentage(businessInbound, percentage);
        const outboundTargetsRaw = calculateFromPercentage(businessOutbound, percentage);
        const partnershipTargetsRaw = calculateFromPercentage(businessPartnerships, percentage);
        const goLiveTargetsRaw = calculateTotalGoLives(inboundTargetsRaw, outboundTargetsRaw, partnershipTargetsRaw);
        const terminalSalesTargetsRaw = goLiveTargetsRaw.map((v) => Math.round(v * terminalSalesPercent / 100));
        const tippingTargetsRaw = terminalSalesTargetsRaw.map((v) => Math.round(v * tippingPercent / 100));
        const monthlySubsTargetsRaw = calculateMonthlySubsTargets(goLiveTargetsRaw, avgSubsBill);
        const monthlyPayTargetsRaw = terminalSalesTargetsRaw.map((ts, i) => (ts * avgPayBillTerminal * 12) + (tippingTargetsRaw[i] * avgPayBillTipping * 12));
        const rawTotalArrTarget = monthlySubsTargetsRaw.reduce(
          (sum, v, i) => (activeInfo.activeFlags[i] ? sum + (v || 0) + (monthlyPayTargetsRaw[i] || 0) : sum),
          0
        );
        const baseSalary = aeBaseSalaries.get(ae.id) ?? DEFAULT_SETTINGS.base_salary;
        const variableOte = aeVariableOTEs.get(ae.id) ?? (aeOTEs.get(ae.id) ?? DEFAULT_SETTINGS.variable_ote);
        const arrMultiple = aeArrMultiples.get(ae.id) ?? DEFAULT_SETTINGS.arr_multiple;
        const quotaArr = calculateQuotaFromMultiple(calculateOtc(baseSalary, variableOte), arrMultiple) * (activeInfo.activeMonths / 12);
        const quotaCalibrationFactor = rawTotalArrTarget > 0 ? quotaArr / rawTotalArrTarget : 1;
        const inboundTargets = inboundTargetsRaw.map((v, i) => (activeInfo.activeFlags[i] ? Math.max(0, Math.round((v || 0) * quotaCalibrationFactor)) : 0));
        const outboundTargets = outboundTargetsRaw.map((v, i) => (activeInfo.activeFlags[i] ? Math.max(0, Math.round((v || 0) * quotaCalibrationFactor)) : 0));
        const partnershipTargets = partnershipTargetsRaw.map((v, i) => (activeInfo.activeFlags[i] ? Math.max(0, Math.round((v || 0) * quotaCalibrationFactor)) : 0));
        const goLiveTargets = calculateTotalGoLives(inboundTargets, outboundTargets, partnershipTargets);
        const terminalSalesTargets = goLiveTargets.map((v) => Math.round(v * terminalSalesPercent / 100));
        const tippingTargets = terminalSalesTargets.map((v) => Math.round(v * tippingPercent / 100));
        const monthlySubsTargets = calculateMonthlySubsTargets(goLiveTargets, avgSubsBill).map((v) => Math.max(0, Math.round(v || 0)));
        const monthlyPayTargets = terminalSalesTargets.map((ts, i) => Math.max(0, Math.round((ts * avgPayBillTerminal * 12) + (tippingTargets[i] * avgPayBillTipping * 12))));
        const monthlyTotalArrTargets = monthlySubsTargets.map((subs, i) => (subs || 0) + (monthlyPayTargets[i] || 0));

        const payload = {
          user_id: ae.id,
          year: newArrYear,
          region: newArrRegion,
          ote: aeOTEs.get(ae.id) ?? DEFAULT_SETTINGS.ote,
          base_salary: baseSalary,
          variable_ote: variableOte,
          arr_multiple: arrMultiple,
          gross_margin_pct: aeGrossMargins.get(ae.id) ?? DEFAULT_SETTINGS.gross_margin_pct,
          monthly_inbound_targets: inboundTargets,
          monthly_outbound_targets: outboundTargets,
          monthly_partnerships_targets: partnershipTargets,
          target_percentage: percentage,
          monthly_go_live_targets: goLiveTargets,
          monthly_subs_targets: monthlySubsTargets,
          monthly_pay_targets: monthlyPayTargets,
          monthly_total_arr_targets: monthlyTotalArrTargets,
          avg_subs_bill: avgSubsBill,
          avg_pay_bill: avgPayBillTerminal,
          avg_pay_bill_tipping: avgPayBillTipping,
          terminal_base: aeTerminalBase.get(ae.id) ?? DEFAULT_SETTINGS.terminal_base,
          terminal_bonus: aeTerminalBonus.get(ae.id) ?? DEFAULT_SETTINGS.terminal_bonus,
          terminal_penetration_threshold: terminalPenetrationThreshold / 100,
          subs_tiers: aeTotalArrTiers.get(ae.id) ?? DEFAULT_TOTAL_ARR_TIERS,
          pay_tiers: aeTotalArrTiers.get(ae.id) ?? DEFAULT_TOTAL_ARR_TIERS,
          total_arr_tiers: aeTotalArrTiers.get(ae.id) ?? DEFAULT_TOTAL_ARR_TIERS,
          pay_arr_factor: 0,
          updated_at: new Date().toISOString(),
        };

        const existing = allSettings.find((s) => s.user_id === ae.id);
        const settingsResult = existing
          ? await supabase.from('ae_settings').update(payload).eq('id', existing.id)
          : await supabase.from('ae_settings').insert({ ...payload, created_at: new Date().toISOString() });

        if (settingsResult.error) {
          throw settingsResult.error;
        }
      }
      
      setSaveMessage('Planzahlen erfolgreich gespeichert!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err: any) {
      console.error('Fehler beim Speichern:', err);
      setSaveMessage(`Fehler: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  savePlanzahlenRef.current = savePlanzahlen;

  // Auto-Save: beim Verlassen des Planzahlen-Tabs oder Unmount (immer aktuelle Formularwerte)
  useEffect(() => {
    if (activeTab !== 'planning') return;
    return () => {
      void savePlanzahlenRef.current();
    };
  }, [activeTab]);

  const saveChurnArrOnly = useCallback(async () => {
    if (loadingPlanzahlen) return;
    setChurnAutoSaving(true);
    setChurnAutoSaveError(null);
    try {
      const timestamp = new Date().toISOString();
      const payload = {
        year: newArrYear,
        region: newArrRegion,
        churn_arr_data: buildChurnArrPayload(),
        updated_at: timestamp,
      };

      if (planzahlenId) {
        const { error } = await supabase
          .from('dlt_planzahlen')
          .update(payload)
          .eq('id', planzahlenId);
        if (error) throw error;
      } else {
        const { data: existing, error: existingError } = await supabase
          .from('dlt_planzahlen')
          .select('id')
          .eq('year', newArrYear)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingError) throw existingError;

        if (existing?.id) {
          const { error: updateError } = await supabase
            .from('dlt_planzahlen')
            .update(payload)
            .eq('id', existing.id);
          if (updateError) throw updateError;
          setPlanzahlenId(existing.id);
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from('dlt_planzahlen')
            .insert({ ...payload, created_at: timestamp })
            .select('id')
            .single();
          if (insertError) throw insertError;
          if (inserted?.id) setPlanzahlenId(inserted.id);
        }
      }

      setLastChurnAutoSaveAt(new Date().toISOString());
    } catch (err: any) {
      console.error('Fehler beim Auto-Save (CHURN ARR):', err);
      const errorMessage = err?.message || 'Unbekannter Fehler';
      setChurnAutoSaveError(errorMessage);
      setSaveMessage(`Fehler Auto-Save CHURN: ${errorMessage}`);
    } finally {
      setChurnAutoSaving(false);
    }
  }, [loadingPlanzahlen, planzahlenId, newArrYear, newArrRegion, buildChurnArrPayload]);
  
  // Filter plannable users for planning tab
  const plannableUsers = useMemo(() => 
    users.filter(u => isPlannable(u.role)), 
    [users]
  );

  useEffect(() => {
    const loadRoleHistoryForUsers = async () => {
      if (users.length === 0) {
        setAeRoleHistoryByUser({});
        return;
      }

      const userIds = users.map((u) => u.id);
      const { data, error } = await supabase
        .from('user_role_history')
        .select('user_id, role, effective_from, effective_to')
        .in('user_id', userIds);

      if (error) {
        console.error('Fehler beim Laden der Rollenhistorie fuer AE-Kalkulation:', error);
        setAeRoleHistoryByUser({});
        return;
      }

      const grouped: Record<string, RoleHistorySlice[]> = {};
      (data || []).forEach((entry: { user_id: string; role: UserRole; effective_from: string; effective_to?: string | null }) => {
        const userId = entry.user_id;
        if (!grouped[userId]) grouped[userId] = [];
        grouped[userId].push({
          role: entry.role,
          effective_from: entry.effective_from,
          effective_to: entry.effective_to ?? null,
        });
      });

      Object.keys(grouped).forEach((uid) => {
        grouped[uid].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      });

      setAeRoleHistoryByUser(grouped);
    };

    loadRoleHistoryForUsers();
  }, [users]);

  const calculateFromPercentage = useCallback((businessValues: number[], percentage: number): number[] => {
    return businessValues.map((val) => Math.round(val * percentage / 100));
  }, []);

  useEffect(() => {
    if (plannableUsers.length === 0) {
      setSelectedAEId(null);
      return;
    }

    const percentPerUser = Math.floor(100 / plannableUsers.length);
    let remainingPercent = 100;

    const nextPercentages = new Map<string, number>();
    const nextOTEs = new Map<string, number>();
    const nextBaseSalaries = new Map<string, number>();
    const nextVariableOTEs = new Map<string, number>();
    const nextArrMultiples = new Map<string, number>();
    const nextGrossMargins = new Map<string, number>();
    const nextTerminalBase = new Map<string, number>();
    const nextTerminalBonus = new Map<string, number>();
    const nextSubsTiers = new Map<string, ProvisionTier[]>();
    const nextPayTiers = new Map<string, ProvisionTier[]>();
    const nextTotalArrTiers = new Map<string, ProvisionTier[]>();

    plannableUsers.forEach((u, idx) => {
      const isLast = idx === plannableUsers.length - 1;
      const defaultPercent = isLast ? remainingPercent : percentPerUser;
      remainingPercent -= percentPerUser;
      const existing = allSettings.find((s) => s.user_id === u.id);
      nextPercentages.set(u.id, existing?.target_percentage ?? defaultPercent);
      nextOTEs.set(u.id, existing?.ote ?? DEFAULT_SETTINGS.ote);
      nextBaseSalaries.set(u.id, existing?.base_salary ?? DEFAULT_SETTINGS.base_salary);
      nextVariableOTEs.set(u.id, existing?.variable_ote ?? existing?.ote ?? DEFAULT_SETTINGS.variable_ote);
      nextArrMultiples.set(u.id, existing?.arr_multiple ?? DEFAULT_SETTINGS.arr_multiple);
      nextGrossMargins.set(u.id, existing?.gross_margin_pct ?? DEFAULT_SETTINGS.gross_margin_pct);
      nextTerminalBase.set(u.id, existing?.terminal_base ?? DEFAULT_SETTINGS.terminal_base);
      nextTerminalBonus.set(u.id, existing?.terminal_bonus ?? DEFAULT_SETTINGS.terminal_bonus);
      const unifiedTiers = existing?.total_arr_tiers ?? existing?.subs_tiers ?? existing?.pay_tiers ?? DEFAULT_TOTAL_ARR_TIERS;
      nextSubsTiers.set(u.id, unifiedTiers);
      nextPayTiers.set(u.id, unifiedTiers);
      nextTotalArrTiers.set(u.id, unifiedTiers);
    });

    setAePercentages(nextPercentages);
    setAeOTEs(nextOTEs);
    setAeBaseSalaries(nextBaseSalaries);
    setAeVariableOTEs(nextVariableOTEs);
    setAeArrMultiples(nextArrMultiples);
    setAeGrossMargins(nextGrossMargins);
    setAeTerminalBase(nextTerminalBase);
    setAeTerminalBonus(nextTerminalBonus);
    setAeSubsTiers(nextSubsTiers);
    setAePayTiers(nextPayTiers);
    setAeTotalArrTiers(nextTotalArrTiers);
    setSelectedAEId((prev) => (prev && plannableUsers.some((u) => u.id === prev) ? prev : plannableUsers[0].id));
  }, [plannableUsers, allSettings]);
  
  // Check permissions
  const permissions = getPermissions(user.role);
  const canToggleManualGoLiveWriteLock = user.role === 'country_manager';
  const dynamicRoleLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    dynamicRoles.forEach((role) => {
      map[role.role_key] = role.label;
    });
    return map;
  }, [dynamicRoles]);

  const roleSelectionOptions = useMemo(() => {
    const staticRoles = Object.keys(ROLE_LABELS);
    const dynamicKeys = dynamicRoles.map((role) => role.role_key);
    return Array.from(new Set([...staticRoles, ...dynamicKeys])).sort();
  }, [dynamicRoles]);

  const getRoleLabel = useCallback(
    (role: string) => ROLE_LABELS[role as UserRole] || dynamicRoleLabelMap[role] || role,
    [dynamicRoleLabelMap]
  );

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           u.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = filterRole === 'all' || u.role === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [users, searchTerm, filterRole]);

  // Group users by role
  const usersByRole = useMemo(() => {
    const grouped: Record<string, User[]> = {};
    users.forEach(u => {
      if (!grouped[u.role]) grouped[u.role] = [];
      grouped[u.role].push(u);
    });
    return grouped;
  }, [users]);

  // Unique roles from users
  const availableRoles = useMemo(() => {
    const roles = new Set<string>(users.map(u => u.role));
    dynamicRoles.forEach((role) => {
      if (role.is_active) roles.add(role.role_key);
    });
    return Array.from(roles).sort();
  }, [users, dynamicRoles]);

  useEffect(() => {
    const loadPlannedRoleChanges = async () => {
      if (users.length === 0) {
        setPlannedRoleChanges({});
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('user_role_history')
        .select('user_id, role, effective_from')
        .gt('effective_from', today)
        .order('effective_from', { ascending: true });

      if (error) {
        console.error('Fehler beim Laden geplanter Rollenwechsel:', error);
        setPlannedRoleChanges({});
        return;
      }

      const byUser: Record<string, { role: string; effective_from: string }> = {};
      (data || []).forEach((entry: any) => {
        if (!byUser[entry.user_id]) {
          byUser[entry.user_id] = {
            role: String(entry.role),
            effective_from: entry.effective_from,
          };
        }
      });
      setPlannedRoleChanges(byUser);
    };

    loadPlannedRoleChanges();
  }, [users]);

  const possibleManagers = useMemo(() => {
    return users.filter((u) =>
      u.role === 'country_manager' ||
      u.role === 'dlt_member' ||
      u.role === 'line_manager_new_business' ||
      u.role === 'commercial_director' ||
      u.role === 'head_of_partnerships' ||
      u.role === 'head_of_expanding_revenue' ||
      u.role === 'line_manager_expanding_business' ||
      u.role === 'head_of_marketing'
    );
  }, [users]);

  const openUserEdit = (targetUser: User) => {
    setEditingUser(targetUser);
    setUserEditError('');
    setSelectedRole(targetUser.role);
    setRoleEffectiveFrom(new Date().toISOString().slice(0, 10));
    setUserEditData({
      name: targetUser.name || '',
      phone: targetUser.phone || '',
      region: targetUser.region || 'DACH',
      employee_id: targetUser.employee_id || '',
      start_date: targetUser.start_date || '',
      entry_date: targetUser.entry_date || targetUser.start_date || '',
      exit_date: targetUser.exit_date || '',
      is_active: targetUser.is_active ?? true,
      manager_id: targetUser.manager_id || '',
    });

    // Rollenhistorie laden
    supabase
      .from('user_role_history')
      .select('*')
      .eq('user_id', targetUser.id)
      .order('effective_from', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('Fehler beim Laden der Rollenhistorie:', error);
          setRoleHistory([]);
          return;
        }
        setRoleHistory((data || []) as UserRoleHistoryRecord[]);
      });
  };

  const saveUserStammdaten = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    setUserEditError('');
    try {
      const { error } = await supabase
        .from('users')
        .update({
          name: userEditData.name,
          phone: userEditData.phone || null,
          region: userEditData.region || 'DACH',
          employee_id: userEditData.employee_id || null,
          start_date: userEditData.start_date || null,
          entry_date: userEditData.entry_date || userEditData.start_date || null,
          exit_date: userEditData.exit_date || null,
          is_active: userEditData.exit_date ? false : userEditData.is_active,
          manager_id: userEditData.manager_id || null,
        })
        .eq('id', editingUser.id);

      if (error) throw error;

      // Rolle mit Stichtag ändern (inkl. Historie), falls geändert
      if (permissions.assignRoles && selectedRole && selectedRole !== editingUser.role) {
        const roleResult = await updateUserRole(editingUser.id, selectedRole, roleEffectiveFrom);
        if (roleResult.error) {
          throw roleResult.error;
        }
      }

      // Beim Austrittsdatum offene Rollenhistorie taggenau schließen.
      if (userEditData.exit_date) {
        const { error: closeHistoryError } = await supabase
          .from('user_role_history')
          .update({ effective_to: userEditData.exit_date })
          .eq('user_id', editingUser.id)
          .is('effective_to', null)
          .lte('effective_from', userEditData.exit_date);

        if (closeHistoryError) throw closeHistoryError;
      }

      setEditingUser(null);
      await refetchUsers();
    } catch (err: any) {
      setUserEditError(err.message || 'Fehler beim Speichern');
    } finally {
      setSavingUser(false);
    }
  };
  
  // ========== NEW ARR: BERECHNUNGEN ==========
  const businessGoLives = useMemo(() => 
    businessInbound.map((inb, i) => inb + businessOutbound[i] + businessPartnerships[i]), 
    [businessInbound, businessOutbound, businessPartnerships]
  );
  
  const businessTotalInbound = businessInbound.reduce((a, b) => a + b, 0);
  const businessTotalOutbound = businessOutbound.reduce((a, b) => a + b, 0);
  const businessTotalPartnerships = businessPartnerships.reduce((a, b) => a + b, 0);
  const businessTotal = businessTotalInbound + businessTotalOutbound + businessTotalPartnerships;
  const businessTotalPayTerminals = businessPayTerminals.reduce((a, b) => a + b, 0);
  const businessTotalTerminalSales = businessTerminalSales.reduce((a, b) => a + b, 0);
  const businessTotalTipping = businessTipping.reduce((a, b) => a + b, 0);
  
  // Terminal Penetration für Business
  const businessTerminalPenetration = businessTotal > 0 ? (businessTotalPayTerminals / businessTotal * 100) : 0;
  
  // ARR Berechnung
  const yearlyPayArr = (businessTotalTerminalSales * avgPayBillTerminal * 12) + (businessTotalTipping * avgPayBillTipping * 12);
  const yearlySubsArr = businessTotal * avgSubsBill * 12;
  
  // ========== NEW ARR: LIVE-UPDATE bei Prozent- oder Go-Live-Änderung ==========
  useEffect(() => {
    if (loadingFromDbRef.current) {
      loadingFromDbRef.current = false;
      return;
    }
    const pPay = payTerminalsPercentRef.current;
    const pTerm = terminalSalesPercentRef.current;
    const pTip = tippingPercentRef.current;
    const newPayTerms = businessGoLives.map(gl => Math.round(gl * pPay / 100));
    setBusinessPayTerminals(newPayTerms);
    const newTermSales = businessGoLives.map(gl => Math.round(gl * pTerm / 100));
    setBusinessTerminalSales(newTermSales);
    setBusinessTipping(newTermSales.map(ts => Math.round(ts * pTip / 100)));
  }, [businessGoLives, payTerminalsPercent, terminalSalesPercent, tippingPercent]);

  useEffect(() => {
    if (activeTab !== 'planning' || loadingPlanzahlen) return;
    if (churnLoadingFromDbRef.current) {
      churnLoadingFromDbRef.current = false;
      return;
    }

    const timeoutId = setTimeout(() => {
      saveChurnArrOnly();
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [
    activeTab,
    loadingPlanzahlen,
    invoicedChurnTargetCount,
    invoicedChurnActualCount,
    invoicedChurnTargetArr,
    invoicedChurnActualArr,
    inMonthChurnTargetCount,
    inMonthChurnTargetArr,
    saveChurnArrOnly,
  ]);
  
  // ========== NEW ARR: HANDLER ==========
  const handleBusinessChange = (category: 'inbound' | 'outbound' | 'partnerships', month: number, value: number) => {
    const setter = category === 'inbound' ? setBusinessInbound 
      : category === 'outbound' ? setBusinessOutbound 
      : setBusinessPartnerships;
    setter(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessPayTerminalsChange = (month: number, value: number) => {
    setBusinessPayTerminals(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessTerminalChange = (month: number, value: number) => {
    setBusinessTerminalSales(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessTippingChange = (month: number, value: number) => {
    setBusinessTipping(prev => { const n = [...prev]; n[month] = value; return n; });
  };

  const updateMonthlyValues = (
    setter: (updater: (prev: number[]) => number[]) => void,
    month: number,
    value: number
  ) => {
    setter((prev) => {
      const next = [...prev];
      next[month] = Number.isFinite(value) ? value : 0;
      return next;
    });
  };

  const toNegativeOrZero = (value: number) => {
    if (!Number.isFinite(value) || value === 0) return 0;
    return -Math.abs(value);
  };

  const sumMonthlyValues = (values: number[]) => values.reduce((sum, current) => sum + (current || 0), 0);

  const updateSalesCycleRule = (key: keyof SalesCyclePlanRules, value: number) => {
    setSalesCyclePlanRules((prev) => ({
      ...prev,
      [key]: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0,
    }));
  };

  const salesCycleMaxToSentQuote20 =
    salesCyclePlanRules.lead_to_demo_booked_days + salesCyclePlanRules.demo_booked_to_sent_quote_20_days;
  const salesCycleMaxToSentQuote50 =
    salesCycleMaxToSentQuote20 + salesCyclePlanRules.sent_quote_20_to_sent_quote_50_days;
  const salesCycleMaxToSentQuote70 =
    salesCycleMaxToSentQuote50 + salesCyclePlanRules.sent_quote_50_to_sent_quote_70_days;
  const salesCycleMaxToSentQuote90 =
    salesCycleMaxToSentQuote70 + salesCyclePlanRules.sent_quote_70_to_sent_quote_90_days;
  const salesCycleMinDays =
    salesCyclePlanRules.lead_to_demo_booked_days + salesCyclePlanRules.sent_quote_70_to_sent_quote_90_days;

  const applyInMonthTargetsFromInvoiced = () => {
    setInMonthChurnTargetCount((prev) => {
      const next = [...prev];
      for (let i = 0; i < 11; i += 1) next[i] = invoicedChurnTargetCount[i + 1] || 0;
      next[11] = prev[11] || 0;
      return next;
    });
    setInMonthChurnTargetArr((prev) => {
      const next = [...prev];
      for (let i = 0; i < 11; i += 1) next[i] = invoicedChurnTargetArr[i + 1] || 0;
      next[11] = prev[11] || 0;
      return next;
    });
  };

  const togglePlanningSection = (
    section:
      | 'newArr'
      | 'expandingArr'
      | 'churnArr'
      | 'newClients'
      | 'churnedClients'
      | 'endingClients'
      | 'salesCycle'
  ) => {
    setPlanningSectionsExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };
  
  const recalculateBusinessDerived = useCallback(() => {
    const pPay = payTerminalsPercentRef.current;
    const pTerm = terminalSalesPercentRef.current;
    const pTip = tippingPercentRef.current;
    const newPayTerms = businessGoLives.map(gl => Math.round(gl * pPay / 100));
    setBusinessPayTerminals(newPayTerms);
    const newTermSales = businessGoLives.map(gl => Math.round(gl * pTerm / 100));
    setBusinessTerminalSales(newTermSales);
    setBusinessTipping(newTermSales.map(ts => Math.round(ts * pTip / 100)));
  }, [businessGoLives]);

  // Tab configuration
  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'users', label: t('dlt.settings.users'), icon: '👥' },
    { id: 'permissions', label: t('dlt.settings.permissions'), icon: '🔐' },
    { id: 'imports', label: 'Importe', icon: '📥' },
    { id: 'areas', label: t('dlt.settings.areas'), icon: '🏢' },
    { id: 'planning', label: t('dlt.settings.planning'), icon: '📊' },
    { id: 'system', label: t('dlt.settings.system'), icon: '⚙️' }
  ];
  
  const selectedAEUser = useMemo(
    () => plannableUsers.find((u) => u.id === selectedAEId) || null,
    [plannableUsers, selectedAEId]
  );
  const isExitedUser = useCallback((user: User) => Boolean(user.exit_date) || user.is_active === false, []);
  const selectedAEPercentage = selectedAEId ? (aePercentages.get(selectedAEId) ?? 0) : 0;
  const selectedAEOTE = selectedAEId ? (aeOTEs.get(selectedAEId) ?? DEFAULT_SETTINGS.ote) : DEFAULT_SETTINGS.ote;
  const selectedAEBaseSalary = selectedAEId ? (aeBaseSalaries.get(selectedAEId) ?? DEFAULT_SETTINGS.base_salary) : DEFAULT_SETTINGS.base_salary;
  const selectedAEVariableOTE = selectedAEId ? (aeVariableOTEs.get(selectedAEId) ?? DEFAULT_SETTINGS.variable_ote) : DEFAULT_SETTINGS.variable_ote;
  const selectedAEArrMultiple = selectedAEId ? (aeArrMultiples.get(selectedAEId) ?? DEFAULT_SETTINGS.arr_multiple) : DEFAULT_SETTINGS.arr_multiple;
  const selectedAEGrossMargin = selectedAEId ? (aeGrossMargins.get(selectedAEId) ?? DEFAULT_SETTINGS.gross_margin_pct) : DEFAULT_SETTINGS.gross_margin_pct;
  const selectedTerminalBase = selectedAEId ? (aeTerminalBase.get(selectedAEId) ?? DEFAULT_SETTINGS.terminal_base) : DEFAULT_SETTINGS.terminal_base;
  const selectedTerminalBonus = selectedAEId ? (aeTerminalBonus.get(selectedAEId) ?? DEFAULT_SETTINGS.terminal_bonus) : DEFAULT_SETTINGS.terminal_bonus;
  const selectedSubsTiers = selectedAEId ? (aeSubsTiers.get(selectedAEId) ?? DEFAULT_SUBS_TIERS) : DEFAULT_SUBS_TIERS;
  const selectedPayTiers = selectedAEId ? (aePayTiers.get(selectedAEId) ?? DEFAULT_PAY_TIERS) : DEFAULT_PAY_TIERS;
  const selectedTotalArrTiers = selectedAEId ? (aeTotalArrTiers.get(selectedAEId) ?? DEFAULT_TOTAL_ARR_TIERS) : DEFAULT_TOTAL_ARR_TIERS;
  const aeActivityByUser = useMemo(() => {
    const result = new Map<string, { activeFlags: boolean[]; activeMonths: number }>();
    const normalizeDate = (v?: string | null) => (v ? String(v).slice(0, 10) : null);
    const monthDate = (month: number) => `${newArrYear}-${String(month).padStart(2, '0')}-01`;

    plannableUsers.forEach((u) => {
      const history = aeRoleHistoryByUser[u.id] || [];
      const entryDate = normalizeDate(u.entry_date || u.start_date || null);
      const exitDate = normalizeDate(u.exit_date || null);
      const flags: boolean[] = [];
      const earliestHistoryFrom = history.length > 0 ? normalizeDate(history[0].effective_from) : null;

      for (let month = 1; month <= 12; month += 1) {
        const currentDate = monthDate(month);
        const userActive =
          (!entryDate || currentDate >= entryDate) &&
          (!exitDate || currentDate <= exitDate);

        if (!userActive) {
          flags.push(false);
          continue;
        }

        const matchingHistory = [...history]
          .reverse()
          .find(
            (h) =>
              normalizeDate(h.effective_from) !== null &&
              currentDate >= (normalizeDate(h.effective_from) as string) &&
              (!normalizeDate(h.effective_to) || currentDate <= (normalizeDate(h.effective_to) as string))
          );

        let roleAtDate: UserRole | null = null;
        if (matchingHistory) {
          roleAtDate = matchingHistory.role;
        } else if (history.length === 0) {
          roleAtDate = u.role;
        } else if (earliestHistoryFrom && currentDate < earliestHistoryFrom) {
          // Vor dem ersten bekannten Rollenstart keine AE-Relevanz annehmen.
          roleAtDate = null;
        } else {
          // Bei Luecken nach dem ersten Eintrag den zuletzt bekannten Stand verwenden.
          const latestBefore = [...history]
            .reverse()
            .find((h) => normalizeDate(h.effective_from) && currentDate >= (normalizeDate(h.effective_from) as string));
          roleAtDate = latestBefore?.role || u.role;
        }

        flags.push(roleAtDate ? isPlannable(roleAtDate) : false);
      }

      result.set(u.id, {
        activeFlags: flags,
        activeMonths: flags.filter(Boolean).length,
      });
    });

    return result;
  }, [plannableUsers, aeRoleHistoryByUser, newArrYear]);

  const selectedAEInbound = useMemo(
    () => calculateFromPercentage(businessInbound, selectedAEPercentage),
    [businessInbound, selectedAEPercentage, calculateFromPercentage]
  );
  const selectedAEOutbound = useMemo(
    () => calculateFromPercentage(businessOutbound, selectedAEPercentage),
    [businessOutbound, selectedAEPercentage, calculateFromPercentage]
  );
  const selectedAEPartnerships = useMemo(
    () => calculateFromPercentage(businessPartnerships, selectedAEPercentage),
    [businessPartnerships, selectedAEPercentage, calculateFromPercentage]
  );
  const allMonthsActive = useMemo(() => new Array(12).fill(true), []);
  const selectedAEActivity = selectedAEId ? aeActivityByUser.get(selectedAEId) : null;
  const selectedAEActiveFlags = selectedAEActivity?.activeFlags ?? allMonthsActive;
  const selectedAEActiveMonths = selectedAEActivity?.activeMonths ?? 12;
  const selectedAEGoLiveTargetsRaw = useMemo(
    () => calculateTotalGoLives(selectedAEInbound, selectedAEOutbound, selectedAEPartnerships),
    [selectedAEInbound, selectedAEOutbound, selectedAEPartnerships]
  );
  const selectedAETerminalSalesRawByMonth = useMemo(
    () => selectedAEGoLiveTargetsRaw.map((v) => Math.round(v * terminalSalesPercent / 100)),
    [selectedAEGoLiveTargetsRaw, terminalSalesPercent]
  );
  const selectedAETippingRawByMonth = useMemo(
    () => selectedAETerminalSalesRawByMonth.map((v) => Math.round(v * tippingPercent / 100)),
    [selectedAETerminalSalesRawByMonth, tippingPercent]
  );
  const selectedAESubsTargetsRawByMonth = useMemo(
    () => calculateMonthlySubsTargets(selectedAEGoLiveTargetsRaw, avgSubsBill),
    [selectedAEGoLiveTargetsRaw, avgSubsBill]
  );
  const selectedAEPayTargetsRawByMonth = useMemo(
    () =>
      selectedAETerminalSalesRawByMonth.map(
        (ts, i) => (ts * avgPayBillTerminal * 12) + (selectedAETippingRawByMonth[i] * avgPayBillTipping * 12)
      ),
    [selectedAETerminalSalesRawByMonth, selectedAETippingRawByMonth, avgPayBillTerminal, avgPayBillTipping]
  );
  const selectedAERawTotalArrTarget = useMemo(
    () =>
      selectedAESubsTargetsRawByMonth.reduce(
        (sum, v, i) => (selectedAEActiveFlags[i] ? sum + (v || 0) + (selectedAEPayTargetsRawByMonth[i] || 0) : sum),
        0
      ),
    [selectedAESubsTargetsRawByMonth, selectedAEPayTargetsRawByMonth, selectedAEActiveFlags]
  );
  const selectedAEQuotaArr = useMemo(
    () =>
      calculateQuotaFromMultiple(
        calculateOtc(selectedAEBaseSalary, selectedAEVariableOTE),
        selectedAEArrMultiple
      ) * (selectedAEActiveMonths / 12),
    [selectedAEBaseSalary, selectedAEVariableOTE, selectedAEArrMultiple, selectedAEActiveMonths]
  );
  const selectedAEQuotaCalibrationFactor = useMemo(
    () => (selectedAERawTotalArrTarget > 0 ? selectedAEQuotaArr / selectedAERawTotalArrTarget : 1),
    [selectedAERawTotalArrTarget, selectedAEQuotaArr]
  );
  const selectedAEInboundCalibrated = useMemo(
    () =>
      selectedAEInbound.map((v, i) =>
        selectedAEActiveFlags[i] ? Math.max(0, Math.round((v || 0) * selectedAEQuotaCalibrationFactor)) : 0
      ),
    [selectedAEInbound, selectedAEQuotaCalibrationFactor, selectedAEActiveFlags]
  );
  const selectedAEOutboundCalibrated = useMemo(
    () =>
      selectedAEOutbound.map((v, i) =>
        selectedAEActiveFlags[i] ? Math.max(0, Math.round((v || 0) * selectedAEQuotaCalibrationFactor)) : 0
      ),
    [selectedAEOutbound, selectedAEQuotaCalibrationFactor, selectedAEActiveFlags]
  );
  const selectedAEPartnershipsCalibrated = useMemo(
    () =>
      selectedAEPartnerships.map((v, i) =>
        selectedAEActiveFlags[i] ? Math.max(0, Math.round((v || 0) * selectedAEQuotaCalibrationFactor)) : 0
      ),
    [selectedAEPartnerships, selectedAEQuotaCalibrationFactor, selectedAEActiveFlags]
  );
  const selectedAEGoLiveTargets = useMemo(
    () => calculateTotalGoLives(selectedAEInboundCalibrated, selectedAEOutboundCalibrated, selectedAEPartnershipsCalibrated),
    [selectedAEInboundCalibrated, selectedAEOutboundCalibrated, selectedAEPartnershipsCalibrated]
  );
  const selectedAEPayTerminalsByMonth = useMemo(
    () => selectedAEGoLiveTargets.map((v) => Math.round(v * payTerminalsPercent / 100)),
    [selectedAEGoLiveTargets, payTerminalsPercent]
  );
  const selectedAETerminalSalesByMonth = useMemo(
    () => selectedAEGoLiveTargets.map((v) => Math.round(v * terminalSalesPercent / 100)),
    [selectedAEGoLiveTargets, terminalSalesPercent]
  );
  const selectedAETippingByMonth = useMemo(
    () => selectedAETerminalSalesByMonth.map((v) => Math.round(v * tippingPercent / 100)),
    [selectedAETerminalSalesByMonth, tippingPercent]
  );
  const selectedAESubsTargetsByMonth = useMemo(
    () => calculateMonthlySubsTargets(selectedAEGoLiveTargets, avgSubsBill).map((v) => Math.max(0, Math.round(v || 0))),
    [selectedAEGoLiveTargets, avgSubsBill]
  );
  const selectedAEPayTargetsByMonth = useMemo(
    () =>
      selectedAETerminalSalesByMonth.map(
        (ts, i) => Math.max(0, Math.round((ts * avgPayBillTerminal * 12) + (selectedAETippingByMonth[i] * avgPayBillTipping * 12)))
      ),
    [selectedAETerminalSalesByMonth, selectedAETippingByMonth, avgPayBillTerminal, avgPayBillTipping]
  );
  const selectedAETotalArrTargetsByMonth = useMemo(
    () => selectedAESubsTargetsByMonth.map((subs, i) => (subs || 0) + (selectedAEPayTargetsByMonth[i] || 0)),
    [selectedAESubsTargetsByMonth, selectedAEPayTargetsByMonth]
  );
  const selectedAESubsArrCalibrated = useMemo(
    () => selectedAESubsTargetsByMonth.reduce((sum, v) => sum + (v || 0), 0),
    [selectedAESubsTargetsByMonth]
  );
  const selectedAEPayArrCalibrated = useMemo(
    () => selectedAEPayTargetsByMonth.reduce((sum, v) => sum + (v || 0), 0),
    [selectedAEPayTargetsByMonth]
  );
  const selectedAEGoLives = selectedAEGoLiveTargets.reduce((a, b) => a + b, 0);
  const selectedAEPayTerminals = selectedAEPayTerminalsByMonth.reduce((a, b) => a + b, 0);
  const selectedAETerminalSales = selectedAETerminalSalesByMonth.reduce((a, b) => a + b, 0);
  const selectedAETipping = selectedAETippingByMonth.reduce((a, b) => a + b, 0);
  const selectedAEInboundTotal = selectedAEInboundCalibrated.reduce((a, b) => a + b, 0);
  const selectedAEOutboundTotal = selectedAEOutboundCalibrated.reduce((a, b) => a + b, 0);
  const selectedAEPartnershipsTotal = selectedAEPartnershipsCalibrated.reduce((a, b) => a + b, 0);
  const selectedAEPenetration = selectedAEGoLives > 0 ? selectedAEPayTerminals / selectedAEGoLives : 0;

  useEffect(() => {
    if (!selectedAEId) return;
    if (lastTierGuideAEIdRef.current === selectedAEId) return;
    setTierGuideTargetPayoutAt100(Math.max(0, Math.round(selectedAEVariableOTE || 0)));
    lastTierGuideAEIdRef.current = selectedAEId;
  }, [selectedAEId, selectedAEVariableOTE]);

  const handleSelectedAEOTEChange = (ote: number) => {
    if (!selectedAEId) return;
    setAeOTEs((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, ote);
      return next;
    });
  };

  const handleSelectedAEBaseSalaryChange = (value: number) => {
    if (!selectedAEId) return;
    setAeBaseSalaries((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedAEVariableOTEChange = (value: number) => {
    if (!selectedAEId) return;
    setAeVariableOTEs((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedAEArrMultipleChange = (value: number) => {
    if (!selectedAEId) return;
    setAeArrMultiples((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedAEGrossMarginChange = (value: number) => {
    if (!selectedAEId) return;
    setAeGrossMargins((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedTerminalBaseChange = (value: number) => {
    if (!selectedAEId) return;
    setAeTerminalBase((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedTerminalBonusChange = (value: number) => {
    if (!selectedAEId) return;
    setAeTerminalBonus((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, value);
      return next;
    });
  };

  const handleSelectedSubsTierRateChange = (idx: number, ratePercent: number) => {
    if (!selectedAEId) return;
    const current = aeSubsTiers.get(selectedAEId) ?? DEFAULT_SUBS_TIERS;
    const nextTiers = [...current];
    nextTiers[idx] = { ...nextTiers[idx], rate: ratePercent / 100 };
    setAeSubsTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, nextTiers);
      return next;
    });
  };

  const handleSelectedPayTierRateChange = (idx: number, ratePercent: number) => {
    if (!selectedAEId) return;
    const current = aePayTiers.get(selectedAEId) ?? DEFAULT_PAY_TIERS;
    const nextTiers = [...current];
    nextTiers[idx] = { ...nextTiers[idx], rate: ratePercent / 100 };
    setAePayTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, nextTiers);
      return next;
    });
  };

  const handleSelectedTotalArrTierRateChange = (idx: number, ratePercent: number) => {
    if (!selectedAEId) return;
    const current = aeTotalArrTiers.get(selectedAEId) ?? DEFAULT_TOTAL_ARR_TIERS;
    const nextTiers = [...current];
    nextTiers[idx] = { ...nextTiers[idx], rate: ratePercent / 100 };
    setAeTotalArrTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, nextTiers);
      return next;
    });
    // Legacy-Felder synchron halten, solange sie noch verwendet werden.
    setAeSubsTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, nextTiers);
      return next;
    });
    setAePayTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, nextTiers);
      return next;
    });
  };

  const previewSettings: AESettings = {
    id: 'preview',
    user_id: selectedAEId || '',
    year: newArrYear,
    region: newArrRegion,
    ote: selectedAEOTE,
    base_salary: selectedAEBaseSalary,
    variable_ote: selectedAEVariableOTE,
    arr_multiple: selectedAEArrMultiple,
    gross_margin_pct: selectedAEGrossMargin,
    active_months_in_year: selectedAEActiveMonths,
    monthly_go_live_targets: selectedAEGoLiveTargets,
    monthly_subs_targets: selectedAESubsTargetsByMonth,
    monthly_pay_targets: selectedAEPayTargetsByMonth,
    monthly_total_arr_targets: selectedAETotalArrTargetsByMonth,
    monthly_inbound_targets: selectedAEInboundCalibrated,
    monthly_outbound_targets: selectedAEOutboundCalibrated,
    monthly_partnerships_targets: selectedAEPartnershipsCalibrated,
    target_percentage: selectedAEPercentage,
    avg_subs_bill: avgSubsBill,
    avg_pay_bill: avgPayBillTerminal,
    avg_pay_bill_tipping: avgPayBillTipping,
    pay_arr_factor: 0,
    terminal_base: selectedTerminalBase,
    terminal_bonus: selectedTerminalBonus,
    terminal_penetration_threshold: terminalPenetrationThreshold / 100,
    subs_tiers: selectedTotalArrTiers,
    pay_tiers: selectedTotalArrTiers,
    total_arr_tiers: selectedTotalArrTiers,
    created_at: '',
    updated_at: ''
  };
  const oteValidation = validateOTESettings(previewSettings, selectedAEPayTerminals);
  const oteProjections = calculateOTEProjections(previewSettings, selectedAEPayTerminals);
  const multipleCalibration = calculateMultipleCalibration(previewSettings, selectedAEPayTerminals);
  const tierGuideProfileFactors: Record<'conservative' | 'balanced' | 'aggressive', number[]> = {
    conservative: [0, 0.2, 0.35, 0.6, 1.0, 1.25, 1.6],
    balanced: [0, 0.25, 0.45, 0.75, 1.0, 1.45, 2.0],
    aggressive: [0, 0.3, 0.55, 0.85, 1.1, 1.7, 2.4],
  };
  const tierGuideArrPoolAt100 = useMemo(
    () => Math.max(0, tierGuideTargetPayoutAt100 - multipleCalibration.terminalProvisionAt100),
    [tierGuideTargetPayoutAt100, multipleCalibration.terminalProvisionAt100]
  );
  const tierGuideBaseRateAt100 = useMemo(
    () => (multipleCalibration.totalArrTarget > 0 ? tierGuideArrPoolAt100 / multipleCalibration.totalArrTarget : 0),
    [tierGuideArrPoolAt100, multipleCalibration.totalArrTarget]
  );
  const suggestedTotalArrTiers = useMemo(() => {
    const factors = tierGuideProfileFactors[tierGuideProfile];
    return selectedTotalArrTiers.map((tier, index) => {
      const factor = factors[Math.min(index, factors.length - 1)] ?? 1;
      return {
        ...tier,
        rate: Math.max(0, Number((tierGuideBaseRateAt100 * factor).toFixed(4))),
      };
    });
  }, [selectedTotalArrTiers, tierGuideBaseRateAt100, tierGuideProfile]);
  const tierGuideCurrentRateAt100 = useMemo(
    () => getProvisionRate(1.0, selectedTotalArrTiers),
    [selectedTotalArrTiers]
  );
  const tierGuideSuggestedRateAt100 = useMemo(
    () => getProvisionRate(1.0, suggestedTotalArrTiers),
    [suggestedTotalArrTiers]
  );
  const tierGuideCurrentPayoutAt100 = multipleCalibration.expectedTotalPayoutAt100;
  const tierGuideSuggestedPayoutAt100 = useMemo(
    () => (multipleCalibration.totalArrTarget * tierGuideSuggestedRateAt100) + multipleCalibration.terminalProvisionAt100,
    [multipleCalibration.totalArrTarget, tierGuideSuggestedRateAt100, multipleCalibration.terminalProvisionAt100]
  );
  const tierGuideSuggestedRateAt120 = useMemo(
    () => getProvisionRate(1.2, suggestedTotalArrTiers),
    [suggestedTotalArrTiers]
  );
  const tierGuideDefaultRateAt120 = useMemo(
    () => getProvisionRate(1.2, DEFAULT_TOTAL_ARR_TIERS),
    []
  );
  const tierGuideSuggestedPayoutAt120 = useMemo(
    () => (multipleCalibration.totalArrTarget * 1.2 * tierGuideSuggestedRateAt120) + multipleCalibration.terminalProvisionAt100,
    [multipleCalibration.totalArrTarget, tierGuideSuggestedRateAt120, multipleCalibration.terminalProvisionAt100]
  );
  const tierGuideDefaultPayoutAt120 = useMemo(
    () => (multipleCalibration.totalArrTarget * 1.2 * tierGuideDefaultRateAt120) + multipleCalibration.terminalProvisionAt100,
    [multipleCalibration.totalArrTarget, tierGuideDefaultRateAt120, multipleCalibration.terminalProvisionAt100]
  );
  const tierGuideArrGainAt120 = useMemo(
    () => Math.max(0, (multipleCalibration.totalArrTarget * 1.2) - multipleCalibration.totalArrTarget),
    [multipleCalibration.totalArrTarget]
  );
  const tierGuideExtraPayoutVsDefaultAt120 = useMemo(
    () => tierGuideSuggestedPayoutAt120 - tierGuideDefaultPayoutAt120,
    [tierGuideSuggestedPayoutAt120, tierGuideDefaultPayoutAt120]
  );
  const handleApplyTierGuideSuggestion = () => {
    if (!selectedAEId) return;
    setAeTotalArrTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, suggestedTotalArrTiers);
      return next;
    });
    // Legacy-Felder synchron halten, solange sie noch verwendet werden.
    setAeSubsTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, suggestedTotalArrTiers);
      return next;
    });
    setAePayTiers((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, suggestedTotalArrTiers);
      return next;
    });
  };
  const whatIfRequiredMarginPct = useMemo(
    () => calculateRequiredGrossMarginPctForPayback(multipleCalibration.otc, multipleCalibration.quotaArr, whatIfTargetPaybackMonths),
    [multipleCalibration.otc, multipleCalibration.quotaArr, whatIfTargetPaybackMonths]
  );
  const whatIfRequiredMultiple = useMemo(
    () => calculateRequiredArrMultipleForPayback(selectedAEGrossMargin, whatIfTargetPaybackMonths, selectedAEActiveMonths),
    [selectedAEGrossMargin, whatIfTargetPaybackMonths, selectedAEActiveMonths]
  );
  const paybackBenchmark = useMemo(() => {
    if (whatIfAcv < 15000) {
      return {
        segment: 'SMB',
        sliderMin: 2,
        sliderMax: 12,
        excellentMax: 6,
        goodMax: 9,
        normalMax: 12,
      };
    }
    if (whatIfAcv < 100000) {
      return {
        segment: 'Mid-Market',
        sliderMin: 3,
        sliderMax: 24,
        excellentMax: 10,
        goodMax: 16,
        normalMax: 24,
      };
    }
    return {
      segment: 'Enterprise',
      sliderMin: 4,
      sliderMax: 30,
      excellentMax: 12,
      goodMax: 20,
      normalMax: 30,
    };
  }, [whatIfAcv]);

  const whatIfPaybackRating = useMemo(() => {
    const v = whatIfTargetPaybackMonths;
    if (v <= paybackBenchmark.excellentMax) return { label: 'Ausgezeichnet', color: 'text-emerald-700' };
    if (v <= paybackBenchmark.goodMax) return { label: 'Gut', color: 'text-green-700' };
    if (v <= paybackBenchmark.normalMax) return { label: 'Normal', color: 'text-amber-700' };
    return { label: 'Kritisch', color: 'text-red-700' };
  }, [whatIfTargetPaybackMonths, paybackBenchmark]);

  const canApplyWhatIf =
    whatIfSolveFor === 'margin'
      ? whatIfRequiredMarginPct !== null && whatIfRequiredMarginPct > 0 && whatIfRequiredMarginPct <= 100
      : whatIfRequiredMultiple !== null && whatIfRequiredMultiple > 0;

  const handleApplyWhatIf = () => {
    if (!selectedAEId) return;
    if (whatIfSolveFor === 'margin' && whatIfRequiredMarginPct !== null && whatIfRequiredMarginPct > 0) {
      handleSelectedAEGrossMarginChange(Math.round(whatIfRequiredMarginPct * 10) / 10);
      return;
    }
    if (whatIfSolveFor === 'multiple' && whatIfRequiredMultiple !== null && whatIfRequiredMultiple > 0) {
      handleSelectedAEArrMultipleChange(Math.round(whatIfRequiredMultiple * 100) / 100);
    }
  };

  useEffect(() => {
    if (!selectedAEId) return;
    if (Number.isFinite(multipleCalibration.paybackMonths) && multipleCalibration.paybackMonths > 0) {
      const roundedCurrent = Math.round(multipleCalibration.paybackMonths * 10) / 10;
      setWhatIfTargetPaybackMonths(Math.min(paybackBenchmark.sliderMax, Math.max(paybackBenchmark.sliderMin, roundedCurrent)));
    }
  }, [selectedAEId, multipleCalibration.paybackMonths, paybackBenchmark.sliderMin, paybackBenchmark.sliderMax]);

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4"></div>
            <p className="text-gray-500">{t('ui.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Title */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
          <span className="text-3xl">⚙️</span>
          {t('dlt.settings.title')}
        </h1>
        <p className="text-gray-500 mt-1">{t('dlt.settings.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-white text-gray-800 border border-b-white border-gray-200 -mb-[3px]'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('dlt.settings.searchUsers')}
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('dlt.settings.searchPlaceholder')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('dlt.settings.filterByRole')}
                </label>
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent"
                >
                  <option value="all">{t('dlt.settings.allRoles')}</option>
                  {availableRoles.map(role => (
                    <option key={role} value={role}>{getRoleLabel(role)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                {t('dlt.settings.userList')} ({filteredUsers.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.settings.name')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.settings.email')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.settings.role')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.settings.region')}</th>
                    {permissions.manageUsers && (
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aktionen</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredUsers.map((u) => (
                    <tr
                      key={u.id}
                      className={`${u.exit_date && !plannedRoleChanges[u.id] ? 'bg-red-100 hover:bg-red-200 italic text-gray-700' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{u.name}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                          {getRoleLabel(u.role)}
                        </span>
                        {plannedRoleChanges[u.id] && (
                          <div className="mt-1">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
                              Rollenwechsel geplant ab {new Date(plannedRoleChanges[u.id].effective_from).toLocaleDateString('de-DE')}
                            </span>
                          </div>
                        )}
                        {u.exit_date && !plannedRoleChanges[u.id] && (
                          <div className="mt-1">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
                              Austritt gesetzt: {new Date(u.exit_date).toLocaleDateString('de-DE')}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{u.region || '-'}</td>
                      {permissions.manageUsers && (
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openUserEdit(u)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            ✏️ Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredUsers.length === 0 && (
              <div className="px-6 py-12 text-center text-gray-500">
                {t('dlt.settings.noUsers')}
              </div>
            )}
          </div>

          {/* Role Summary */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.settings.roleSummary')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(usersByRole).map(([role, roleUsers]) => (
                <div key={role} className="p-4 rounded-lg bg-gray-50">
                  <div className="text-2xl font-bold text-gray-800">{roleUsers.length}</div>
                  <div className="text-sm text-gray-500">{getRoleLabel(role)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* User Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">User Stammdaten bearbeiten</h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              {userEditError && (
                <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{userEditError}</div>
              )}

              <div>
                <label className="block text-sm text-gray-700 mb-1">Name</label>
                <input
                  value={userEditData.name}
                  onChange={(e) => setUserEditData({ ...userEditData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-1">Region</label>
                <input
                  value={userEditData.region}
                  onChange={(e) => setUserEditData({ ...userEditData, region: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Mitarbeiter-ID</label>
                  <input
                    value={userEditData.employee_id}
                    onChange={(e) => setUserEditData({ ...userEditData, employee_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Telefon</label>
                  <input
                    value={userEditData.phone}
                    onChange={(e) => setUserEditData({ ...userEditData, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Start-Datum</label>
                  <input
                    type="date"
                    value={userEditData.start_date}
                    onChange={(e) => setUserEditData({ ...userEditData, start_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Eintrittsdatum</label>
                  <input
                    type="date"
                    value={userEditData.entry_date}
                    onChange={(e) => setUserEditData({ ...userEditData, entry_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">Austrittsdatum</label>
                  <input
                    type="date"
                    value={userEditData.exit_date}
                    onChange={(e) => setUserEditData({ ...userEditData, exit_date: e.target.value, is_active: e.target.value ? false : userEditData.is_active })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={userEditData.is_active}
                      disabled={!!userEditData.exit_date}
                      onChange={(e) => setUserEditData({ ...userEditData, is_active: e.target.checked })}
                      className="mr-2"
                    />
                    Aktiv
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-1">Manager</label>
                <select
                  value={userEditData.manager_id}
                  onChange={(e) => setUserEditData({ ...userEditData, manager_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Kein Manager</option>
                  {possibleManagers
                    .filter((m) => m.id !== editingUser.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({getRoleLabel(m.role)})
                      </option>
                    ))}
                </select>
              </div>

              {/* Rollenwechsel + Historie */}
              <div className="pt-2 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Rollenhistorie</h4>

                {permissions.assignRoles ? (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Neue Rolle</label>
                      <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        {roleSelectionOptions.map((role) => (
                          <option key={role} value={role}>
                            {getRoleLabel(role)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Gültig ab</label>
                      <input
                        type="date"
                        value={roleEffectiveFrom}
                        onChange={(e) => setRoleEffectiveFrom(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mb-2">Du hast keine Berechtigung für Rollenänderungen.</p>
                )}

                {roleHistory.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-2 py-1 text-gray-500">Rolle</th>
                          <th className="text-left px-2 py-1 text-gray-500">Von</th>
                          <th className="text-left px-2 py-1 text-gray-500">Bis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roleHistory.map((entry) => (
                          <tr key={entry.id} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-700">{getRoleLabel(entry.role)}</td>
                            <td className="px-2 py-1 text-gray-600">{new Date(entry.effective_from).toLocaleDateString('de-DE')}</td>
                            <td className="px-2 py-1 text-gray-600">
                              {entry.effective_to ? new Date(entry.effective_to).toLocaleDateString('de-DE') : 'Heute'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Noch keine Rollenhistorie vorhanden.</p>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                onClick={saveUserStammdaten}
                disabled={savingUser}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {savingUser ? 'Speichere...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Imports Tab */}
      {activeTab === 'imports' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveImportSubTab('newBusinessGoLives')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'newBusinessGoLives'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                +New Business Go-Lives
              </button>
              <button
                onClick={() => setActiveImportSubTab('churnImports')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'churnImports'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Churn - Importe
              </button>
              <button
                onClick={() => setActiveImportSubTab('upDownsellsImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'upDownsellsImport'
                    ? 'bg-purple-50 border-purple-300 text-purple-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Up-Downsells Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('smsImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'smsImport'
                    ? 'bg-violet-50 border-violet-300 text-violet-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                SMS-Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('salespipeImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'salespipeImport'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Salespipe Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('salespipe2Import')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'salespipe2Import'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Salespipe Import 2
              </button>
              <button
                onClick={() => setActiveImportSubTab('leadsImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'leadsImport'
                    ? 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Leads Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('signupsImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'signupsImport'
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                DACH Sign-ups Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('paymarginImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'paymarginImport'
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Paymargin CSV Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('payStripeTerminalInstallationImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'payStripeTerminalInstallationImport'
                    ? 'bg-pink-50 border-pink-300 text-pink-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Pay Stripe Terminal Installation Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('phorestPayRevenueImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'phorestPayRevenueImport'
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Phorest Pay Revenue Import
              </button>
              <button
                onClick={() => setActiveImportSubTab('lookerLeadsImport')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                  activeImportSubTab === 'lookerLeadsImport'
                    ? 'bg-teal-50 border-teal-300 text-teal-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Looker Leads Import
              </button>
            </div>
          </div>

          {activeImportSubTab === 'newBusinessGoLives' && (
            <>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Manuelle Go-Live-Erfassung</h3>
            <p className="text-sm text-gray-500 mb-4">
              Die manuelle Eingabe wurde aus dem New-Business-Bereich hierher verlagert.
            </p>
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700">Schreibschutz manuelle Go-Live-Erfassung</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={manualGoLiveWriteLocked}
                  disabled={
                    manualGoLiveWriteLockLoading ||
                    manualGoLiveWriteLockSaving ||
                    !canToggleManualGoLiveWriteLock
                  }
                  onChange={(e) => handleManualGoLiveWriteLockToggle(e.target.checked)}
                />
              </label>
              <div className="text-xs text-gray-500 space-y-1">
                <div>
                  Status: {manualGoLiveWriteLocked ? 'Aktiv (gesperrt)' : 'Inaktiv (freigegeben)'}
                </div>
                {!canToggleManualGoLiveWriteLock ? (
                  <div>Nur Country Manager kann den Schreibschutz aendern.</div>
                ) : null}
                {manualGoLiveWriteLockLoading ? <div>Status wird geladen...</div> : null}
                {manualGoLiveWriteLockSaving ? <div>Status wird gespeichert...</div> : null}
                {manualGoLiveWriteLockMessage ? <div>{manualGoLiveWriteLockMessage}</div> : null}
              </div>
            </div>
            {goLiveSaveMessage && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                {goLiveSaveMessage}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <div className="max-w-2xl">
              <GoLiveForm
                onSubmit={handleManualGoLiveSubmit}
                onCancel={() => {}}
                canEnterPayARR={permissions.enterPayARR}
                defaultCommissionRelevant={getDefaultCommissionRelevant(selectedGoLiveTargetUser.role)}
                currentUser={user}
                targetUserId={goLiveUserId}
                avgPayBillTerminal={avgPayBillTerminal}
                assignableUsers={assignableGoLiveUsers}
                selectedUserId={goLiveUserId}
                onSelectedUserChange={setGoLiveUserId}
                readOnly={manualGoLiveWriteLocked}
                readOnlyReason="Manuelle Go-Live-Erfassung ist aktuell schreibgeschuetzt."
              />
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Google-Sheet Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe eingehende Go-Live-Daten als Stapel und entscheide dann ueber den Import.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setGoLiveImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    goLiveImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setGoLiveImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    goLiveImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={autoImportEnabled}
                  disabled={autoImportLoading || autoImportSaving}
                  onChange={(e) => handleAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>
                  Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.
                </div>
                {autoImportLoading ? <div>Status wird geladen...</div> : null}
                {autoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {autoImportMessage ? <div>{autoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunGoLiveBatchCheck}
                  disabled={batchLoading || batchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {batchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunGoLiveBatchImport}
                  disabled={batchImportLoading || batchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {batchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {batchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {batchError}
                </div>
              )}

              {batchImportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {batchImportError}
                </div>
              )}

              {batchImportResult?.stats && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{batchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{batchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{batchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{batchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Duplikate im Sheet</div>
                      <div className="font-semibold text-amber-700">{batchImportResult.stats.duplicates}</div>
                    </div>
                  </div>
                </div>
              )}

              {batchResult?.stats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Sheet Zeilen</div>
                      <div className="text-xl font-semibold">{batchResult.stats.totalRowsFromSheet}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Geparst</div>
                      <div className="text-xl font-semibold">{batchResult.stats.parsedRows}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{batchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{batchResult.stats.invalidRows}</div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">Feld-Mapping (Sheet -&gt; Datenbank)</h5>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Sheet-Spalte</th>
                              <th className="text-left px-2 py-2 text-gray-600">DB-Feld</th>
                              <th className="text-left px-2 py-2 text-gray-600">Transformation</th>
                              <th className="text-left px-2 py-2 text-gray-600">Pflicht</th>
                            </tr>
                          </thead>
                          <tbody>
                            {GO_LIVE_BATCH_FIELD_MAPPING.map((row) => (
                              <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{row.source}</td>
                                <td className="px-2 py-1.5 text-gray-700 font-mono">{row.target}</td>
                                <td className="px-2 py-1.5 text-gray-600">{row.transform}</td>
                                <td className="px-2 py-1.5">
                                  {row.required ? (
                                    <span className="inline-flex items-center rounded bg-red-50 text-red-700 px-2 py-0.5">Ja</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded bg-gray-100 text-gray-600 px-2 py-0.5">Nein</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {batchResult.preview?.valid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Import-Vorschau (normalisierte Werte)</h5>
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                                <th className="text-left px-2 py-2 text-gray-600">Oak ID</th>
                                <th className="text-left px-2 py-2 text-gray-600">Kunde</th>
                                <th className="text-left px-2 py-2 text-gray-600">Go-Live</th>
                                <th className="text-left px-2 py-2 text-gray-600">Subs/Monat</th>
                                <th className="text-left px-2 py-2 text-gray-600">Subs ARR</th>
                                <th className="text-left px-2 py-2 text-gray-600">Terminal</th>
                                <th className="text-left px-2 py-2 text-gray-600">Partnership</th>
                                <th className="text-left px-2 py-2 text-gray-600">Partnerschaftsname</th>
                                <th className="text-left px-2 py-2 text-gray-600">Pay ARR</th>
                                <th className="text-left px-2 py-2 text-gray-600">Prov.-relevant</th>
                                <th className="text-left px-2 py-2 text-gray-600">Enterprise</th>
                                <th className="text-left px-2 py-2 text-gray-600">AE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batchResult.preview.valid.slice(0, 12).map((row) => (
                                <tr key={row.rowNumber} className="border-t border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-700">{row.rowNumber}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.oakId ?? '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.customerName || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{formatBatchPreviewDate(row.goLiveDate)}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.monthlySubs ?? '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {row.monthlySubs !== null && row.monthlySubs !== undefined
                                      ? Math.round(row.monthlySubs * 12)
                                      : '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{formatBatchPreviewBoolean(row.hasTerminal)}</td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {formatBatchPreviewBoolean(row.partnershipsEnabled)}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.partnershipName || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.payValueAfter3Month ?? '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {formatBatchPreviewBoolean(row.commissionRelevant)}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{formatBatchPreviewBoolean(row.enterprise)}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.ae || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Vorschau zeigt die ersten 12 geparsten Zeilen aus dem Dry-Run.
                      </p>
                    </div>
                  ) : null}

                  {batchResult.warnings?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-amber-800 mb-2">Warnungen beim Mapping</h5>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {batchResult.warnings.slice(0, 8).map((w, idx) => (
                          <div
                            key={`${w.rowNumber}-${w.oakId}-${idx}`}
                            className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"
                          >
                            <div className="font-medium text-amber-800">
                              Zeile {w.rowNumber > 0 ? w.rowNumber : '-'} {w.oakId ? `- OAK ${w.oakId}` : ''}
                            </div>
                            <div className="text-amber-700">{w.warning}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {goLiveImportMode === 'manual' && batchResult.preview?.invalid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Beispiele fehlerhafte Zeilen</h5>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {batchResult.preview.invalid.slice(0, 6).map((row) => (
                          <div key={row.rowNumber} className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs">
                            <div className="font-medium text-red-700">
                              Zeile {row.rowNumber} - {row.raw.customerName || 'Ohne Kundenname'}
                            </div>
                            <div className="text-red-600">{row.reasons.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadImportHistory}
                    disabled={importHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {importHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {importHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {importHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Duplikate</div>
                        <div>{latestAutoRun.duplicates}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>{latestAutoRun.reason || (latestAutoRun.skipped ? 'Skipped' : '-')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {importRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                            <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">
                                {new Date(run.started_at).toLocaleString('de-DE')}
                              </td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                              <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedImportRunId && selectedImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">OAK</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.oak_id ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
            </>
          )}

          {activeImportSubTab === 'churnImports' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-1">Churn Drive Import-Übersicht (Datenbank)</h4>
                  <p className="text-sm text-gray-500">
                    Der alte Google-Sheet-Churn-Import wurde entfernt. Hier siehst du die importierten Churn-Dateien aus der
                    Datenbank-Historie.
                  </p>
                </div>
                <button
                  onClick={loadChurnImportHistory}
                  disabled={churnImportHistoryLoading}
                  className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {churnImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setChurnImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    churnImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setChurnImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    churnImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={churnAutoImportEnabled}
                  disabled={churnAutoImportLoading || churnAutoImportSaving}
                  onChange={(e) => handleChurnAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {churnAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {churnAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {churnAutoImportMessage ? <div>{churnAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunChurnBatchCheck}
                  disabled={churnBatchLoading || churnBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {churnBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunChurnBatchImport}
                  disabled={churnBatchImportLoading || churnBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {churnBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastChurnBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastChurnBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastChurnBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastChurnBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {churnBatchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{churnBatchError}</div>
              )}

              {churnBatchImportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {churnBatchImportError}
                </div>
              )}

              {churnBatchImportResult?.stats && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{churnBatchImportResult.stats.imported ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{churnBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{churnBatchImportResult.stats.failed ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Client List</div>
                      <div className="font-semibold">{churnBatchImportResult.stats.clientListRows ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Scheduled Detail</div>
                      <div className="font-semibold">{churnBatchImportResult.stats.scheduledDetailRows ?? 0}</div>
                    </div>
                  </div>
                </div>
              )}

              {churnBatchResult?.stats && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <h5 className="text-sm font-semibold text-gray-700 mb-2">Dry-Run Ergebnis</h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-gray-50 border p-2">
                      <div className="text-gray-500">ZIP Entries</div>
                      <div className="font-semibold">{churnBatchResult.stats.zipEntries ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-50 border p-2">
                      <div className="text-gray-500">Client List Rows</div>
                      <div className="font-semibold">{churnBatchResult.stats.clientListRows ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-50 border p-2">
                      <div className="text-gray-500">Scheduled Detail Rows</div>
                      <div className="font-semibold">{churnBatchResult.stats.scheduledDetailRows ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-50 border p-2">
                      <div className="text-gray-500">Summary Rows</div>
                      <div className="font-semibold">{churnBatchResult.stats.summaryRows ?? 0}</div>
                    </div>
                  </div>
                </div>
              )}

              {churnImportHistoryError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {churnImportHistoryError}
                </div>
              ) : null}

              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                {latestChurnAutoRun ? (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                    <div>
                      <div className="text-indigo-700">Zeitpunkt</div>
                      <div>{new Date(latestChurnAutoRun.started_at).toLocaleString('de-DE')}</div>
                    </div>
                    <div>
                      <div className="text-indigo-700">Status</div>
                      <div>{getImportRunStatusLabel(latestChurnAutoRun.status)}</div>
                    </div>
                    <div>
                      <div className="text-indigo-700">Importiert</div>
                      <div>{latestChurnAutoRun.imported}</div>
                    </div>
                    <div>
                      <div className="text-indigo-700">Fehler</div>
                      <div>{latestChurnAutoRun.failed}</div>
                    </div>
                    <div>
                      <div className="text-indigo-700">Duplikate</div>
                      <div>{latestChurnAutoRun.duplicates ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-indigo-700">Hinweis</div>
                      <div>{latestChurnAutoRun.hint || latestChurnAutoRun.reason || '-'}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                )}
              </div>

              {churnImportRuns.length === 0 ? (
                <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                  Noch keine Churn-Import-Läufe protokolliert.
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-2 text-gray-600">Datei</th>
                          <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                          <th className="text-left px-2 py-2 text-gray-600">Status</th>
                          <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                          <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                          <th className="text-left px-2 py-2 text-gray-600">Hinweis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {churnImportRuns.map((run) => (
                          <tr
                            key={run.id}
                            onClick={() => setSelectedChurnImportRunId(run.id)}
                            className={`border-t border-gray-100 cursor-pointer ${
                              selectedChurnImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-2 py-1.5 text-gray-700">{run.source_file_name || '-'}</td>
                            <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                            <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                            <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                            <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            <td className="px-2 py-1.5 text-amber-700">{run.duplicates ?? 0}</td>
                            <td className="px-2 py-1.5 text-gray-700">{run.hint || run.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedChurnImportRunId && selectedChurnImportRunItems.length > 0 ? (
                <div>
                  <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Level</th>
                            <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedChurnImportRunItems.slice(0, 200).map((item) => (
                            <tr key={item.id} className="border-t border-gray-100">
                              <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                              <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {activeImportSubTab === 'upDownsellsImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Google-Sheet Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe eingehende Up-/Downsell-Daten als Stapel und entscheide dann ueber den Import.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setUpDownsellsImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    upDownsellsImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setUpDownsellsImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    upDownsellsImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={upDownsellsAutoImportEnabled}
                  disabled={upDownsellsAutoImportLoading || upDownsellsAutoImportSaving}
                  onChange={(e) => handleUpDownsellsAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {upDownsellsAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {upDownsellsAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {upDownsellsAutoImportMessage ? <div>{upDownsellsAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunUpDownsellsBatchCheck}
                  disabled={upDownsellsBatchLoading || upDownsellsBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {upDownsellsBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunUpDownsellsBatchImport}
                  disabled={upDownsellsBatchImportLoading || upDownsellsBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {upDownsellsBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastUpDownsellsBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastUpDownsellsBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastUpDownsellsBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastUpDownsellsBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {upDownsellsBatchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {upDownsellsBatchError}
                </div>
              )}

              {upDownsellsBatchImportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {upDownsellsBatchImportError}
                </div>
              )}

              {upDownsellsBatchImportResult?.stats && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{upDownsellsBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{upDownsellsBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{upDownsellsBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{upDownsellsBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Duplikate im Sheet</div>
                      <div className="font-semibold text-amber-700">{upDownsellsBatchImportResult.stats.duplicates}</div>
                    </div>
                  </div>
                </div>
              )}

              {upDownsellsBatchResult?.stats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Sheet Zeilen</div>
                      <div className="text-xl font-semibold">{upDownsellsBatchResult.stats.totalRowsFromSheet}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Geparst</div>
                      <div className="text-xl font-semibold">{upDownsellsBatchResult.stats.parsedRows}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{upDownsellsBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{upDownsellsBatchResult.stats.invalidRows}</div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">Feld-Mapping (Sheet -&gt; Datenbank)</h5>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Sheet-Spalte</th>
                              <th className="text-left px-2 py-2 text-gray-600">DB-Feld</th>
                              <th className="text-left px-2 py-2 text-gray-600">Transformation</th>
                              <th className="text-left px-2 py-2 text-gray-600">Pflicht</th>
                            </tr>
                          </thead>
                          <tbody>
                            {UP_DOWNSELLS_BATCH_FIELD_MAPPING.map((row) => (
                              <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{row.source}</td>
                                <td className="px-2 py-1.5 text-gray-700 font-mono">{row.target}</td>
                                <td className="px-2 py-1.5 text-gray-600">{row.transform}</td>
                                <td className="px-2 py-1.5">
                                  {row.required ? (
                                    <span className="inline-flex items-center rounded bg-red-50 text-red-700 px-2 py-0.5">Ja</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded bg-gray-100 text-gray-600 px-2 py-0.5">Nein</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {upDownsellsBatchResult.preview?.valid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Import-Vorschau (normalisierte Werte)</h5>
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                                <th className="text-left px-2 py-2 text-gray-600">Oak ID</th>
                                <th className="text-left px-2 py-2 text-gray-600">Kunde</th>
                                <th className="text-left px-2 py-2 text-gray-600">Monat</th>
                                <th className="text-left px-2 py-2 text-gray-600">Net Growth ARR</th>
                                <th className="text-left px-2 py-2 text-gray-600">Net Loss ARR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {upDownsellsBatchResult.preview.valid.slice(0, 12).map((row) => (
                                <tr key={row.rowNumber} className="border-t border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-700">{row.rowNumber}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.oakId ?? '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.customerName || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{formatBatchPreviewMonth(row.eventMonth)}</td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {row.netGrowthArr !== null && row.netGrowthArr !== undefined
                                      ? formatCurrency(row.netGrowthArr)
                                      : '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {row.netLossArr !== null && row.netLossArr !== undefined
                                      ? formatCurrency(row.netLossArr)
                                      : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Vorschau zeigt die ersten 12 geparsten Zeilen aus dem Dry-Run.
                      </p>
                    </div>
                  ) : null}

                  {upDownsellsImportMode === 'manual' && upDownsellsBatchResult.preview?.invalid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Beispiele fehlerhafte Zeilen</h5>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {upDownsellsBatchResult.preview.invalid.slice(0, 6).map((row) => (
                          <div key={row.rowNumber} className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs">
                            <div className="font-medium text-red-700">
                              Zeile {row.rowNumber} - {row.raw.customerName || 'Ohne Kundenname'}
                            </div>
                            <div className="text-red-600">{row.reasons.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadUpDownsellsImportHistory}
                    disabled={upDownsellsImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {upDownsellsImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {upDownsellsImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {upDownsellsImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestUpDownsellsAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestUpDownsellsAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestUpDownsellsAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestUpDownsellsAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestUpDownsellsAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Duplikate</div>
                        <div>{latestUpDownsellsAutoRun.duplicates}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>{latestUpDownsellsAutoRun.reason || (latestUpDownsellsAutoRun.skipped ? 'Skipped' : '-')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {upDownsellsImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                            <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upDownsellsImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedUpDownsellsImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedUpDownsellsImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">
                                {new Date(run.started_at).toLocaleString('de-DE')}
                              </td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                              <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedUpDownsellsImportRunId && selectedUpDownsellsImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">OAK</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedUpDownsellsImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.oak_id ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'smsImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Google-Drive Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe neue SMS-CSV-Dateien aus dem Drive-Ordner und entscheide dann ueber den Import.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSmsImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    smsImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setSmsImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    smsImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={smsAutoImportEnabled}
                  disabled={smsAutoImportLoading || smsAutoImportSaving}
                  onChange={(e) => handleSmsAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {smsAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {smsAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {smsAutoImportMessage ? <div>{smsAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunSmsBatchCheck}
                  disabled={smsBatchLoading || smsBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {smsBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunSmsBatchImport}
                  disabled={smsBatchImportLoading || smsBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {smsBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastSmsBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastSmsBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastSmsBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastSmsBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {smsBatchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {smsBatchError}
                </div>
              )}

              {smsBatchImportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {smsBatchImportError}
                </div>
              )}

              {smsBatchImportResult?.stats && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{smsBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{smsBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{smsBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{smsBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Duplikate</div>
                      <div className="font-semibold text-amber-700">{smsBatchImportResult.stats.duplicates}</div>
                    </div>
                  </div>
                </div>
              )}

              {smsBatchResult?.stats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Datei-Zeilen</div>
                      <div className="text-xl font-semibold">{smsBatchResult.stats.totalRowsFromFile}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{smsBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{smsBatchResult.stats.invalidRows}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Quelldatei</div>
                      <div className="text-sm font-semibold break-all">{smsBatchResult.sourceFile?.name || '-'}</div>
                    </div>
                  </div>

                  {smsBatchResult.preview?.valid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Import-Vorschau (erste Zeilen)</h5>
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                                <th className="text-left px-2 py-2 text-gray-600">Daten</th>
                              </tr>
                            </thead>
                            <tbody>
                              {smsBatchResult.preview.valid.slice(0, 12).map((row) => (
                                <tr key={row.rowNumber} className="border-t border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-700">{row.rowNumber}</td>
                                  <td className="px-2 py-1.5 text-gray-700 font-mono text-[11px]">
                                    {JSON.stringify(row.payload)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadSmsImportHistory}
                    disabled={smsImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {smsImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {smsImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {smsImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestSmsAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestSmsAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestSmsAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestSmsAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestSmsAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Duplikate</div>
                        <div>{latestSmsAutoRun.duplicates}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>{latestSmsAutoRun.reason || (latestSmsAutoRun.skipped ? 'Skipped' : '-')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {smsImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Datei</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {smsImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedSmsImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedSmsImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.source_file_name || '-'}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedSmsImportRunId && selectedSmsImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedSmsImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'payStripeTerminalInstallationImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Google-Drive ZIP Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe neue ZIP-Dateien aus dem Drive-Ordner und importiere die entpackte CSV in die Datenbank.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPayStripeTerminalInstallationImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    payStripeTerminalInstallationImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setPayStripeTerminalInstallationImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    payStripeTerminalInstallationImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={payStripeTerminalInstallationAutoImportEnabled}
                  disabled={
                    payStripeTerminalInstallationAutoImportLoading ||
                    payStripeTerminalInstallationAutoImportSaving
                  }
                  onChange={(e) => handlePayStripeTerminalInstallationAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {payStripeTerminalInstallationAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {payStripeTerminalInstallationAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {payStripeTerminalInstallationAutoImportMessage ? (
                  <div>{payStripeTerminalInstallationAutoImportMessage}</div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunPayStripeTerminalInstallationBatchCheck}
                  disabled={payStripeTerminalInstallationBatchLoading || payStripeTerminalInstallationBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {payStripeTerminalInstallationBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunPayStripeTerminalInstallationBatchImport}
                  disabled={payStripeTerminalInstallationBatchImportLoading || payStripeTerminalInstallationBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {payStripeTerminalInstallationBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastPayStripeTerminalInstallationBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastPayStripeTerminalInstallationBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastPayStripeTerminalInstallationBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastPayStripeTerminalInstallationBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {payStripeTerminalInstallationBatchError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {payStripeTerminalInstallationBatchError}
                </div>
              ) : null}

              {payStripeTerminalInstallationBatchImportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {payStripeTerminalInstallationBatchImportError}
                </div>
              ) : null}

              {payStripeTerminalInstallationBatchImportResult?.stats ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{payStripeTerminalInstallationBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{payStripeTerminalInstallationBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{payStripeTerminalInstallationBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{payStripeTerminalInstallationBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">ZIP Entries</div>
                      <div className="font-semibold text-gray-700">{payStripeTerminalInstallationBatchImportResult.stats.zipEntries ?? 0}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {payStripeTerminalInstallationBatchResult?.stats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Datei-Zeilen</div>
                      <div className="text-xl font-semibold">{payStripeTerminalInstallationBatchResult.stats.totalRowsFromFile}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{payStripeTerminalInstallationBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{payStripeTerminalInstallationBatchResult.stats.invalidRows}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Quelldatei</div>
                      <div className="text-sm font-semibold break-all">
                        {payStripeTerminalInstallationBatchResult.sourceFile?.name || '-'}
                      </div>
                    </div>
                  </div>

                  {payStripeTerminalInstallationBatchResult.warnings?.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      {payStripeTerminalInstallationBatchResult.warnings.slice(0, 3).map((w, idx) => (
                        <div key={`${w.rowNumber}-${idx}`}>{w.warning}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">Quelle</th>
                      <th className="text-left px-3 py-2 text-gray-600">Ziel</th>
                      <th className="text-left px-3 py-2 text-gray-600">Transformation</th>
                      <th className="text-left px-3 py-2 text-gray-600">Pflicht</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAY_STRIPE_TERMINAL_INSTALLATION_FIELD_MAPPING.map((row) => (
                      <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{row.source}</td>
                        <td className="px-3 py-2 text-gray-700 font-mono">{row.target}</td>
                        <td className="px-3 py-2 text-gray-700">{row.transform}</td>
                        <td className="px-3 py-2 text-gray-700">{row.required ? 'Ja' : 'Nein'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadPayStripeTerminalInstallationImportHistory}
                    disabled={payStripeTerminalInstallationImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {payStripeTerminalInstallationImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {payStripeTerminalInstallationImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {payStripeTerminalInstallationImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestPayStripeTerminalInstallationAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestPayStripeTerminalInstallationAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestPayStripeTerminalInstallationAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestPayStripeTerminalInstallationAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestPayStripeTerminalInstallationAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">ZIP Entries</div>
                        <div>{latestPayStripeTerminalInstallationAutoRun.zip_entries ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>
                          {latestPayStripeTerminalInstallationAutoRun.reason ||
                            (latestPayStripeTerminalInstallationAutoRun.skipped ? 'Skipped' : '-')}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {payStripeTerminalInstallationImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Datei</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payStripeTerminalInstallationImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedPayStripeTerminalInstallationImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedPayStripeTerminalInstallationImportRunId === run.id
                                  ? 'bg-blue-50'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.source_file_name || '-'}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedPayStripeTerminalInstallationImportRunId &&
                selectedPayStripeTerminalInstallationImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPayStripeTerminalInstallationImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'phorestPayRevenueImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Phorest Pay Revenue - Google-Drive ZIP Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe neue ZIP-Dateien aus dem Drive-Ordner und importiere die entpackte CSV in die Datenbank.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPhorestPayRevenueImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    phorestPayRevenueImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setPhorestPayRevenueImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    phorestPayRevenueImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={phorestPayRevenueAutoImportEnabled}
                  disabled={phorestPayRevenueAutoImportLoading || phorestPayRevenueAutoImportSaving}
                  onChange={(e) => handlePhorestPayRevenueAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {phorestPayRevenueAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {phorestPayRevenueAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {phorestPayRevenueAutoImportMessage ? <div>{phorestPayRevenueAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunPhorestPayRevenueBatchCheck}
                  disabled={phorestPayRevenueBatchLoading || phorestPayRevenueBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {phorestPayRevenueBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunPhorestPayRevenueBatchImport}
                  disabled={phorestPayRevenueBatchImportLoading || phorestPayRevenueBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {phorestPayRevenueBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastPhorestPayRevenueBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastPhorestPayRevenueBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastPhorestPayRevenueBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastPhorestPayRevenueBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {phorestPayRevenueBatchError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {phorestPayRevenueBatchError}
                </div>
              ) : null}

              {phorestPayRevenueBatchImportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {phorestPayRevenueBatchImportError}
                </div>
              ) : null}

              {phorestPayRevenueBatchImportResult?.stats ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{phorestPayRevenueBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{phorestPayRevenueBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{phorestPayRevenueBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{phorestPayRevenueBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">ZIP Entries</div>
                      <div className="font-semibold text-gray-700">{phorestPayRevenueBatchImportResult.stats.zipEntries ?? 0}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {phorestPayRevenueBatchResult?.stats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Datei-Zeilen</div>
                      <div className="text-xl font-semibold">{phorestPayRevenueBatchResult.stats.totalRowsFromFile}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{phorestPayRevenueBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{phorestPayRevenueBatchResult.stats.invalidRows}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Quelldatei</div>
                      <div className="text-sm font-semibold break-all">{phorestPayRevenueBatchResult.sourceFile?.name || '-'}</div>
                    </div>
                  </div>

                  {phorestPayRevenueBatchResult.warnings?.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      {phorestPayRevenueBatchResult.warnings.slice(0, 3).map((w, idx) => (
                        <div key={`${w.rowNumber}-${idx}`}>{w.warning}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">Quelle</th>
                      <th className="text-left px-3 py-2 text-gray-600">Ziel</th>
                      <th className="text-left px-3 py-2 text-gray-600">Transformation</th>
                      <th className="text-left px-3 py-2 text-gray-600">Pflicht</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PHOREST_PAY_REVENUE_FIELD_MAPPING.map((row) => (
                      <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{row.source}</td>
                        <td className="px-3 py-2 text-gray-700 font-mono">{row.target}</td>
                        <td className="px-3 py-2 text-gray-700">{row.transform}</td>
                        <td className="px-3 py-2 text-gray-700">{row.required ? 'Ja' : 'Nein'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadPhorestPayRevenueImportHistory}
                    disabled={phorestPayRevenueImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {phorestPayRevenueImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {phorestPayRevenueImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {phorestPayRevenueImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestPhorestPayRevenueAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestPhorestPayRevenueAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestPhorestPayRevenueAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestPhorestPayRevenueAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestPhorestPayRevenueAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">ZIP Entries</div>
                        <div>{latestPhorestPayRevenueAutoRun.zip_entries ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>
                          {latestPhorestPayRevenueAutoRun.reason ||
                            (latestPhorestPayRevenueAutoRun.skipped ? 'Skipped' : '-')}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {phorestPayRevenueImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Datei</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {phorestPayRevenueImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedPhorestPayRevenueImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedPhorestPayRevenueImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.source_file_name || '-'}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedPhorestPayRevenueImportRunId && selectedPhorestPayRevenueImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPhorestPayRevenueImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'lookerLeadsImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Looker Leads - Google-Drive ZIP Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe neue ZIP-Dateien aus dem Drive-Ordner und importiere die entpackten CSV-Dateien in die Datenbank.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setLookerLeadsImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    lookerLeadsImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setLookerLeadsImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    lookerLeadsImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={lookerLeadsAutoImportEnabled}
                  disabled={lookerLeadsAutoImportSaving}
                  onChange={(e) => handleLookerLeadsAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {lookerLeadsAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {lookerLeadsAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {lookerLeadsAutoImportMessage ? <div>{lookerLeadsAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunLookerLeadsBatchCheck}
                  disabled={lookerLeadsBatchLoading || lookerLeadsBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {lookerLeadsBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunLookerLeadsBatchImport}
                  disabled={lookerLeadsBatchImportLoading || lookerLeadsBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {lookerLeadsBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastLookerLeadsBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastLookerLeadsBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastLookerLeadsBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastLookerLeadsBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {lookerLeadsBatchError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {lookerLeadsBatchError}
                </div>
              ) : null}

              {lookerLeadsBatchImportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {lookerLeadsBatchImportError}
                </div>
              ) : null}

              {lookerLeadsBatchImportResult?.stats ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{lookerLeadsBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{lookerLeadsBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{lookerLeadsBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{lookerLeadsBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">ZIP Entries</div>
                      <div className="font-semibold text-gray-700">{lookerLeadsBatchImportResult.stats.zipEntries ?? 0}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {lookerLeadsBatchResult?.stats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Datei-Zeilen</div>
                      <div className="text-xl font-semibold">{lookerLeadsBatchResult.stats.totalRowsFromFile}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{lookerLeadsBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{lookerLeadsBatchResult.stats.invalidRows}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Quelldatei</div>
                      <div className="text-sm font-semibold break-all">{lookerLeadsBatchResult.sourceFile?.name || '-'}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">Quelle</th>
                      <th className="text-left px-3 py-2 text-gray-600">Ziel</th>
                      <th className="text-left px-3 py-2 text-gray-600">Transformation</th>
                      <th className="text-left px-3 py-2 text-gray-600">Pflicht</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LOOKER_LEADS_FIELD_MAPPING.map((row) => (
                      <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{row.source}</td>
                        <td className="px-3 py-2 text-gray-700 font-mono">{row.target}</td>
                        <td className="px-3 py-2 text-gray-700">{row.transform}</td>
                        <td className="px-3 py-2 text-gray-700">{row.required ? 'Ja' : 'Nein'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadLookerLeadsImportHistory}
                    disabled={lookerLeadsImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {lookerLeadsImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {lookerLeadsImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {lookerLeadsImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestLookerLeadsAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestLookerLeadsAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestLookerLeadsAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestLookerLeadsAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestLookerLeadsAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">ZIP Entries</div>
                        <div>{latestLookerLeadsAutoRun.zip_entries ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>{latestLookerLeadsAutoRun.reason || (latestLookerLeadsAutoRun.skipped ? 'Skipped' : '-')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {lookerLeadsImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Datei</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lookerLeadsImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedLookerLeadsImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedLookerLeadsImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.source_file_name || '-'}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedLookerLeadsImportRunId && selectedLookerLeadsImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedLookerLeadsImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'salespipeImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Google-Sheet Batch Import</h4>
                <p className="text-sm text-gray-500">
                  Pruefe eingehende Salespipe-Daten als Stapel und entscheide dann ueber den Import.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSalespipeImportMode('manual')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    salespipeImportMode === 'manual'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Manuell pruefen
                </button>
                <button
                  onClick={() => setSalespipeImportMode('automatic')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    salespipeImportMode === 'automatic'
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Automatisch einlaufen
                </button>
              </div>

              <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-700">Auto-Import aktivieren</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={salespipeAutoImportEnabled}
                  disabled={salespipeAutoImportLoading || salespipeAutoImportSaving}
                  onChange={(e) => handleSalespipeAutoImportToggle(e.target.checked)}
                />
              </label>

              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>Der Schalter ist persistent gespeichert. Der Cron importiert nur, wenn Auto-Import aktiviert ist.</div>
                {salespipeAutoImportLoading ? <div>Status wird geladen...</div> : null}
                {salespipeAutoImportSaving ? <div>Status wird gespeichert...</div> : null}
                {salespipeAutoImportMessage ? <div>{salespipeAutoImportMessage}</div> : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRunSalespipeBatchCheck}
                  disabled={salespipeBatchLoading || salespipeBatchImportLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {salespipeBatchLoading ? 'Pruefe Batch...' : 'Batch pruefen (Dry-Run)'}
                </button>
                <button
                  onClick={handleRunSalespipeBatchImport}
                  disabled={salespipeBatchImportLoading || salespipeBatchLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {salespipeBatchImportLoading ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {lastSalespipeBatchCheckAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Check: {new Date(lastSalespipeBatchCheckAt).toLocaleString('de-DE')}
                  </span>
                )}
                {lastSalespipeBatchImportAt && (
                  <span className="text-xs text-gray-500">
                    Letzter Import: {new Date(lastSalespipeBatchImportAt).toLocaleString('de-DE')}
                  </span>
                )}
              </div>

              {salespipeBatchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {salespipeBatchError}
                </div>
              )}

              {salespipeBatchImportError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {salespipeBatchImportError}
                </div>
              )}

              {salespipeBatchImportResult?.stats && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
                  <h5 className="text-sm font-semibold text-green-800">Ergebnis manueller Import</h5>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">To Import</div>
                      <div className="font-semibold">{salespipeBatchImportResult.stats.toImport}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importiert</div>
                      <div className="font-semibold text-green-700">{salespipeBatchImportResult.stats.imported}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Aktualisiert</div>
                      <div className="font-semibold text-blue-700">{salespipeBatchImportResult.stats.updated ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Fehler</div>
                      <div className="font-semibold text-red-700">{salespipeBatchImportResult.stats.failed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Duplikate im Sheet</div>
                      <div className="font-semibold text-amber-700">{salespipeBatchImportResult.stats.duplicates}</div>
                    </div>
                  </div>
                </div>
              )}

              {salespipeBatchResult?.stats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Sheet Zeilen</div>
                      <div className="text-xl font-semibold">{salespipeBatchResult.stats.totalRowsFromSheet}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 border">
                      <div className="text-gray-500">Geparst</div>
                      <div className="text-xl font-semibold">{salespipeBatchResult.stats.parsedRows}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                      <div className="text-green-700">Importierbar</div>
                      <div className="text-xl font-semibold text-green-700">{salespipeBatchResult.stats.validRows}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3 border border-red-200">
                      <div className="text-red-700">Fehlerhaft</div>
                      <div className="text-xl font-semibold text-red-700">{salespipeBatchResult.stats.invalidRows}</div>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">Feld-Mapping (Sheet -&gt; Datenbank)</h5>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-60 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Sheet-Spalte</th>
                              <th className="text-left px-2 py-2 text-gray-600">DB-Feld</th>
                              <th className="text-left px-2 py-2 text-gray-600">Transformation</th>
                              <th className="text-left px-2 py-2 text-gray-600">Pflicht</th>
                            </tr>
                          </thead>
                          <tbody>
                            {SALESPIPE_BATCH_FIELD_MAPPING.map((row) => (
                              <tr key={`${row.source}-${row.target}`} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{row.source}</td>
                                <td className="px-2 py-1.5 text-gray-700 font-mono">{row.target}</td>
                                <td className="px-2 py-1.5 text-gray-600">{row.transform}</td>
                                <td className="px-2 py-1.5">
                                  {row.required ? (
                                    <span className="inline-flex items-center rounded bg-red-50 text-red-700 px-2 py-0.5">Ja</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded bg-gray-100 text-gray-600 px-2 py-0.5">Nein</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {salespipeBatchResult.preview?.valid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Import-Vorschau (normalisierte Werte)</h5>
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                                <th className="text-left px-2 py-2 text-gray-600">Opportunity-ID</th>
                                <th className="text-left px-2 py-2 text-gray-600">Opportunity</th>
                                <th className="text-left px-2 py-2 text-gray-600">OAK</th>
                                <th className="text-left px-2 py-2 text-gray-600">Stage</th>
                                <th className="text-left px-2 py-2 text-gray-600">Close Date</th>
                                <th className="text-left px-2 py-2 text-gray-600">Estimated ARR</th>
                                <th className="text-left px-2 py-2 text-gray-600">Probability</th>
                                <th className="text-left px-2 py-2 text-gray-600">Owner</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salespipeBatchResult.preview.valid.slice(0, 12).map((row) => (
                                <tr key={`${row.rowNumber}-${row.opportunityId}`} className="border-t border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-700">{row.rowNumber}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.opportunityId || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.opportunityName || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.oakId ?? '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.stage || '-'}</td>
                                  <td className="px-2 py-1.5 text-gray-700">{formatBatchPreviewDate(row.closeDate)}</td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {row.estimatedArr !== null && row.estimatedArr !== undefined
                                      ? formatCurrency(row.estimatedArr)
                                      : '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">
                                    {row.probability !== null && row.probability !== undefined ? `${row.probability}` : '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{row.opportunityOwner || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Vorschau zeigt die ersten 12 geparsten Zeilen aus dem Dry-Run.
                      </p>
                    </div>
                  ) : null}

                  {salespipeBatchResult.warnings?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-amber-800 mb-2">Warnungen beim Mapping</h5>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {salespipeBatchResult.warnings.slice(0, 8).map((w, idx) => (
                          <div
                            key={`${w.rowNumber}-${w.oakId}-${idx}`}
                            className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"
                          >
                            <div className="font-medium text-amber-800">
                              Zeile {w.rowNumber > 0 ? w.rowNumber : '-'} {w.oakId ? `- OAK ${w.oakId}` : ''}
                            </div>
                            <div className="text-amber-700">{w.warning}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {salespipeImportMode === 'manual' && salespipeBatchResult.preview?.invalid?.length ? (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Beispiele fehlerhafte Zeilen</h5>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {salespipeBatchResult.preview.invalid.slice(0, 6).map((row) => (
                          <div key={row.rowNumber} className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs">
                            <div className="font-medium text-red-700">
                              Zeile {row.rowNumber} - {row.raw.opportunityName || 'Ohne Opportunity-Name'}
                            </div>
                            <div className="text-red-600">{row.reasons.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-700">Import-Historie</h5>
                  <button
                    onClick={loadSalespipeImportHistory}
                    disabled={salespipeImportHistoryLoading}
                    className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {salespipeImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                  </button>
                </div>

                {salespipeImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {salespipeImportHistoryError}
                  </div>
                ) : null}

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
                  <div className="font-semibold text-indigo-800 mb-1">Letzter Auto-Run (Cron)</div>
                  {latestSalespipeAutoRun ? (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-indigo-900">
                      <div>
                        <div className="text-indigo-700">Zeitpunkt</div>
                        <div>{new Date(latestSalespipeAutoRun.started_at).toLocaleString('de-DE')}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Status</div>
                        <div>{getImportRunStatusLabel(latestSalespipeAutoRun.status)}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Importiert</div>
                        <div>{latestSalespipeAutoRun.imported}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Fehler</div>
                        <div>{latestSalespipeAutoRun.failed}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Duplikate</div>
                        <div>{latestSalespipeAutoRun.duplicates}</div>
                      </div>
                      <div>
                        <div className="text-indigo-700">Hinweis</div>
                        <div>{latestSalespipeAutoRun.reason || (latestSalespipeAutoRun.skipped ? 'Skipped' : '-')}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-indigo-700">Noch kein automatischer Lauf protokolliert.</div>
                  )}
                </div>

                {salespipeImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                            <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salespipeImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedSalespipeImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedSalespipeImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">
                                {new Date(run.started_at).toLocaleString('de-DE')}
                              </td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                              <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedSalespipeImportRunId && selectedSalespipeImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">OAK</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedSalespipeImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.oak_id ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'salespipe2Import' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-1">Salespipe Import 2 - Übersicht</h4>
                  <p className="text-sm text-gray-500">
                    Workflow wie Drive-Ingest: Salesforce Mail-Anhang nach Google Drive, dann API-Ingest und danach Supabase.
                  </p>
                </div>
                <button
                  onClick={loadSalespipe2ImportHistory}
                  disabled={salespipe2ImportHistoryLoading}
                  className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {salespipe2ImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                </button>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                Ingest-Endpunkt:
                <code className="mx-1">/api/salespipe2/sync/ingest</code>
                mit Secret
                <code className="mx-1">SALESPIPE2_DRIVE_INGEST_SECRET</code>.
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <span className="font-medium text-gray-700">Auto-Import aktivieren (Cron)</span>
                  <input
                    type="checkbox"
                    checked={salespipe2AutoImportEnabled}
                    onChange={(e) => handleSalespipe2AutoImportToggle(e.target.checked)}
                    disabled={salespipe2AutoImportLoading || salespipe2AutoImportSaving}
                    className="h-4 w-4"
                  />
                </label>
                {salespipe2AutoImportMessage ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                    {salespipe2AutoImportMessage}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={loadSalespipe2EventsStats}
                  disabled={salespipe2EventsCountLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {salespipe2EventsCountLoading ? 'Prüfe DB...' : 'salespipe2_events > 0 prüfen'}
                </button>
              </div>

              <div
                className={`rounded-lg border p-3 text-sm ${
                  salespipe2EventsCountError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : salespipe2EventsCount !== null && salespipe2EventsCount > 0
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {salespipe2EventsCountError
                  ? salespipe2EventsCountError
                  : salespipe2EventsCount === null
                    ? 'Noch kein Datenbank-Check ausgeführt.'
                    : salespipe2EventsCount > 0
                      ? `OK: salespipe_events (source_tab=drive_salespipe2_csv) enthält ${salespipe2EventsCount} Datensätze.`
                      : 'Aktuell sind noch keine Datensätze aus Salespipe Import 2 vorhanden (0).'}
              </div>

              <div className="space-y-3 pt-1">
                {salespipe2ImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {salespipe2ImportHistoryError}
                  </div>
                ) : null}

                {salespipe2ImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Trigger</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                            <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                            <th className="text-left px-2 py-2 text-gray-600">Hinweis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salespipe2ImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedSalespipe2ImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedSalespipe2ImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.triggered_by}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                              <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.reason || (run.skipped ? 'Skipped' : '-')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedSalespipe2ImportRunId && selectedSalespipe2ImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Opportunity-ID</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedSalespipe2ImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.opportunity_id ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'leadsImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-1">Leads Import-Übersicht</h4>
                  <p className="text-sm text-gray-500">
                    Übersicht der importierten Datensätze aus der Leads INBOUND CSV.
                  </p>
                </div>
                <button
                  onClick={loadLeadsImportHistory}
                  disabled={leadsImportHistoryLoading}
                  className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {leadsImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                </button>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                Der Leads Import läuft im Apps-Script-Workflow über
                <code className="mx-1">/api/leads/sync/ingest</code>.
                Diese Ansicht zeigt nur Datenbank-Status und Import-Historie.
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={loadLeadsEventsStats}
                  disabled={leadsEventsCountLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {leadsEventsCountLoading ? 'Prüfe DB...' : 'leads_events > 0 prüfen'}
                </button>
              </div>

              <div
                className={`rounded-lg border p-3 text-sm ${
                  leadsEventsCountError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : leadsEventsCount !== null && leadsEventsCount > 0
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {leadsEventsCountError
                  ? leadsEventsCountError
                  : leadsEventsCount === null
                    ? 'Noch kein Datenbank-Check ausgeführt.'
                    : leadsEventsCount > 0
                      ? `OK: leads_events enthält ${leadsEventsCount} Datensätze.`
                      : 'Aktuell sind noch keine Datensätze in leads_events vorhanden (0).'}
              </div>

              <div className="space-y-3 pt-1">
                {leadsImportHistoryError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {leadsImportHistoryError}
                  </div>
                ) : null}

                {leadsImportRuns.length === 0 ? (
                  <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                    Noch keine Import-Läufe protokolliert.
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-52 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                            <th className="text-left px-2 py-2 text-gray-600">Status</th>
                            <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                            <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                            <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                            <th className="text-left px-2 py-2 text-gray-600">Hinweis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leadsImportRuns.map((run) => (
                            <tr
                              key={run.id}
                              onClick={() => setSelectedLeadsImportRunId(run.id)}
                              className={`border-t border-gray-100 cursor-pointer ${
                                selectedLeadsImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                              <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                              <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                              <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                              <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                              <td className="px-2 py-1.5 text-gray-700">{run.reason || (run.skipped ? 'Skipped' : '-')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedLeadsImportRunId && selectedLeadsImportRunItems.length > 0 ? (
                  <div>
                    <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">Level</th>
                              <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                              <th className="text-left px-2 py-2 text-gray-600">Lead-ID</th>
                              <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedLeadsImportRunItems.slice(0, 150).map((item) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.lead_id ?? '-'}</td>
                                <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {activeImportSubTab === 'signupsImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-1">DACH Sign-ups Import-Übersicht</h4>
                  <p className="text-sm text-gray-500">
                    Übersicht der importierten Datensätze aus der DACH Sign-ups Import Source CSV.
                  </p>
                </div>
                <button
                  onClick={loadSignupsImportHistory}
                  disabled={signupsImportHistoryLoading}
                  className="px-2 py-1 text-xs border rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {signupsImportHistoryLoading ? 'Aktualisiere...' : 'Aktualisieren'}
                </button>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                Der Sign-ups Import läuft im Apps-Script-Workflow über
                <code className="mx-1">/api/signups/sync/ingest</code>.
                Diese Ansicht zeigt nur Datenbank-Status und Import-Historie.
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={loadSignupsEventsStats}
                  disabled={signupsEventsCountLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {signupsEventsCountLoading ? 'Prüfe DB...' : 'signups_events > 0 prüfen'}
                </button>
              </div>

              <div
                className={`rounded-lg border p-3 text-sm ${
                  signupsEventsCountError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : signupsEventsCount !== null && signupsEventsCount > 0
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {signupsEventsCountError
                  ? signupsEventsCountError
                  : signupsEventsCount === null
                    ? 'Noch kein Datenbank-Check ausgeführt.'
                    : signupsEventsCount > 0
                      ? `OK: signups_events enthält ${signupsEventsCount} Datensätze.`
                      : 'Aktuell sind noch keine Datensätze in signups_events vorhanden (0).'}
              </div>

              {signupsImportHistoryError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {signupsImportHistoryError}
                </div>
              ) : null}

              {signupsImportRuns.length === 0 ? (
                <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3">
                  Noch keine Sign-ups Import-Läufe protokolliert.
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="max-h-60 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-2 text-gray-600">Zeitpunkt</th>
                          <th className="text-left px-2 py-2 text-gray-600">Status</th>
                          <th className="text-left px-2 py-2 text-gray-600">Importiert</th>
                          <th className="text-left px-2 py-2 text-gray-600">Fehler</th>
                          <th className="text-left px-2 py-2 text-gray-600">Duplikate</th>
                          <th className="text-left px-2 py-2 text-gray-600">Hinweis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signupsImportRuns.map((run) => (
                          <tr
                            key={run.id}
                            onClick={() => setSelectedSignupsImportRunId(run.id)}
                            className={`border-t border-gray-100 cursor-pointer ${
                              selectedSignupsImportRunId === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-2 py-1.5 text-gray-700">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                            <td className="px-2 py-1.5 text-gray-700">{getImportRunStatusLabel(run.status)}</td>
                            <td className="px-2 py-1.5 text-green-700">{run.imported}</td>
                            <td className="px-2 py-1.5 text-red-700">{run.failed}</td>
                            <td className="px-2 py-1.5 text-amber-700">{run.duplicates}</td>
                            <td className="px-2 py-1.5 text-gray-700">{run.reason || (run.skipped ? 'Skipped' : '-')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedSignupsImportRunId && selectedSignupsImportRunItems.length > 0 ? (
                <div>
                  <h6 className="text-xs font-semibold text-gray-600 mb-1">Details zum gewählten Lauf</h6>
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2 text-gray-600">Level</th>
                            <th className="text-left px-2 py-2 text-gray-600">Zeile</th>
                            <th className="text-left px-2 py-2 text-gray-600">OAK</th>
                            <th className="text-left px-2 py-2 text-gray-600">Meldung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSignupsImportRunItems.slice(0, 150).map((item) => (
                            <tr key={item.id} className="border-t border-gray-100">
                              <td className="px-2 py-1.5 text-gray-700">{item.level}</td>
                              <td className="px-2 py-1.5 text-gray-700">{item.row_number ?? '-'}</td>
                              <td className="px-2 py-1.5 text-gray-700">{item.oak_id ?? '-'}</td>
                              <td className="px-2 py-1.5 text-gray-700">{item.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {activeImportSubTab === 'paymarginImport' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-1">Paymargin CSV Import</h4>
                <p className="text-sm text-gray-500">
                  Lade eine Paymargin-CSV hoch. Pro OAK ID wird ein normalisierter Pay-Ist-Monatswert berechnet
                  (Net Margin / Monatsfaktor) und als ARR (x12) in die passenden Go-Lives geschrieben.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Go-Live Jahr</label>
                  <input
                    type="number"
                    value={paymarginImportYear}
                    onChange={(e) => setPaymarginImportYear(parseInt(e.target.value) || currentYear)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Go-Live Monat (Kohorte)</label>
                  <select
                    value={paymarginGoLiveMonth}
                    onChange={(e) => setPaymarginGoLiveMonth(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CSV Datei</label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setPaymarginCsvFile(e.target.files?.[0] || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Erwartete Spalten: OAK ID, Net Margin
                  </p>
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-blue-900">
                        OAK IDs fuer Looker ({MONTHS[paymarginGoLiveMonth - 1]} {paymarginImportYear}, nur mit Terminal)
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!paymarginCohortOakIdsCsv) return;
                          try {
                            await navigator.clipboard.writeText(paymarginCohortOakIdsCsv);
                            setPaymarginCohortOakIdsCopyMessage('Kopiert.');
                          } catch {
                            setPaymarginCohortOakIdsCopyMessage('Kopieren fehlgeschlagen.');
                          }
                        }}
                        disabled={!paymarginCohortOakIdsCsv}
                        className="px-2 py-1 text-xs border border-blue-300 rounded text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        OAK IDs kopieren
                      </button>
                    </div>
                    <textarea
                      value={paymarginCohortOakIdsCsv}
                      readOnly
                      rows={3}
                      placeholder={
                        paymarginCohortOakIdsLoading
                          ? 'OAK IDs werden geladen...'
                          : 'Keine OAK IDs mit Terminal in dieser Kohorte gefunden.'
                      }
                      className="w-full px-2 py-1.5 text-xs border border-blue-200 rounded bg-white text-gray-700"
                    />
                    <div className="mt-1 text-xs text-blue-900">
                      Anzahl OAK IDs: {paymarginCohortOakIds.length}
                    </div>
                    {paymarginCohortOakIdsError ? (
                      <div className="mt-1 text-xs text-red-700">{paymarginCohortOakIdsError}</div>
                    ) : null}
                    {paymarginCohortOakIdsCopyMessage ? (
                      <div className="mt-1 text-xs text-blue-700">{paymarginCohortOakIdsCopyMessage}</div>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Referenzquelle (manuell):{' '}
                    <a
                      href="https://phorestinternal.cloud.looker.com/dashboards/188?OAK+ID=&Activity+Date=last+month&Region=DACH&Platform+Account+Name=&Business+Advisor=&Phorest+Pay+Account+Executive=&Currency=EURO&Country=&Phorest+Pay+channel="
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 underline hover:text-blue-800 break-all"
                    >
                      Looker Dashboard 188 (DACH, Last Month)
                    </a>
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1 text-xs">
                <div className="text-gray-700">
                  <span className="font-semibold">CSV für ausgewählte Kohorte ({MONTHS[paymarginGoLiveMonth - 1]} {paymarginImportYear}):</span>{' '}
                  {paymarginSelectedMonthLastRun
                    ? `${paymarginSelectedMonthLastRun.source_file_name} (${new Date(
                        paymarginSelectedMonthLastRun.created_at
                      ).toLocaleString('de-DE')})`
                    : 'Noch kein Commit-Import protokolliert.'}
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold">Durchschnitt Net Margin (aus importierten OAK IDs, gewählte Kohorte):</span>{' '}
                  {paymarginSelectedMonthLastRun?.avg_net_margin_monthly !== undefined &&
                  paymarginSelectedMonthLastRun?.avg_net_margin_monthly !== null
                    ? formatCurrency(Number(paymarginSelectedMonthLastRun.avg_net_margin_monthly))
                    : '-'}
                  {paymarginSelectedMonthLastRun?.imported_oak_ids_count !== undefined &&
                  paymarginSelectedMonthLastRun?.imported_oak_ids_count !== null
                    ? ` (n=${paymarginSelectedMonthLastRun.imported_oak_ids_count})`
                    : ''}
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold">Letzte wirksame CSV-Quelle (aktuelle Datenbasis):</span>{' '}
                  {paymarginLatestRun
                    ? `${paymarginLatestRun.source_file_name} — ${MONTHS[paymarginLatestRun.go_live_month - 1]} ${
                        paymarginLatestRun.year
                      } (${new Date(paymarginLatestRun.created_at).toLocaleString('de-DE')})`
                    : 'Noch kein Commit-Import protokolliert.'}
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold">Durchschnitt Net Margin (letzte wirksame Quelle):</span>{' '}
                  {paymarginLatestRun?.avg_net_margin_monthly !== undefined &&
                  paymarginLatestRun?.avg_net_margin_monthly !== null
                    ? formatCurrency(Number(paymarginLatestRun.avg_net_margin_monthly))
                    : '-'}
                  {paymarginLatestRun?.imported_oak_ids_count !== undefined &&
                  paymarginLatestRun?.imported_oak_ids_count !== null
                    ? ` (n=${paymarginLatestRun.imported_oak_ids_count})`
                    : ''}
                </div>
                {paymarginHistoryLoading ? <div className="text-gray-500">Historie wird geladen...</div> : null}
                {paymarginHistoryError ? <div className="text-red-700">{paymarginHistoryError}</div> : null}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-sm font-semibold text-amber-800">Saisonfaktoren (frei editierbar)</h5>
                  <button
                    type="button"
                    onClick={() => setPaymarginSeasonalFactors([...DEFAULT_SEASONAL_FACTORS])}
                    className="px-2 py-1 text-xs border border-amber-300 rounded text-amber-700 hover:bg-amber-100"
                  >
                    Standardwerte zurücksetzen
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
                  {MONTHS.map((monthLabel, idx) => (
                    <div key={monthLabel}>
                      <label className="block text-xs text-amber-700 mb-1">{monthLabel}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.1"
                        value={paymarginSeasonalFactors[idx] ?? 1}
                        onChange={(e) => handlePaymarginFactorChange(idx, parseFloat(e.target.value) || 1)}
                        className="w-full px-2 py-1 border border-amber-300 rounded text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setPaymarginImportMode('dry-run');
                    handleRunPaymarginCsvImport(true);
                  }}
                  disabled={paymarginImportLoading || !paymarginCsvFile}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {paymarginImportLoading && paymarginImportMode === 'dry-run' ? 'Pruefe...' : 'Dry-Run'}
                </button>
                <button
                  onClick={() => {
                    setPaymarginImportMode('commit');
                    handleRunPaymarginCsvImport(false);
                  }}
                  disabled={paymarginImportLoading || !paymarginCsvFile}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {paymarginImportLoading && paymarginImportMode === 'commit' ? 'Importiere...' : 'Jetzt importieren (Commit)'}
                </button>
                {paymarginCsvFile ? (
                  <span className="text-xs text-gray-500">Datei: {paymarginCsvFile.name}</span>
                ) : null}
              </div>

              {paymarginImportError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {paymarginImportError}
                </div>
              ) : null}

              {paymarginImportResult?.stats ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-3">
                  <h5 className="text-sm font-semibold text-green-800">Import-Ergebnis</h5>
                  <p className="text-xs text-green-800">
                    Modus: <strong>{paymarginImportResult.mode === 'dry-run' ? 'Dry-Run' : 'Commit'}</strong>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Zeilen geparst</div>
                      <div className="font-semibold">{paymarginImportResult.stats.rowsParsed}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Zeilen valid</div>
                      <div className="font-semibold">{paymarginImportResult.stats.rowsValid}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Go-Lives gematcht</div>
                      <div className="font-semibold text-blue-700">{paymarginImportResult.stats.rowsMatchedGoLives}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Wuerde aktualisieren</div>
                      <div className="font-semibold text-blue-700">{paymarginImportResult.stats.rowsWouldUpdate}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Go-Lives aktualisiert</div>
                      <div className="font-semibold text-green-700">{paymarginImportResult.stats.rowsUpdated}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Ohne Match</div>
                      <div className="font-semibold text-amber-700">{paymarginImportResult.stats.rowsSkippedNoMatch}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Importierte OAK IDs</div>
                      <div className="font-semibold text-blue-700">{paymarginImportResult.stats.importedOakIdsCount ?? 0}</div>
                    </div>
                    <div className="rounded bg-white border p-2">
                      <div className="text-gray-500">Ø Net Margin</div>
                      <div className="font-semibold text-blue-700">
                        {paymarginImportResult.stats.avgNetMarginMonthly !== null &&
                        paymarginImportResult.stats.avgNetMarginMonthly !== undefined
                          ? formatCurrency(paymarginImportResult.stats.avgNetMarginMonthly)
                          : '-'}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-green-800">
                    Ziel-Kohorte: {MONTHS[(paymarginImportResult.stats.goLiveMonth || 1) - 1]} {paymarginImportResult.stats.year}
                    {' '}| Doppelte OAK-Zeilen im CSV: {paymarginImportResult.stats.duplicateOakRows}
                  </p>
                  {paymarginImportResult.warning ? (
                    <p className="text-xs text-amber-700">{paymarginImportResult.warning}</p>
                  ) : null}

                  {paymarginImportResult.preview?.length ? (
                    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                      <div className="max-h-56 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2 text-gray-600">OAK ID</th>
                              <th className="text-left px-2 py-2 text-gray-600">Net Margin (Monat)</th>
                              <th className="text-left px-2 py-2 text-gray-600">Normalisiert / Monat</th>
                              <th className="text-left px-2 py-2 text-gray-600">Pay ARR (x12)</th>
                              <th className="text-left px-2 py-2 text-gray-600">Go-Live IDs</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymarginImportResult.preview.map((row) => (
                              <tr key={`${row.oakId}-${row.payArr}`} className="border-t border-gray-100">
                                <td className="px-2 py-1.5 text-gray-700">{row.oakId}</td>
                                <td className="px-2 py-1.5 text-gray-700">{formatCurrency(row.netMarginMonthly)}</td>
                                <td className="px-2 py-1.5 text-gray-700">{formatCurrency(row.normalizedMonthly)}</td>
                                <td className="px-2 py-1.5 text-green-700">{formatCurrency(row.payArr)}</td>
                                <td className="px-2 py-1.5 text-gray-500">{row.matchedGoLiveIds.length}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Rolle hinzufügen</h3>
              {dynamicRolesLoading && <span className="text-xs text-gray-400">Lade Rollen...</span>}
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Lege neue Rollen inkl. Bereichszuordnung an. Die Rolle wird in der DB gespeichert und ist anschließend in den Rollen-Dropdowns verfügbar.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={newRoleKey}
                onChange={(e) => setNewRoleKey(e.target.value)}
                placeholder="role_key, z. B. revops_manager"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <input
                value={newRoleLabel}
                onChange={(e) => setNewRoleLabel(e.target.value)}
                placeholder="Label, z. B. RevOps Manager"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>

            <textarea
              value={newRoleDescription}
              onChange={(e) => setNewRoleDescription(e.target.value)}
              placeholder="Optionale Beschreibung"
              rows={2}
              className="w-full mt-3 border border-gray-300 rounded-lg px-3 py-2"
            />

            <div className="mt-3">
              <p className="text-sm text-gray-700 mb-2">Bereiche</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(BUSINESS_AREA_LABELS) as BusinessArea[]).map((area) => {
                  const checked = newRoleAreas.includes(area);
                  return (
                    <label key={area} className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewRoleAreas((prev) => Array.from(new Set([...prev, area])));
                          } else {
                            setNewRoleAreas((prev) => prev.filter((v) => v !== area));
                          }
                        }}
                      />
                      <span>{BUSINESS_AREA_LABELS[area]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {createRoleError && <p className="text-sm text-red-600 mt-3">{createRoleError}</p>}
            {createRoleMessage && <p className="text-sm text-green-600 mt-3">{createRoleMessage}</p>}

            <div className="mt-4">
              <button
                type="button"
                onClick={handleCreateDynamicRole}
                disabled={createRoleLoading || !permissions.assignRoles}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {createRoleLoading ? 'Speichern...' : 'Rolle hinzufügen'}
              </button>
              {!permissions.assignRoles && (
                <p className="text-xs text-gray-500 mt-2">
                  Du hast keine Berechtigung, neue Rollen anzulegen.
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-800 mb-2">Dynamische Rollen (DB)</h4>
              {dynamicRoles.length === 0 ? (
                <p className="text-sm text-gray-500">Noch keine dynamischen Rollen angelegt.</p>
              ) : (
                <div className="space-y-2">
                  {dynamicRoles.map((role) => (
                    <div key={role.role_key} className="border border-gray-200 rounded-lg px-3 py-2">
                      <div className="text-sm font-medium text-gray-800">{role.label}</div>
                      <div className="text-xs text-gray-500">{role.role_key}</div>
                      {role.description ? <div className="text-xs text-gray-600 mt-1">{role.description}</div> : null}
                      <div className="text-xs text-gray-500 mt-1">
                        Bereiche: {role.areas.map((area) => BUSINESS_AREA_LABELS[area]).join(', ') || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.settings.permissionsOverview')}</h3>
            <p className="text-gray-500 mb-6">{t('dlt.settings.permissionsDescription')}</p>
            
            <div className="space-y-4">
              {[
                { role: 'country_manager', permissions: ['Alle Bereiche', 'Alle Benutzer verwalten', 'Alle Reports', 'System-Einstellungen'] },
                { role: 'dlt_member', permissions: ['Alle Bereiche', 'Team-Reports', 'KPI-Dashboard'] },
                { role: 'line_manager_new_business', permissions: ['New Business', 'Team verwalten', 'Go-Lives eintragen'] },
                { role: 'ae_subscription_sales', permissions: ['Eigene Go-Lives', 'Eigene Targets', 'Jahresübersicht'] },
                { role: 'ae_payments', permissions: ['Eigene Go-Lives', 'Eigene Targets', 'Jahresübersicht'] }
              ].map(({ role, permissions }) => (
                <div key={role} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[role as UserRole] || 'bg-gray-100 text-gray-700'}`}>
                      {getRoleLabel(role)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {permissions.map(perm => (
                      <span key={perm} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm">
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {dynamicRoles.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Dynamische Rollen</h3>
              <div className="space-y-2">
                {dynamicRoles.map((role) => (
                  <div key={role.role_key} className="border border-gray-200 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{role.label}</span>
                      <span className="text-xs text-gray-500">({role.role_key})</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Bereiche: {role.areas.map((area) => BUSINESS_AREA_LABELS[area] || area).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Areas Tab */}
      {activeTab === 'areas' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(['new_business', 'expanding_business', 'marketing', 'dlt'] as BusinessArea[]).map((area) => {
              const areaUsers = users.filter(u => {
                if (area === 'new_business') return ['ae_subscription_sales', 'ae_payments', 'line_manager_new_business', 'commercial_director', 'head_of_partnerships'].includes(u.role);
                if (area === 'expanding_business') return ['head_of_expanding_revenue', 'line_manager_expanding_business', 'cs_account_executive', 'cs_account_manager', 'cs_sdr'].includes(u.role);
                if (area === 'marketing') return ['head_of_marketing', 'marketing_specialist', 'marketing_executive', 'demand_generation_specialist'].includes(u.role);
                if (area === 'dlt') return ['country_manager', 'dlt_member'].includes(u.role);
                return false;
              });

              const icons: Record<BusinessArea, string> = {
                new_business: '🚀',
                expanding_business: '📈',
                marketing: '📣',
                dlt: '👔'
              };

              const colors: Record<BusinessArea, string> = {
                new_business: 'border-l-blue-500 bg-blue-50',
                expanding_business: 'border-l-green-500 bg-green-50',
                marketing: 'border-l-orange-500 bg-orange-50',
                dlt: 'border-l-purple-500 bg-purple-50'
              };

              return (
                <div key={area} className={`bg-white rounded-xl shadow-sm p-6 border-l-4 ${colors[area]}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">{icons[area]}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800">{BUSINESS_AREA_LABELS[area]}</h3>
                      <p className="text-sm text-gray-500">{areaUsers.length} {t('dlt.settings.members')}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {areaUsers.slice(0, 5).map(u => (
                      <div key={u.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{u.name}</span>
                        <span className="text-gray-400">{getRoleLabel(u.role).split(' ')[0] || u.role}</span>
                      </div>
                    ))}
                    {areaUsers.length > 5 && (
                      <div className="text-sm text-gray-400 text-center pt-2">
                        +{areaUsers.length - 5} {t('dlt.settings.more')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Planning Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          {/* Header with Year Selector & Save Button */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">{t('dlt.settings.planningOverview')}</h3>
                <p className="text-sm text-gray-500">{t('dlt.settings.planningDescription')}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={newArrYear}
                  onChange={(e) => setNewArrYear(Number(e.target.value))}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  {[currentYear - 1, currentYear, currentYear + 1].map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <button
                  onClick={savePlanzahlen}
                  disabled={saving || loadingPlanzahlen}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Speichern...
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      Alle speichern
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {/* Status Message */}
            {saveMessage && (
              <div className={`mt-4 p-3 rounded-lg text-sm ${saveMessage.includes('Fehler') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {saveMessage}
              </div>
            )}
            
            {/* Loading Indicator */}
            {loadingPlanzahlen && (
              <div className="mt-4 flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mr-2"></div>
                <span className="text-gray-500">Planzahlen werden geladen...</span>
              </div>
            )}
          </div>

          {/* 1. NEW ARR */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-green-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-green-50 cursor-pointer"
              onClick={() => togglePlanningSection('newArr')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📈</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">1. NEW ARR</h3>
                  <p className="text-sm text-gray-500">Neuer ARR aus Neukundengeschäft</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.newArr ? '▼' : '▶'}</span>
              </div>
              {planningSectionsExpanded.newArr && (
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mt-4 text-center">
                <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                  <div className="text-xs text-blue-600">Go-Lives</div>
                  <div className="text-lg font-bold text-blue-700">{businessTotal}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                  <div className="text-xs text-green-600">Pay Term.</div>
                  <div className="text-lg font-bold text-green-700">{businessTotalPayTerminals}</div>
                </div>
                <div className="bg-teal-50 rounded-lg p-2 border border-teal-200">
                  <div className="text-xs text-teal-600">Terminal</div>
                  <div className="text-lg font-bold text-teal-700">{businessTotalTerminalSales}</div>
                </div>
                <div className="bg-pink-50 rounded-lg p-2 border border-pink-200">
                  <div className="text-xs text-pink-600">Tipping</div>
                  <div className="text-lg font-bold text-pink-700">{businessTotalTipping}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                  <div className="text-xs text-green-600">Subs ARR</div>
                  <div className="text-lg font-bold text-green-700">{formatCurrency(yearlySubsArr)}</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-2 border border-orange-200">
                  <div className="text-xs text-orange-600">Pay ARR</div>
                  <div className="text-lg font-bold text-orange-700">{formatCurrency(yearlyPayArr)}</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2 border border-purple-200">
                  <div className="text-xs text-purple-600">Gesamt ARR</div>
                  <div className="text-lg font-bold text-purple-700">{formatCurrency(yearlySubsArr + yearlyPayArr)}</div>
                </div>
              </div>
              )}
            </div>
            
            {planningSectionsExpanded.newArr && (
            <div className="p-6 space-y-6">
              {/* ========== 1. GRUNDEINSTELLUNGEN ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">1. Grundeinstellungen</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Jahr</label>
                    <input type="number" value={newArrYear} onChange={(e) => setNewArrYear(parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                    <input type="text" value={newArrRegion} onChange={(e) => setNewArrRegion(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                  </div>
                </div>
              </div>
              
              {/* ========== 2. BUSINESS TARGETS (100%) ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div 
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setBusinessTargetsExpanded(!businessTargetsExpanded)}
                >
                  <h4 className="text-md font-bold text-gray-800">2. Business Targets (100%)</h4>
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-500">
                      {businessTotal} Go-Lives | {businessTotalTerminalSales} Terminal | {businessTotalTipping} Tipping
                    </span>
                    <span className="text-gray-400">{businessTargetsExpanded ? '▼' : '▶'}</span>
                  </div>
                </div>
                
                {businessTargetsExpanded && (
                  <div className="mt-4 space-y-4">
                    {/* Go-Lives: Inbound, Outbound, Partnerships */}
                    {[
                      { key: 'inbound', label: 'Inbound', color: 'blue', data: businessInbound, total: businessTotalInbound },
                      { key: 'outbound', label: 'Outbound', color: 'orange', data: businessOutbound, total: businessTotalOutbound },
                      { key: 'partnerships', label: 'Partnerships', color: 'purple', data: businessPartnerships, total: businessTotalPartnerships },
                    ].map(cat => (
                      <div key={cat.key}>
                        <div className="flex items-center justify-between mb-1">
                          <h5 className={`font-medium text-${cat.color}-700`}>{cat.label}</h5>
                          <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <div key={i} className="text-center">
                              <label className="block text-xs text-gray-500">{m}</label>
                              <input type="number" value={cat.data[i]}
                                onChange={(e) => handleBusinessChange(cat.key as 'inbound' | 'outbound' | 'partnerships', i, parseInt(e.target.value) || 0)}
                                className={`w-full px-1 py-1 text-center border border-${cat.color}-200 rounded text-sm bg-${cat.color}-50`} />
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                {formatCurrency((cat.data[i] || 0) * avgSubsBill * 12)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    
                    {/* Abgeleitete Kennzahlen */}
                    <div className="pt-4 border-t">
                      <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                        <span className="font-medium text-gray-700">Abgeleitete Kennzahlen</span>
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <div className="flex items-center space-x-1">
                            <span className="text-green-600">Pay Term.</span>
                            <input type="number" value={payTerminalsPercent} onChange={(e) => { const v = parseInt(e.target.value) || 0; payTerminalsPercentRef.current = v; setPayTerminalsPercent(v); }}
                              className="w-12 px-1 py-0.5 text-center border border-green-300 rounded text-xs" />
                            <span className="text-green-600">%</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="text-teal-600">Terminal</span>
                            <input type="number" value={terminalSalesPercent} onChange={(e) => { const v = parseInt(e.target.value) || 0; terminalSalesPercentRef.current = v; setTerminalSalesPercent(v); }}
                              className="w-12 px-1 py-0.5 text-center border border-teal-300 rounded text-xs" />
                            <span className="text-teal-600">%</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="text-pink-600">Tipping</span>
                            <input type="number" value={tippingPercent} onChange={(e) => { const v = parseInt(e.target.value) || 0; tippingPercentRef.current = v; setTippingPercent(v); }}
                              className="w-12 px-1 py-0.5 text-center border border-pink-300 rounded text-xs" />
                            <span className="text-pink-600">%</span>
                          </div>
                          <button type="button" onClick={recalculateBusinessDerived} className="text-xs text-blue-600 underline hover:text-blue-800">Berechnen</button>
                        </div>
                      </div>
                      
                      {/* Pay Terminals (Hardware) */}
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="font-medium text-green-700">Pay Terminals (Hardware)</h5>
                          <span className="text-sm text-gray-500">Summe: <strong>{businessTotalPayTerminals}</strong></span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <div key={i} className="text-center">
                              <label className="block text-xs text-gray-500">{m}</label>
                              <input type="number" value={businessPayTerminals[i] || 0}
                                onChange={(e) => handleBusinessPayTerminalsChange(i, parseInt(e.target.value) || 0)}
                                className="w-full px-1 py-1 text-center border border-green-200 rounded text-sm bg-green-50" />
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Terminal Sales & Tipping */}
                      {[
                        {
                          label: 'Terminal Sales',
                          color: 'teal',
                          data: businessTerminalSales,
                          handler: handleBusinessTerminalChange,
                          total: businessTotalTerminalSales,
                          expectedArrPerUnit: avgPayBillTerminal * 12,
                          streamInfo: `${terminalSalesPercent}% Anteil von Go-Lives`,
                        },
                        {
                          label: 'Tipping',
                          color: 'pink',
                          data: businessTipping,
                          handler: handleBusinessTippingChange,
                          total: businessTotalTipping,
                          expectedArrPerUnit: avgPayBillTipping * 12,
                          streamInfo: `${tippingPercent}% Anteil von Terminal Sales`,
                        },
                      ].map(cat => (
                        <div key={cat.label} className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <h5 className={`font-medium text-${cat.color}-700`}>
                              {cat.label}
                              <div className="text-xs font-normal text-gray-500">
                                Erwarteter ARR je {cat.label === 'Terminal Sales' ? 'Terminal Sale' : 'Tipping'}:{' '}
                                <span className={`font-semibold text-${cat.color}-700`}>
                                  {formatCurrency(cat.expectedArrPerUnit)}
                                </span>{' '}
                                <span className="text-gray-400">
                                  (12 x {formatCurrency(cat.label === 'Terminal Sales' ? avgPayBillTerminal : avgPayBillTipping)})
                                </span>
                                <span className="text-gray-400"> | {cat.streamInfo}</span>
                              </div>
                            </h5>
                            <div className="text-right text-sm text-gray-500">
                              <div>Summe: <strong>{cat.total}</strong></div>
                              <div className={`text-${cat.color}-700`}>
                                ARR-Summe:{' '}
                                <strong>
                                  {formatCurrency(cat.data.reduce((sum, value) => sum + ((value || 0) * cat.expectedArrPerUnit), 0))}
                                </strong>
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-12 gap-1">
                            {MONTHS.map((m, i) => (
                              <div key={i} className="text-center">
                                <label className="block text-xs text-gray-500">{m}</label>
                                <input type="number" value={cat.data[i] || 0}
                                  onChange={(e) => cat.handler(i, parseInt(e.target.value) || 0)}
                                  className={`w-full px-1 py-1 text-center border border-${cat.color}-200 rounded text-sm bg-${cat.color}-50`} />
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  {formatCurrency((cat.data[i] || 0) * cat.expectedArrPerUnit)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* ========== 4. UMSATZ-BERECHNUNG ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">4. Umsatz-Berechnung</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Avg Subs Bill</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input type="number" value={avgSubsBill} onChange={(e) => setAvgSubsBill(parseInt(e.target.value) || 0)}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Subs ARR = Go-Lives × Bill × 12</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-teal-700 mb-1">Avg Pay Bill Terminal</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input type="number" value={avgPayBillTerminal} onChange={(e) => setAvgPayBillTerminal(parseInt(e.target.value) || 0)}
                        className="w-full pl-8 pr-3 py-2 border border-teal-300 rounded-lg bg-teal-50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-pink-700 mb-1">Avg Pay Bill Tipping</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input type="number" value={avgPayBillTipping} onChange={(e) => setAvgPayBillTipping(parseInt(e.target.value) || 0)}
                        className="w-full pl-8 pr-3 py-2 border border-pink-300 rounded-lg bg-pink-50" />
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-white rounded-lg border text-sm space-y-2">
                  <div>
                    <strong className="text-green-700">Subs ARR:</strong> ({businessTotal} × €{avgSubsBill} × 12) = <strong className="text-green-600">{formatCurrency(yearlySubsArr)}</strong>
                  </div>
                  <div>
                    <strong className="text-orange-700">Pay ARR:</strong> ({businessTotalTerminalSales} × €{avgPayBillTerminal} × 12) + ({businessTotalTipping} × €{avgPayBillTipping} × 12) = <strong className="text-orange-600">{formatCurrency(yearlyPayArr)}</strong>
                  </div>
                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <strong className="text-purple-700">Gesamt ARR:</strong> {formatCurrency(yearlySubsArr)} + {formatCurrency(yearlyPayArr)} = <strong className="text-purple-600 text-base">{formatCurrency(yearlySubsArr + yearlyPayArr)}</strong>
                  </div>
                </div>
              </div>

              {/* ========== 5. AE AUSWÄHLEN + OTE ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">
                  5. AE auswählen & OTE <span className="text-sm font-normal text-gray-500">(ab hier AE-spezifisch)</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">AE auswählen</label>
                    <select
                      value={selectedAEId || ''}
                      onChange={(e) => setSelectedAEId(e.target.value)}
                      className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-indigo-50 font-medium"
                      style={
                        selectedAEUser && isExitedUser(selectedAEUser)
                          ? { fontStyle: 'italic', color: '#6b7280' }
                          : undefined
                      }
                    >
                      {plannableUsers.map((ae) => (
                        <option
                          key={ae.id}
                          value={ae.id}
                          style={isExitedUser(ae) ? { fontStyle: 'italic', color: '#6b7280' } : undefined}
                        >
                          {ae.name}{isExitedUser(ae) ? ' (ausgetreten)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Variables OTE für {selectedAEUser?.name || 'AE'}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input
                        type="number"
                        value={selectedAEVariableOTE}
                        onChange={(e) => {
                          const value = parseInt(e.target.value) || 0;
                          handleSelectedAEVariableOTEChange(value);
                          handleSelectedAEOTEChange(value);
                        }}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Base Salary</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input
                        type="number"
                        value={selectedAEBaseSalary}
                        onChange={(e) => handleSelectedAEBaseSalaryChange(parseInt(e.target.value) || 0)}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ARR Multiple</label>
                    <input
                      type="number"
                      value={selectedAEArrMultiple}
                      onChange={(e) => handleSelectedAEArrMultipleChange(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      step="0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gross Margin %</label>
                    <input
                      type="number"
                      value={selectedAEGrossMargin}
                      onChange={(e) => handleSelectedAEGrossMarginChange(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      step="0.1"
                    />
                  </div>
                </div>
                {selectedAEUser && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-9 gap-3 text-center">
                      <div className="bg-violet-50 rounded-lg p-2">
                        <div className="text-xs text-violet-600">Aktive AE-Monate</div>
                        <div className="text-lg font-bold text-violet-700">{selectedAEActiveMonths}/12</div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2">
                        <div className="text-xs text-blue-600">Go-Lives</div>
                        <div className="text-lg font-bold text-blue-700">{selectedAEGoLives}</div>
                      </div>
                      <div className="bg-teal-50 rounded-lg p-2">
                        <div className="text-xs text-teal-600">Terminal</div>
                        <div className="text-lg font-bold text-teal-700">{selectedAETerminalSales}</div>
                      </div>
                      <div className="bg-pink-50 rounded-lg p-2">
                        <div className="text-xs text-pink-600">Tipping</div>
                        <div className="text-lg font-bold text-pink-700">{selectedAETipping}</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2">
                        <div className="text-xs text-green-600">Subs ARR</div>
                        <div className="text-lg font-bold text-green-700">{formatCurrency(selectedAESubsArrCalibrated)}</div>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-2">
                        <div className="text-xs text-orange-600">Pay ARR</div>
                        <div className="text-lg font-bold text-orange-700">{formatCurrency(selectedAEPayArrCalibrated)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2">
                        <div className="text-xs text-slate-600">OTC</div>
                        <div className="text-lg font-bold text-slate-700">{formatCurrency(multipleCalibration.otc)}</div>
                      </div>
                      <div className="bg-indigo-50 rounded-lg p-2">
                        <div className="text-xs text-indigo-600">Quota ARR</div>
                        <div className="text-lg font-bold text-indigo-700">{formatCurrency(multipleCalibration.quotaArr)}</div>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-2">
                        <div className="text-xs text-amber-600">CAC Payback</div>
                        <div className="text-lg font-bold text-amber-700">
                          {Number.isFinite(multipleCalibration.paybackMonths) ? `${multipleCalibration.paybackMonths.toFixed(1)} Mon.` : '-'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-white border border-indigo-100 rounded-lg">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setAeBusinessTargetsExpanded(!aeBusinessTargetsExpanded)}
                      >
                        <h5 className="font-semibold text-indigo-900">
                          Business Targets (AE-Mapping)
                        </h5>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-600">
                            {selectedAEGoLives} Go-Lives | {selectedAETerminalSales} Terminal | {selectedAETipping} Tipping
                          </span>
                          <span className="text-gray-400">{aeBusinessTargetsExpanded ? '▼' : '▶'}</span>
                        </div>
                      </div>

                      {aeBusinessTargetsExpanded && (
                        <div className="mt-3 space-y-3">
                      <p className="text-xs text-gray-500">Graue Monate sind ausserhalb des aktiven AE-Zeitraums (vor AE-Start oder nach Austritt).</p>
                      {[
                        {
                          key: 'inbound',
                          label: 'Inbound',
                          labelClass: 'text-blue-700',
                          boxClass: 'border-blue-200 bg-blue-50',
                          data: selectedAEInboundCalibrated,
                          total: selectedAEInboundTotal,
                        },
                        {
                          key: 'outbound',
                          label: 'Outbound',
                          labelClass: 'text-orange-700',
                          boxClass: 'border-orange-200 bg-orange-50',
                          data: selectedAEOutboundCalibrated,
                          total: selectedAEOutboundTotal,
                        },
                        {
                          key: 'partnerships',
                          label: 'Partnerships',
                          labelClass: 'text-purple-700',
                          boxClass: 'border-purple-200 bg-purple-50',
                          data: selectedAEPartnershipsCalibrated,
                          total: selectedAEPartnershipsTotal,
                        },
                      ].map((cat) => (
                        <div key={cat.key}>
                          <div className="flex items-center justify-between mb-1">
                            <h6 className={`font-medium ${cat.labelClass}`}>{cat.label}</h6>
                            <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                          </div>
                          <div className="grid grid-cols-12 gap-1">
                            {MONTHS.map((m, i) => (
                              <div key={i} className="text-center">
                                <label className={`block text-xs ${selectedAEActiveFlags[i] ? 'text-gray-500' : 'text-gray-400'}`}>{m}</label>
                                <div
                                  className={`w-full px-1 py-1 text-center border rounded text-sm ${
                                    selectedAEActiveFlags[i] ? cat.boxClass : 'border-gray-200 bg-gray-100 text-gray-400'
                                  }`}
                                >
                                  {cat.data[i] || 0}
                                </div>
                                <div className={`text-[10px] mt-0.5 ${selectedAEActiveFlags[i] ? 'text-gray-400' : 'text-gray-300'}`}>
                                  {formatCurrency((cat.data[i] || 0) * avgSubsBill * 12)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="pt-3 border-t border-gray-200 space-y-2">
                        <span className="font-medium text-gray-700">Abgeleitete Kennzahlen</span>
                        {[
                          {
                            key: 'pay-terminals',
                            label: 'Pay Terminals (Hardware)',
                            labelClass: 'text-green-700',
                            boxClass: 'border-green-200 bg-green-50',
                            data: selectedAEPayTerminalsByMonth,
                            total: selectedAEPayTerminals,
                          },
                          {
                            key: 'terminal-sales',
                            label: 'Terminal Sales',
                            labelClass: 'text-teal-700',
                            boxClass: 'border-teal-200 bg-teal-50',
                            data: selectedAETerminalSalesByMonth,
                            total: selectedAETerminalSales,
                          },
                          {
                            key: 'tipping',
                            label: 'Tipping',
                            labelClass: 'text-pink-700',
                            boxClass: 'border-pink-200 bg-pink-50',
                            data: selectedAETippingByMonth,
                            total: selectedAETipping,
                          },
                        ].map((cat) => (
                          <div key={cat.key}>
                            <div className="flex items-center justify-between mb-1">
                              <h6 className={`font-medium ${cat.labelClass}`}>{cat.label}</h6>
                              <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                            </div>
                            <div className="grid grid-cols-12 gap-1">
                              {MONTHS.map((m, i) => (
                                <div key={i} className="text-center">
                                  <label className={`block text-xs ${selectedAEActiveFlags[i] ? 'text-gray-500' : 'text-gray-400'}`}>{m}</label>
                                  <div
                                    className={`w-full px-1 py-1 text-center border rounded text-sm ${
                                      selectedAEActiveFlags[i] ? cat.boxClass : 'border-gray-200 bg-gray-100 text-gray-400'
                                    }`}
                                  >
                                    {cat.data[i] || 0}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ========== 6. OTE VALIDIERUNG ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">
                  6. Multiple & OTE Validierung <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEUser?.name || 'AE'}</span>
                </h4>
                <div className={`p-4 rounded-lg mb-4 ${Math.abs(multipleCalibration.quotaDeviationPct) <= 10 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <p className={`font-medium ${Math.abs(multipleCalibration.quotaDeviationPct) <= 10 ? 'text-green-700' : 'text-yellow-700'}`}>
                    {Math.abs(multipleCalibration.quotaDeviationPct) <= 10
                      ? `Multiple-Kalibrierung passt (Quota-Abweichung ${multipleCalibration.quotaDeviationPct >= 0 ? '+' : ''}${multipleCalibration.quotaDeviationPct.toFixed(1)}%)`
                      : `Multiple-Kalibrierung prüfen (Quota-Abweichung ${multipleCalibration.quotaDeviationPct >= 0 ? '+' : ''}${multipleCalibration.quotaDeviationPct.toFixed(1)}%)`
                    }
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    OTC: {formatCurrency(multipleCalibration.otc)} | Multiple: {multipleCalibration.arrMultiple.toFixed(2)}x | Aktiv: {multipleCalibration.activeMonths}/12 Monate | Quota: {formatCurrency(multipleCalibration.quotaArr)} | Total ARR Target: {formatCurrency(multipleCalibration.totalArrTarget)}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Bruttomarge: {multipleCalibration.grossMarginPct.toFixed(1)}% | CAC Payback: {Number.isFinite(multipleCalibration.paybackMonths) ? `${multipleCalibration.paybackMonths.toFixed(1)} Monate` : 'n/a'}
                  </p>
                </div>
                <div className="p-4 rounded-lg mb-4 bg-indigo-50 border border-indigo-200">
                  <h5 className="font-medium text-indigo-800 mb-3">What-if: Ziel-Payback Szenario</h5>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-indigo-700 mb-1">Ø ACV pro Deal (€)</label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={whatIfAcv}
                        onChange={(e) => setWhatIfAcv(parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-indigo-700 mb-1">Ziel-Payback (Monate)</label>
                      <input
                        type="range"
                        min={paybackBenchmark.sliderMin}
                        max={paybackBenchmark.sliderMax}
                        step={0.1}
                        value={Math.min(paybackBenchmark.sliderMax, Math.max(paybackBenchmark.sliderMin, whatIfTargetPaybackMonths))}
                        onChange={(e) => {
                          const next = parseFloat(e.target.value) || paybackBenchmark.sliderMin;
                          setWhatIfTargetPaybackMonths(
                            Math.min(paybackBenchmark.sliderMax, Math.max(paybackBenchmark.sliderMin, next))
                          );
                        }}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-indigo-700 mb-1">Monate (genau)</label>
                      <input
                        type="number"
                        min={paybackBenchmark.sliderMin}
                        max={paybackBenchmark.sliderMax}
                        step={0.1}
                        value={whatIfTargetPaybackMonths}
                        onChange={(e) => {
                          const next = parseFloat(e.target.value) || paybackBenchmark.sliderMin;
                          setWhatIfTargetPaybackMonths(
                            Math.min(paybackBenchmark.sliderMax, Math.max(paybackBenchmark.sliderMin, next))
                          );
                        }}
                        className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWhatIfSolveFor('margin')}
                        className={`px-3 py-2 rounded-lg text-sm border ${whatIfSolveFor === 'margin' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300'}`}
                      >
                        Löse Marge
                      </button>
                      <button
                        type="button"
                        onClick={() => setWhatIfSolveFor('multiple')}
                        className={`px-3 py-2 rounded-lg text-sm border ${whatIfSolveFor === 'multiple' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300'}`}
                      >
                        Löse Multiple
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-indigo-900 space-y-1">
                    <p className="text-xs text-indigo-700">
                      Segment: <strong>{paybackBenchmark.segment}</strong> (ACV-abhängige Skala: {paybackBenchmark.sliderMin}-{paybackBenchmark.sliderMax} Monate)
                      {' '}| Bewertung: <strong className={whatIfPaybackRating.color}>{whatIfPaybackRating.label}</strong>
                    </p>
                    {whatIfSolveFor === 'margin' ? (
                      <>
                        <p>
                          Benötigte Gross Margin für {whatIfTargetPaybackMonths.toFixed(1)} Monate:
                          {' '}
                          <strong>{whatIfRequiredMarginPct !== null ? `${whatIfRequiredMarginPct.toFixed(1)}%` : 'n/a'}</strong>
                        </p>
                        {whatIfRequiredMarginPct !== null && whatIfRequiredMarginPct > 100 && (
                          <p className="text-red-600 text-xs">
                            Ziel nicht realistisch mit aktueller Quota (benoetigt &gt; 100% Marge).
                          </p>
                        )}
                      </>
                    ) : (
                      <p>
                        Benötigtes ARR Multiple für {whatIfTargetPaybackMonths.toFixed(1)} Monate:
                        {' '}
                        <strong>{whatIfRequiredMultiple !== null ? `${whatIfRequiredMultiple.toFixed(2)}x` : 'n/a'}</strong>
                      </p>
                    )}
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleApplyWhatIf}
                      disabled={!canApplyWhatIf}
                      className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Szenario in Eingaben übernehmen
                    </button>
                  </div>
                </div>
                <div className={`p-4 rounded-lg mb-4 ${oteValidation.valid ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <p className={`font-medium ${oteValidation.valid ? 'text-green-700' : 'text-yellow-700'}`}>
                    {oteValidation.valid
                      ? `OTE passt! Erwartete Provision: ${formatCurrency(oteValidation.expectedProvision)}`
                      : `OTE Abweichung: ${oteValidation.deviation > 0 ? '+' : ''}${oteValidation.deviation.toFixed(1)}%`
                    }
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    OTE: {formatCurrency(selectedAEOTE)} | Erwartet bei 100%: {formatCurrency(oteValidation.expectedProvision)}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-1">Szenario</th>
                        <th className="text-right py-2 px-1 text-green-600">Subs</th>
                        <th className="text-right py-2 px-1 text-orange-600">Pay</th>
                        <th className="text-right py-2 px-1 text-blue-600">Terminal</th>
                        <th className="text-right py-2 px-1 text-purple-700 font-bold">Gesamt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oteProjections.map((proj, i) => (
                        <tr key={i} className={`border-b ${proj.ote_match ? 'bg-green-50' : ''}`}>
                          <td className="py-1 px-1">{proj.scenario}</td>
                          <td className="py-1 px-1 text-right text-green-600">{formatCurrency(proj.subs_provision)}</td>
                          <td className="py-1 px-1 text-right text-orange-600">{formatCurrency(proj.pay_provision)}</td>
                          <td className="py-1 px-1 text-right text-blue-600">{formatCurrency(proj.terminal_provision)}</td>
                          <td className="py-1 px-1 text-right font-bold text-purple-700">
                            {formatCurrency(proj.total_provision)} {proj.ote_match && '✓'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ========== 7. PROVISIONSMODELL (AE-spezifisch) ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">
                  7. Provisionsmodell (Unified Total ARR) <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEUser?.name || 'AE'}</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Terminal Basis €</label>
                    <input
                      type="number"
                      value={selectedTerminalBase}
                      onChange={(e) => handleSelectedTerminalBaseChange(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Terminal Bonus €</label>
                    <input
                      type="number"
                      value={selectedTerminalBonus}
                      onChange={(e) => handleSelectedTerminalBonusChange(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mb-4">
                  Die Provisionstufen werden auf Gesamt-ARR-Zielerreichung angewandt.
                  Terminal-Provision bleibt als separater Einmalbetrag aktiv.
                </p>

                <div className="mb-4 p-4 rounded-lg border border-indigo-200 bg-indigo-50">
                  <h5 className="font-medium text-indigo-800 mb-3">Guided Tier Setup (betriebswirtschaftlich)</h5>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-indigo-700 mb-1">Ziel-Auszahlung bei 100% (€)</label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={tierGuideTargetPayoutAt100}
                        onChange={(e) => setTierGuideTargetPayoutAt100(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-white"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTierGuideTargetPayoutAt100(Math.round(selectedAEVariableOTE * 0.9))}
                          className="px-2 py-1 text-xs rounded border border-indigo-300 bg-white text-indigo-700"
                        >
                          90% Var OTE
                        </button>
                        <button
                          type="button"
                          onClick={() => setTierGuideTargetPayoutAt100(Math.round(selectedAEVariableOTE))}
                          className="px-2 py-1 text-xs rounded border border-indigo-300 bg-white text-indigo-700"
                        >
                          100% Var OTE
                        </button>
                        <button
                          type="button"
                          onClick={() => setTierGuideTargetPayoutAt100(Math.round(selectedAEVariableOTE * 1.1))}
                          className="px-2 py-1 text-xs rounded border border-indigo-300 bg-white text-indigo-700"
                        >
                          110% Var OTE
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-indigo-700 mb-1">Beschleunigungsprofil</label>
                      <select
                        value={tierGuideProfile}
                        onChange={(e) => setTierGuideProfile(e.target.value as 'conservative' | 'balanced' | 'aggressive')}
                        className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-white"
                      >
                        <option value="conservative">Konservativ</option>
                        <option value="balanced">Ausgewogen</option>
                        <option value="aggressive">Aggressiv</option>
                      </select>
                      <p className="mt-2 text-xs text-indigo-700">
                        ARR-Pool bei 100% (ohne Terminal): <strong>{formatCurrency(tierGuideArrPoolAt100)}</strong>
                      </p>
                      <p className="text-xs text-indigo-700">
                        Empfohlene 100%-Rate: <strong>{(tierGuideBaseRateAt100 * 100).toFixed(2)}%</strong>
                      </p>
                    </div>
                    <div className="flex flex-col justify-end">
                      <button
                        type="button"
                        onClick={handleApplyTierGuideSuggestion}
                        disabled={!selectedAEId || multipleCalibration.totalArrTarget <= 0}
                        className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Vorschlag in Total ARR Stufen übernehmen
                      </button>
                      <p className="mt-2 text-xs text-gray-600">
                        Nutzt Quota/Targets + Terminal-Provision als 100%-Anker.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                    <div className="p-2 rounded bg-white border border-indigo-100">
                      <div className="text-xs text-gray-500">Aktuell Auszahlung bei 100%</div>
                      <div className="font-semibold text-gray-800">{formatCurrency(tierGuideCurrentPayoutAt100)}</div>
                      <div className="text-xs text-gray-500">Rate bei 100%: {(tierGuideCurrentRateAt100 * 100).toFixed(2)}%</div>
                    </div>
                    <div className="p-2 rounded bg-white border border-indigo-100">
                      <div className="text-xs text-gray-500">Vorschlag Auszahlung bei 100%</div>
                      <div className="font-semibold text-indigo-800">{formatCurrency(tierGuideSuggestedPayoutAt100)}</div>
                      <div className="text-xs text-gray-500">Rate bei 100%: {(tierGuideSuggestedRateAt100 * 100).toFixed(2)}%</div>
                    </div>
                    <div className="p-2 rounded bg-white border border-indigo-100">
                      <div className="text-xs text-gray-500">Vorschlag Auszahlung bei 120%</div>
                      <div className="font-semibold text-indigo-800">{formatCurrency(tierGuideSuggestedPayoutAt120)}</div>
                      <div className="text-xs text-gray-500">Rate bei 120%: {(tierGuideSuggestedRateAt120 * 100).toFixed(2)}%</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Mehr ARR (120% vs. 100%): <strong>{formatCurrency(tierGuideArrGainAt120)}</strong>
                      </div>
                      <div className={`text-xs mt-1 ${tierGuideExtraPayoutVsDefaultAt120 >= 0 ? 'text-amber-700' : 'text-green-700'}`}>
                        Mehr OTE/Payout vs. Standard (bei 120%): <strong>{tierGuideExtraPayoutVsDefaultAt120 >= 0 ? '+' : ''}{formatCurrency(tierGuideExtraPayoutVsDefaultAt120)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <h5 className="font-medium text-purple-700 mb-2">Total ARR Stufen</h5>
                    <table className="w-full text-sm">
                      <tbody>
                        {selectedTotalArrTiers.map((tier, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-1">{tier.label}</td>
                            <td className="py-1 text-right">
                              <input
                                type="number"
                                value={(tier.rate * 100).toFixed(1)}
                                onChange={(e) => handleSelectedTotalArrTierRateChange(i, parseFloat(e.target.value) || 0)}
                                className="w-14 px-1 py-0.5 text-right border rounded text-xs"
                                step="0.1"
                              />%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h5 className="font-medium text-blue-700 mb-2">Terminal-Provision (Einmalig)</h5>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className={`border-b ${selectedAEPenetration < (terminalPenetrationThreshold / 100) ? 'bg-blue-50' : ''}`}>
                          <td className="py-1">&lt; {terminalPenetrationThreshold}%</td>
                          <td className="py-1 text-right font-medium">€{selectedTerminalBase}</td>
                          <td className="py-1 text-right text-xs text-gray-500">pro Terminal</td>
                        </tr>
                        <tr className={`border-b ${selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? 'bg-blue-50' : ''}`}>
                          <td className="py-1">≥ {terminalPenetrationThreshold}%</td>
                          <td className="py-1 text-right font-medium">€{selectedTerminalBonus}</td>
                          <td className="py-1 text-right text-xs text-gray-500">pro Terminal</td>
                        </tr>
                      </tbody>
                    </table>
                    {selectedAEUser && (
                      <div className={`mt-2 p-2 rounded text-xs ${selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        <strong>{selectedAEUser.name.split(' ')[0]}:</strong> {(selectedAEPenetration * 100).toFixed(0)}% Penetration
                        {' '}→ <strong>€{selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? selectedTerminalBonus : selectedTerminalBase}</strong> × {selectedAEPayTerminals} = <strong>{formatCurrency(selectedAEPayTerminals * (selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? selectedTerminalBonus : selectedTerminalBase))}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ========== 8. PARTNER & SUBSCRIPTION MANAGEMENT ========== */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                <h4 className="text-md font-bold text-gray-800">
                  8. Partner & Subscription Management
                </h4>
                <p className="text-sm text-gray-600">
                  Verwaltung von Partnern und Subscription-Paketen direkt im Planning Overview.
                </p>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                  <div className="rounded-lg border border-gray-200 p-4 bg-white">
                    <PartnerManagement />
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4 bg-white">
                    <SubscriptionPackageManagement />
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* 2. EXPANDING ARR */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-blue-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-blue-50 cursor-pointer"
              onClick={() => togglePlanningSection('expandingArr')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚀</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">2. EXPANDING ARR</h3>
                  <p className="text-sm text-gray-500">ARR aus Bestandskundenwachstum (Upselling, Cross-Selling)</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.expandingArr ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.expandingArr && (
            <div className="p-6">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 mb-4">
                Monatliche Targets fuer Upgrade/Downgrade koennen hier gepflegt werden.
              </div>
              <div className="space-y-3 overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-12 gap-1 mb-1">
                    {MONTHS.map((m) => (
                      <div key={`expanding-header-${m}`} className="text-center text-xs text-gray-500 font-medium">
                        {m}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">TOTAL Upgrades (Package + Add-On)</span>
                        <span className="text-xs text-gray-500">Jahressumme: {sumMonthlyValues(expandingTotalUpgrades)}</span>
                      </div>
                      <div className="grid grid-cols-12 gap-1">
                        {MONTHS.map((m, i) => (
                          <input
                            key={`expanding-upgrades-${m}`}
                            type="number"
                            value={expandingTotalUpgrades[i] ?? 0}
                            onChange={(e) =>
                              updateMonthlyValues(
                                setExpandingTotalUpgrades,
                                i,
                                parseInt(e.target.value, 10) || 0
                              )
                            }
                            className="w-full px-1 py-1 text-center border border-green-200 rounded text-sm bg-white"
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">TOTAL Downgrades (Package + Add-On)</span>
                        <span className="text-xs text-gray-500">Jahressumme: {sumMonthlyValues(expandingTotalDowngrades)}</span>
                      </div>
                      <div className="grid grid-cols-12 gap-1">
                        {MONTHS.map((m, i) => (
                          <input
                            key={`expanding-downgrades-${m}`}
                            type="number"
                            value={expandingTotalDowngrades[i] ?? 0}
                            onChange={(e) =>
                              updateMonthlyValues(
                                setExpandingTotalDowngrades,
                                i,
                                parseInt(e.target.value, 10) || 0
                              )
                            }
                            className="w-full px-1 py-1 text-center border border-orange-200 rounded text-sm bg-white"
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">Net Upgrade Downgrade ARR</span>
                        <span className="text-xs text-gray-500">
                          Jahressumme: {formatCurrency(sumMonthlyValues(expandingNetUpgradeDowngradeArr))}
                        </span>
                      </div>
                      <div className="grid grid-cols-12 gap-1">
                        {MONTHS.map((m, i) => (
                          <input
                            key={`expanding-net-arr-${m}`}
                            type="number"
                            step="0.01"
                            value={expandingNetUpgradeDowngradeArr[i] ?? 0}
                            onChange={(e) =>
                              updateMonthlyValues(
                                setExpandingNetUpgradeDowngradeArr,
                                i,
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-1 py-1 text-center border border-blue-200 rounded text-sm bg-white"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* 3. CHURN ARR */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-red-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-red-50 cursor-pointer"
              onClick={() => togglePlanningSection('churnArr')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📉</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">3. CHURN ARR</h3>
                  <p className="text-sm text-gray-500">Verlorener ARR durch Kündigungen und Downgrades</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.churnArr ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.churnArr && (
            <div className="p-6 space-y-6">
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
                Die Werte werden manuell gepflegt. Negative Zahlen repräsentieren Churn.
              </div>
              <div className="space-y-2 text-xs">
                {churnAutoSaving ? (
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
                    Auto-Save aktiv: CHURN ARR wird gespeichert...
                  </div>
                ) : null}
                {churnAutoSaveError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                    Auto-Save fehlgeschlagen: {churnAutoSaveError}
                  </div>
                ) : null}
                {!churnAutoSaving && !churnAutoSaveError ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                    {lastChurnAutoSaveAt
                      ? `Zuletzt automatisch gespeichert: ${new Date(lastChurnAutoSaveAt).toLocaleString('de-DE')}`
                      : 'Auto-Save aktiv: CHURN ARR wird bei Eingabe automatisch gespeichert.'}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-md font-bold text-gray-800">Invoiced Churn</h4>
                  <div className="text-xs text-gray-500">Quelle: Looker Messenger Churn Dash (manuell uebertragen)</div>
                </div>
                <div className="space-y-3 overflow-x-auto">
                  <div className="min-w-[980px]">
                    <div className="grid grid-cols-12 gap-1 mb-1">
                      {MONTHS.map((m) => (
                        <div key={`invoiced-header-${m}`} className="text-center text-xs text-gray-500 font-medium">
                          {m}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">Invoiced Churn Target</span>
                          <span className="text-xs text-gray-500">Jahressumme: {sumMonthlyValues(invoicedChurnTargetCount)}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`invoiced-target-count-${m}`}
                              type="number"
                              value={invoicedChurnTargetCount[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInvoicedChurnTargetCount,
                                  i,
                                  toNegativeOrZero(parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">Invoiced Churn Actual</span>
                          <span className="text-xs text-gray-500">Jahressumme: {sumMonthlyValues(invoicedChurnActualCount)}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`invoiced-actual-count-${m}`}
                              type="number"
                              value={invoicedChurnActualCount[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInvoicedChurnActualCount,
                                  i,
                                  toNegativeOrZero(parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">Invoiced Churn Target ARR</span>
                          <span className="text-xs text-gray-500">Jahressumme: {formatCurrency(sumMonthlyValues(invoicedChurnTargetArr))}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`invoiced-target-arr-${m}`}
                              type="number"
                              step="0.01"
                              value={invoicedChurnTargetArr[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInvoicedChurnTargetArr,
                                  i,
                                  toNegativeOrZero(parseFloat(e.target.value) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">Invoiced Churn Actual ARR</span>
                          <span className="text-xs text-gray-500">Jahressumme: {formatCurrency(sumMonthlyValues(invoicedChurnActualArr))}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`invoiced-actual-arr-${m}`}
                              type="number"
                              step="0.01"
                              value={invoicedChurnActualArr[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInvoicedChurnActualArr,
                                  i,
                                  toNegativeOrZero(parseFloat(e.target.value) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-md font-bold text-gray-800">In Month Churn</h4>
                  <button
                    type="button"
                    onClick={applyInMonthTargetsFromInvoiced}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Aus Invoiced (naechster Monat) ableiten
                  </button>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Jan-Nov werden aus Invoiced Feb-Dez abgeleitet. Dez bleibt manuell fuer Jan Folgejahr.
                </div>
                <div className="space-y-3 overflow-x-auto">
                  <div className="min-w-[980px]">
                    <div className="grid grid-cols-12 gap-1 mb-1">
                      {MONTHS.map((m) => (
                        <div key={`inmonth-header-${m}`} className="text-center text-xs text-gray-500 font-medium">
                          {m}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">In Month Churn Target</span>
                          <span className="text-xs text-gray-500">Jahressumme: {sumMonthlyValues(inMonthChurnTargetCount)}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`inmonth-target-count-${m}`}
                              type="number"
                              value={inMonthChurnTargetCount[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInMonthChurnTargetCount,
                                  i,
                                  toNegativeOrZero(parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">In Month Churn Target ARR</span>
                          <span className="text-xs text-gray-500">Jahressumme: {formatCurrency(sumMonthlyValues(inMonthChurnTargetArr))}</span>
                        </div>
                        <div className="grid grid-cols-12 gap-1">
                          {MONTHS.map((m, i) => (
                            <input
                              key={`inmonth-target-arr-${m}`}
                              type="number"
                              step="0.01"
                              value={inMonthChurnTargetArr[i] ?? 0}
                              onChange={(e) =>
                                updateMonthlyValues(
                                  setInMonthChurnTargetArr,
                                  i,
                                  toNegativeOrZero(parseFloat(e.target.value) || 0)
                                )
                              }
                              className="w-full px-1 py-1 text-center border border-red-200 rounded text-sm bg-white"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* 4. New clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-emerald-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-emerald-50 cursor-pointer"
              onClick={() => togglePlanningSection('newClients')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">👥</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">4. New clients</h3>
                  <p className="text-sm text-gray-500">Anzahl neuer Kunden</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.newClients ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.newClients && (
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für New clients Daten</p>
            </div>
            )}
          </div>

          {/* 5. Churned clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-orange-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-orange-50 cursor-pointer"
              onClick={() => togglePlanningSection('churnedClients')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚪</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">5. Churned clients</h3>
                  <p className="text-sm text-gray-500">Anzahl gekündigter Kunden</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.churnedClients ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.churnedClients && (
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für Churned clients Daten</p>
            </div>
            )}
          </div>

          {/* 6. Ending clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-purple-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-purple-50 cursor-pointer"
              onClick={() => togglePlanningSection('endingClients')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏰</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">6. Ending clients</h3>
                  <p className="text-sm text-gray-500">Anzahl auslaufender Kundenverträge</p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.endingClients ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.endingClients && (
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für Ending clients Daten</p>
            </div>
            )}
          </div>

          {/* 7. Sales Cycle Planregeln */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-indigo-500">
            <div
              className="px-6 py-4 border-b border-gray-200 bg-indigo-50 cursor-pointer"
              onClick={() => togglePlanningSection('salesCycle')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏱️</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">7. Sales Cycle Planregeln</h3>
                  <p className="text-sm text-gray-500">
                    Editierbare Max-Tage je Stage sowie abgeleitete Min/Max-Sales-Cycle-Dauer
                  </p>
                </div>
                <span className="ml-auto text-gray-500">{planningSectionsExpanded.salesCycle ? '▼' : '▶'}</span>
              </div>
            </div>
            {planningSectionsExpanded.salesCycle && (
              <div className="p-6 space-y-6">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-700">
                  Standard-Logik: Lead → Demo Booked → Sent Quote (20/50/70/90%) → Close Won/Close Lost.
                  Alle Felder sind flexibel editierbar und werden mit den Planzahlen gespeichert.
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lead zu Demo Booked (max. Tage)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salesCyclePlanRules.lead_to_demo_booked_days}
                      onChange={(e) =>
                        updateSalesCycleRule('lead_to_demo_booked_days', parseInt(e.target.value, 10) || 0)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Demo Booked zu Sent Quote 20% (max. Tage)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salesCyclePlanRules.demo_booked_to_sent_quote_20_days}
                      onChange={(e) =>
                        updateSalesCycleRule(
                          'demo_booked_to_sent_quote_20_days',
                          parseInt(e.target.value, 10) || 0
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sent Quote 20% zu 50% (max. Tage)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salesCyclePlanRules.sent_quote_20_to_sent_quote_50_days}
                      onChange={(e) =>
                        updateSalesCycleRule(
                          'sent_quote_20_to_sent_quote_50_days',
                          parseInt(e.target.value, 10) || 0
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sent Quote 50% zu 70% (max. Tage)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salesCyclePlanRules.sent_quote_50_to_sent_quote_70_days}
                      onChange={(e) =>
                        updateSalesCycleRule(
                          'sent_quote_50_to_sent_quote_70_days',
                          parseInt(e.target.value, 10) || 0
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sent Quote 70% zu 90% (max. Tage)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={salesCyclePlanRules.sent_quote_70_to_sent_quote_90_days}
                      onChange={(e) =>
                        updateSalesCycleRule(
                          'sent_quote_70_to_sent_quote_90_days',
                          parseInt(e.target.value, 10) || 0
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <div className="text-xs text-blue-700">Max bis Sent Quote 20%</div>
                    <div className="text-xl font-bold text-blue-800">{salesCycleMaxToSentQuote20} Tage</div>
                  </div>
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                    <div className="text-xs text-cyan-700">Max bis Sent Quote 50%</div>
                    <div className="text-xl font-bold text-cyan-800">{salesCycleMaxToSentQuote50} Tage</div>
                  </div>
                  <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                    <div className="text-xs text-teal-700">Max bis Sent Quote 70%</div>
                    <div className="text-xl font-bold text-teal-800">{salesCycleMaxToSentQuote70} Tage</div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <div className="text-xs text-indigo-700">Max bis Sent Quote 90%</div>
                    <div className="text-xl font-bold text-indigo-800">{salesCycleMaxToSentQuote90} Tage</div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div className="text-xs text-emerald-700">Schnellster Sales Cycle</div>
                    <div className="text-xl font-bold text-emerald-800">{salesCycleMinDays} Tage</div>
                  </div>
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                    <div className="text-xs text-purple-700">Längster Sales Cycle</div>
                    <div className="text-xl font-bold text-purple-800">{salesCycleMaxToSentQuote90} Tage</div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  Nach Erreichen des jeweiligen Stage-Limits muss die Opportunity in den nächsten Stage wechseln
                  oder geschlossen werden (Close Won/Close Lost).
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Tab */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.settings.systemInfo')}</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-2">{t('dlt.settings.appVersion')}</h4>
                <p className="text-lg font-semibold text-gray-800">Commercial Business Planner v4.0</p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-2">{t('dlt.settings.currentUser')}</h4>
                <p className="text-lg font-semibold text-gray-800">{user.name}</p>
                <p className="text-sm text-gray-500">{getRoleLabel(user.role)}</p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-2">{t('dlt.settings.totalUsers')}</h4>
                <p className="text-lg font-semibold text-gray-800">{users.length}</p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-gray-500 mb-2">{t('dlt.settings.activeAEs')}</h4>
                <p className="text-lg font-semibold text-gray-800">{users.filter(u => isPlannable(u.role)).length}</p>
              </div>
            </div>
          </div>

          {/* Feature Status */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.settings.featureStatus')}</h3>
            
            <div className="space-y-3">
              {[
                { name: 'New Business Dashboard', status: 'active' },
                { name: 'DLT Leadership Dashboard', status: 'active' },
                { name: 'Team Performance', status: 'active' },
                { name: 'Strategic Reports', status: 'active' },
                { name: 'Expanding Business', status: 'planned' },
                { name: 'Marketing Dashboard', status: 'planned' }
              ].map(feature => (
                <div key={feature.name} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-700">{feature.name}</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    feature.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {feature.status === 'active' ? t('dlt.settings.active') : t('dlt.settings.planned')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
