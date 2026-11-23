import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  Copy,
  Search,
  X,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import { humanizeStatus } from '../../lib/format.ts';

/**
 * Semantic status indicator pairing explicit text label + accessible icon (never color alone).
 */
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();

  let tone = 'text-slate-600 dark:text-slate-400';
  let Icon = Clock;

  if (
    [
      'VERIFIED',
      'PAID',
      'CONFIRMED',
      'APPROVED_VERIFIED',
      'MATCHED',
      'ACTIVE',
      'HEALTHY',
      'SUCCESS',
      'RESOLVED',
    ].includes(normalized)
  ) {
    tone = 'text-emerald-700 dark:text-emerald-400';
    Icon = CheckCircle2;
  } else if (
    [
      'VERIFICATION_PENDING',
      'PAYMENT_REPORTED',
      'REVIEW_REQUIRED',
      'PARTIALLY_VERIFIED',
      'PARTIALLY_PAID',
      'POTENTIAL_MATCH',
      'AMBIGUOUS',
      'AWAITING_PAYMENT',
      'OPEN',
      'ASSIGNED',
      'UNDER_BANK_CHECK',
      'CLARIFICATION_REQUESTED',
      'REOPENED',
      'ISSUED',
      'PENDING',
    ].includes(normalized)
  ) {
    tone = 'text-amber-700 dark:text-amber-400';
    Icon = Clock;
  } else if (
    [
      'DISPUTED',
      'FAILED_REPORTED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
      'DENIED',
      'FAILED',
      'UNMATCHED',
    ].includes(normalized)
  ) {
    tone = 'text-red-700 dark:text-red-400';
    Icon = AlertCircle;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium text-xs whitespace-nowrap ${tone}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{humanizeStatus(status)}</span>
    </span>
  );
}

/**
 * Standard page header with concise title, supporting subtitle, and contextual actions.
 */
export function PageHeader({
  title,
  description,
  kicker,
  actions,
}: {
  title: string;
  description?: string;
  kicker?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1">
      <div className="min-w-0">
        {kicker && (
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-1">
            {kicker}
          </p>
        )}
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
      )}
    </div>
  );
}

/**
 * Single-elevation metric summary block with optional interactive drill-down.
 */
export function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = 'default',
  onClick,
  actionLabel,
}: {
  label: string;
  value: string | number;
  subtext: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'indigo';
  onClick?: () => void;
  actionLabel?: string;
}) {
  const valueTone =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'danger'
          ? 'text-red-700 dark:text-red-400'
          : tone === 'indigo'
            ? 'text-indigo-700 dark:text-indigo-400'
            : 'text-slate-900 dark:text-slate-100';

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {Icon && (
          <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className={`mt-2.5 text-2xl sm:text-[26px] font-bold font-mono tabular-nums tracking-tight ${valueTone}`}>
        {value}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">{subtext}</span>
        {onClick && actionLabel && (
          <span className="inline-flex items-center gap-0.5 font-medium text-indigo-600 dark:text-indigo-400 shrink-0">
            <span>{actionLabel}</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-5 bg-white dark:bg-[#0D1424] hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition-colors focus-visible:outline-none"
      >
        {content}
      </button>
    );
  }

  return <div className="p-5 bg-white dark:bg-[#0D1424]">{content}</div>;
}

/**
 * Clean alert banner pairing icon + semantic colors + message.
 */
export function AlertBanner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message: string;
  action?: React.ReactNode;
}) {
  const styles = {
    success:
      'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-200',
    warning:
      'border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200',
    error:
      'border-red-200 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/25 text-red-900 dark:text-red-200',
    info:
      'border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/25 text-indigo-950 dark:text-indigo-200',
  }[tone];

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'error'
          ? AlertCircle
          : Info;

  return (
    <div className={`border rounded-xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 ${styles}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs leading-relaxed">
          {title && <div className="font-semibold mb-0.5">{title}</div>}
          <div>{message}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Segmented tab control for status filtering and view switching.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              active
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                ({opt.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Accessible search input with clear button.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className = 'w-full sm:w-72',
  ariaLabel = 'Search records',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="forge-input w-full h-10 pl-9 pr-8 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * One-click clipboard copy button.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  className = '',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 ${className}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

/**
 * Empty state with clear description and optional primary action.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-10 text-center">
      {Icon && (
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto mb-3 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Skeleton rows for async data tables.
 */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse">
          <div className="h-3.5 w-32 sm:w-40 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="h-3.5 w-40 sm:w-56 bg-slate-100 dark:bg-slate-800/70 rounded" />
          <div className="h-3.5 w-20 sm:w-24 bg-slate-200 dark:bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * Centered modal dialog with Escape key support.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${maxWidth} bg-white dark:bg-[#0D1424] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl my-8 fxp-fade-in`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/**
 * Right-side slide-over detail drawer on desktop, full-screen sheet on mobile.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  headerBadge,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerBadge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full sm:max-w-xl h-full bg-white dark:bg-[#0D1424] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col fxp-drawer-in">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {title}
              </h2>
              {headerBadge}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail drawer"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 shrink-0 flex flex-wrap items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Chronological timeline displaying actual occurred events.
 */
export interface TimelineEvent {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string | null;
  state: 'completed' | 'current' | 'error';
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="space-y-4">
      {events.map((ev, idx) => {
        const isLast = idx === events.length - 1;
        const dotCls =
          ev.state === 'completed'
            ? 'bg-emerald-600 text-white border-emerald-600'
            : ev.state === 'error'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-indigo-600 text-white border-indigo-600';

        return (
          <li key={ev.id} className="relative flex items-start gap-3">
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-slate-200 dark:bg-slate-800"
                aria-hidden="true"
              />
            )}
            <span
              className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${dotCls}`}
              aria-hidden="true"
            >
              {ev.state === 'completed' ? (
                <Check className="w-3.5 h-3.5" />
              ) : ev.state === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {ev.label}
                </span>
                {ev.timestamp && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {ev.timestamp}
                  </span>
                )}
              </div>
              {ev.detail && (
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {ev.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
