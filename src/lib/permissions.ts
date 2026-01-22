// ============================================
// ROLLEN & BERECHTIGUNGEN - Commercial Business Planner v4.0
// ============================================

import { BusinessArea } from './types';

export type UserRole = 
  // Superuser
  | 'country_manager'
  // DLT
  | 'dlt_member'
  // New Business
  | 'line_manager_new_business'
  | 'ae_subscription_sales'
  | 'ae_payments'
  | 'commercial_director'
  | 'head_of_partnerships'
  // Expanding Business
  | 'head_of_expanding_revenue'
  | 'cs_account_executive'
  | 'cs_account_manager'
  | 'cs_sdr'
  // Marketing
  | 'head_of_marketing'
  | 'marketing_specialist'
  | 'marketing_executive'
  | 'demand_generation_specialist'
  // Legacy/Sonstige
  | 'sonstiges';

export const ROLE_LABELS: Record<UserRole, string> = {
  // Superuser
  country_manager: 'Country Manager',
  // DLT
  dlt_member: 'DLT Mitglied',
  // New Business
  line_manager_new_business: 'Line Manager New Business',
  ae_subscription_sales: 'Account Executive Subscription Sales',
  ae_payments: 'Account Executive Payments',
  commercial_director: 'Commercial Director',
  head_of_partnerships: 'Head of Partnerships',
  // Expanding Business
  head_of_expanding_revenue: 'Head of Expanding Revenue',
  cs_account_executive: 'CS Account Executive',
  cs_account_manager: 'CS Account Manager',
  cs_sdr: 'CS SDR',
  // Marketing
  head_of_marketing: 'Head of Marketing',
  marketing_specialist: 'Marketing Specialist',
  marketing_executive: 'Marketing Executive',
  demand_generation_specialist: 'Demand Generation Specialist',
  // Sonstige
  sonstiges: 'Sonstiges'
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  // Superuser
  country_manager: 'Superuser - Vollzugriff auf alle Funktionen inkl. Debug',
  // DLT
  dlt_member: 'Digital Leadership Team - Zugriff auf alle Bereiche',
  // New Business
  line_manager_new_business: 'Team-Manager New Business - Kann Team und Daten verwalten',
  ae_subscription_sales: 'Account Executive für Subscription-Verkäufe',
  ae_payments: 'Account Executive für Payment-Verkäufe',
  commercial_director: 'Commercial Director - Strategische Vertriebsleitung',
  head_of_partnerships: 'Head of Partnerships - Verwaltet Partner-Deals',
  // Expanding Business
  head_of_expanding_revenue: 'Leitung Expanding Business',
  cs_account_executive: 'Customer Success Account Executive',
  cs_account_manager: 'Customer Success Account Manager',
  cs_sdr: 'Customer Success SDR',
  // Marketing
  head_of_marketing: 'Leitung Marketing',
  marketing_specialist: 'Marketing Specialist',
  marketing_executive: 'Marketing Executive',
  demand_generation_specialist: 'Demand Generation Specialist',
  // Sonstige
  sonstiges: 'Sammelkonto für nicht zuordenbare Umsätze'
};

// Rollen gruppiert nach Bereich (für UI)
export const ROLES_BY_AREA: Record<BusinessArea, UserRole[]> = {
  dlt: ['dlt_member'],
  new_business: ['line_manager_new_business', 'ae_subscription_sales', 'ae_payments', 'commercial_director', 'head_of_partnerships'],
  expanding_business: ['head_of_expanding_revenue', 'cs_account_executive', 'cs_account_manager', 'cs_sdr'],
  marketing: ['head_of_marketing', 'marketing_specialist', 'marketing_executive', 'demand_generation_specialist']
};

// ============================================
// BERECHTIGUNGS-PRÜFUNGEN
// ============================================

// Superuser-Check
export function isSuperuser(role: UserRole): boolean {
  return role === 'country_manager';
}

// DLT-Check (kann alle Bereiche sehen)
export function isDLT(role: UserRole): boolean {
  return role === 'country_manager' || role === 'dlt_member';
}

// Kann Debug-Fenster sehen (nur Superuser)
export function canSeeDebug(role: UserRole): boolean {
  return role === 'country_manager';
}

/**
 * Kann alle User sehen (Team-Übersicht, Jahresübersicht GESAMT)
 */
export function canViewAllUsers(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships'
    || role === 'head_of_expanding_revenue'
    || role === 'head_of_marketing';
}

/**
 * Kann Einstellungen bearbeiten (Ziele, Tiers, etc.)
 */
export function canEditSettings(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships'
    || role === 'head_of_expanding_revenue'
    || role === 'head_of_marketing';
}

/**
 * Kann Pay ARR eingeben (M3 Provision)
 */
export function canEnterPayARR(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships';
}

/**
 * Kann Go-Lives für andere User eingeben
 */
export function canEnterGoLivesForOthers(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships';
}

/**
 * Kann eigene Go-Lives eingeben
 */
export function canEnterOwnGoLives(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business'
    || role === 'ae_subscription_sales' 
    || role === 'ae_payments'
    || role === 'commercial_director'
    || role === 'head_of_partnerships';
}

/**
 * Kann User anlegen und löschen
 */
export function canManageUsers(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business'
    || role === 'head_of_expanding_revenue'
    || role === 'head_of_marketing';
}

/**
 * Kann Rollen zuweisen
 */
export function canAssignRoles(role: UserRole): boolean {
  return role === 'country_manager' || role === 'dlt_member';
}

/**
 * Kann Provisions-Stufen (Tiers) ändern
 */
export function canEditTiers(role: UserRole): boolean {
  return role === 'country_manager' || role === 'dlt_member';
}

/**
 * Kann alle Berichte sehen
 */
export function canViewAllReports(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships'
    || role === 'head_of_expanding_revenue'
    || role === 'head_of_marketing';
}

/**
 * Kann Berichte drucken/exportieren
 */
export function canExportReports(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'ae_subscription_sales'
    || role === 'ae_payments'
    || role === 'commercial_director'
    || role === 'head_of_partnerships'
    || role === 'head_of_expanding_revenue'
    || role === 'cs_account_executive'
    || role === 'head_of_marketing';
}

/**
 * Hat Admin-Zugang (für den jeweiligen Bereich)
 */
export function hasAdminAccess(role: UserRole): boolean {
  return role === 'country_manager' 
    || role === 'dlt_member'
    || role === 'line_manager_new_business' 
    || role === 'commercial_director'
    || role === 'head_of_partnerships'
    || role === 'head_of_expanding_revenue'
    || role === 'head_of_marketing';
}

/**
 * Ist die Rolle aktiv (alle neuen Rollen sind aktiv)
 */
export function isRoleActive(role: UserRole): boolean {
  return true; // Alle Rollen sind jetzt aktiv
}

/**
 * Ist eine planbare Rolle (hat Targets & Go-Lives)
 */
export function isPlannable(role: UserRole): boolean {
  return role === 'ae_subscription_sales' 
    || role === 'ae_payments' 
    || role === 'sonstiges';
}

// ============================================
// ROLLEN-HIERARCHIE
// ============================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  country_manager: 10,      // Superuser
  dlt_member: 9,            // DLT
  commercial_director: 8,   // Director-Level
  head_of_expanding_revenue: 8,
  head_of_marketing: 8,
  line_manager_new_business: 7,  // Manager-Level
  head_of_partnerships: 7,
  cs_account_executive: 5,  // Executive-Level
  ae_subscription_sales: 5,
  ae_payments: 5,
  marketing_executive: 5,
  cs_account_manager: 4,    // Manager/Specialist-Level
  marketing_specialist: 4,
  demand_generation_specialist: 4,
  cs_sdr: 3,                // SDR-Level
  sonstiges: 0              // Kein Login möglich
};

/**
 * Prüft ob eine Rolle höher oder gleich einer anderen ist
 */
export function isRoleAtLeast(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Gibt die Rollen zurück, die ein User zuweisen darf
 */
export function getAssignableRoles(userRole: UserRole): UserRole[] {
  if (userRole === 'country_manager') {
    // Superuser kann alle Rollen zuweisen
    return Object.keys(ROLE_LABELS) as UserRole[];
  }
  if (userRole === 'dlt_member') {
    // DLT kann alle außer country_manager zuweisen
    return (Object.keys(ROLE_LABELS) as UserRole[]).filter(r => r !== 'country_manager');
  }
  if (userRole === 'line_manager_new_business') {
    // Line Manager kann nur New Business Rollen (unter sich) zuweisen
    return ['ae_subscription_sales', 'ae_payments', 'sonstiges'];
  }
  if (userRole === 'head_of_expanding_revenue') {
    return ['cs_account_executive', 'cs_account_manager', 'cs_sdr'];
  }
  if (userRole === 'head_of_marketing') {
    return ['marketing_specialist', 'marketing_executive', 'demand_generation_specialist'];
  }
  return [];
}

// ============================================
// BERECHTIGUNGS-OBJEKT (für einfache Verwendung)
// ============================================

export interface Permissions {
  viewAllUsers: boolean;
  editSettings: boolean;
  enterPayARR: boolean;
  enterGoLivesForOthers: boolean;
  enterOwnGoLives: boolean;
  manageUsers: boolean;
  assignRoles: boolean;
  editTiers: boolean;
  viewAllReports: boolean;
  exportReports: boolean;
  hasAdminAccess: boolean;
  isSuperuser: boolean;
  isDLT: boolean;
  canSeeDebug: boolean;
}

/**
 * Gibt alle Berechtigungen für eine Rolle zurück
 */
export function getPermissions(role: UserRole): Permissions {
  return {
    viewAllUsers: canViewAllUsers(role),
    editSettings: canEditSettings(role),
    enterPayARR: canEnterPayARR(role),
    enterGoLivesForOthers: canEnterGoLivesForOthers(role),
    enterOwnGoLives: canEnterOwnGoLives(role),
    manageUsers: canManageUsers(role),
    assignRoles: canAssignRoles(role),
    editTiers: canEditTiers(role),
    viewAllReports: canViewAllReports(role),
    exportReports: canExportReports(role),
    hasAdminAccess: hasAdminAccess(role),
    isSuperuser: isSuperuser(role),
    isDLT: isDLT(role),
    canSeeDebug: canSeeDebug(role)
  };
}
