'use client';

import { useState } from 'react';
import { useNotifications, useNotificationSettings } from '@/lib/pipeline-hooks';
import { Notification, NotificationPriority } from '@/lib/pipeline-types';

interface NotificationsPanelProps {
  userId: string;
  onNavigateToOpportunity?: (opportunityId: string) => void;
  onClose: () => void;
}

const PRIORITY_STYLES: Record<NotificationPriority, { bg: string; border: string; icon: string }> = {
  low: { bg: 'bg-gray-50', border: 'border-gray-200', icon: '💬' },
  normal: { bg: 'bg-blue-50', border: 'border-blue-200', icon: '📌' },
  high: { bg: 'bg-orange-50', border: 'border-orange-200', icon: '⚠️' },
  urgent: { bg: 'bg-red-50', border: 'border-red-200', icon: '🚨' },
};

const TYPE_LABELS: Record<string, string> = {
  deal_overdue: 'Deal überfällig',
  deal_stuck: 'Deal steckt fest',
  forecast_warning: 'Forecast Warnung',
  forecast_critical: 'Forecast kritisch',
  stage_changed: 'Stage geändert',
  deal_won: 'Deal gewonnen',
  deal_lost: 'Deal verloren',
};

export default function NotificationsPanel({ 
  userId, 
  onNavigateToOpportunity,
  onClose 
}: NotificationsPanelProps) {
  const { 
    notifications, 
    unreadCount, 
    loading, 
    markAsRead, 
    markAllAsRead,
    deleteNotification 
  } = useNotifications(userId);
  
  const { settings, updateSettings } = useNotificationSettings(userId);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filteredNotifications = filter === 'unread' 
    ? notifications.filter(n => !n.is_read)
    : notifications;

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    
    if (notification.related_type === 'opportunity' && notification.related_id && onNavigateToOpportunity) {
      onNavigateToOpportunity(notification.related_id);
      onClose();
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Gerade eben';
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    return date.toLocaleDateString('de-DE');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-end z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col mt-16 mr-4">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-800">🔔 Benachrichtigungen</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition ${showSettings ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
              title="Einstellungen"
            >
              ⚙️
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              ✕
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && settings && (
          <div className="p-4 bg-gray-50 border-b space-y-3">
            <h3 className="font-medium text-gray-700">Benachrichtigungs-Einstellungen</h3>
            
            <label className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Deal überfällig</span>
              <input
                type="checkbox"
                checked={settings.notify_deal_overdue}
                onChange={(e) => updateSettings({ notify_deal_overdue: e.target.checked })}
                className="w-5 h-5 rounded text-blue-600"
              />
            </label>
            
            <label className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Deal steckt fest</span>
              <input
                type="checkbox"
                checked={settings.notify_deal_stuck}
                onChange={(e) => updateSettings({ notify_deal_stuck: e.target.checked })}
                className="w-5 h-5 rounded text-blue-600"
              />
            </label>
            
            {settings.notify_deal_stuck && (
              <div className="flex items-center justify-between pl-4">
                <span className="text-sm text-gray-500">Nach Tagen:</span>
                <input
                  type="number"
                  value={settings.notify_deal_stuck_days}
                  onChange={(e) => updateSettings({ notify_deal_stuck_days: Number(e.target.value) })}
                  className="w-16 px-2 py-1 border rounded text-sm"
                  min="1"
                  max="30"
                />
              </div>
            )}
            
            <label className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Forecast Warnung</span>
              <input
                type="checkbox"
                checked={settings.notify_forecast_warning}
                onChange={(e) => updateSettings({ notify_forecast_warning: e.target.checked })}
                className="w-5 h-5 rounded text-blue-600"
              />
            </label>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setFilter('all')}
            className={`flex-1 py-2 text-sm font-medium transition ${
              filter === 'all' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
            }`}
          >
            Alle
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`flex-1 py-2 text-sm font-medium transition ${
              filter === 'unread' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
            }`}
          >
            Ungelesen ({unreadCount})
          </button>
        </div>

        {/* Mark all as read */}
        {unreadCount > 0 && (
          <div className="px-4 py-2 border-b bg-gray-50">
            <button
              onClick={() => markAllAsRead()}
              className="text-sm text-blue-600 hover:underline"
            >
              Alle als gelesen markieren
            </button>
          </div>
        )}

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotifications.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <div className="text-4xl mb-2">📭</div>
              <p>Keine Benachrichtigungen</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredNotifications.map(notification => {
                const style = PRIORITY_STYLES[notification.priority];
                return (
                  <div
                    key={notification.id}
                    className={`p-4 cursor-pointer transition hover:bg-gray-50 ${
                      !notification.is_read ? style.bg : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className={`font-medium truncate ${!notification.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                            {notification.title}
                          </h4>
                          {!notification.is_read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-400">
                            {TYPE_LABELS[notification.type] || notification.type}
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatTimeAgo(notification.created_at)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                        title="Löschen"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Mini-Badge für Navigation
export function NotificationBadge({ 
  count, 
  onClick 
}: { 
  count: number; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative p-2 hover:bg-gray-100 rounded-lg transition"
    >
      <span className="text-xl">🔔</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
