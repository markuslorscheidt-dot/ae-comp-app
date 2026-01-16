'use client';

import { User } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';

interface UserSelectorProps {
  users: User[];
  selectedUserIds: string[];
  onSelectionChange: (userIds: string[]) => void;
  currentUser: User;
  mode: 'single' | 'multi' | 'compare';
  showAllOption?: boolean;
  label?: string;
}

export default function UserSelector({
  users,
  selectedUserIds,
  onSelectionChange,
  currentUser,
  mode,
  showAllOption = false,
  label
}: UserSelectorProps) {
  const { t } = useLanguage();

  const getRoleColor = (role: string) => {
    if (role === 'country_manager') return 'bg-purple-100 text-purple-700';
    if (role === 'line_manager') return 'bg-blue-100 text-blue-700';
    if (role === 'ae') return 'bg-green-100 text-green-700';
    return 'bg-gray-100 text-gray-700';
  };

  // Single Select Mode
  if (mode === 'single') {
    return (
      <div className="flex items-center space-x-3">
        {label && <span className="text-sm font-medium text-gray-700">{label}:</span>}
        <select
          value={selectedUserIds[0] || ''}
          onChange={(e) => onSelectionChange([e.target.value])}
          className="px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.name} {user.id === currentUser.id ? t('common.you') : ''} - {t(`roles.${user.role}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Multi/Compare Mode
  if (mode === 'multi' || mode === 'compare') {
    const isAllSelected = selectedUserIds.includes('all');
    const isCompareMode = selectedUserIds.length > 1 && !isAllSelected;

    return (
      <div className="space-y-2">
        {label && <span className="text-sm font-medium text-gray-700">{label}:</span>}
        
        <div className="flex flex-wrap gap-2">
          {/* Alle Option */}
          {showAllOption && (
            <button
              onClick={() => onSelectionChange(['all'])}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                isAllSelected
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📊 {t('userSelector.total')}
            </button>
          )}

          {/* Einzelne User */}
          {users.map(user => {
            const isSelected = selectedUserIds.includes(user.id);
            return (
              <button
                key={user.id}
                onClick={() => {
                  if (mode === 'compare') {
                    if (isSelected) {
                      const newSelection = selectedUserIds.filter(id => id !== user.id && id !== 'all');
                      onSelectionChange(newSelection.length > 0 ? newSelection : [users[0].id]);
                    } else {
                      onSelectionChange([...selectedUserIds.filter(id => id !== 'all'), user.id]);
                    }
                  } else {
                    onSelectionChange([user.id]);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-2 ${
                  isSelected && !isAllSelected
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{user.name}</span>
                {user.id === currentUser.id && <span className="text-xs opacity-75">{t('common.you')}</span>}
              </button>
            );
          })}
        </div>

        {/* Vergleichs-Info */}
        {isCompareMode && (
          <p className="text-xs text-blue-600">
            📊 {t('userSelector.comparison')}: {t('userSelector.compareUsers').replace('{count}', selectedUserIds.length.toString())}
          </p>
        )}
      </div>
    );
  }

  return null;
}
