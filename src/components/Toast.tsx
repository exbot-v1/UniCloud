/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Toast Notification Provider
 * Lightweight non-intrusive feedback for file and account operations.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, message: string, duration = 3500) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const success = useCallback((msg: string, dur?: number) => showToast('success', msg, dur), [showToast]);
  const error = useCallback((msg: string, dur?: number) => showToast('error', msg, dur), [showToast]);
  const info = useCallback((msg: string, dur?: number) => showToast('info', msg, dur), [showToast]);
  const warning = useCallback((msg: string, dur?: number) => showToast('warning', msg, dur), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      {/* Toast Notifications Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all ${
              toast.type === 'success'
                ? 'bg-white/95 dark:bg-slate-900/95 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                : toast.type === 'error'
                ? 'bg-white/95 dark:bg-slate-900/95 border-rose-500/30 text-rose-800 dark:text-rose-200'
                : toast.type === 'warning'
                ? 'bg-white/95 dark:bg-slate-900/95 border-amber-500/30 text-amber-800 dark:text-amber-200'
                : 'bg-white/95 dark:bg-slate-900/95 border-blue-500/30 text-blue-800 dark:text-blue-200'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              {toast.type === 'error' && <AlertCircle className="h-4 w-4 text-rose-500" />}
              {toast.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {toast.type === 'info' && <Info className="h-4 w-4 text-blue-500" />}
            </div>
            <div className="flex-1 text-xs font-medium leading-relaxed text-slate-800 dark:text-slate-100">
              {toast.message}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded cursor-pointer shrink-0 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
