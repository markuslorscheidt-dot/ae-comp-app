// ============================================================================
// SALES PIPELINE TYPES
// Version: 1.0
// ============================================================================

// ============================================================================
// IMPORT/STAGING TYPES
// ============================================================================

// Import Batch Types
export type ImportBatchStatus = 'open' | 'completed' | 'discarded' | 'rolled_back';
export type ImportMatchStatus = 'new' | 'changed' | 'unchanged' | 'conflict' | 'pending';
export type UserMatchStatus = 'matched' | 'unmatched' | 'manual' | 'pending';

export interface ImportBatch {
  id: string;
  created_at: string;
  created_by: string;
  source_filename: string;
  source_type: string;
  status: ImportBatchStatus;
  completed_at: string | null;
  discarded_at: string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  stats_total: number;
  stats_new: number;
  stats_updated: number;
  stats_skipped: number;
  stats_conflicts: number;
  // Joined
  created_by_user?: { name: string };
  rolled_back_by_user?: { name: string };
}

export interface ImportStagingRow {
  id: string;
  batch_id: string;
  row_number: number;
  raw_data: Record<string, string>;
  parsed_company_name: string | null;
  parsed_opportunity_name: string | null;
  parsed_stage: string | null;
  parsed_close_date: string | null;
  parsed_created_date: string | null;
  parsed_owner_name: string | null;
  parsed_notes: string | null;
  parsed_rating: string | null;
  sfid: string | null;
  match_status: ImportMatchStatus;
  matched_lead_id: string | null;
  matched_opportunity_id: string | null;
  matched_user_id: string | null;
  user_match_status: UserMatchStatus;
  changes: Record<string, { from: string; to: string }> | null;
  is_selected: boolean;
  conflict_resolved: boolean;
  created_lead_id: string | null;
  created_opportunity_id: string | null;
  created_at: string;
  // Joined
  matched_user?: { id: string; name: string };
  matched_lead?: { id: string; company_name: string };
  matched_opportunity?: { id: string; name: string; stage: string };
}

// Salesforce CSV Stage Mapping
export const SALESFORCE_STAGE_MAP: Record<string, OpportunityStage> = {
  'sql': 'sql',
  'demo booked': 'demo_booked',
  'demo completed': 'demo_completed',
  'demo cancelled/no-show': 'nurture',
  'demo cancelled': 'nurture',
  'no-show': 'nurture',
  'sent quote': 'sent_quote',
  'closed won': 'close_won',
  'closed lost': 'close_lost',
  'nurture': 'nurture',
};

// Helper: Parse Salesforce Stage
export function parseSalesforceStage(sfStage: string): OpportunityStage {
  const normalized = sfStage.toLowerCase().trim();
  return SALESFORCE_STAGE_MAP[normalized] || 'sql';
}

// Helper: Extract SFID from Salesforce Sign-Up Link
export function extractSfidFromLink(link: string): string | null {
  if (!link) return null;
  const match = link.match(/sfid=([^&]+)/);
  return match ? match[1] : null;
}

// Helper: Parse German date (DD.MM.YYYY) to ISO
export function parseGermanDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

// ============================================================================
// PIPELINE TYPES
// ============================================================================

// Pipeline Stages
export type OpportunityStage = 
  | 'sql' 
  | 'demo_booked' 
  | 'demo_completed' 
  | 'sent_quote' 
  | 'close_won' 
  | 'close_lost' 
  | 'nurture';

// Lead-Ursprung
export type LeadSource = 'inbound' | 'outbound' | 'partnership' | 'enterprise';

// Lead Status
export type LeadStatus = 'active' | 'nurture' | 'disqualified';

// Lost Reason Kategorien
export type LostReasonCategory = 'general' | 'feature' | 'price' | 'timing';

// Activity Types
export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task';

// Activity Outcome
export type ActivityOutcome = 'positive' | 'neutral' | 'negative' | 'no_answer';

// Notification Types
export type NotificationType = 
  | 'deal_overdue' 
  | 'deal_stuck' 
  | 'forecast_warning' 
  | 'forecast_critical'
  | 'stage_changed'
  | 'deal_won'
  | 'deal_lost';

// Notification Priority
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

// ============================================================================
// INTERFACES
// ============================================================================

export interface Competitor {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface LostReason {
  id: string;
  reason: string;
  category: LostReasonCategory;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  
  // Unternehmensdaten
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  
  // Unternehmensgröße
  employee_count: number | null;
  location_count: number;
  
  // Lead-Ursprung
  lead_source: LeadSource;
  
  // Aktuelle Software
  has_existing_software: boolean;
  competitor_id: string | null;
  
  // Notizen
  notes: string | null;
  
  // Status
  status: LeadStatus;
  
  // Import-Tracking
  imported_from: string | null;
  external_id: string | null;
  sfid: string | null;
  import_batch_id: string | null;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  
  // Archive
  archived: boolean;
  archived_at: string | null;
  
  // Joined data (optional)
  competitor?: Competitor;
  opportunities?: Opportunity[];
  opportunities_count?: number;
}

export interface Opportunity {
  id: string;
  lead_id: string;
  user_id: string;
  
  // Name
  name: string;
  
  // Stage
  stage: OpportunityStage;
  stage_changed_at: string;
  
  // Lost Details
  lost_reason_id: string | null;
  lost_reason_notes: string | null;
  
  // Werte (monatlich)
  expected_subs_monthly: number;
  expected_pay_monthly: number;
  has_terminal: boolean;
  
  // Probability & Timing
  probability: number | null;  // NULL = Stage-Default
  expected_close_date: string | null;
  
  // Tracking-Daten
  demo_booked_date: string | null;
  demo_completed_date: string | null;
  quote_sent_date: string | null;
  
  // Go-Live Verknüpfung
  go_live_id: string | null;
  
  // Import-Tracking
  imported_from: string | null;
  external_id: string | null;
  sfid: string | null;
  import_batch_id: string | null;
  sf_owner_name: string | null;  // Original SF Owner Name (auch wenn kein App-User Match)
  sf_created_date: string | null;  // Salesforce Erstelldatum (aus CSV Import)
  
  // Timestamps
  created_at: string;
  updated_at: string;
  
  // Archive
  archived: boolean;
  archived_at: string | null;
  
  // Joined data (optional)
  lead?: Lead;
  lost_reason?: LostReason;
  assigned_user?: { id: string; name: string };  // Für Owner-Anzeige
}

export interface OpportunityStageHistory {
  id: string;
  opportunity_id: string;
  from_stage: OpportunityStage | null;
  to_stage: OpportunityStage;
  changed_at: string;
  changed_by: string | null;
  probability_at_change: number | null;
  expected_arr_at_change: number | null;
}

export interface PipelineSettings {
  id: string;
  user_id: string | null;  // NULL = globale Defaults
  
  // Stage Probabilities
  sql_probability: number;
  demo_booked_probability: number;
  demo_completed_probability: number;
  sent_quote_probability: number;
  
  // Cycle Length (Tage)
  sql_to_demo_booked_days: number;
  demo_booked_to_completed_days: number;
  demo_completed_to_quote_days: number;
  quote_to_close_days: number;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface PipelineActivity {
  id: string;
  opportunity_id: string | null;
  lead_id: string | null;
  user_id: string;
  
  activity_type: ActivityType;
  subject: string | null;
  description: string | null;
  activity_date: string;
  duration_minutes: number | null;
  meeting_type: string | null;
  outcome: ActivityOutcome | null;
  next_action: string | null;
  next_action_date: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  
  type: NotificationType;
  title: string;
  message: string | null;
  
  related_type: string | null;
  related_id: string | null;
  
  is_read: boolean;
  read_at: string | null;
  priority: NotificationPriority;
  
  created_at: string;
  expires_at: string | null;
}

export interface NotificationSettings {
  id: string;
  user_id: string;
  
  notify_deal_overdue: boolean;
  notify_deal_stuck: boolean;
  notify_deal_stuck_days: number;
  
  notify_forecast_warning: boolean;
  forecast_warning_threshold: number;
  
  notify_team_deals: boolean;
  notify_team_golives: boolean;
  
  in_app_enabled: boolean;
  email_enabled: boolean;
  email_digest: string;
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Stage-Konfiguration mit Labels und Farben
export const OPPORTUNITY_STAGES: Record<OpportunityStage, {
  label: string;
  labelEn: string;
  color: string;
  bgColor: string;
  defaultProbability: number;
  icon: string;
}> = {
  sql: {
    label: 'SQL',
    labelEn: 'SQL',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    defaultProbability: 0.15,
    icon: '🔵',
  },
  demo_booked: {
    label: 'Demo Booked',
    labelEn: 'Demo Booked',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-100',
    defaultProbability: 0.25,
    icon: '📅',
  },
  demo_completed: {
    label: 'Demo Completed',
    labelEn: 'Demo Completed',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    defaultProbability: 0.50,
    icon: '🟡',
  },
  sent_quote: {
    label: 'Sent Quote',
    labelEn: 'Sent Quote',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    defaultProbability: 0.75,
    icon: '🟢',
  },
  close_won: {
    label: 'Closed Won',
    labelEn: 'Closed Won',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    defaultProbability: 1.0,
    icon: '✅',
  },
  close_lost: {
    label: 'Closed Lost',
    labelEn: 'Closed Lost',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    defaultProbability: 0,
    icon: '❌',
  },
  nurture: {
    label: 'Nurture',
    labelEn: 'Nurture',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    defaultProbability: 0.05,
    icon: '⏸️',
  },
};

// Lead-Quellen mit Labels
export const LEAD_SOURCES: Record<LeadSource, { label: string; labelEn: string; icon: string }> = {
  inbound: { label: 'Inbound Marketing', labelEn: 'Inbound Marketing', icon: '📥' },
  outbound: { label: 'Outbound', labelEn: 'Outbound', icon: '📞' },
  partnership: { label: 'Partnership', labelEn: 'Partnership', icon: '🤝' },
  enterprise: { label: 'Enterprise (5+ Filialen)', labelEn: 'Enterprise (5+ locations)', icon: '🏢' },
};

// Pipeline Stages für Forecasting (nur aktive)
export const ACTIVE_PIPELINE_STAGES: OpportunityStage[] = [
  'sql',
  'demo_booked',
  'demo_completed',
  'sent_quote',
];

// Stages die zu Deals führen können
export const CLOSEABLE_STAGES: OpportunityStage[] = [
  'sql',
  'demo_booked',
  'demo_completed',
  'sent_quote',
  'nurture',
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Berechnet den ARR aus monatlichem Wert
 */
export function calculateARR(monthly: number | null | undefined): number {
  return (monthly || 0) * 12;
}

/**
 * Berechnet den gewichteten Wert einer Opportunity
 */
export function calculateWeightedValue(
  opportunity: Opportunity,
  settings?: PipelineSettings
): number {
  const subsARR = calculateARR(opportunity.expected_subs_monthly);
  const payARR = calculateARR(opportunity.expected_pay_monthly);
  const totalARR = subsARR + payARR;
  
  const probability = opportunity.probability ?? getDefaultProbability(opportunity.stage, settings);
  
  return totalARR * probability;
}

/**
 * Holt die Default-Probability für eine Stage
 */
export function getDefaultProbability(
  stage: OpportunityStage,
  settings?: PipelineSettings
): number {
  if (settings) {
    switch (stage) {
      case 'sql': return settings.sql_probability;
      case 'demo_booked': return settings.demo_booked_probability;
      case 'demo_completed': return settings.demo_completed_probability;
      case 'sent_quote': return settings.sent_quote_probability;
      case 'close_won': return 1.0;
      case 'close_lost': return 0;
      case 'nurture': return 0.05;
    }
  }
  return OPPORTUNITY_STAGES[stage].defaultProbability;
}

/**
 * Berechnet das erwartete Close-Datum basierend auf Stage und Settings
 */
export function calculateExpectedCloseDate(
  stage: OpportunityStage,
  settings?: PipelineSettings,
  fromDate: Date = new Date()
): Date {
  let daysRemaining = 0;
  
  const s = settings || {
    sql_to_demo_booked_days: 7,
    demo_booked_to_completed_days: 5,
    demo_completed_to_quote_days: 7,
    quote_to_close_days: 5,
  };
  
  switch (stage) {
    case 'sql':
      daysRemaining = s.sql_to_demo_booked_days + s.demo_booked_to_completed_days + 
                      s.demo_completed_to_quote_days + s.quote_to_close_days;
      break;
    case 'demo_booked':
      daysRemaining = s.demo_booked_to_completed_days + s.demo_completed_to_quote_days + 
                      s.quote_to_close_days;
      break;
    case 'demo_completed':
      daysRemaining = s.demo_completed_to_quote_days + s.quote_to_close_days;
      break;
    case 'sent_quote':
      daysRemaining = s.quote_to_close_days;
      break;
    default:
      daysRemaining = 0;
  }
  
  const closeDate = new Date(fromDate);
  closeDate.setDate(closeDate.getDate() + daysRemaining);
  return closeDate;
}

/**
 * Prüft ob eine Stage eine "gewonnene" Stage ist
 */
export function isWonStage(stage: OpportunityStage): boolean {
  return stage === 'close_won';
}

/**
 * Prüft ob eine Stage eine "verlorene" Stage ist
 */
export function isLostStage(stage: OpportunityStage): boolean {
  return stage === 'close_lost';
}

/**
 * Prüft ob eine Stage eine "aktive" Pipeline-Stage ist
 */
export function isActiveStage(stage: OpportunityStage): boolean {
  return ACTIVE_PIPELINE_STAGES.includes(stage);
}

/**
 * Formatiert ein Datum für die Anzeige
 */
export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Berechnet die Anzahl der Tage zwischen zwei Daten
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Berechnet die Anzahl der Tage bis zu einem Datum
 */
export function daysUntil(date: Date | string): number {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Prüft ob ein Deal überfällig ist
 */
export function isOverdue(opportunity: Opportunity): boolean {
  if (!opportunity.expected_close_date) return false;
  if (isWonStage(opportunity.stage) || isLostStage(opportunity.stage)) return false;
  return daysUntil(opportunity.expected_close_date) < 0;
}

/**
 * Prüft ob ein Deal "stuck" ist (zu lange in gleicher Stage)
 */
export function isStuck(opportunity: Opportunity, stuckDays: number = 7): boolean {
  if (isWonStage(opportunity.stage) || isLostStage(opportunity.stage)) return false;
  return daysBetween(opportunity.stage_changed_at, new Date()) > stuckDays;
}
