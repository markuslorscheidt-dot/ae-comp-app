'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, UserRoleHistoryRecord, ProvisionTier, AESettings, GoLive, isPlannable, canReceiveGoLives, getDefaultCommissionRelevant, BUSINESS_AREA_LABELS, BusinessArea, MONTH_NAMES, DEFAULT_SETTINGS, DEFAULT_SUBS_TIERS, DEFAULT_PAY_TIERS, calculateMonthlySubsTargets, calculateTotalGoLives } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useMultiUserData, useAllSettings, useGoLivesForUser } from '@/lib/hooks';
import { getPermissions } from '@/lib/permissions';
import { formatCurrency, calculateOTEProjections, validateOTESettings } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import GoLiveForm from './GoLiveForm';

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
  head_of_marketing: 'bg-pink-100 text-pink-700'
};

// Months for Business Targets
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

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

type SettingsTab = 'users' | 'goLives' | 'permissions' | 'areas' | 'planning' | 'system';

export default function DLTSettings({ user }: DLTSettingsProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all');
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
  
  // Business Pay Terminals, Terminal Sales und Tipping (monatlich)
  const [businessPayTerminals, setBusinessPayTerminals] = useState<number[]>([]);
  const [businessTerminalSales, setBusinessTerminalSales] = useState<number[]>([]);
  const [businessTipping, setBusinessTipping] = useState<number[]>([]);
  
  // ========== NEW ARR: UMSATZ-BERECHNUNG ==========
  const [avgSubsBill, setAvgSubsBill] = useState(NEW_ARR_DEFAULTS.avgSubsBill);
  const [avgPayBillTerminal, setAvgPayBillTerminal] = useState(NEW_ARR_DEFAULTS.avgPayBillTerminal);
  const [avgPayBillTipping, setAvgPayBillTipping] = useState(NEW_ARR_DEFAULTS.avgPayBillTipping);
  
  // UI State
  const [businessTargetsExpanded, setBusinessTargetsExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingPlanzahlen, setLoadingPlanzahlen] = useState(true);
  const [saveMessage, setSaveMessage] = useState('');
  const [planzahlenId, setPlanzahlenId] = useState<string | null>(null);

  // ========== AE-SPEZIFISCHE NEW ARR SETTINGS ==========
  const [selectedAEId, setSelectedAEId] = useState<string | null>(null);
  const [aePercentages, setAePercentages] = useState<Map<string, number>>(new Map());
  const [aeOTEs, setAeOTEs] = useState<Map<string, number>>(new Map());
  const [aeTerminalBase, setAeTerminalBase] = useState<Map<string, number>>(new Map());
  const [aeTerminalBonus, setAeTerminalBonus] = useState<Map<string, number>>(new Map());
  const [aeSubsTiers, setAeSubsTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  const [aePayTiers, setAePayTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  
  // Load all users
  const { users, loading, refetch: refetchUsers, updateUserRole } = useAllUsers();
  const { settings: allSettings } = useAllSettings(newArrYear);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userEditError, setUserEditError] = useState('');
  const [roleHistory, setRoleHistory] = useState<UserRoleHistoryRecord[]>([]);
  const [plannedRoleChanges, setPlannedRoleChanges] = useState<Record<string, { role: UserRole; effective_from: string }>>({});
  const [selectedRole, setSelectedRole] = useState<UserRole | ''>('');
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

  useEffect(() => {
    if (activeTab === 'goLives') {
      loadManualGoLiveWriteLockState();
      loadAutoImportState();
      loadImportHistory();
    }
  }, [activeTab, loadManualGoLiveWriteLockState, loadAutoImportState, loadImportHistory]);

  useEffect(() => {
    if (activeTab !== 'goLives' || !selectedImportRunId) return;
    loadImportRunItems(selectedImportRunId);
  }, [activeTab, selectedImportRunId, loadImportRunItems]);

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
  
  // ========== PLANZAHLEN: LADEN ==========
  const loadPlanzahlen = useCallback(async (year: number) => {
    setLoadingPlanzahlen(true);
    try {
      const { data, error } = await supabase
        .from('dlt_planzahlen')
        .select('*')
        .eq('year', year)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('Fehler beim Laden der Planzahlen:', error);
        return;
      }
      
      if (data) {
        loadingFromDbRef.current = true;
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
  
  // Auto-Save: beim Verlassen des Planzahlen-Tabs oder beim Schließen der Einstellungen
  useEffect(() => {
    if (activeTab !== 'planning') return;
    return () => {
      savePlanzahlen();
    };
  }, [activeTab]);
  
  // ========== PLANZAHLEN: SPEICHERN ==========
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
        expanding_arr_data: {},
        churn_arr_data: {},
        new_clients_data: {},
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
        const inboundTargets = calculateFromPercentage(businessInbound, percentage);
        const outboundTargets = calculateFromPercentage(businessOutbound, percentage);
        const partnershipTargets = calculateFromPercentage(businessPartnerships, percentage);
        const goLiveTargets = calculateTotalGoLives(inboundTargets, outboundTargets, partnershipTargets);
        const terminalSalesTargets = goLiveTargets.map((v) => Math.round(v * terminalSalesPercent / 100));
        const tippingTargets = terminalSalesTargets.map((v) => Math.round(v * tippingPercent / 100));
        const monthlySubsTargets = calculateMonthlySubsTargets(goLiveTargets, avgSubsBill);
        const monthlyPayTargets = terminalSalesTargets.map((ts, i) => (ts * avgPayBillTerminal * 12) + (tippingTargets[i] * avgPayBillTipping * 12));

        const payload = {
          user_id: ae.id,
          year: newArrYear,
          region: newArrRegion,
          ote: aeOTEs.get(ae.id) ?? DEFAULT_SETTINGS.ote,
          monthly_inbound_targets: inboundTargets,
          monthly_outbound_targets: outboundTargets,
          monthly_partnerships_targets: partnershipTargets,
          target_percentage: percentage,
          monthly_go_live_targets: goLiveTargets,
          monthly_subs_targets: monthlySubsTargets,
          monthly_pay_targets: monthlyPayTargets,
          avg_subs_bill: avgSubsBill,
          avg_pay_bill: avgPayBillTerminal,
          avg_pay_bill_tipping: avgPayBillTipping,
          terminal_base: aeTerminalBase.get(ae.id) ?? DEFAULT_SETTINGS.terminal_base,
          terminal_bonus: aeTerminalBonus.get(ae.id) ?? DEFAULT_SETTINGS.terminal_bonus,
          terminal_penetration_threshold: terminalPenetrationThreshold / 100,
          subs_tiers: aeSubsTiers.get(ae.id) ?? DEFAULT_SUBS_TIERS,
          pay_tiers: aePayTiers.get(ae.id) ?? DEFAULT_PAY_TIERS,
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
  
  // Filter plannable users for planning tab
  const plannableUsers = useMemo(() => 
    users.filter(u => isPlannable(u.role)), 
    [users]
  );

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
    const nextTerminalBase = new Map<string, number>();
    const nextTerminalBonus = new Map<string, number>();
    const nextSubsTiers = new Map<string, ProvisionTier[]>();
    const nextPayTiers = new Map<string, ProvisionTier[]>();

    plannableUsers.forEach((u, idx) => {
      const isLast = idx === plannableUsers.length - 1;
      const defaultPercent = isLast ? remainingPercent : percentPerUser;
      remainingPercent -= percentPerUser;
      const existing = allSettings.find((s) => s.user_id === u.id);
      nextPercentages.set(u.id, existing?.target_percentage ?? defaultPercent);
      nextOTEs.set(u.id, existing?.ote ?? DEFAULT_SETTINGS.ote);
      nextTerminalBase.set(u.id, existing?.terminal_base ?? DEFAULT_SETTINGS.terminal_base);
      nextTerminalBonus.set(u.id, existing?.terminal_bonus ?? DEFAULT_SETTINGS.terminal_bonus);
      nextSubsTiers.set(u.id, existing?.subs_tiers ?? DEFAULT_SUBS_TIERS);
      nextPayTiers.set(u.id, existing?.pay_tiers ?? DEFAULT_PAY_TIERS);
    });

    setAePercentages(nextPercentages);
    setAeOTEs(nextOTEs);
    setAeTerminalBase(nextTerminalBase);
    setAeTerminalBonus(nextTerminalBonus);
    setAeSubsTiers(nextSubsTiers);
    setAePayTiers(nextPayTiers);
    setSelectedAEId((prev) => (prev && plannableUsers.some((u) => u.id === prev) ? prev : plannableUsers[0].id));
  }, [plannableUsers, allSettings]);
  
  // Load multi-user data for planning
  const userIds = useMemo(() => plannableUsers.map(u => u.id), [plannableUsers]);
  const { data: multiUserData, loading: planningLoading } = useMultiUserData(userIds, planningYear);
  
  // Check permissions
  const permissions = getPermissions(user.role);
  const canToggleManualGoLiveWriteLock = user.role === 'country_manager';

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
    const roles = new Set(users.map(u => u.role));
    return Array.from(roles).sort();
  }, [users]);

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

      const byUser: Record<string, { role: UserRole; effective_from: string }> = {};
      (data || []).forEach((entry: any) => {
        if (!byUser[entry.user_id]) {
          byUser[entry.user_id] = {
            role: entry.role as UserRole,
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
    { id: 'goLives', label: '+New Business Go-Lives', icon: '➕' },
    { id: 'permissions', label: t('dlt.settings.permissions'), icon: '🔐' },
    { id: 'areas', label: t('dlt.settings.areas'), icon: '🏢' },
    { id: 'planning', label: t('dlt.settings.planning'), icon: '📊' },
    { id: 'system', label: t('dlt.settings.system'), icon: '⚙️' }
  ];
  
  // Calculate aggregated planning data
  const planningData = useMemo(() => {
    if (!multiUserData || multiUserData.length === 0) return null;
    
    // Aggregate monthly targets across all AEs
    const monthlyTotals = Array(12).fill(null).map((_, idx) => ({
      month: idx + 1,
      monthName: MONTH_NAMES[idx],
      goLivesTarget: 0,
      subsTarget: 0,
      payTarget: 0,
      aeCount: 0
    }));
    
    let totalOTE = 0;
    let totalSubsYearly = 0;
    let totalPayYearly = 0;
    let totalGoLivesYearly = 0;
    
    multiUserData.forEach(({ settings }) => {
      if (!settings) return;
      
      totalOTE += settings.ote || 0;
      
      settings.monthly_go_live_targets?.forEach((target, idx) => {
        monthlyTotals[idx].goLivesTarget += target;
        totalGoLivesYearly += target;
      });
      
      settings.monthly_subs_targets?.forEach((target, idx) => {
        monthlyTotals[idx].subsTarget += target;
        totalSubsYearly += target;
      });
      
      settings.monthly_pay_targets?.forEach((target, idx) => {
        monthlyTotals[idx].payTarget += target;
        totalPayYearly += target;
      });
      
      monthlyTotals.forEach((m) => {
        m.aeCount = plannableUsers.length;
      });
    });
    
    return {
      monthlyTotals,
      totalOTE,
      totalSubsYearly,
      totalPayYearly,
      totalGoLivesYearly,
      aeCount: plannableUsers.length
    };
  }, [multiUserData, plannableUsers]);

  const selectedAEUser = useMemo(
    () => plannableUsers.find((u) => u.id === selectedAEId) || null,
    [plannableUsers, selectedAEId]
  );
  const selectedAEPercentage = selectedAEId ? (aePercentages.get(selectedAEId) ?? 0) : 0;
  const selectedAEOTE = selectedAEId ? (aeOTEs.get(selectedAEId) ?? DEFAULT_SETTINGS.ote) : DEFAULT_SETTINGS.ote;
  const selectedTerminalBase = selectedAEId ? (aeTerminalBase.get(selectedAEId) ?? DEFAULT_SETTINGS.terminal_base) : DEFAULT_SETTINGS.terminal_base;
  const selectedTerminalBonus = selectedAEId ? (aeTerminalBonus.get(selectedAEId) ?? DEFAULT_SETTINGS.terminal_bonus) : DEFAULT_SETTINGS.terminal_bonus;
  const selectedSubsTiers = selectedAEId ? (aeSubsTiers.get(selectedAEId) ?? DEFAULT_SUBS_TIERS) : DEFAULT_SUBS_TIERS;
  const selectedPayTiers = selectedAEId ? (aePayTiers.get(selectedAEId) ?? DEFAULT_PAY_TIERS) : DEFAULT_PAY_TIERS;

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
  const selectedAEGoLiveTargets = useMemo(
    () => calculateTotalGoLives(selectedAEInbound, selectedAEOutbound, selectedAEPartnerships),
    [selectedAEInbound, selectedAEOutbound, selectedAEPartnerships]
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
  const selectedAEGoLives = selectedAEGoLiveTargets.reduce((a, b) => a + b, 0);
  const selectedAEPayTerminals = selectedAEPayTerminalsByMonth.reduce((a, b) => a + b, 0);
  const selectedAETerminalSales = selectedAETerminalSalesByMonth.reduce((a, b) => a + b, 0);
  const selectedAETipping = selectedAETippingByMonth.reduce((a, b) => a + b, 0);
  const selectedAEPenetration = selectedAEGoLives > 0 ? selectedAEPayTerminals / selectedAEGoLives : 0;

  const handleSelectedAEOTEChange = (ote: number) => {
    if (!selectedAEId) return;
    setAeOTEs((prev) => {
      const next = new Map(prev);
      next.set(selectedAEId, ote);
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

  const previewSettings: AESettings = {
    id: 'preview',
    user_id: selectedAEId || '',
    year: newArrYear,
    region: newArrRegion,
    ote: selectedAEOTE,
    monthly_go_live_targets: selectedAEGoLiveTargets,
    monthly_subs_targets: calculateMonthlySubsTargets(selectedAEGoLiveTargets, avgSubsBill),
    monthly_pay_targets: selectedAETerminalSalesByMonth.map((ts, i) => (ts * avgPayBillTerminal * 12) + (selectedAETippingByMonth[i] * avgPayBillTipping * 12)),
    monthly_inbound_targets: selectedAEInbound,
    monthly_outbound_targets: selectedAEOutbound,
    monthly_partnerships_targets: selectedAEPartnerships,
    target_percentage: selectedAEPercentage,
    avg_subs_bill: avgSubsBill,
    avg_pay_bill: avgPayBillTerminal,
    avg_pay_bill_tipping: avgPayBillTipping,
    pay_arr_factor: 0,
    terminal_base: selectedTerminalBase,
    terminal_bonus: selectedTerminalBonus,
    terminal_penetration_threshold: terminalPenetrationThreshold / 100,
    subs_tiers: selectedSubsTiers,
    pay_tiers: selectedPayTiers,
    created_at: '',
    updated_at: ''
  };
  const oteValidation = validateOTESettings(previewSettings, selectedAEPayTerminals);
  const oteProjections = calculateOTEProjections(previewSettings, selectedAEPayTerminals);

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
                  onChange={(e) => setFilterRole(e.target.value as UserRole | 'all')}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent"
                >
                  <option value="all">{t('dlt.settings.allRoles')}</option>
                  {availableRoles.map(role => (
                    <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
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
                          {ROLE_LABELS[u.role] || u.role}
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
                  <div className="text-sm text-gray-500">{ROLE_LABELS[role as UserRole] || role}</div>
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
                        {m.name} ({ROLE_LABELS[m.role] || m.role})
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
                        onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
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
                            <td className="px-2 py-1 text-gray-700">{ROLE_LABELS[entry.role] || entry.role}</td>
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

      {/* Go-Lives Tab */}
      {activeTab === 'goLives' && (
        <div className="space-y-6">
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
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">Feld-Mapping (Sheet -> Datenbank)</h5>
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
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
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
                      {ROLE_LABELS[role as UserRole]}
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
        </div>
      )}

      {/* Areas Tab */}
      {activeTab === 'areas' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(['new_business', 'expanding_business', 'marketing', 'dlt'] as BusinessArea[]).map((area) => {
              const areaUsers = users.filter(u => {
                if (area === 'new_business') return ['ae_subscription_sales', 'ae_payments', 'line_manager_new_business', 'commercial_director', 'head_of_partnerships'].includes(u.role);
                if (area === 'expanding_business') return ['head_of_expanding_revenue', 'cs_account_executive', 'cs_account_manager', 'cs_sdr'].includes(u.role);
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
                        <span className="text-gray-400">{ROLE_LABELS[u.role]?.split(' ')[0] || u.role}</span>
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
            <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📈</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">1. NEW ARR</h3>
                  <p className="text-sm text-gray-500">Neuer ARR aus Neukundengeschäft</p>
                </div>
              </div>
              {/* Quick Stats */}
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
            </div>
            
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
                        { label: 'Terminal Sales', color: 'teal', data: businessTerminalSales, handler: handleBusinessTerminalChange, total: businessTotalTerminalSales },
                        { label: 'Tipping', color: 'pink', data: businessTipping, handler: handleBusinessTippingChange, total: businessTotalTipping },
                      ].map(cat => (
                        <div key={cat.label} className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <h5 className={`font-medium text-${cat.color}-700`}>{cat.label}</h5>
                            <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                          </div>
                          <div className="grid grid-cols-12 gap-1">
                            {MONTHS.map((m, i) => (
                              <div key={i} className="text-center">
                                <label className="block text-xs text-gray-500">{m}</label>
                                <input type="number" value={cat.data[i] || 0}
                                  onChange={(e) => cat.handler(i, parseInt(e.target.value) || 0)}
                                  className={`w-full px-1 py-1 text-center border border-${cat.color}-200 rounded text-sm bg-${cat.color}-50`} />
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
                    >
                      {plannableUsers.map((ae) => (
                        <option key={ae.id} value={ae.id}>
                          {ae.name} ({aePercentages.get(ae.id) ?? 0}%)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">OTE für {selectedAEUser?.name || 'AE'}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">€</span>
                      <input
                        type="number"
                        value={selectedAEOTE}
                        onChange={(e) => handleSelectedAEOTEChange(parseInt(e.target.value) || 0)}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
                {selectedAEUser && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
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
                      <div className="text-lg font-bold text-green-700">{formatCurrency(selectedAEGoLives * avgSubsBill * 12)}</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2">
                      <div className="text-xs text-orange-600">Pay ARR</div>
                      <div className="text-lg font-bold text-orange-700">{formatCurrency((selectedAETerminalSales * avgPayBillTerminal * 12) + (selectedAETipping * avgPayBillTipping * 12))}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* ========== 6. PROVISIONSMODELL (AE-spezifisch) ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">
                  6. Provisionsmodell <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEUser?.name || 'AE'}</span>
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

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <h5 className="font-medium text-green-700 mb-2">Subs ARR Stufen</h5>
                    <table className="w-full text-sm">
                      <tbody>
                        {selectedSubsTiers.map((tier, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-1">{tier.label}</td>
                            <td className="py-1 text-right">
                              <input
                                type="number"
                                value={(tier.rate * 100).toFixed(1)}
                                onChange={(e) => handleSelectedSubsTierRateChange(i, parseFloat(e.target.value) || 0)}
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
                    <h5 className="font-medium text-orange-700 mb-2">Pay ARR Stufen</h5>
                    <table className="w-full text-sm">
                      <tbody>
                        {selectedPayTiers.map((tier, i) => (
                          <tr key={i} className="border-b">
                            <td className="py-1">{tier.label}</td>
                            <td className="py-1 text-right">
                              <input
                                type="number"
                                value={(tier.rate * 100).toFixed(1)}
                                onChange={(e) => handleSelectedPayTierRateChange(i, parseFloat(e.target.value) || 0)}
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

              {/* ========== 7. OTE VALIDIERUNG ========== */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-md font-bold text-gray-800 mb-3">
                  7. OTE Validierung <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEUser?.name || 'AE'}</span>
                </h4>
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
            </div>
          </div>

          {/* 2. EXPANDING ARR */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-blue-500">
            <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚀</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">2. EXPANDING ARR</h3>
                  <p className="text-sm text-gray-500">ARR aus Bestandskundenwachstum (Upselling, Cross-Selling)</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für EXPANDING ARR Daten</p>
            </div>
          </div>

          {/* 3. CHURN ARR */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-red-500">
            <div className="px-6 py-4 border-b border-gray-200 bg-red-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📉</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">3. CHURN ARR</h3>
                  <p className="text-sm text-gray-500">Verlorener ARR durch Kündigungen und Downgrades</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für CHURN ARR Daten</p>
            </div>
          </div>

          {/* 4. New clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-emerald-500">
            <div className="px-6 py-4 border-b border-gray-200 bg-emerald-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👥</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">4. New clients</h3>
                  <p className="text-sm text-gray-500">Anzahl neuer Kunden</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für New clients Daten</p>
            </div>
          </div>

          {/* 5. Churned clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-orange-500">
            <div className="px-6 py-4 border-b border-gray-200 bg-orange-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚪</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">5. Churned clients</h3>
                  <p className="text-sm text-gray-500">Anzahl gekündigter Kunden</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für Churned clients Daten</p>
            </div>
          </div>

          {/* 6. Ending clients */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-l-purple-500">
            <div className="px-6 py-4 border-b border-gray-200 bg-purple-50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏰</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">6. Ending clients</h3>
                  <p className="text-sm text-gray-500">Anzahl auslaufender Kundenverträge</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-center py-8">Platzhalter für Ending clients Daten</p>
            </div>
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
                <p className="text-sm text-gray-500">{ROLE_LABELS[user.role]}</p>
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
