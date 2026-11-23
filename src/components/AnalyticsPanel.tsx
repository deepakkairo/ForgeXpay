import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw, ShieldCheck, AlertTriangle, Clock, FileText } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatInr } from '../lib/format.ts';
import {
  AlertBanner,
  EmptyState,
  MetricCard,
  PageHeader,
  SegmentedTabs,
  SkeletonRows,
} from './ui/Primitives.tsx';

export interface AnalyticsTransaction {
  id: string;
  paymentRef: string;
  category: string;
  expectedAmountPaise: number;
  verifiedAmountPaise: number | null;
  status: string;
  createdAt: string;
  verifiedAt?: string | null;
}

type Granularity = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type DateRangeKey = 'TODAY' | '7D' | '30D' | 'ALL';

export function filterByDateRange<T extends { createdAt: string }>(
  items: T[],
  range: DateRangeKey
): T[] {
  if (range === 'ALL') return items;
  const now = Date.now();
  const ms =
    range === 'TODAY'
      ? 24 * 60 * 60 * 1000
      : range === '7D'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const t = new Date(item.createdAt).getTime();
    return Number.isFinite(t) && now - t <= ms;
  });
}

function getBucketKey(dateIso: string, granularity: Granularity): { key: string; label: string } {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return { key: 'unknown', label: 'Unknown' };
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  if (granularity === 'MONTHLY') {
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label };
  }

  if (granularity === 'WEEKLY') {
    const utcDay = d.getUTCDay();
    const diff = day - utcDay + (utcDay === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(year, month, diff));
    const label = monday.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return { key: monday.toISOString().slice(0, 10), label: `Wk ${label}` };
  }

  const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return { key: d.toISOString().slice(0, 10), label };
}

export function VerifiedCollectionsChart({
  transactions,
  title = 'Verified Collections Over Time',
}: {
  transactions: AnalyticsTransaction[];
  title?: string;
}) {
  const [granularity, setGranularity] = useState<Granularity>('DAILY');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const verifiedOnly = useMemo(
    () =>
      transactions.filter(
        (t) => t.status === 'VERIFIED' && (t.verifiedAmountPaise ?? t.expectedAmountPaise) > 0
      ),
    [transactions]
  );

  const buckets = useMemo(() => {
    const map = new Map<string, { key: string; label: string; totalPaise: number; count: number }>();
    for (const tx of verifiedOnly) {
      const dateRef = tx.verifiedAt || tx.createdAt;
      const { key, label } = getBucketKey(dateRef, granularity);
      const cur = map.get(key) || { key, label, totalPaise: 0, count: 0 };
      cur.totalPaise += tx.verifiedAmountPaise ?? tx.expectedAmountPaise;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [verifiedOnly, granularity]);

  const totalVerifiedPaise = useMemo(
    () => buckets.reduce((acc, b) => acc + b.totalPaise, 0),
    [buckets]
  );

  const width = 760;
  const height = 220;
  const padX = 24;
  const padY = 24;
  const maxVal = Math.max(100, ...buckets.map((b) => b.totalPaise));

  const points = buckets.map((b, i) => {
    const x =
      buckets.length === 1
        ? width / 2
        : padX + (i / Math.max(1, buckets.length - 1)) * (width - padX * 2);
    const y = height - padY - (b.totalPaise / maxVal) * (height - padY * 2);
    return { ...b, x, y };
  });

  const linePath =
    points.length > 0
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      : '';

  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(height - padY).toFixed(1)} L ${points[0].x.toFixed(1)} ${(height - padY).toFixed(1)} Z`
      : '';

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : points[points.length - 1];

  return (
    <section
      aria-label={title}
      className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Verified Bank Credits only — unverified customer reports are excluded from revenue.
          </p>
        </div>

        <SegmentedTabs<Granularity>
          value={granularity}
          onChange={setGranularity}
          options={[
            { id: 'DAILY', label: 'Daily' },
            { id: 'WEEKLY', label: 'Weekly' },
            { id: 'MONTHLY', label: 'Monthly' },
          ]}
        />
      </div>

      {buckets.length === 0 ? (
        <div className="mt-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl py-12 px-6 text-center">
          <BarChart3 className="w-6 h-6 text-slate-400 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No verified bank credits in this period
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Verified collections appear here once an authorised Finance Admin confirms an incoming UPI transfer against bank records.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-4 mb-3">
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {activePoint ? `${activePoint.label} · ${activePoint.count} verified` : 'Total Verified'}
              </span>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatInr(activePoint ? activePoint.totalPaise : totalVerifiedPaise)}
              </div>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Period total: {formatInr(totalVerifiedPaise)} ({verifiedOnly.length} txns)
            </div>
          </div>

          <div className="w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-52 overflow-visible"
              role="img"
              aria-label={`Verified collections chart showing ${formatInr(totalVerifiedPaise)} across ${buckets.length} periods`}
            >
              <defs>
                <linearGradient id="fxpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75, 1].map((step) => {
                const y = height - padY - step * (height - padY * 2);
                return (
                  <line
                    key={step}
                    x1={padX}
                    x2={width - padX}
                    y1={y}
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                );
              })}

              {areaPath && <path d={areaPath} fill="url(#fxpAreaGrad)" />}
              {points.length > 1 && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#4F46E5"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {points.map((p, idx) => {
                const isActive = activePoint?.key === p.key;
                return (
                  <g key={p.key}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isActive ? 5.5 : 3.5}
                      className={isActive ? 'fill-indigo-600 stroke-white dark:stroke-slate-950' : 'fill-indigo-500'}
                      strokeWidth={isActive ? 2 : 0}
                    />
                    <rect
                      x={p.x - 18}
                      y={0}
                      width={36}
                      height={height}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      onClick={() => setHoveredIdx(idx)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 overflow-x-auto">
            {points.slice(0, 8).map((p) => (
              <span key={p.key} className="whitespace-nowrap">
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface InvoiceSummary {
  totalPaise: number;
  verifiedPaidPaise: number;
  outstandingPaise: number;
  status: string;
}

interface DisputeSummary {
  status: string;
}

export function AnalyticsPage() {
  const [range, setRange] = useState<DateRangeKey>('30D');
  const [transactions, setTransactions] = useState<AnalyticsTransaction[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [disputes, setDisputes] = useState<DisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [txRes, invRes, dispRes] = await Promise.all([
        apiRequest<{ transactions: AnalyticsTransaction[] }>('/transactions?status=ALL'),
        apiRequest<{ invoices: InvoiceSummary[] }>('/invoices'),
        apiRequest<{ disputes: DisputeSummary[] }>('/disputes'),
      ]);
      setTransactions(txRes.transactions);
      setInvoices(invRes.invoices);
      setDisputes(dispRes.disputes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scoped = useMemo(() => filterByDateRange(transactions, range), [transactions, range]);

  const stats = useMemo(() => {
    const verified = scoped.filter((t) => t.status === 'VERIFIED');
    const verifiedPaise = verified.reduce(
      (sum, t) => sum + (t.verifiedAmountPaise ?? t.expectedAmountPaise),
      0
    );
    const pendingVerif = scoped.filter((t) =>
      ['PAYMENT_REPORTED', 'VERIFICATION_PENDING', 'REVIEW_REQUIRED'].includes(t.status)
    );
    const turnaroundHours = verified
      .map((t) => {
        if (!t.verifiedAt) return null;
        const diff = new Date(t.verifiedAt).getTime() - new Date(t.createdAt).getTime();
        return diff >= 0 ? diff / (1000 * 60 * 60) : null;
      })
      .filter((v): v is number => v !== null);

    const avgTurnaround =
      turnaroundHours.length > 0
        ? `${(turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length).toFixed(1)}h`
        : '—';

    const byCategory = ['ADVANCE', 'MILESTONE', 'FINAL'].map((cat) => {
      const catVerified = verified.filter((t) => t.category === cat);
      const total = catVerified.reduce(
        (s, t) => s + (t.verifiedAmountPaise ?? t.expectedAmountPaise),
        0
      );
      return { category: cat, count: catVerified.length, totalPaise: total };
    });

    const outstandingTotal = invoices.reduce((s, i) => s + i.outstandingPaise, 0);
    const openDisputes = disputes.filter(
      (d) => !['RESOLVED', 'REJECTED', 'CLOSED'].includes(d.status)
    ).length;

    return {
      verifiedCount: verified.length,
      verifiedPaise,
      pendingCount: pendingVerif.length,
      avgTurnaround,
      byCategory,
      outstandingTotal,
      openDisputes,
      totalDisputes: disputes.length,
    };
  }, [scoped, invoices, disputes]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Analytics"
        description="Verified bank credits, instalment breakdown, verification turnaround, and dispute resolution metrics."
        actions={
          <>
            <SegmentedTabs<DateRangeKey>
              value={range}
              onChange={setRange}
              options={[
                { id: 'TODAY', label: 'Today' },
                { id: '7D', label: 'Last 7d' },
                { id: '30D', label: 'Last 30d' },
                { id: 'ALL', label: 'All Time' },
              ]}
            />
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] hover:bg-slate-50 dark:hover:bg-slate-900 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <MetricCard
              label="Verified Bank Credits"
              value={formatInr(stats.verifiedPaise)}
              subtext={`${stats.verifiedCount} verified transactions`}
              icon={ShieldCheck}
              tone="success"
            />
            <MetricCard
              label="Verification Queue Volume"
              value={stats.pendingCount}
              subtext="Awaiting Finance HQ review"
              icon={Clock}
              tone="warning"
            />
            <MetricCard
              label="Avg Verification Turnaround"
              value={stats.avgTurnaround}
              subtext="Created to admin confirmation"
              icon={FileText}
              tone="indigo"
            />
            <MetricCard
              label="Open Disputes / Total"
              value={`${stats.openDisputes} / ${stats.totalDisputes}`}
              subtext={`Outstanding: ${formatInr(stats.outstandingTotal)}`}
              icon={AlertTriangle}
            />
          </div>

          <VerifiedCollectionsChart transactions={scoped} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Advance vs Milestone vs Final Breakdown */}
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Advance vs Milestone vs Final Payments
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Verified collection distribution by project billing stage.
              </p>

              {stats.verifiedPaise === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    title="No verified stage collections yet"
                    description="Confirmed Advance, Milestone, and Final payments will appear here."
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {stats.byCategory.map((row) => {
                    const pct =
                      stats.verifiedPaise > 0
                        ? Math.round((row.totalPaise / stats.verifiedPaise) * 100)
                        : 0;
                    return (
                      <div key={row.category} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {row.category} · {row.count} verified
                          </span>
                          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatInr(row.totalPaise)} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-indigo-600 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Payment Status Summary Table */}
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Payment Lifecycle Distribution
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                All payment attempts within selected period grouped by verification status.
              </p>

              <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {[
                  {
                    label: 'Awaiting Payment',
                    statuses: ['AWAITING_PAYMENT'],
                  },
                  {
                    label: 'Reported / Pending Verification',
                    statuses: ['PAYMENT_REPORTED', 'VERIFICATION_PENDING', 'REVIEW_REQUIRED'],
                  },
                  {
                    label: 'Verified Bank Credits',
                    statuses: ['VERIFIED'],
                  },
                  {
                    label: 'Disputed / Failed / Expired',
                    statuses: ['DISPUTED', 'FAILED_REPORTED', 'EXPIRED', 'REJECTED'],
                  },
                ].map((group) => {
                  const items = scoped.filter((t) => group.statuses.includes(t.status));
                  const sumPaise = items.reduce((s, t) => s + t.expectedAmountPaise, 0);
                  return (
                    <div key={group.label} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {group.label}
                      </span>
                      <div className="font-mono tabular-nums text-right">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {items.length}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 ml-2">
                          ({formatInr(sumPaise)})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
