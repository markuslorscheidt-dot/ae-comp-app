'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, AESettings, GoLive } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/lib/supabase';
import { 
  formatCurrency, 
  formatPercent,
  getAchievementColor,
  calculateYTDSummary
} from '@/lib/calculations';
import { calculateBadges, EarnedBadge, RARITY_COLORS } from '@/lib/badges';

interface UserProfileProps {
  user: User;
  currentUser: User;
  settings?: AESettings;
  goLives?: GoLive[];
  allUsers: User[];
  onBack: () => void;
  onSave?: (updatedUser: Partial<User>) => Promise<void>;
  canEdit: boolean;
}

const REGIONS = [
  'DACH',
  'Deutschland',
  'Österreich',
  'Schweiz',
  'DACH-Nord',
  'DACH-Süd',
  'DACH-Ost',
  'DACH-West',
];

export default function UserProfile({
  user,
  currentUser,
  settings,
  goLives = [],
  allUsers,
  onBack,
  onSave,
  canEdit
}: UserProfileProps) {
  const { t } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  
  // Editierbare Felder
  const [editData, setEditData] = useState({
    name: user.name,
    phone: user.phone || '',
    region: user.region || 'DACH',
    employee_id: user.employee_id || '',
    start_date: user.start_date || '',
    manager_id: user.manager_id || '',
  });

  // Manager finden
  const manager = useMemo(() => {
    if (!user.manager_id) return null;
    return allUsers.find(u => u.id === user.manager_id);
  }, [user.manager_id, allUsers]);

  // Team-Mitglieder (wenn User ein Manager ist)
  const teamMembers = useMemo(() => {
    return allUsers.filter(u => u.manager_id === user.id);
  }, [user.id, allUsers]);

  // Mögliche Manager (nur Line Manager und Country Manager)
  const possibleManagers = useMemo(() => {
    return allUsers.filter(u => 
      u.id !== user.id && 
      (u.role === 'country_manager' || 
       u.role === 'dlt_member' ||
       u.role === 'line_manager_new_business' ||
       u.role === 'commercial_director' ||
       u.role === 'head_of_partnerships' ||
       u.role === 'head_of_expanding_revenue' ||
       u.role === 'head_of_marketing')
    );
  }, [user.id, allUsers]);

  // YTD Performance berechnen
  const ytdSummary = useMemo(() => {
    if (!settings || goLives.length === 0) return null;
    return calculateYTDSummary(goLives, settings);
  }, [goLives, settings]);

  // Badges berechnen
  const badges = useMemo(() => {
    if (!settings) return [];
    return calculateBadges(user, settings, goLives);
  }, [user, settings, goLives]);

  const handleSave = async () => {
    if (!onSave) return;
    
    setSaving(true);
    setSaveMessage('');
    
    try {
      await onSave({
        name: editData.name,
        phone: editData.phone || null,
        region: editData.region,
        employee_id: editData.employee_id || null,
        start_date: editData.start_date || null,
        manager_id: editData.manager_id || null,
      });
      
      setSaveMessage(t('profile.saveSuccess'));
      setIsEditing(false);
      
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <h2 className="text-2xl font-bold text-gray-800">👤 {t('profile.title')}</h2>
        </div>
        {canEdit && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
          >
            ✏️ {t('profile.editProfile')}
          </button>
        )}
      </div>

      {/* Success Message */}
      {saveMessage && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
          ✅ {saveMessage}
        </div>
      )}

      {/* Profile Card */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {/* Header mit Avatar */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex items-center space-x-4">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl">
              {user.photo_url ? (
                <img 
                  src={user.photo_url} 
                  alt={user.name} 
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                user.name.charAt(0).toUpperCase()
              )}
            </div>
            <div>
              {isEditing ? (
                <input
                  type="text"
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="text-2xl font-bold bg-white/20 rounded px-2 py-1 text-white placeholder-white/60"
                />
              ) : (
                <h3 className="text-2xl font-bold">{user.name}</h3>
              )}
              <p className="text-blue-100">{t(`roles.${user.role}`)}</p>
              {user.employee_id && (
                <p className="text-sm text-blue-200">#{user.employee_id}</p>
              )}
            </div>
          </div>
          
          {/* Badges */}
          {badges.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {badges.map((eb, i) => (
                <span 
                  key={i} 
                  className="bg-white/20 px-2 py-1 rounded-full text-sm flex items-center space-x-1"
                  title={t(eb.badge.descKey)}
                >
                  <span>{eb.badge.icon}</span>
                  <span>{t(eb.badge.nameKey)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stammdaten */}
        <div className="p-6">
          <h4 className="text-lg font-bold text-gray-800 mb-4">{t('profile.basicInfo')}</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* E-Mail */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.email')}</label>
              <p className="text-gray-800">{user.email}</p>
            </div>

            {/* Telefon */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.phone')}</label>
              {isEditing ? (
                <input
                  type="tel"
                  value={editData.phone}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="+49 123 456789"
                />
              ) : (
                <p className="text-gray-800">{user.phone || '-'}</p>
              )}
            </div>

            {/* Region */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.region')}</label>
              {isEditing ? (
                <select
                  value={editData.region}
                  onChange={(e) => setEditData({ ...editData, region: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {REGIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <p className="text-gray-800">{user.region || 'DACH'}</p>
              )}
            </div>

            {/* Mitarbeiter-Nr. */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.employeeId')}</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editData.employee_id}
                  onChange={(e) => setEditData({ ...editData, employee_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="AE-001"
                />
              ) : (
                <p className="text-gray-800">{user.employee_id || '-'}</p>
              )}
            </div>

            {/* Start-Datum */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.startDate')}</label>
              {isEditing ? (
                <input
                  type="date"
                  value={editData.start_date}
                  onChange={(e) => setEditData({ ...editData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              ) : (
                <p className="text-gray-800">{formatDate(user.start_date)}</p>
              )}
            </div>

            {/* Vorgesetzter */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.manager')}</label>
              {isEditing ? (
                <select
                  value={editData.manager_id}
                  onChange={(e) => setEditData({ ...editData, manager_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">{t('profile.noManager')}</option>
                  {possibleManagers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({t(`roles.${m.role}`)})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-gray-800">
                  {manager ? (
                    <span className="flex items-center space-x-2">
                      <span>{manager.name}</span>
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {t(`roles.${manager.role}`)}
                      </span>
                    </span>
                  ) : (
                    t('profile.noManager')
                  )}
                </p>
              )}
            </div>

            {/* Dabei seit */}
            <div>
              <label className="block text-sm font-medium text-gray-500">{t('profile.memberSince')}</label>
              <p className="text-gray-800">{formatDate(user.created_at)}</p>
            </div>
          </div>

          {/* Edit Buttons */}
          {isEditing && (
            <div className="flex space-x-4 mt-6 pt-4 border-t">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditData({
                    name: user.name,
                    phone: user.phone || '',
                    region: user.region || 'DACH',
                    employee_id: user.employee_id || '',
                    start_date: user.start_date || '',
                    manager_id: user.manager_id || '',
                  });
                }}
                className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Performance Card */}
      {ytdSummary && settings && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h4 className="text-lg font-bold text-gray-800 mb-4">{t('profile.performance')}</h4>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(ytdSummary.total_subs_arr)}
              </div>
              <div className="text-sm text-gray-500">YTD Subs ARR</div>
              <div className={`text-xs ${getAchievementColor(ytdSummary.total_subs_achievement)}`}>
                {formatPercent(ytdSummary.total_subs_achievement)} {t('leaderboard.vsTarget')}
              </div>
            </div>
            
            <div className="bg-orange-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">
                {formatCurrency(ytdSummary.total_pay_arr)}
              </div>
              <div className="text-sm text-gray-500">YTD Pay ARR</div>
              <div className={`text-xs ${getAchievementColor(ytdSummary.total_pay_achievement)}`}>
                {formatPercent(ytdSummary.total_pay_achievement)} {t('leaderboard.vsTarget')}
              </div>
            </div>
            
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {ytdSummary.total_go_lives}
              </div>
              <div className="text-sm text-gray-500">{t('leaderboard.goLives')}</div>
              <div className="text-xs text-gray-400">
                {ytdSummary.total_terminals} {t('leaderboard.terminals')}
              </div>
            </div>
            
            <div className="bg-purple-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {formatCurrency(ytdSummary.total_provision)}
              </div>
              <div className="text-sm text-gray-500">{t('profile.ytdEarnings')}</div>
              <div className="text-xs text-gray-400">
                {formatPercent(ytdSummary.total_provision / settings.ote)} OTE
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Members (if Manager) */}
      {teamMembers.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h4 className="text-lg font-bold text-gray-800 mb-4">
            👥 {t('profile.teamMembers')} ({teamMembers.length})
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map(member => (
              <div key={member.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                  {member.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium text-gray-800">{member.name}</div>
                  <div className="text-xs text-gray-500">{t(`roles.${member.role}`)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Badges Section */}
      {badges.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h4 className="text-lg font-bold text-gray-800 mb-4">
            🏅 {t('profile.badges')} ({badges.length})
          </h4>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {badges.map((eb, i) => {
              const colors = RARITY_COLORS[eb.badge.rarity];
              return (
                <div 
                  key={i}
                  className={`${colors.bg} ${colors.border} border-2 rounded-xl p-4 text-center ${colors.glow}`}
                >
                  <div className="text-3xl mb-2">{eb.badge.icon}</div>
                  <div className={`text-sm font-bold ${colors.text}`}>
                    {t(eb.badge.nameKey)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {t(eb.badge.descKey)}
                  </div>
                  {eb.details && (
                    <div className="text-xs text-gray-400 mt-1">{eb.details}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
