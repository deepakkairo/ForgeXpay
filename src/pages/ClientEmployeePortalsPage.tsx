import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { QrCode, Download, AlertTriangle, Lock, Briefcase, Smartphone } from 'lucide-react';
import { apiRequest, createIdempotencyKey } from '../lib/api.ts';
import { formatInr, formatShortDate, formatUtcDateTime, rupeesInputToPaise } from '../lib/format.ts';
import { useAuth } from '../context/AuthContext.tsx';
import {
  AlertBanner,
  EmptyState,
  Modal,
  PageHeader,
  SearchInput,
  SkeletonRows,
  StatusBadge,
} from '../components/ui/Primitives.tsx';
import { CheckoutInfo, UpiCheckoutModal } from './PaymentRequestsTransactionsPage.tsx';

interface ClientPortalData {
  customer: {
    id: string;
    customerRef: string;
    name: string;
    email: string;
    companyName: string;
  } | null;
  projects: Array<{
    id: string;
    projectRef: string;
    name: string;
    totalContractPaise: number;
    verifiedPaidPaise: number;
    outstandingPaise: number;
    progressPercent: number;
    status: string;
  }>;
  paymentRequests: Array<{
    id: string;
    requestRef: string;
    projectId: string;
    category: string;
    title: string;
    amountDuePaise: number;
    amountVerifiedPaise: number;
    remainingDuePaise: number;
    status: string;
  }>;
  attempts: Array<{
    id: string;
    paymentRef: string;
    paymentRequestId: string;
    expectedAmountPaise: number;
    verifiedAmountPaise: number | null;
    status: string;
    receivingUpiId: string;
    customerReportedUtr: string | null;
    verifiedUtr: string | null;
    createdAt: string;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    paymentAttemptId: string;
    category: string;
    paidAmountPaise: number;
    verifiedUtr: string;
    issuedAt: string;
    pdfDownloadUrl: string;
  }>;
  disputes: Array<{
    id: string;
    ticketRef: string;
    claimedUtr: string;
    claimedAmountPaise: number;
    status: string;
    resolutionNote: string;
    createdAt: string;
  }>;
}

export function ClientPortalPage() {
  const { hasAnyRole } = useAuth();
  const isStaff = hasAnyRole('SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ');
  const [customers, setCustomers] = useState<Array<{ id: string; customerRef: string; name: string }>>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [checkout, setCheckout] = useState<CheckoutInfo | null>(null);
  const [disputeAttempt, setDisputeAttempt] = useState<ClientPortalData['attempts'][number] | null>(
    null
  );
  const [disputeForm, setDisputeForm] = useState({
    claimedUtr: '',
    claimedRupees: '',
    approximateTime: '',
    explanation: '',
    supportingEvidenceNote: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (custId?: string) => {
    setLoading(true);
    setError(null);
    try {
      if (isStaff && customers.length === 0) {
        const cRes = await apiRequest<{
          customers: Array<{ id: string; customerRef: string; name: string }>;
        }>('/customers');
        setCustomers(cRes.customers);
      }
      const query = custId ? `?customerId=${encodeURIComponent(custId)}` : '';
      const res = await apiRequest<ClientPortalData>(`/client/portal${query}`);
      setData(res);
      if (res.customer && !custId) {
        setSelectedCustomerId(res.customer.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client portal.');
    } finally {
      setLoading(false);
    }
  }, [isStaff, customers.length]);

  useEffect(() => {
    load();
  }, [load]);

  const initiatePayment = async (reqId: string) => {
    setError(null);
    try {
      const res = await apiRequest<{
        attempt: { id: string };
        checkout: Omit<CheckoutInfo, 'attemptId'>;
      }>(`/payment-requests/${reqId}/attempts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey('client') },
        body: {},
      });
      setCheckout({ ...res.checkout, attemptId: res.attempt.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate UPI payment.');
    }
  };

  const openExistingQr = async (paymentRef: string, attemptId: string) => {
    setError(null);
    try {
      const res = await apiRequest<Omit<CheckoutInfo, 'attemptId' | 'notice' | 'currency'>>(
        `/payments/${paymentRef}/upi-qr`
      );
      setCheckout({
        ...res,
        attemptId,
        currency: 'INR',
        notice: 'Payment initiated. We are awaiting verification of the incoming transfer.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load UPI QR.');
    }
  };

  const submitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeAttempt) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ dispute: { ticketRef: string } }>('/disputes', {
        method: 'POST',
        body: {
          paymentAttemptId: disputeAttempt.id,
          claimedUtr: disputeForm.claimedUtr.trim(),
          claimedAmountPaise: rupeesInputToPaise(disputeForm.claimedRupees),
          approximateTime: disputeForm.approximateTime.trim(),
          explanation: disputeForm.explanation.trim(),
          supportingEvidenceNote: disputeForm.supportingEvidenceNote.trim(),
        },
      });
      setNotice(
        `Missing payment ticket ${res.dispute.ticketRef} created and routed to Finance HQ for bank-record review.`
      );
      setDisputeAttempt(null);
      await load(selectedCustomerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit dispute.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="ForgeX Client Payment Portal"
        description="View project payment schedules, pay instalments via UPI, track verification progress, and download verified receipts."
        actions={
          isStaff && customers.length > 0 ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 dark:text-slate-400">Preview Customer:</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => {
                  setSelectedCustomerId(e.target.value);
                  load(e.target.value);
                }}
                className="forge-input px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1424]"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerRef} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : !data?.customer ? (
        <EmptyState
          icon={Smartphone}
          title="No client billing profile linked yet"
          description="Register a customer in Customers & Projects with your email address (or select a customer above) to view their project payment schedule and initiate UPI payments."
        />
      ) : (
        <>
          {/* Project Overview & Schedule */}
          {data.projects.map((proj) => {
            const projReqs = data.paymentRequests.filter((r) => r.projectId === proj.id);
            return (
              <div
                key={proj.id}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden"
              >
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {proj.projectRef} · {data.customer?.name} ({data.customer?.customerRef})
                      </div>
                      <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                        {proj.name}
                      </h2>
                    </div>
                    <div className="grid grid-cols-3 gap-6 text-right">
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Agreed Value</div>
                        <div className="font-mono tabular-nums text-sm font-semibold">
                          {formatInr(proj.totalContractPaise)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Verified Paid</div>
                        <div className="font-mono tabular-nums text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                          {formatInr(proj.verifiedPaidPaise)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Outstanding</div>
                        <div className="font-mono tabular-nums text-sm font-semibold">
                          {formatInr(proj.outstandingPaise)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, proj.progressPercent))}%` }}
                    />
                  </div>
                </div>

                {/* Instalment Schedule */}
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {projReqs.map((req) => (
                    <div
                      key={req.id}
                      className="px-6 py-4 flex flex-wrap items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {req.title}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500 dark:text-slate-400">
                            {req.category}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500 dark:text-slate-400">
                            {req.requestRef}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          Due: {formatInr(req.amountDuePaise)} · Verified:{' '}
                          {formatInr(req.amountVerifiedPaise)} · Remaining:{' '}
                          {formatInr(req.remainingDuePaise)}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <StatusBadge status={req.status} />
                        {req.status !== 'PAID' && req.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            onClick={() => initiatePayment(req.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Pay {req.category.charAt(0) + req.category.slice(1).toLowerCase()}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Transaction History & Missing Payment Support */}
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold">Payment Attempts & Receipts</h2>
            </div>
            {data.attempts.length === 0 ? (
              <p className="px-5 py-6 text-xs text-slate-500 dark:text-slate-400">
                No payment attempts initiated yet. Click Pay on an open milestone above to generate a unique Payment ID and UPI QR code.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                      <th className="py-3 px-4 font-semibold">Payment ID</th>
                      <th className="py-3 px-4 font-semibold text-right">Amount</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">UTR Reference</th>
                      <th className="py-3 px-4 font-semibold text-right">Date</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {data.attempts.map((a) => {
                      const receipt = data.receipts.find((r) => r.paymentAttemptId === a.id);
                      return (
                        <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3.5 px-4 font-mono font-semibold">{a.paymentRef}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                            {formatInr(a.verifiedAmountPaise || a.expectedAmountPaise)}
                          </td>
                          <td className="py-3.5 px-4">
                            <StatusBadge status={a.status} />
                            {a.status === 'VERIFICATION_PENDING' && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Awaiting verification of incoming transfer
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                            {a.verifiedUtr || a.customerReportedUtr || '—'}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-right text-slate-500">
                            {formatShortDate(a.createdAt)}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                            {receipt ? (
                              <a
                                href={receipt.pdfDownloadUrl}
                                download
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
                              >
                                <Download className="w-3 h-3" />
                                <span>Receipt PDF</span>
                              </a>
                            ) : (
                              <>
                                {a.status === 'AWAITING_PAYMENT' && (
                                  <button
                                    type="button"
                                    onClick={() => openExistingQr(a.paymentRef, a.id)}
                                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                                  >
                                    View QR / Report
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDisputeAttempt(a);
                                    setDisputeForm({
                                      claimedUtr: a.customerReportedUtr || '',
                                      claimedRupees: (a.expectedAmountPaise / 100).toFixed(2),
                                      approximateTime: new Date().toLocaleTimeString('en-IN'),
                                      explanation: '',
                                      supportingEvidenceNote: '',
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-amber-700 dark:text-amber-400"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>Missing Payment</span>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Customer Dispute Tickets */}
          {data.disputes.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-sm font-semibold">Your Support & Missing Payment Tickets</h2>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.disputes.map((d) => (
                  <div key={d.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-mono font-semibold">{d.ticketRef}</span> · UTR{' '}
                      <span className="font-mono">{d.claimedUtr}</span> ·{' '}
                      <span className="font-mono">{formatInr(d.claimedAmountPaise)}</span>
                      {d.resolutionNote && (
                        <div className="mt-1 text-slate-600 dark:text-slate-400">
                          Finance Update: {d.resolutionNote}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={d.status} />
                      <span className="font-mono text-slate-400">{formatUtcDateTime(d.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <UpiCheckoutModal
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onReported={() => load(selectedCustomerId)}
      />

      {/* Missing Payment Dispute Modal */}
      <Modal
        open={Boolean(disputeAttempt)}
        onClose={() => setDisputeAttempt(null)}
        title={`Report Missing Payment — ${disputeAttempt?.paymentRef}`}
        subtitle="Provide your UPI reference so Finance HQ can verify the transfer against bank records."
      >
        <form onSubmit={submitDispute} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">UPI Reference / UTR</label>
              <input
                type="text"
                required
                value={disputeForm.claimedUtr}
                onChange={(e) => setDisputeForm({ ...disputeForm, claimedUtr: e.target.value })}
                className="forge-input w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Amount Claimed Paid (INR)</label>
              <input
                type="text"
                required
                value={disputeForm.claimedRupees}
                onChange={(e) => setDisputeForm({ ...disputeForm, claimedRupees: e.target.value })}
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Approximate Transfer Time</label>
            <input
              type="text"
              required
              value={disputeForm.approximateTime}
              onChange={(e) => setDisputeForm({ ...disputeForm, approximateTime: e.target.value })}
              placeholder="e.g. Today at 14:25 IST"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Explanation</label>
            <textarea
              rows={2}
              value={disputeForm.explanation}
              onChange={(e) => setDisputeForm({ ...disputeForm, explanation: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Supporting Info / Screenshot Reference (Non-conclusive context)
            </label>
            <input
              type="text"
              value={disputeForm.supportingEvidenceNote}
              onChange={(e) =>
                setDisputeForm({ ...disputeForm, supportingEvidenceNote: e.target.value })
              }
              placeholder="UPI app name or reference note"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDisputeAttempt(null)}
              className="px-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {submitting ? 'Submitting...' : 'Submit Missing Payment Ticket'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface EmployeeProjectRow {
  projectRef: string;
  name: string;
  status: string;
  progressPercent: number;
  advanceVerified: boolean;
  milestones: Array<{
    requestRef: string;
    category: string;
    title: string;
    status: string;
    dueDate: string | null;
  }>;
}

export function EmployeeHqPage() {
  const [projects, setProjects] = useState<EmployeeProjectRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ projects: EmployeeProjectRow[] }>('/employee/projects')
      .then((res) => setProjects(res.projects))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        p.projectRef.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.milestones.some((m) => m.title.toLowerCase().includes(q))
    );
  }, [projects, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ForgeX Employee HQ — Project Payment Status"
        description="Server-enforced restricted view exposing only project advance verification and milestone statuses. Receiving bank numbers, API secrets, and private client transaction records are strictly omitted by the backend."
        actions={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search project ref or milestone..."
          />
        }
      />

      <AlertBanner
        tone="info"
        message="Employee HQ endpoints enforce strict field redaction and project assignment scoping on the server."
      />

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={projects.length === 0 ? 'No assigned projects available' : 'No matching projects'}
          description="Projects assigned to your employee account (or all projects when previewing as Admin) appear here with milestone verification status."
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((p) => (
            <div
              key={p.projectRef}
              className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-slate-500">{p.projectRef}</div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {p.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500">Advance:</span>
                  <StatusBadge status={p.advanceVerified ? 'VERIFIED' : 'PENDING'} />
                </div>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
                {p.milestones.map((m) => (
                  <div
                    key={m.requestRef}
                    className="py-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono text-slate-500 mr-2">{m.requestRef}</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {m.title}
                      </span>{' '}
                      <span className="text-slate-500">({m.category})</span>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
