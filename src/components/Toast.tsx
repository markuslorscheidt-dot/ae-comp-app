'use client';

import { useState, useEffect, createContext, useContext, useCallback } from 'react';

export type ToastType = 'success' | 'warning' | 'error' | 'info' | 'challenge';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  icon?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: ToastMessage = {
      ...toast,
      id,
      duration: toast.duration ?? 5000,
    };
    setToasts(prev => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, removeToast }: { toasts: ToastMessage[]; removeToast: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Einblenden
    requestAnimationFrame(() => setIsVisible(true));

    // Auto-Ausblenden
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(onClose, 300);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, onClose]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(onClose, 300);
  };

  const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: {
      bg: 'bg-green-50',
      border: 'border-green-500',
      icon: '✅',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-500',
      icon: '⚠️',
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-500',
      icon: '❌',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-500',
      icon: 'ℹ️',
    },
    challenge: {
      bg: 'bg-purple-50',
      border: 'border-purple-500',
      icon: '🎯',
    },
  };

  const styles = typeStyles[toast.type];

  return (
    <div
      className={`
        ${styles.bg} ${styles.border} border-l-4 rounded-lg shadow-lg p-4
        transform transition-all duration-300 ease-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className="flex items-start">
        <span className="text-xl mr-3 flex-shrink-0">
          {toast.icon || styles.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-gray-800 text-sm">{toast.title}</h4>
          <p className="text-gray-600 text-sm mt-1">{toast.message}</p>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="mt-2 text-sm font-medium text-purple-600 hover:text-purple-800"
            >
              {toast.action.label} →
            </button>
          )}
        </div>
        <button
          onClick={handleClose}
          className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Hook für Challenge-spezifische Benachrichtigungen
export function useChallengeNotifications(
  challenges: Array<{ id: string; name: string; icon: string; is_active: boolean; end_date: string }>,
  progressMap: Map<string, { is_completed: boolean; days_remaining: number; progress_percent: number }>
) {
  const { addToast } = useToast();
  const [notifiedChallenges, setNotifiedChallenges] = useState<Set<string>>(new Set());

  useEffect(() => {
    challenges.forEach(challenge => {
      if (!challenge.is_active) return;
      
      const progress = progressMap.get(challenge.id);
      if (!progress) return;

      const notifyKey = `${challenge.id}-${progress.is_completed ? 'completed' : 'warning'}`;
      
      // Bereits benachrichtigt?
      if (notifiedChallenges.has(notifyKey)) return;

      // Challenge abgeschlossen
      if (progress.is_completed) {
        addToast({
          type: 'challenge',
          title: '🎉 Challenge geschafft!',
          message: `"${challenge.name}" wurde erfolgreich abgeschlossen!`,
          icon: challenge.icon,
          duration: 8000,
        });
        setNotifiedChallenges(prev => new Set(prev).add(notifyKey));
      }
      // Challenge endet bald (< 3 Tage)
      else if (progress.days_remaining <= 3 && progress.days_remaining > 0 && progress.progress_percent < 100) {
        addToast({
          type: 'warning',
          title: '⏰ Challenge endet bald!',
          message: `"${challenge.name}" - noch ${progress.days_remaining} Tag(e)! Aktuell: ${Math.round(progress.progress_percent)}%`,
          icon: challenge.icon,
          duration: 10000,
        });
        setNotifiedChallenges(prev => new Set(prev).add(notifyKey));
      }
    });
  }, [challenges, progressMap, addToast, notifiedChallenges]);
}

export default ToastProvider;
