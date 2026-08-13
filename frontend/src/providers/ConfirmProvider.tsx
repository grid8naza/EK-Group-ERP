'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** Focus the cancel button by default (so Enter cancels) — for prompts where
   *  the safe choice should be the default, e.g. discarding unsaved changes. */
  defaultCancel?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** One way out of a question — see `choose`. */
export interface ChoiceAction {
  /** What the caller gets back when this one is picked. */
  key: string;
  label: string;
  tone?: 'primary' | 'secondary' | 'danger';
  /** The one Enter takes. Put it on the safe answer, not the destructive one. */
  autoFocus?: boolean;
}

export interface ChoiceOptions {
  title?: string;
  message: string;
  danger?: boolean;
  /** Left to right, so the safest first and the most destructive last. */
  actions: ChoiceAction[];
  /** What clicking the backdrop resolves to — always the harmless answer. */
  dismissKey: string;
}

type ChooseFn = (opts: ChoiceOptions) => Promise<string>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);
const ChoiceContext = createContext<ChooseFn | undefined>(undefined);

/**
 * The application's one question box.
 *
 * Two ways to ask. `confirm` is yes/no and answers a boolean — most questions
 * are that. `choose` offers a list of ways out and answers which was taken, for
 * the questions that genuinely have three: leaving a half-written mail is keep
 * writing, save it, or throw it away, and forcing that into yes/no would make
 * one of the three unreachable.
 *
 * Both render the same dialog, so a question looks the same wherever it comes
 * from.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ChoiceOptions | null>(null);
  const resolver = useRef<(key: string) => void>();

  const choose = useCallback<ChooseFn>((o) => {
    setOpts(o);
    return new Promise<string>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Yes/no, expressed as a two-way choice: one dialog, one set of styles.
  const confirm = useCallback<ConfirmFn>(
    async (o) => {
      const picked = await choose({
        title: o.title,
        message: o.message,
        danger: o.danger,
        dismissKey: 'cancel',
        actions: [
          {
            key: 'cancel',
            label: o.cancelText || 'Cancel',
            tone: 'secondary',
            autoFocus: o.defaultCancel,
          },
          {
            key: 'confirm',
            label: o.confirmText || 'Confirm',
            tone: o.danger ? 'danger' : 'primary',
          },
        ],
      });
      return picked === 'confirm';
    },
    [choose],
  );

  const close = (key: string) => {
    resolver.current?.(key);
    resolver.current = undefined;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      <ChoiceContext.Provider value={choose}>
        {children}
        {opts && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              onClick={() => close(opts.dismissKey)}
            />
            <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-4">
                <div
                  className={
                    'flex h-11 w-11 flex-none items-center justify-center rounded-full ' +
                    (opts.danger
                      ? 'bg-rose-100 text-rose-600 dark:bg-rose-950'
                      : 'bg-brand-100 text-brand-600 dark:bg-brand-950')
                  }
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {opts.title || 'Are you sure?'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {opts.message}
                  </p>
                </div>
              </div>
              {/* Wraps rather than squeezes: three ways out do not always fit
                  one line, and a truncated label is a question nobody can
                  answer. */}
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {opts.actions.map((action) => (
                  <button
                    key={action.key}
                    autoFocus={action.autoFocus}
                    className={
                      action.tone === 'danger'
                        ? 'btn-danger'
                        : action.tone === 'primary'
                          ? 'btn-primary'
                          : 'btn-secondary'
                    }
                    onClick={() => close(action.key)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </ChoiceContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

/** Ask a question with more than two answers. See ConfirmProvider. */
export function useChoice() {
  const ctx = useContext(ChoiceContext);
  if (!ctx) throw new Error('useChoice must be used within ConfirmProvider');
  return ctx;
}
