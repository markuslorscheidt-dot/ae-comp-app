'use client';

import { useState, useEffect, useRef } from 'react';
import { User, UserRole } from '@/lib/types';
import { useAllUsers, useAllGoLives, useAllSettings, useRolePermissions, RolePermissionRecord, createBackup, restoreBackup, downloadBackup, BackupData } from '@/lib/hooks';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/lib/supabase';
import { getAssignableRoles, canAssignRoles, canManageUsers, getPermissions, Permissions } from '@/lib/permissions';
import { calculateYearSummary, formatCurrency } from '@/lib/calculations';
import DebugPanel from './DebugPanel';

interface AdminPanelProps {
  currentUser: User;
  onBack: () => void;
}

type AdminView = 'users' | 'add-user' | 'permissions' | 'team-overview' | 'backup';

const PERMISSION_KEYS: (keyof Permissions)[] = [
  'viewAllUsers', 'enterOwnGoLives', 'enterGoLivesForOthers', 'enterPayARR',
  'editSettings', 'editTiers', 'manageUsers', 'assignRoles', 'viewAllReports', 'exportReports', 'hasAdminAccess',
  'isSuperuser', 'isDLT', 'canSeeDebug'
];

// Alle verfügbaren Rollen für das neue System
const ALL_ROLES: UserRole[] = [
  // Superuser
  'country_manager',
  // DLT
  'dlt_member',
  // New Business
  'line_manager_new_business',
  'ae_subscription_sales',
  'ae_payments',
  'commercial_director',
  'head_of_partnerships',
  // Expanding Business
  'head_of_expanding_revenue',
  'cs_account_executive',
  'cs_account_manager',
  'cs_sdr',
  // Marketing
  'head_of_marketing',
  'marketing_specialist',
  'marketing_executive',
  'demand_generation_specialist',
  // Sonstige
  'sonstiges'
];

const REGIONS = ['DACH', 'Deutschland', 'Österreich', 'Schweiz', 'DACH-Nord', 'DACH-Süd', 'DACH-Ost', 'DACH-West'];

// Welche Rollen kann eine Rolle editieren?
const EDITABLE_ROLES: Record<UserRole, UserRole[]> = {
  // Superuser kann alles
  country_manager: ALL_ROLES,
  // DLT kann alle außer Superuser
  dlt_member: ALL_ROLES.filter(r => r !== 'country_manager'),
  // Line Manager New Business
  line_manager_new_business: ['ae_subscription_sales', 'ae_payments', 'sonstiges'],
  // Andere Manager können ihre Bereiche verwalten
  head_of_expanding_revenue: ['cs_account_executive', 'cs_account_manager', 'cs_sdr'],
  head_of_marketing: ['marketing_specialist', 'marketing_executive', 'demand_generation_specialist'],
  // Nicht-Manager können keine Rollen editieren
  ae_subscription_sales: [],
  ae_payments: [],
  commercial_director: [],
  head_of_partnerships: [],
  cs_account_executive: [],
  cs_account_manager: [],
  cs_sdr: [],
  marketing_specialist: [],
  marketing_executive: [],
  demand_generation_specialist: [],
  sonstiges: [],
};

export default function AdminPanel({ currentUser, onBack }: AdminPanelProps) {
  const { t } = useLanguage();
  const [view, setView] = useState<AdminView>('users');
  const { users, loading: usersLoading, updateUserRole, deleteUser, refetch: refetchUsers } = useAllUsers();
  const { goLives, loading: goLivesLoading } = useAllGoLives();
  const { settings: allSettings, loading: settingsLoading } = useAllSettings();
  
  // Permissions aus DB laden
  const { 
    permissions: dbPermissions, 
    loading: permissionsLoading, 
    updatePermission,
    updateRolePermissions 
  } = useRolePermissions();
  
  // Create User State
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('ae');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Edit User State
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editData, setEditData] = useState({
    name: '',
    email: '',
    phone: '',
    region: 'DACH',
    employee_id: '',
    start_date: '',
    manager_id: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  // Permissions Message State
  const [permissionsMessage, setPermissionsMessage] = useState('');

  // Backup State
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupSuccess, setBackupSuccess] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoreSuccess, setRestoreSuccess] = useState('');
  const [restoreDetails, setRestoreDetails] = useState<string[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loading = usersLoading || goLivesLoading || settingsLoading || permissionsLoading;

  // Edit User Handlers
  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setEditData({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      region: user.region || 'DACH',
      employee_id: user.employee_id || '',
      start_date: user.start_date || '',
      manager_id: user.manager_id || '',
    });
    setEditError('');
    setEditSuccess('');
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;
    
    setEditLoading(true);
    setEditError('');
    setEditSuccess('');

    try {
      const { error } = await supabase
        .from('users')
        .update({
          name: editData.name,
          phone: editData.phone || null,
          region: editData.region,
          employee_id: editData.employee_id || null,
          start_date: editData.start_date || null,
          manager_id: editData.manager_id || null,
        })
        .eq('id', editingUser.id);

      if (error) throw error;

      setEditSuccess(t('profile.saveSuccess'));
      setTimeout(() => {
        setEditingUser(null);
        refetchUsers();
      }, 1000);
    } catch (err: any) {
      setEditError(err.message || t('errors.generic'));
    } finally {
      setEditLoading(false);
    }
  };

  // Permission Edit Handlers
  const canEditPermissionsForRole = (targetRole: UserRole): boolean => {
    return EDITABLE_ROLES[currentUser.role]?.includes(targetRole) || false;
  };

  // Map DB field names to Permissions interface keys
  const dbKeyToPermKey: Record<string, keyof Permissions> = {
    view_all_users: 'viewAllUsers',
    enter_own_go_lives: 'enterOwnGoLives',
    enter_go_lives_for_others: 'enterGoLivesForOthers',
    enter_pay_arr: 'enterPayARR',
    edit_settings: 'editSettings',
    edit_tiers: 'editTiers',
    manage_users: 'manageUsers',
    assign_roles: 'assignRoles',
    view_all_reports: 'viewAllReports',
    export_reports: 'exportReports',
    has_admin_access: 'hasAdminAccess',
  };

  const permKeyToDbKey: Record<keyof Permissions, string> = {
    viewAllUsers: 'view_all_users',
    enterOwnGoLives: 'enter_own_go_lives',
    enterGoLivesForOthers: 'enter_go_lives_for_others',
    enterPayARR: 'enter_pay_arr',
    editSettings: 'edit_settings',
    editTiers: 'edit_tiers',
    manageUsers: 'manage_users',
    assignRoles: 'assign_roles',
    viewAllReports: 'view_all_reports',
    exportReports: 'export_reports',
    hasAdminAccess: 'has_admin_access',
  };

  const handlePermissionToggle = async (role: UserRole, permKey: keyof Permissions) => {
    if (!canEditPermissionsForRole(role)) return;
    
    const dbKey = permKeyToDbKey[permKey];
    const currentValue = dbPermissions[role]?.[dbKey as keyof RolePermissionRecord] as boolean;
    const newValue = !currentValue;

    // Update in DB
    const result = await updatePermission(role, dbKey as any, newValue);
    
    if (result.error) {
      setPermissionsMessage('Fehler beim Speichern');
      setTimeout(() => setPermissionsMessage(''), 3000);
    } else {
      setPermissionsMessage(t('profile.saveSuccess'));
      setTimeout(() => setPermissionsMessage(''), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setCreateLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: newUserEmail,
        password: newUserPassword,
        options: { data: { name: newUserName } }
      });
      if (error) { setCreateError(error.message); return; }
      if (data.user) {
        if (newUserRole !== 'ae') {
          await supabase.from('users').update({ role: newUserRole }).eq('id', data.user.id);
        }
        setCreateSuccess(t('admin.addUser.success', { name: newUserName }));
        setNewUserEmail(''); setNewUserName(''); setNewUserPassword(''); setNewUserRole('ae');
        setTimeout(() => { refetchUsers(); setView('users'); }, 1500);
      }
    } catch (err: any) {
      setCreateError(err.message || t('errors.generic'));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (!canAssignRoles(currentUser.role)) { alert(t('admin.users.noPermissionRole')); return; }
    const result = await updateUserRole(userId, newRole);
    if (result.error) alert(t('admin.users.roleChangeError') + ': ' + result.error.message);
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!canManageUsers(currentUser.role)) { alert(t('admin.users.noPermissionDelete')); return; }
    if (userId === currentUser.id) { alert(t('admin.users.cannotDeleteSelf')); return; }
    if (confirm(t('admin.users.deleteConfirm', { name: userName }))) {
      const result = await deleteUser(userId);
      if (result.error) alert(t('admin.users.deleteError') + ': ' + result.error.message);
    }
  };

  // Alle User mit planbaren Rollen oder Manager-Rollen für Team-Statistiken
  const teamStats = users.filter(u => 
    u.role === 'ae_subscription_sales' || 
    u.role === 'ae_payments' || 
    u.role === 'line_manager_new_business' ||
    u.role === 'cs_account_executive' ||
    u.role === 'cs_account_manager'
  ).map(user => {
    const userSettings = allSettings.find(s => s.user_id === user.id);
    const userGoLives = goLives.filter(gl => gl.user_id === user.id);
    if (!userSettings) return { user, goLivesCount: 0, subsActual: 0, payActual: 0, totalProvision: 0 };
    const summary = calculateYearSummary(userGoLives, userSettings);
    return { user, goLivesCount: summary.total_go_lives, subsActual: summary.total_subs_actual, payActual: summary.total_pay_actual, totalProvision: summary.total_provision };
  });

  const getRoleColor = (role: UserRole) => {
    // Superuser
    if (role === 'country_manager') return 'bg-purple-100 text-purple-700';
    // DLT
    if (role === 'dlt_member') return 'bg-indigo-100 text-indigo-700';
    // Directors/Heads
    if (role === 'commercial_director' || role === 'head_of_expanding_revenue' || role === 'head_of_marketing' || role === 'head_of_partnerships') return 'bg-blue-100 text-blue-700';
    // Line Managers
    if (role === 'line_manager_new_business') return 'bg-sky-100 text-sky-700';
    // AEs
    if (role === 'ae_subscription_sales' || role === 'ae_payments' || role === 'cs_account_executive') return 'bg-green-100 text-green-700';
    // Marketing
    if (role === 'marketing_specialist' || role === 'marketing_executive' || role === 'demand_generation_specialist') return 'bg-orange-100 text-orange-700';
    // Account Managers & SDRs
    if (role === 'cs_account_manager' || role === 'cs_sdr') return 'bg-teal-100 text-teal-700';
    // Sonstige
    if (role === 'sonstiges') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-700';
  };

  // Mögliche Manager für Dropdown - alle Manager-/Head-Rollen
  const possibleManagers = users.filter(u => 
    u.role === 'country_manager' || 
    u.role === 'dlt_member' ||
    u.role === 'line_manager_new_business' ||
    u.role === 'commercial_director' ||
    u.role === 'head_of_partnerships' ||
    u.role === 'head_of_expanding_revenue' ||
    u.role === 'head_of_marketing'
  );

  return (
    <div>
      {/* DEBUG PANEL */}
      <DebugPanel 
        user={currentUser} 
        data={{
          usersCount: users.length,
          goLivesCount: goLives.length,
          allSettingsCount: allSettings.length,
          teamStatsCount: teamStats.length,
          dbPermissionsCount: dbPermissions.length,
          currentView: view,
        }}
        title="AdminPanel Debug"
      />

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              ✏️ {t('profile.editProfile')}: {editingUser.name}
            </h3>

            {editError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {editError}
              </div>
            )}
            {editSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
                ✅ {editSuccess}
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.name')}</label>
                <input
                  type="text"
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              {/* E-Mail (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.email')}</label>
                <input
                  type="email"
                  value={editData.email}
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-400 mt-1">E-Mail kann nicht geändert werden</p>
              </div>

              {/* Telefon */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.phone')}</label>
                <input
                  type="tel"
                  value={editData.phone}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="+49 123 456789"
                />
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.region')}</label>
                <select
                  value={editData.region}
                  onChange={(e) => setEditData({ ...editData, region: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {REGIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Mitarbeiter-Nr. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.employeeId')}</label>
                <input
                  type="text"
                  value={editData.employee_id}
                  onChange={(e) => setEditData({ ...editData, employee_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="AE-001"
                />
              </div>

              {/* Start-Datum */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.startDate')}</label>
                <input
                  type="date"
                  value={editData.start_date}
                  onChange={(e) => setEditData({ ...editData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              {/* Vorgesetzter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.manager')}</label>
                <select
                  value={editData.manager_id}
                  onChange={(e) => setEditData({ ...editData, manager_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">{t('profile.noManager')}</option>
                  {possibleManagers.filter(m => m.id !== editingUser.id).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({t(`roles.${m.role}`)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex space-x-4 mt-6 pt-4 border-t">
              <button
                onClick={() => setEditingUser(null)}
                className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveUser}
                disabled={editLoading}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {editLoading ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">{t('common.back')}</button>
          <h2 className="text-2xl font-bold text-gray-800">{t('admin.title')}</h2>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setView('users')} className={`px-4 py-2 rounded-lg font-medium transition ${view === 'users' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t('admin.tabs.users')}</button>
        {canManageUsers(currentUser.role) && (
          <button onClick={() => setView('add-user')} className={`px-4 py-2 rounded-lg font-medium transition ${view === 'add-user' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>{t('admin.tabs.addUser')}</button>
        )}
        <button onClick={() => setView('permissions')} className={`px-4 py-2 rounded-lg font-medium transition ${view === 'permissions' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t('admin.tabs.permissions')}</button>
        <button onClick={() => setView('team-overview')} className={`px-4 py-2 rounded-lg font-medium transition ${view === 'team-overview' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t('admin.tabs.teamOverview')}</button>
        <button onClick={() => setView('backup')} className={`px-4 py-2 rounded-lg font-medium transition ${view === 'backup' ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>💾 Backup</button>
      </div>

      {view === 'users' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">{t('admin.users.title')} ({users.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.name')}</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.email')}</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.role')}</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.created')}</th>
                  <th className="py-3 px-2 font-medium text-gray-500">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className={`border-b hover:bg-gray-50 ${user.id === currentUser.id ? 'bg-blue-50' : ''}`}>
                    <td className="py-3 px-2">
                      <div className="font-medium text-gray-800">{user.name}</div>
                      {user.id === currentUser.id && <span className="text-xs text-blue-600">{t('common.you')}</span>}
                      {user.employee_id && <span className="text-xs text-gray-400 ml-2">#{user.employee_id}</span>}
                    </td>
                    <td className="py-3 px-2 text-gray-600">{user.email}</td>
                    <td className="py-3 px-2">
                      {canAssignRoles(currentUser.role) && user.id !== currentUser.id ? (
                        <select value={user.role} onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)} className="border border-gray-300 rounded px-2 py-1 text-sm">
                          {getAssignableRoles(currentUser.role).map(role => (<option key={role} value={role}>{t(`roles.${role}`)}</option>))}
                        </select>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getRoleColor(user.role)}`}>{t(`roles.${user.role}`)}</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-gray-500 text-xs">{new Date(user.created_at).toLocaleDateString('de-DE')}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center space-x-2">
                        {/* Edit Button */}
                        {canManageUsers(currentUser.role) && (
                          <button 
                            onClick={() => handleEditUser(user)} 
                            className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50"
                          >
                            ✏️ {t('common.edit')}
                          </button>
                        )}
                        {/* Delete Button */}
                        {canManageUsers(currentUser.role) && user.id !== currentUser.id && (
                          <button 
                            onClick={() => handleDeleteUser(user.id, user.name)} 
                            className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'add-user' && canManageUsers(currentUser.role) && (
        <div className="bg-white rounded-xl shadow-sm p-6 max-w-xl">
          <h3 className="text-lg font-bold text-gray-800 mb-6">{t('admin.addUser.title')}</h3>
          {createError && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{createError}</div>}
          {createSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{createSuccess}</div>}
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.name')}</label>
              <input type="text" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.email')}</label>
              <input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.password')}</label>
              <input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" minLength={6} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('admin.addUser.selectRole')}</label>
              <div className="space-y-2">
                {getAssignableRoles(currentUser.role).map(role => {
                  const perms = getPermissions(role);
                  return (
                    <label key={role} className={`flex items-start p-3 border rounded-lg cursor-pointer transition ${newUserRole === role ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="role" value={role} checked={newUserRole === role} onChange={() => setNewUserRole(role)} className="mt-1 mr-3" />
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleColor(role)}`}>{t(`roles.${role}`)}</span>
                          {/* Alle Rollen sind jetzt aktiv */}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{t(`roleDescriptions.${role}`)}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {perms.enterOwnGoLives && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t('permissionTags.goLives')}</span>}
                          {perms.enterPayARR && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">{t('permissionTags.payArr')}</span>}
                          {perms.manageUsers && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{t('permissionTags.manageUsers')}</span>}
                          {perms.hasAdminAccess && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">{t('permissionTags.admin')}</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex space-x-4 pt-4">
              <button type="button" onClick={() => setView('users')} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50">{t('common.cancel')}</button>
              <button type="submit" disabled={createLoading} className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">{createLoading ? t('admin.addUser.creating') : t('admin.addUser.createButton')}</button>
            </div>
          </form>
        </div>
      )}

      {view === 'permissions' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-800">{t('admin.permissions.title')}</h3>
              <p className="text-sm text-gray-500">{t('admin.permissions.description')}</p>
            </div>
            {/* Auto-Save Info */}
            {EDITABLE_ROLES[currentUser.role].length > 0 && (
              <span className="text-xs text-gray-400">💾 Änderungen werden automatisch gespeichert</span>
            )}
          </div>

          {permissionsMessage && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
              ✅ {permissionsMessage}
            </div>
          )}

          {/* Hinweis welche Rollen editierbar sind */}
          {EDITABLE_ROLES[currentUser.role].length > 0 && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              💡 Du kannst Berechtigungen für folgende Rollen bearbeiten: {EDITABLE_ROLES[currentUser.role].map(r => t(`roles.${r}`)).join(', ')}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2">
                  <th className="text-left py-3 px-2 font-medium text-gray-700"></th>
                  {ALL_ROLES.map(role => (
                    <th key={role} className="text-center py-3 px-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getRoleColor(role)}`}>
                        {t(`roles.${role}`)}
                      </span>
                      {canEditPermissionsForRole(role) && (
                        <div className="text-xs text-blue-500 mt-1">✏️</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_KEYS.map(key => (
                  <tr key={key} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-2">
                      <div className="font-medium text-gray-700">{t(`permissions.${key}`)}</div>
                      <div className="text-xs text-gray-400">{t(`permissions.${key}Desc`)}</div>
                    </td>
                    {ALL_ROLES.map(role => {
                      const canEdit = canEditPermissionsForRole(role);
                      // Get value from DB permissions using the key mapping
                      const dbKey = permKeyToDbKey[key];
                      const isChecked = dbPermissions[role]?.[dbKey as keyof RolePermissionRecord] as boolean ?? false;
                      return (
                        <td key={role} className="text-center py-3 px-2">
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            disabled={!canEdit}
                            onChange={() => handlePermissionToggle(role, key)}
                            className={`w-5 h-5 rounded border-gray-300 text-blue-600 ${
                              canEdit ? 'cursor-pointer hover:ring-2 hover:ring-blue-200' : 'cursor-not-allowed opacity-60'
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-700 mb-2">{t('admin.permissions.roleDescriptions')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {ALL_ROLES.map(role => (
                <div key={role} className="flex items-start space-x-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${getRoleColor(role)}`}>{t(`roles.${role}`)}</span>
                  <span className="text-gray-500">{t(`roleDescriptions.${role}`)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'team-overview' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">{t('admin.teamOverview.title')} 2026</h3>
          {teamStats.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('admin.teamOverview.noMembers')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.name')}</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">{t('common.role')}</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-500">{t('yearOverview.goLives')}</th>
                    <th className="text-right py-3 px-2 font-medium text-green-600">Subs ARR</th>
                    <th className="text-right py-3 px-2 font-medium text-orange-600">Pay ARR</th>
                    <th className="text-right py-3 px-2 font-medium text-purple-600">{t('dashboard.ytdProvision')}</th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map(({ user, goLivesCount, subsActual, payActual, totalProvision }) => (
                    <tr key={user.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-2 font-medium text-gray-800">{user.name}</td>
                      <td className="py-3 px-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleColor(user.role)}`}>{t(`roles.${user.role}`)}</span></td>
                      <td className="py-3 px-2 text-right">{goLivesCount}</td>
                      <td className="py-3 px-2 text-right text-green-600 font-medium">{formatCurrency(subsActual)}</td>
                      <td className="py-3 px-2 text-right text-orange-600 font-medium">{formatCurrency(payActual)}</td>
                      <td className="py-3 px-2 text-right text-purple-600 font-bold">{formatCurrency(totalProvision)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td className="py-3 px-2" colSpan={2}>{t('admin.teamOverview.teamTotal')}</td>
                    <td className="py-3 px-2 text-right">{teamStats.reduce((s, x) => s + x.goLivesCount, 0)}</td>
                    <td className="py-3 px-2 text-right text-green-700">{formatCurrency(teamStats.reduce((s, x) => s + x.subsActual, 0))}</td>
                    <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(teamStats.reduce((s, x) => s + x.payActual, 0))}</td>
                    <td className="py-3 px-2 text-right text-purple-700">{formatCurrency(teamStats.reduce((s, x) => s + x.totalProvision, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'backup' && (
        <div className="space-y-6">
          {/* Backup erstellen */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">💾 Backup erstellen</h3>
            <p className="text-sm text-gray-500 mb-4">
              Erstelle eine Sicherung aller Daten. Die Backup-Datei wird heruntergeladen und kann bei Bedarf wiederhergestellt werden.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-blue-800 mb-2">📦 Enthaltene Daten:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• <strong>{users.length}</strong> Benutzer (Profile, Rollen)</li>
                <li>• <strong>{allSettings.length}</strong> AE-Einstellungen (Targets, Tiers)</li>
                <li>• <strong>{goLives.length}</strong> Go-Lives</li>
                <li>• Challenges & Berechtigungen</li>
              </ul>
            </div>

            {backupError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                ❌ {backupError}
              </div>
            )}
            {backupSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
                ✅ {backupSuccess}
              </div>
            )}

            <button
              onClick={async () => {
                setBackupLoading(true);
                setBackupError('');
                setBackupSuccess('');
                
                const { data, error } = await createBackup();
                
                if (error) {
                  setBackupError(error);
                } else if (data) {
                  downloadBackup(data);
                  setBackupSuccess(`Backup erstellt! ${data.metadata.user_count} User, ${data.metadata.go_lives_count} Go-Lives, ${data.metadata.settings_count} Settings`);
                }
                
                setBackupLoading(false);
              }}
              disabled={backupLoading}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {backupLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Backup wird erstellt...</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>Backup herunterladen</span>
                </>
              )}
            </button>
          </div>

          {/* Backup wiederherstellen */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">🔄 Backup wiederherstellen</h3>
            <p className="text-sm text-gray-500 mb-4">
              Lade eine zuvor erstellte Backup-Datei hoch, um die Daten wiederherzustellen.
            </p>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-orange-800 mb-2">⚠️ Achtung:</h4>
              <ul className="text-sm text-orange-700 space-y-1">
                <li>• Bestehende Go-Lives, Settings und Challenges werden <strong>überschrieben</strong></li>
                <li>• Benutzer-Accounts bleiben erhalten (nur Profile werden aktualisiert)</li>
                <li>• Dieser Vorgang kann <strong>nicht rückgängig</strong> gemacht werden</li>
                <li>• Erstelle vorher ein aktuelles Backup!</li>
              </ul>
            </div>

            {restoreError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                ❌ {restoreError}
              </div>
            )}
            {restoreSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
                ✅ {restoreSuccess}
              </div>
            )}
            {restoreDetails.length > 0 && (
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                <h4 className="font-medium text-gray-700 mb-2">Details:</h4>
                {restoreDetails.map((detail, i) => (
                  <div key={i} className="text-gray-600">{detail}</div>
                ))}
              </div>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                setRestoreError('');
                setRestoreSuccess('');
                setRestoreDetails([]);

                try {
                  const text = await file.text();
                  const backup = JSON.parse(text) as BackupData;

                  // Validierung
                  if (!backup.version || !backup.tables) {
                    setRestoreError('Ungültiges Backup-Format');
                    return;
                  }

                  // Backup-Info anzeigen und Bestätigung anfordern
                  setPendingBackup(backup);
                  setConfirmRestore(true);
                } catch (err) {
                  setRestoreError('Datei konnte nicht gelesen werden. Ist es eine gültige JSON-Datei?');
                }

                // Input zurücksetzen
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
            />

            {!confirmRestore ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={restoreLoading}
                className="w-full py-3 bg-orange-100 text-orange-700 border-2 border-dashed border-orange-300 rounded-lg font-medium hover:bg-orange-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📁 Backup-Datei auswählen...
              </button>
            ) : pendingBackup && (
              <div className="border-2 border-orange-400 rounded-lg p-4 bg-orange-50">
                <h4 className="font-bold text-orange-800 mb-3">📋 Backup-Inhalt:</h4>
                <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">Erstellt am:</span>
                    <br />
                    <strong>{new Date(pendingBackup.created_at).toLocaleString('de-DE')}</strong>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">App-Version:</span>
                    <br />
                    <strong>{pendingBackup.app_version}</strong>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">Benutzer:</span>
                    <br />
                    <strong>{pendingBackup.metadata.user_count}</strong>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">Go-Lives:</span>
                    <br />
                    <strong>{pendingBackup.metadata.go_lives_count}</strong>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">Settings:</span>
                    <br />
                    <strong>{pendingBackup.metadata.settings_count}</strong>
                  </div>
                  <div className="bg-white p-2 rounded">
                    <span className="text-gray-500">Challenges:</span>
                    <br />
                    <strong>{pendingBackup.metadata.challenges_count}</strong>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setConfirmRestore(false);
                      setPendingBackup(null);
                    }}
                    className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={async () => {
                      if (!pendingBackup) return;
                      
                      setRestoreLoading(true);
                      setRestoreError('');
                      setRestoreSuccess('');
                      setRestoreDetails([]);

                      const { success, error, details } = await restoreBackup(pendingBackup);

                      if (success) {
                        setRestoreSuccess('Backup erfolgreich wiederhergestellt!');
                        setRestoreDetails(details);
                        // Daten neu laden
                        setTimeout(() => {
                          window.location.reload();
                        }, 2000);
                      } else {
                        setRestoreError(error || 'Wiederherstellung fehlgeschlagen');
                        setRestoreDetails(details);
                      }

                      setRestoreLoading(false);
                      setConfirmRestore(false);
                      setPendingBackup(null);
                    }}
                    disabled={restoreLoading}
                    className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                  >
                    {restoreLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span>Wird wiederhergestellt...</span>
                      </>
                    ) : (
                      <>
                        <span>⚠️</span>
                        <span>Jetzt wiederherstellen</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tipps */}
          <div className="bg-gray-50 rounded-xl p-6">
            <h4 className="font-medium text-gray-700 mb-3">💡 Tipps für Backups:</h4>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>• <strong>Vor Updates:</strong> Erstelle immer ein Backup bevor du größere Änderungen machst</li>
              <li>• <strong>Regelmäßig:</strong> Sichere deine Daten mindestens wöchentlich</li>
              <li>• <strong>Sicher aufbewahren:</strong> Speichere Backups an einem sicheren Ort (z.B. Cloud-Speicher)</li>
              <li>• <strong>Testen:</strong> Überprüfe gelegentlich, ob deine Backups funktionieren</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
