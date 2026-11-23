import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Clock,
  FileText,
  AlertTriangle,
  QrCode,
  FileSpreadsheet,
  Smartphone,
  Landmark,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatInr, formatUtcDateTime } from '../lib/format.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { NavSection } from '../components/Shell.tsx';
import {
  AlertBanner,
  CopyButton,
  DetailDrawer,
  EmptyState,
  MetricCard,
  PageHeader,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
  Timeline,
  TimelineEvent,
} from '../components/ui/Primitives.tsx';
import {
  AnalyticsTransaction,
  DateRangeKey,
  VerifiedCollectionsChart,
  filterByDateRange,
} from '../components/AnalyticsPanel.tsx';

interface OverviewResponse {
  metrics: {
    totalVerifiedCollectionsPaise: number;
    totalExpectedPaise: number;
    totalReportedUnverifiedPaise: number;
    outstandingBalancePaise: number;
    outstandingInvoicesCount: number;
    paymentsAwaitingVerificationCount: number;
    activeDisputesCount: number;
    reconciliationExceptionsCount: number;
    connectedApplicationsCount: number;
    apiTotalRequests: number;
    apiFailedRequests: number;
  };
  activeReceivingAccount: {
    accountCode: string;
    bankName: string;
    accountNumberMasked: string;
    upiId: string;
    manualCheckAttested: boolean;
  } | null;
  recentTransactions: Array<{
    id: string;
    paymentRef: string;
    customerRef: string;
    customerName: string;
    invoiceRef: string;
    category: string;
    expectedAmountPaise: number;
    verifiedAmountPaise: number | null;
    status: string;
    verifiedUtr: string | null;
    customerReportedUtr: string | null;
    createdAt: string;
  }>;
}

function getTimeGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

export function OverviewPage({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const { hasAnyRole } = useAuth();
  const canVerify = hasAnyRole('SUPER_ADMIN', 'FINANCE_ADMIN');
  const canConfigureBank = hasAnyRole('SUPER_ADMIN', 'FINANCE_ADMIN');
  const isSuperAdmin = hasAnyRole('SUPER_ADMIN');

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [txHistory, setTxHistory] = useState<AnalyticsTransaction[]>([]);
  const [workspaceName, setWorkspaceName] = useState('ForgeX 4XPay');
  const [dateRange, setDateRange] = useState<DateRangeKey>('30D');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<OverviewResponse['recentTransactions'][number] | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, txRes, settingsRes] = await Promise.allSettled([
        apiRequest<OverviewResponse>('/overview'),
        apiRequest<{ transactions: AnalyticsTransaction[] }>('/transactions?status=ALL'),
        isSuperAdmin
          ? apiRequest<{ business_profile?: { legalName?: string } }>('/settings')
          : Promise.resolve(null),
      ]);

      if (ovRes.status === 'fulfilled') {
        setData(ovRes.value);
      } else {
        throw ovRes.reason;
      }

      if (txRes.status === 'fulfilled') {
        setTxHistory(txRes.value.transactions);
      }

      if (
        settingsRes.status === 'fulfilled' &&
        settingsRes.value?.business_profile?.legalName?.trim()
      ) {
        setWorkspaceName(settingsRes.value.business_profile.legalName.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const scopedChartTx = useMemo(
    () => filterByDateRange(txHistory, dateRange),
    [txHistory, dateRange]
  );

  const filteredRecentTx = useMemo(
    () => (data ? filterByDateRange(data.recentTransactions, dateRange) : []),
    [data, dateRange]
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-72 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <AlertBanner
          tone="error"
          title="Failed to Load Financial Overview"
          message={error || 'Unable to load overview data.'}
          action={
            <button
              type="button"
              onClick={load}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const m = data.metrics;
  const attentionTotal =
    m.paymentsAwaitingVerificationCount + m.activeDisputesCount + m.reconciliationExceptionsCount;

  const selectedTimeline: TimelineEvent[] = selectedTx
    ? [
        {
          id: 'created',
          label: 'Payment attempt initiated',
          detail: `Unique Payment ID ${selectedTx.paymentRef} minted for ${selectedTx.invoiceRef}.`,
          timestamp: formatUtcDateTime(selectedTx.createdAt),
          state: 'completed',
        },
        ...(selectedTx.customerReportedUtr
          ? [
              {
                id: 'reported',
                label: 'Customer submitted UPI reference',
                detail: `Claimed UTR: ${selectedTx.customerReportedUtr}`,
                state: 'completed' as const,
              },
            ]
          : []),
        ...(selectedTx.status === 'VERIFIED'
          ? [
              {
                id: 'verified',
                label: 'Bank credit confirmed & receipt issued',
                detail: `Verified ${formatInr(selectedTx.verifiedAmountPaise ?? selectedTx.expectedAmountPaise)} · Bank UTR ${selectedTx.verifiedUtr || 'Recorded'}`,
                state: 'completed' as const,
              },
            ]
          : selectedTx.status === 'DISPUTED' || selectedTx.status === 'FAILED_REPORTED'
            ? [
                {
                  id: 'issue',
                  label: 'Requires investigation',
                  detail: 'Flagged for missing payment / failed transfer review.',
                  state: 'error' as const,
                },
              ]
            : [
                {
                  id: 'pending',
                  label:
                    selectedTx.status === 'AWAITING_PAYMENT'
                      ? 'Awaiting UPI transfer from customer'
                      : 'Awaiting Finance HQ bank verification',
                  detail:
                    'Receipts are issued only after an authorised admin verifies bank settlement.',
                  state: 'current' as const,
                },
              ]),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={workspaceName}
        title={getTimeGreeting()}
        description="Here is your 4XPay financial overview separating billed dues, customer-reported claims, and verified bank credits."
        actions={
          <>
            <SegmentedTabs<DateRangeKey>
              value={dateRange}
              onChange={setDateRange}
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      {/* Receiving Account Status Banner */}
      {!data.activeReceivingAccount ? (
        <AlertBanner
          tone="warning"
          title="Receiving UPI Account Not Configured"
          message="No active receiving bank account is configured. Register and activate your authorised receiving UPI address before accepting customer transfers."
          action={
            canConfigureBank ? (
              <button
                type="button"
                onClick={() => onNavigate('receiving-accounts')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
              >
                <span>Configure Account</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
              <Landmark className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Active Receiving UPI</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
              {data.activeReceivingAccount.upiId}
            </span>
            <span aria-hidden="true">·</span>
            <span>{data.activeReceivingAccount.bankName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{data.activeReceivingAccount.accountNumberMasked}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge
              status={data.activeReceivingAccount.manualCheckAttested ? 'ACTIVE' : 'PENDING'}
            />
          </div>
          {canConfigureBank && (
            <button
              type="button"
              onClick={() => onNavigate('receiving-accounts')}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
            >
              Manage Accounts
            </button>
          )}
        </div>
      )}

      {/* 4-Card Primary Financial Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <MetricCard
          label="Verified Collections"
          value={formatInr(m.totalVerifiedCollectionsPaise)}
          subtext="Independently confirmed bank credits"
          icon={ShieldCheck}
          tone="success"
          onClick={() => onNavigate('transactions')}
          actionLabel="Ledger"
        />
        <MetricCard
          label="Awaiting Verification"
          value={m.paymentsAwaitingVerificationCount}
          subtext={`${formatInr(m.totalReportedUnverifiedPaise)} reported (unverified)`}
          icon={Clock}
          tone="warning"
          onClick={canVerify ? () => onNavigate('pending-verification') : () => onNavigate('transactions')}
          actionLabel="Review"
        />
        <MetricCard
          label="Outstanding Invoices"
          value={formatInr(m.outstandingBalancePaise)}
          subtext={`${m.outstandingInvoicesCount} open · ${formatInr(m.totalExpectedPaise)} billed`}
          icon={FileText}
          onClick={() => onNavigate('invoices')}
          actionLabel="Invoices"
        />
        <MetricCard
          label="Active Disputes & Exceptions"
          value={m.activeDisputesCount + m.reconciliationExceptionsCount}
          subtext={`${m.activeDisputesCount} disputes · ${m.reconciliationExceptionsCount} recon`}
          icon={AlertTriangle}
          tone={m.activeDisputesCount + m.reconciliationExceptionsCount > 0 ? 'danger' : 'default'}
          onClick={() => onNavigate('disputes')}
          actionLabel="Resolve"
        />
      </div>

      {/* Analytics + Attention & Quick Actions Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8">
          <VerifiedCollectionsChart transactions={scopedChartTx} />
        </div>

        <div className="lg:col-span-4 flex flex-col gap-5">
          {/* Payments Requiring Attention */}
          <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Payments Requiring Attention
              </h2>
              <span className="font-mono tabular-nums text-xs font-semibold text-slate-500 dark:text-slate-400">
                {attentionTotal} total
              </span>
            </div>

            <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => onNavigate(canVerify ? 'pending-verification' : 'transactions')}
                className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Unreviewed payment reports
                </span>
                <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                  {m.paymentsAwaitingVerificationCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('disputes')}
                className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Missing-payment disputes
                </span>
                <span className="font-mono tabular-nums font-semibold text-red-700 dark:text-red-400">
                  {m.activeDisputesCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate(canVerify ? 'pending-verification' : 'transactions')}
                className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Ambiguous / unmatched bank rows
                </span>
                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {m.reconciliationExceptionsCount}
                </span>
              </button>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Quick Actions
            </h2>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => onNavigate('payment-requests')}
                className="w-full px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-between transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Create Payment Request</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('qr-codes')}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <QrCode className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Open UPI QR Manager</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
              {canVerify && (
                <button
                  type="button"
                  onClick={() => onNavigate('pending-verification')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Review Verification Queue</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('client-portal')}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span>Open Client Payment Portal</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Recent Transactions Table (Desktop Table + Mobile Cards) */}
      <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Payment Attempts
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select any payment row to inspect full details and lifecycle timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('transactions')}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
          >
            View all transactions
          </button>
        </div>

        {filteredRecentTx.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No payment attempts in this timeframe"
              description="Configure an active receiving UPI account, create a customer & project, then initiate a UPI payment request."
              action={
                <button
                  type="button"
                  onClick={() => onNavigate('payment-requests')}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Create Payment Request
                </button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 font-medium">Payment ID</th>
                    <th className="py-3 px-4 font-medium">Customer · Invoice</th>
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium text-right">Amount</th>
                    <th className="py-3 px-4 font-medium">Bank UTR</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredRecentTx.map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {tx.paymentRef}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {tx.customerName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {tx.customerRef} · {tx.invoiceRef}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                        {tx.category}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-medium text-slate-900 dark:text-slate-100">
                        {formatInr(tx.expectedAmountPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {tx.verifiedUtr || tx.customerReportedUtr || '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatUtcDateTime(tx.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {filteredRecentTx.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => setSelectedTx(tx)}
                  className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 space-y-2 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {tx.paymentRef}
                    </span>
                    <span className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
                      {formatInr(tx.expectedAmountPaise)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {tx.customerName} · <span className="font-mono">{tx.invoiceRef}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <StatusBadge status={tx.status} />
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      {formatUtcDateTime(tx.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Transaction Detail Drawer */}
      <DetailDrawer
        open={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title={selectedTx?.paymentRef || ''}
        subtitle={
          selectedTx ? `${selectedTx.customerName} · ${selectedTx.invoiceRef}` : undefined
        }
        headerBadge={selectedTx ? <StatusBadge status={selectedTx.status} /> : undefined}
        footer={
          selectedTx && (
            <>
              <CopyButton value={selectedTx.paymentRef} label="Copy Payment ID" />
              <button
                type="button"
                onClick={() => {
                  setSelectedTx(null);
                  onNavigate(
                    selectedTx.status === 'VERIFIED'
                      ? 'receipts'
                      : canVerify
                        ? 'pending-verification'
                        : 'transactions'
                  );
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {selectedTx.status === 'VERIFIED'
                  ? 'Open Receipts'
                  : canVerify
                    ? 'Open Verification Queue'
                    : 'Open Transactions'}
              </button>
            </>
          )
        }
      >
        {selectedTx && (
          <>
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Expected Amount</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatInr(selectedTx.expectedAmountPaise)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Verified Credit</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {selectedTx.verifiedAmountPaise
                    ? formatInr(selectedTx.verifiedAmountPaise)
                    : 'Pending'}
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between gap-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Customer</span>
                <span className="font-medium text-slate-900 dark:text-slate-100 text-right">
                  {selectedTx.customerName} ({selectedTx.customerRef})
                </span>
              </div>
              <div className="flex justify-between gap-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Category</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {selectedTx.category}
                </span>
              </div>
              <div className="flex justify-between gap-4 py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Bank / Reported UTR</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">
                  {selectedTx.verifiedUtr || selectedTx.customerReportedUtr || '—'}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Payment Lifecycle Timeline
              </h3>
              <Timeline events={selectedTimeline} />
            </div>
          </>
        )}
      </DetailDrawer>
    </div>
  );
}
