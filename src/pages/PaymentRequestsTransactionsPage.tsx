import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus,
  QrCode,
  Download,
  ExternalLink,
  SlidersHorizontal,
  ArrowUpDown,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { apiRequest, createIdempotencyKey } from '../lib/api.ts';
import { formatInr, formatUtcDateTime, rupeesInputToPaise } from '../lib/format.ts';
import { useAuth } from '../context/AuthContext.tsx';
import {
  AlertBanner,
  CopyButton,
  DetailDrawer,
  EmptyState,
  Modal,
  PageHeader,
  SearchInput,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
  Timeline,
  TimelineEvent,
} from '../components/ui/Primitives.tsx';
import { UpiDeepLinkQrCard, UpiQrGeneratorModal, UpiQrPreset } from '../components/UpiQrGenerator.tsx';
import { DateRangeKey, filterByDateRange } from '../components/AnalyticsPanel.tsx';

export interface CheckoutInfo {
  attemptId: string;
  paymentRef: string;
  expectedAmountPaise: number;
  currency: string;
  receivingUpiId: string;
  payeeName: string;
  upiUri: string;
  qrDataUrl: string;
  expiresAt: string;
  notice: string;
}

/**
 * Premium responsive Customer UPI Checkout Modal.
 * Supports desktop two-column split and mobile single-column touch-friendly flow.
 * Never simulates automatic payment success upon returning from a UPI app.
 */
export function UpiCheckoutModal({
  checkout,
  onClose,
  onReported,
}: {
  checkout: CheckoutInfo | null;
  onClose: () => void;
  onReported: () => void;
}) {
  const [showReportForm, setShowReportForm] = useState(false);
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setShowReportForm(false);
    setUtr('');
    setNote('');
    setResultMsg(null);
    setErrMsg(null);
  }, [checkout?.paymentRef]);

  if (!checkout) return null;

  const downloadQr = () => {
    const a = document.createElement('a');
    a.href = checkout.qrDataUrl;
    a.download = `${checkout.paymentRef}-UPI-QR.png`;
    a.click();
  };

  const submitReport = async (outcome: 'PAID' | 'FAILED') => {
    setSubmitting(true);
    setErrMsg(null);
    setResultMsg(null);
    try {
      const res = await apiRequest<{ message: string }>(
        `/payments/${checkout.paymentRef}/report`,
        {
          method: 'POST',
          body: {
            outcome,
            utrReference: utr.trim(),
            reportedAmountPaise: checkout.expectedAmountPaise,
            note: note.trim(),
          },
        }
      );
      setResultMsg(res.message);
      setShowReportForm(false);
      onReported();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to submit payment report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(checkout)}
      onClose={onClose}
      title="4XPay · Secure UPI Checkout"
      subtitle="UPI is the only active payment method. Finance HQ verifies incoming bank credits before issuing receipts."
      maxWidth="max-w-3xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
        {/* Left: Payment Summary & Status */}
        <div className="md:col-span-6 flex flex-col justify-between space-y-5">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50/70 dark:bg-slate-950/50 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Payable Amount
                </div>
                <div className="mt-1 text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatInr(checkout.expectedAmountPaise)}
                </div>
              </div>
              <StatusBadge status={resultMsg ? 'VERIFICATION_PENDING' : 'AWAITING_PAYMENT'} />
            </div>

            <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Payment ID</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {checkout.paymentRef}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Payee Identity</span>
                <span className="font-medium text-slate-900 dark:text-slate-100 text-right">
                  {checkout.payeeName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Receiving UPI</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
                    {checkout.receivingUpiId}
                  </span>
                  <CopyButton value={checkout.receivingUpiId} label="Copy" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">QR Valid Until</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {formatUtcDateTime(checkout.expiresAt)}
                </span>
              </div>
            </div>
          </div>

          {resultMsg ? (
            <div className="border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/25 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Payment Awaiting Verification</span>
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                {resultMsg}
              </p>
              {utr.trim() && (
                <div className="text-[11px] font-mono text-amber-900 dark:text-amber-200">
                  Submitted UTR: {utr.trim()}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {errMsg && <AlertBanner tone="error" message={errMsg} />}

              {!showReportForm ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowReportForm(true)}
                    className="w-full h-11 px-4 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                  >
                    I Have Paid — Submit Reference
                  </button>
                  <button
                    type="button"
                    onClick={() => submitReport('FAILED')}
                    disabled={submitting}
                    className="w-full h-10 px-4 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
                  >
                    Report UPI Transfer Failed
                  </button>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      UPI Transaction Reference / UTR (12-digit preferred)
                    </label>
                    <input
                      type="text"
                      value={utr}
                      onChange={(e) => setUtr(e.target.value)}
                      placeholder="12-digit UTR number"
                      className="forge-input w-full h-10 px-3 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Optional Note</label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="UPI app or transfer note"
                      className="forge-input w-full h-10 px-3 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowReportForm(false)}
                      className="px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => submitReport('PAID')}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {submitting ? 'Submitting...' : 'Submit for Verification'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Scannable QR Card & UPI App Handoff */}
        <div className="md:col-span-6 flex flex-col items-center justify-between border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50/70 dark:bg-slate-950/60">
          <div className="text-center">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Scan &amp; Pay with Any UPI App
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              4XPay never asks for your UPI PIN
            </div>
          </div>

          <div className="my-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <img
              src={checkout.qrDataUrl}
              alt={`UPI QR code for ${checkout.paymentRef}`}
              className="w-52 h-52 object-contain block"
            />
          </div>

          <div className="w-full space-y-2">
            <a
              href={checkout.upiUri}
              className="w-full h-11 inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-950 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Pay via Installed UPI App</span>
            </a>
            <div className="grid grid-cols-2 gap-2">
              <CopyButton value={checkout.upiUri} label="Copy UPI URI" className="justify-center h-9" />
              <button
                type="button"
                onClick={downloadQr}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download QR</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface PaymentRequestItem {
  id: string;
  requestRef: string;
  invoiceRef: string;
  projectRef: string;
  projectName: string;
  customerRef: string;
  customerName: string;
  category: string;
  title: string;
  amountDuePaise: number;
  amountVerifiedPaise: number;
  remainingDuePaise: number;
  status: string;
  revisionNumber: number;
  createdAt: string;
}

interface ProjectOption {
  id: string;
  projectRef: string;
  name: string;
  customerId: string;
  customerRef: string;
  customerName: string;
}

export function PaymentRequestsPage() {
  const { hasAnyRole, activeReceivingSummary } = useAuth();
  const canCreate = hasAnyRole('SUPER_ADMIN', 'ADMIN_HQ');
  const [requests, setRequests] = useState<PaymentRequestItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [fallbackReceiving, setFallbackReceiving] = useState<{
    upiId: string;
    payeeName: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'PAID' | 'CANCELLED'>('ALL');
  const [selectedReq, setSelectedReq] = useState<PaymentRequestItem | null>(null);

  // Step-based Create Payment Request Wizard
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [createdReq, setCreatedReq] = useState<PaymentRequestItem | { requestRef: string; id: string } | null>(null);
  const [form, setForm] = useState({
    projectId: '',
    category: 'ADVANCE' as 'ADVANCE' | 'MILESTONE' | 'FINAL',
    title: 'Project Advance Payment',
    amountRupees: '5000',
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutInfo | null>(null);
  const [qrUtilityPreset, setQrUtilityPreset] = useState<UpiQrPreset | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, projRes, overviewRes] = await Promise.all([
        apiRequest<{ paymentRequests: PaymentRequestItem[] }>('/payment-requests'),
        apiRequest<{ projects: ProjectOption[] }>('/projects'),
        apiRequest<{
          activeReceivingAccount: { upiId: string; bankName: string } | null;
        }>('/overview').catch(() => null),
      ]);
      setRequests(reqRes.paymentRequests);
      setProjects(projRes.projects);
      if (overviewRes?.activeReceivingAccount?.upiId) {
        setFallbackReceiving({
          upiId: overviewRes.activeReceivingAccount.upiId,
          payeeName: activeReceivingSummary?.displayPayeeName || 'ForgeX 4XPay',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment requests.');
    } finally {
      setLoading(false);
    }
  }, [activeReceivingSummary?.displayPayeeName]);

  useEffect(() => {
    load();
  }, [load]);

  const activeVpa = activeReceivingSummary?.upiId || fallbackReceiving?.upiId || '';
  const activePayeeName =
    activeReceivingSummary?.displayPayeeName || fallbackReceiving?.payeeName || 'ForgeX 4XPay';

  const openUtilityForRequest = (reqItem: PaymentRequestItem) => {
    const duePaise =
      reqItem.remainingDuePaise > 0 ? reqItem.remainingDuePaise : reqItem.amountDuePaise;
    setQrUtilityPreset({
      requestId: reqItem.id,
      requestRef: reqItem.requestRef,
      customerName: reqItem.customerName,
      projectName: reqItem.projectName,
      vpa: activeVpa,
      payeeName: activePayeeName,
      amountRupees: (duePaise / 100).toFixed(2),
      transactionId: reqItem.requestRef,
      transactionNote: `${reqItem.requestRef} ${reqItem.title}`.slice(0, 80),
    });
  };

  const openCustomQrUtility = () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    setQrUtilityPreset({
      vpa: activeVpa,
      payeeName: activePayeeName,
      amountRupees: '1000.00',
      transactionId: `FXUPI-${stamp}-001`,
      transactionNote: 'ForgeX 4XPay UPI Collection',
    });
  };

  const openWizard = () => {
    setForm({
      projectId: projects[0]?.id || '',
      category: 'ADVANCE',
      title: 'Project Advance Payment',
      amountRupees: '5000',
    });
    setWizardStep(1);
    setCreatedReq(null);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const amountDuePaise = rupeesInputToPaise(form.amountRupees);
      const res = await apiRequest<{ paymentRequest: { id: string; requestRef: string } }>(
        '/payment-requests',
        {
          method: 'POST',
          body: {
            projectId: form.projectId,
            category: form.category,
            title: form.title,
            amountDuePaise,
          },
        }
      );
      setCreatedReq(res.paymentRequest);
      setWizardStep(4);
      setNotice(`Payment Request ${res.paymentRequest.requestRef} created.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payment request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInitiateUpi = async (reqItem: { id: string }) => {
    setError(null);
    try {
      const res = await apiRequest<{
        attempt: { id: string };
        checkout: Omit<CheckoutInfo, 'attemptId'>;
      }>(`/payment-requests/${reqItem.id}/attempts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('req') },
        body: {},
      });
      setCheckout({ ...res.checkout, attemptId: res.attempt.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate UPI payment attempt.');
    }
  };

  const handleCancel = async (reqItem: PaymentRequestItem) => {
    setError(null);
    try {
      await apiRequest(`/payment-requests/${reqItem.id}`, {
        method: 'PATCH',
        body: { action: 'CANCEL', reason: 'Cancelled by operator prior to verification' },
      });
      setNotice(`Payment Request ${reqItem.requestRef} cancelled with audit record.`);
      setSelectedReq(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel request.');
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter === 'OPEN' && (r.status === 'PAID' || r.status === 'CANCELLED')) return false;
      if (statusFilter === 'PAID' && r.status !== 'PAID') return false;
      if (statusFilter === 'CANCELLED' && r.status !== 'CANCELLED') return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        r.requestRef.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.invoiceRef.toLowerCase().includes(q)
      );
    });
  }, [requests, statusFilter, query]);

  const selectedProject = projects.find((p) => p.id === form.projectId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Requests"
        description="Authorised billing requests (FXREQ-*). Every payment initiation mints a separate Payment ID (FXPAY-*) and UPI QR."
        actions={
          <>
            <button
              type="button"
              onClick={openCustomQrUtility}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1424] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>UPI QR Utility</span>
            </button>
            {canCreate && (
              <button
                type="button"
                disabled={projects.length === 0}
                onClick={openWizard}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Payment Request</span>
              </button>
            )}
          </>
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<'ALL' | 'OPEN' | 'PAID' | 'CANCELLED'>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: requests.length },
            {
              id: 'OPEN',
              label: 'Active / Open',
              count: requests.filter((r) => r.status !== 'PAID' && r.status !== 'CANCELLED').length,
            },
            { id: 'PAID', label: 'Paid', count: requests.filter((r) => r.status === 'PAID').length },
            {
              id: 'CANCELLED',
              label: 'Cancelled',
              count: requests.filter((r) => r.status === 'CANCELLED').length,
            },
          ]}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search Request ID, customer, invoice..."
        />
      </div>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title="No payment requests match"
          description={
            requests.length === 0
              ? 'Create a customer and project first, then issue a payment request to begin collecting via UPI.'
              : 'Try adjusting your status filter or search query.'
          }
          action={
            canCreate && projects.length > 0 && requests.length === 0 ? (
              <button
                type="button"
                onClick={openWizard}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Create First Payment Request
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-4 font-medium">Request ID</th>
                  <th className="py-3 px-4 font-medium">Customer · Project</th>
                  <th className="py-3 px-4 font-medium">Instalment</th>
                  <th className="py-3 px-4 font-medium text-right">Due</th>
                  <th className="py-3 px-4 font-medium text-right">Verified</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRequests.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedReq(r)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {r.requestRef}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {r.customerName} · {r.projectName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {r.invoiceRef} · Rev {r.revisionNumber}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-900 dark:text-slate-100">{r.title}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.category}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                      {formatInr(r.amountDuePaise)}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                      {formatInr(r.amountVerifiedPaise)}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td
                      className="py-3.5 px-4 text-right whitespace-nowrap space-x-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.status !== 'PAID' && r.status !== 'CANCELLED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openUtilityForRequest(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            <span>Quick QR</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateUpi(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                          >
                            <QrCode className="w-3 h-3" />
                            <span>Generate UPI QR</span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
            {filteredRequests.map((r) => (
              <div key={r.id} className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedReq(r)}
                    className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                  >
                    {r.requestRef}
                  </button>
                  <span className="font-mono tabular-nums text-sm font-bold">
                    {formatInr(r.amountDuePaise)}
                  </span>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  {r.customerName} · {r.projectName}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={r.status} />
                  {r.status !== 'PAID' && r.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() => handleInitiateUpi(r)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Pay QR</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step-Based Create Payment Request Wizard */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Payment Request"
        subtitle="Guided workflow to issue an authorised FXREQ-* payment obligation."
      >
        <div className="space-y-5">
          {/* Progress Steps */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
            {[
              { step: 1, label: 'Project' },
              { step: 2, label: 'Details' },
              { step: 3, label: 'Review' },
              { step: 4, label: 'Issued' },
            ].map((s) => (
              <div
                key={s.step}
                className={`px-2.5 py-1.5 rounded-lg border text-center ${
                  wizardStep === s.step
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : wizardStep > s.step
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-400'
                }`}
              >
                {s.step}. {s.label}
              </div>
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Select Customer Project
                </label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  className="forge-input w-full h-11 px-3 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.projectRef} — {p.name} ({p.customerName})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!form.projectId}
                  onClick={() => setWizardStep(2)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <span>Next: Details</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Payment Category</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        category: e.target.value as 'ADVANCE' | 'MILESTONE' | 'FINAL',
                      })
                    }
                    className="forge-input w-full h-11 px-3 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="ADVANCE">Advance</option>
                    <option value="MILESTONE">Milestone</option>
                    <option value="FINAL">Final Payment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Amount Due (INR)</label>
                  <input
                    type="text"
                    value={form.amountRupees}
                    onChange={(e) => setForm({ ...form, amountRupees: e.target.value })}
                    className="forge-input w-full h-11 px-3 text-sm font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5">Title / Description</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="forge-input w-full h-11 px-3 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={!form.title.trim() || rupeesInputToPaise(form.amountRupees) <= 0}
                  onClick={() => setWizardStep(3)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40"
                >
                  <span>Review Request</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs bg-slate-50/70 dark:bg-slate-950/40">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer &amp; Project</span>
                  <span className="font-semibold text-right">
                    {selectedProject?.customerName} · {selectedProject?.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Instalment Type</span>
                  <span className="font-medium">
                    {form.category} — {form.title}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Requested Amount</span>
                  <span className="font-mono font-bold text-sm">
                    {formatInr(rupeesInputToPaise(form.amountRupees))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Receiving UPI Route</span>
                  <span className="font-mono">{activeVpa || 'Configure in Receiving Accounts'}</span>
                </div>
              </div>

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCreate}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {submitting ? 'Creating...' : 'Confirm & Create Request'}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 4 && createdReq && (
            <div className="text-center space-y-4 py-2">
              <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Payment Request Issued
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Request ID <span className="font-mono font-semibold">{createdReq.requestRef}</span>{' '}
                  has been created. Generate a UPI QR attempt when the customer is ready to pay.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                <CopyButton value={createdReq.requestRef} label="Copy Request ID" />
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    void handleInitiateUpi(createdReq);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Generate Official UPI QR</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Request Detail Drawer */}
      <DetailDrawer
        open={Boolean(selectedReq)}
        onClose={() => setSelectedReq(null)}
        title={selectedReq?.requestRef || ''}
        subtitle={selectedReq ? `${selectedReq.customerName} · ${selectedReq.projectName}` : undefined}
        headerBadge={selectedReq ? <StatusBadge status={selectedReq.status} /> : undefined}
        footer={
          selectedReq &&
          selectedReq.status !== 'PAID' &&
          selectedReq.status !== 'CANCELLED' && (
            <>
              {canCreate && selectedReq.amountVerifiedPaise === 0 && (
                <button
                  type="button"
                  onClick={() => handleCancel(selectedReq)}
                  className="px-3.5 py-2 text-xs font-medium rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  Cancel Request
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const target = selectedReq;
                  setSelectedReq(null);
                  void handleInitiateUpi(target);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Generate UPI QR</span>
              </button>
            </>
          )
        }
      >
        {selectedReq && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
              <div>
                <div className="text-[11px] text-slate-500">Amount Due</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums">
                  {formatInr(selectedReq.amountDuePaise)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Verified Paid</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatInr(selectedReq.amountVerifiedPaise)}
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Invoice Ref</span>
                <span className="font-mono font-medium">{selectedReq.invoiceRef}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Instalment Title</span>
                <span className="font-medium">{selectedReq.title}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Category</span>
                <span className="font-medium">{selectedReq.category}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Created</span>
                <span className="font-mono tabular-nums">
                  {formatUtcDateTime(selectedReq.createdAt)}
                </span>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      <UpiCheckoutModal
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onReported={load}
      />

      <UpiQrGeneratorModal
        open={Boolean(qrUtilityPreset)}
        onClose={() => setQrUtilityPreset(null)}
        preset={qrUtilityPreset}
        onMintOfficialAttempt={(requestId) => {
          const matched = requests.find((item) => item.id === requestId);
          setQrUtilityPreset(null);
          if (matched) {
            void handleInitiateUpi(matched);
          }
        }}
      />
    </div>
  );
}

interface TransactionRow {
  id: string;
  paymentRef: string;
  requestRef: string;
  invoiceRef: string;
  projectRef: string;
  projectName: string;
  customerRef: string;
  customerName: string;
  category: string;
  receivingUpiSnapshot: string;
  expectedAmountPaise: number;
  reportedAmountPaise: number | null;
  verifiedAmountPaise: number | null;
  status: string;
  customerReportedUtr: string | null;
  verifiedUtr: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateRange, setDateRange] = useState<DateRangeKey>('ALL');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'expectedAmountPaise'>('createdAt');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ transactions: TransactionRow[] }>(
        `/transactions?status=${encodeURIComponent(statusFilter)}`
      );
      setRows(res.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const dated = filterByDateRange(rows, dateRange);
    const searched = dated.filter((r) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        r.paymentRef.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.invoiceRef.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        (r.verifiedUtr || '').toLowerCase().includes(q) ||
        (r.customerReportedUtr || '').toLowerCase().includes(q)
      );
    });
    return [...searched].sort((a, b) => {
      const valA =
        sortBy === 'expectedAmountPaise'
          ? a.expectedAmountPaise
          : new Date(a.createdAt).getTime();
      const valB =
        sortBy === 'expectedAmountPaise'
          ? b.expectedAmountPaise
          : new Date(b.createdAt).getTime();
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
  }, [rows, dateRange, query, sortBy, sortDir]);

  const toggleSort = (col: 'createdAt' | 'expectedAmountPaise') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const exportCsv = () => {
    const headers = [
      'Payment ID',
      'Request Ref',
      'Customer',
      'Project',
      'Invoice',
      'Category',
      'Receiving UPI',
      'Expected INR',
      'Verified INR',
      'Bank UTR',
      'Status',
      'Created UTC',
    ];
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csvLines = [
      headers.map(escape).join(','),
      ...filtered.map((tx) =>
        [
          tx.paymentRef,
          tx.requestRef,
          tx.customerName,
          tx.projectName,
          tx.invoiceRef,
          tx.category,
          tx.receivingUpiSnapshot,
          (tx.expectedAmountPaise / 100).toFixed(2),
          tx.verifiedAmountPaise ? (tx.verifiedAmountPaise / 100).toFixed(2) : '',
          tx.verifiedUtr || tx.customerReportedUtr || '',
          tx.status,
          tx.createdAt,
        ]
          .map(escape)
          .join(',')
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4xpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const timelineEvents: TimelineEvent[] = selectedTx
    ? [
        {
          id: 'req',
          label: 'Payment request linked',
          detail: `${selectedTx.requestRef} · ${selectedTx.category} (${selectedTx.invoiceRef})`,
          state: 'completed',
        },
        {
          id: 'init',
          label: 'Payment attempt & UPI QR created',
          detail: `Minted ${selectedTx.paymentRef} routed to ${selectedTx.receivingUpiSnapshot}`,
          timestamp: formatUtcDateTime(selectedTx.createdAt),
          state: 'completed',
        },
        ...(selectedTx.customerReportedUtr
          ? [
              {
                id: 'rep',
                label: 'Customer reported transfer',
                detail: `Claimed UTR: ${selectedTx.customerReportedUtr}`,
                state: 'completed' as const,
              },
            ]
          : []),
        ...(selectedTx.status === 'VERIFIED'
          ? [
              {
                id: 'ver',
                label: 'Bank credit verified & receipt issued',
                detail: `Confirmed ${formatInr(selectedTx.verifiedAmountPaise ?? selectedTx.expectedAmountPaise)} · UTR ${selectedTx.verifiedUtr || 'Recorded'}`,
                timestamp: selectedTx.verifiedAt
                  ? formatUtcDateTime(selectedTx.verifiedAt)
                  : undefined,
                state: 'completed' as const,
              },
            ]
          : ['DISPUTED', 'FAILED_REPORTED', 'REJECTED'].includes(selectedTx.status)
            ? [
                {
                  id: 'err',
                  label: 'Requires dispute / exception follow-up',
                  detail: `Current status: ${selectedTx.status}`,
                  state: 'error' as const,
                },
              ]
            : [
                {
                  id: 'wait',
                  label:
                    selectedTx.status === 'AWAITING_PAYMENT'
                      ? 'Waiting for customer UPI transfer'
                      : 'Awaiting Finance HQ verification',
                  detail: 'Only confirmed bank credits move ledger balances.',
                  state: 'current' as const,
                },
              ]),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Track payment attempts and independently verified bank collections with full UTR traceability."
        actions={
          <>
            <SegmentedTabs<DateRangeKey>
              value={dateRange}
              onChange={setDateRange}
              options={[
                { id: 'TODAY', label: 'Today' },
                { id: '7D', label: '7d' },
                { id: '30D', label: '30d' },
                { id: 'ALL', label: 'All' },
              ]}
            />
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </>
        }
      />

      {/* Status Tabs & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All' },
            { id: 'AWAITING_PAYMENT', label: 'Awaiting Payment' },
            { id: 'VERIFICATION_PENDING', label: 'Awaiting Verification' },
            { id: 'REVIEW_REQUIRED', label: 'Under Review' },
            { id: 'VERIFIED', label: 'Verified' },
            { id: 'DISPUTED', label: 'Disputed' },
            { id: 'FAILED_REPORTED', label: 'Closed / Failed' },
          ]}
        />

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search Payment ID, UTR, customer..."
        />
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matching transactions"
          description="No payment attempts match the selected status filter, timeframe, and search query."
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-4 font-medium">Payment ID · Request</th>
                  <th className="py-3 px-4 font-medium">Customer · Invoice</th>
                  <th className="py-3 px-4 font-medium">Receiving UPI</th>
                  <th className="py-3 px-4 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('expectedAmountPaise')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      <span>Expected</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-medium text-right">Verified</th>
                  <th className="py-3 px-4 font-medium">Bank UTR</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('createdAt')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      <span>Created</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {tx.paymentRef}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {tx.requestRef} · {tx.category}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {tx.customerName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {tx.projectName} · {tx.invoiceRef}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {tx.receivingUpiSnapshot}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                      {formatInr(tx.expectedAmountPaise)}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                      {tx.verifiedAmountPaise ? formatInr(tx.verifiedAmountPaise) : '—'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {tx.verifiedUtr ? (
                        <span className="text-emerald-700 dark:text-emerald-400">{tx.verifiedUtr}</span>
                      ) : tx.customerReportedUtr ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {tx.customerReportedUtr} (claimed)
                        </span>
                      ) : (
                        '—'
                      )}
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
            {filtered.map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => setSelectedTx(tx)}
                className="w-full text-left p-4 space-y-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {tx.paymentRef}
                  </span>
                  <span className="font-mono tabular-nums text-sm font-bold">
                    {formatInr(tx.expectedAmountPaise)}
                  </span>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {tx.customerName} · <span className="font-mono">{tx.invoiceRef}</span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <StatusBadge status={tx.status} />
                  <span className="text-[11px] font-mono text-slate-500">
                    {tx.verifiedUtr || tx.customerReportedUtr || formatUtcDateTime(tx.createdAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transaction Detail Drawer */}
      <DetailDrawer
        open={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        title={selectedTx?.paymentRef || ''}
        subtitle={
          selectedTx
            ? `${selectedTx.customerName} · ${selectedTx.projectName} (${selectedTx.invoiceRef})`
            : undefined
        }
        headerBadge={selectedTx ? <StatusBadge status={selectedTx.status} /> : undefined}
        footer={
          selectedTx && (
            <>
              <CopyButton value={selectedTx.paymentRef} label="Copy Payment ID" />
              {selectedTx.verifiedUtr && (
                <CopyButton value={selectedTx.verifiedUtr} label="Copy Bank UTR" />
              )}
            </>
          )
        }
      >
        {selectedTx && (
          <>
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
              <div>
                <div className="text-[11px] text-slate-500">Expected Amount</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums">
                  {formatInr(selectedTx.expectedAmountPaise)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Verified Credit</div>
                <div className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {selectedTx.verifiedAmountPaise
                    ? formatInr(selectedTx.verifiedAmountPaise)
                    : 'Not verified yet'}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Receiving UPI</span>
                <span className="font-mono">{selectedTx.receivingUpiSnapshot}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Customer Reported UTR</span>
                <span className="font-mono">{selectedTx.customerReportedUtr || '—'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Verified Bank UTR</span>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {selectedTx.verifiedUtr || '—'}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Chronological Payment Timeline
              </h3>
              <Timeline events={timelineEvents} />
            </div>
          </>
        )}
      </DetailDrawer>
    </div>
  );
}

/**
 * Dedicated UPI QR Code Manager Page:
 * Combines live generated QR attempt records from the backend with an interactive UPI QR preview studio.
 */
export function UpiQrManagerPage() {
  const { activeReceivingSummary } = useAuth();
  const [attempts, setAttempts] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<TransactionRow | null>(null);
  const [fallbackVpa, setFallbackVpa] = useState('');
  const [fallbackPayee, setFallbackPayee] = useState('ForgeX 4XPay');

  // Interactive custom preview inputs when inspecting or composing a QR
  const [customVpa, setCustomVpa] = useState('');
  const [customPayee, setCustomPayee] = useState('ForgeX 4XPay');
  const [customAmount, setCustomAmount] = useState('5000.00');
  const [customRef, setCustomRef] = useState('FXPAY-PREVIEW-001');
  const [customNote, setCustomNote] = useState('ForgeX 4XPay UPI Payment');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [txRes, ovRes] = await Promise.all([
        apiRequest<{ transactions: TransactionRow[] }>('/transactions?status=ALL'),
        apiRequest<{ activeReceivingAccount: { upiId: string } | null }>('/overview').catch(
          () => null
        ),
      ]);
      setAttempts(txRes.transactions);
      const vpa = activeReceivingSummary?.upiId || ovRes?.activeReceivingAccount?.upiId || '';
      const payee = activeReceivingSummary?.displayPayeeName || 'ForgeX 4XPay';
      setFallbackVpa(vpa);
      setFallbackPayee(payee);
      setCustomVpa((prev) => prev || vpa);
      setCustomPayee(payee);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load UPI QR records.');
    } finally {
      setLoading(false);
    }
  }, [activeReceivingSummary]);

  useEffect(() => {
    load();
  }, [load]);

  const previewTarget = selectedAttempt
    ? {
        vpa: selectedAttempt.receivingUpiSnapshot || fallbackVpa,
        payeeName: fallbackPayee,
        amountPaise: selectedAttempt.expectedAmountPaise,
        transactionId: selectedAttempt.paymentRef,
        transactionNote: `${selectedAttempt.paymentRef} ${selectedAttempt.projectName}`.slice(0, 80),
        contextLabel: `${selectedAttempt.customerName} · ${selectedAttempt.status}`,
      }
    : {
        vpa: customVpa,
        payeeName: customPayee,
        amountRupees: customAmount,
        transactionId: customRef,
        transactionNote: customNote,
        contextLabel: 'UPI QR Preview Studio',
      };

  return (
    <div className="space-y-6">
      <PageHeader
        title="UPI QR Code Manager"
        description="Inspect payment attempt QR codes with clean scan margins. Generated QR status never replaces bank verification."
      />

      <AlertBanner
        tone="info"
        message="A generated UPI QR code represents an initiated payment attempt. Funds are marked Verified only after Finance HQ confirms bank settlement."
      />

      {error && <AlertBanner tone="error" message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Generated QR Library */}
        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Payment QR Records
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select any payment attempt to inspect or download its scannable QR.
              </p>
            </div>
            {selectedAttempt && (
              <button
                type="button"
                onClick={() => setSelectedAttempt(null)}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Switch to Custom Studio
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-4">
              <SkeletonRows rows={4} />
            </div>
          ) : attempts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={QrCode}
                title="No payment attempt QR records yet"
                description="Use Payment Requests to generate a unique Payment ID and UPI QR, or test formatting in the right-hand QR Studio."
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
              {attempts.map((a) => {
                const active = selectedAttempt?.id === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAttempt(a)}
                    className={`w-full text-left px-5 py-4 flex items-center justify-between gap-4 transition-colors ${
                      active
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {a.paymentRef}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {a.invoiceRef}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
                        {a.customerName} · {formatUtcDateTime(a.createdAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-xs font-bold text-slate-900 dark:text-slate-100">
                        {formatInr(a.expectedAmountPaise)}
                      </div>
                      <div className="mt-1">
                        <StatusBadge status={a.status} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Scannable QR Preview Panel */}
        <div className="lg:col-span-5 space-y-4">
          {!selectedAttempt && (
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Custom QR Studio Parameters</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Receiving VPA
                  </label>
                  <input
                    type="text"
                    value={customVpa}
                    onChange={(e) => setCustomVpa(e.target.value)}
                    placeholder="merchant@bank"
                    className="forge-input w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Amount (INR)
                  </label>
                  <input
                    type="text"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="forge-input w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Payee Name
                  </label>
                  <input
                    type="text"
                    value={customPayee}
                    onChange={(e) => setCustomPayee(e.target.value)}
                    className="forge-input w-full h-9 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Reference ID
                  </label>
                  <input
                    type="text"
                    value={customRef}
                    onChange={(e) => setCustomRef(e.target.value)}
                    className="forge-input w-full h-9 px-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Note</label>
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  className="forge-input w-full h-9 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          <UpiDeepLinkQrCard {...previewTarget} />
        </div>
      </div>
    </div>
  );
}
