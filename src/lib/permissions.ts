// ============================================
// ROLLEN & BERECHTIGUNGEN
// ============================================

export type UserRole = 'country_manager' | 'line_manager' | 'ae' | 'sdr' | 'sonstiges' | 'head_of_partnerships';

export const ROLE_LABELS: Record<UserRole, string> = {
  country_manager: 'Country Manager',
  line_manager: 'Line Manager',
  ae: 'Account Executive',
  sdr: 'SDR',
  sonstiges: 'Sonstiges',
  head_of_partnerships: 'Head of Partnerships'
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  country_manager: 'Admin/Inhaber - Vollzugriff auf alle Funktionen',
  line_manager: 'Team-Manager - Kann User und Daten verwalten',
  ae: 'Account Executive - Kann eigene Go-Lives erfassen',
  sdr: 'Sales Development Rep - Zukünftige Rolle (noch nicht aktiv)',
  sonstiges: 'Sammelkonto für nicht zuordenbare Umsätze',
  head_of_partnerships: 'Head of Partnerships - Verwaltet Partner-Deals'
};

// ============================================
// BERECHTIGUNGS-PRÜFUNGEN
// ============================================

/**
 * Kann alle User sehen (Team-Übersicht, Jahresübersicht GESAMT)
 * AE und SDR können die Übersicht sehen, aber nicht bearbeiten
 */
export function canViewAllUsers(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'ae' || role === 'sdr' || role === 'head_of_partnerships';
}

/**
 * Kann Einstellungen bearbeiten (Ziele, Tiers, etc.)
 */
export function canEditSettings(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'head_of_partnerships';
}

/**
 * Kann Pay ARR eingeben (M3 Provision)
 */
export function canEnterPayARR(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'head_of_partnerships';
}

/**
 * Kann Go-Lives für andere User eingeben
 */
export function canEnterGoLivesForOthers(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'head_of_partnerships';
}

/**
 * Kann eigene Go-Lives eingeben
 */
export function canEnterOwnGoLives(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'ae' || role === 'head_of_partnerships';
}

/**
 * Kann User anlegen und löschen
 */
export function canManageUsers(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager';
}

/**
 * Kann Rollen zuweisen
 */
export function canAssignRoles(role: UserRole): boolean {
  return role === 'country_manager';
}

/**
 * Kann Provisions-Stufen (Tiers) ändern
 */
export function canEditTiers(role: UserRole): boolean {
  return role === 'country_manager';
}

/**
 * Kann alle Berichte sehen
 */
export function canViewAllReports(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'head_of_partnerships';
}

/**
 * Kann Berichte drucken/exportieren
 */
export function canExportReports(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'ae' || role === 'head_of_partnerships';
}

/**
 * Hat Admin-Zugang
 */
export function hasAdminAccess(role: UserRole): boolean {
  return role === 'country_manager' || role === 'line_manager' || role === 'head_of_partnerships';
}

/**
 * Ist die Rolle aktiv (SDR ist noch nicht implementiert)
 */
export function isRoleActive(role: UserRole): boolean {
  return role !== 'sdr';
}

/**
 * Ist eine planbare Rolle (hat Targets & Go-Lives)
 */
export function isPlannable(role: UserRole): boolean {
  return role === 'ae' || role === 'sonstiges';
}

// ============================================
// ROLLEN-HIERARCHIE
// ============================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  country_manager: 4,
  line_manager: 3,
  head_of_partnerships: 3,  // Gleiche Ebene wie Line Manager
  ae: 2,
  sdr: 1,
  sonstiges: 0  // Kein Login möglich, niedrigste "Hierarchie"
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
    return ['country_manager', 'line_manager', 'head_of_partnerships', 'ae', 'sdr', 'sonstiges'];
  }
  if (userRole === 'line_manager') {
    return ['ae', 'sdr', 'sonstiges']; // Line Manager kann keine Manager-Rollen vergeben
  }
  if (userRole === 'head_of_partnerships') {
    return ['ae', 'sdr', 'sonstiges']; // Head of Partnerships kann keine Manager-Rollen vergeben
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
    hasAdminAccess: hasAdminAccess(role)
  };
}
