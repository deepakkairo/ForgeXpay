import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, Upload, AlertCircle, Eye, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatInr, formatUtcDateTime, rupeesInputToPaise } from '../lib/format.ts';
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
} from '../components/ui/Primitives.tsx';

interface QueueItem {
  attempt: {
    id: string;
    paymentRef: string;
    expectedAmountPaise: number;
    reportedAmountPaise: number | null;
    status: string;
    customerReportedUtr: string | null;
    customerReportNote: string | null;
    requiresDualApproval: boolean;
    firstApproverUserId: string | null;
    createdAt: string;
  };
  paymentRequest: { requestRef: string; category: string; title: string };
  customer: { customerRef: string; name: string; email: string };
  project: { projectRef: string; name: string };
  invoice: { invoiceRef: string };
  receivingAccount: {
    accountCode: string;
    bankName: string;
    accountNumberMasked: string;
    upiId: string;
  };
  suggestedBankMatches: Array<{
    match: { id: string; matchClassification: string; confidenceScore: number; matchReasonsJson: string[] };
    bankTx: { id: string; bankReferenceUtr: string | null; amountPaise: number; transactionDate: string };
  }>;
}

interface ReconMatchRow {
  id: string;
  matchClassification: string;
  confidenceScore: number;
  matchReasonsJson: string[];
  reviewNote: string | null;
  bankTransaction: {
    id: string;
    amountPaise: number;
    bankReferenceUtr: string | null;
    transactionDate: string;
    description: string;
    settlementStatus: string;
  };
  receivingAccount: { accountCode: string; bankName: string; upiId: string };
  linkedPayment: {
    id: string;
    paymentRef: string;
    expectedAmountPaise: number;
    status: string;
    customerName: string;
    invoiceRef: string;
  } | null;
}

interface AccountOption {
  id: string;
  accountCode: string;
  bankName: string;
  accountNumberMasked: string;
  upiId: string;
}

export function VerificationQueuePage() {
  const [tab, setTab] = useState<'queue' | 'reconciliation'>('queue');
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [matches, setMatches] = useState<ReconMatchRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Case Review Detail Drawer
  const [reviewItem, setReviewItem] = useState<QueueItem | null>(null);

  // Manual confirm modal
  const [confirmTarget, setConfirmTarget] = useState<QueueItem | null>(null);
  const [confirmForm, setConfirmForm] = useState({
    verifiedUtr: '',
    creditedRupees: '',
    bankDate: new Date().toISOString().slice(0, 10),
    notes: '',
    independentCheckConfirmed: false,
  });
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [markAsReview, setMarkAsReview] = useState(false);

  // CSV statement import modal
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvAccountId, setCsvAccountId] = useState('');
  const [csvFilename, setCsvFilename] = useState('bank-statement.csv');
  const [csvContent, setCsvContent] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    dateColumn: 'Date',
    directionColumn: 'Type',
    amountColumn: 'Amount',
    utrColumn: 'UTR',
    descriptionColumn: 'Narration',
  });

  // Manual bind modal for ambiguous/unmatched statement credit
  const [bindMatch, setBindMatch] = useState<ReconMatchRow | null>(null);
  const [bindAttemptId, setBindAttemptId] = useState('');
  const [bindUtrOverride, setBindUtrOverride] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qRes, rRes, aRes] = await Promise.all([
        apiRequest<{ queue: QueueItem[] }>('/verification-queue'),
        apiRequest<{ matches: ReconMatchRow[] }>('/reconciliation/matches'),
        apiRequest<{ accounts: AccountOption[] }>('/admin/receiving-accounts'),
      ]);
      setQueue(qRes.queue);
      setMatches(rRes.matches);
      setAccounts(aRes.accounts);
      if (aRes.accounts.length > 0 && !csvAccountId) {
        setCsvAccountId(aRes.accounts[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification workspace.');
    } finally {
      setLoading(false);
    }
  }, [csvAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredQueue = useMemo(() => {
    if (!query.trim()) return queue;
    const q = query.trim().toLowerCase();
    return queue.filter(
      (item) =>
        item.attempt.paymentRef.toLowerCase().includes(q) ||
        item.customer.name.toLowerCase().includes(q) ||
        item.invoice.invoiceRef.toLowerCase().includes(q) ||
        (item.attempt.customerReportedUtr || '').toLowerCase().includes(q) ||
        item.project.name.toLowerCase().includes(q)
    );
  }, [queue, query]);

  const filteredMatches = useMemo(() => {
    if (!query.trim()) return matches;
    const q = query.trim().toLowerCase();
    return matches.filter(
      (m) =>
        (m.bankTransaction.bankReferenceUtr || '').toLowerCase().includes(q) ||
        m.bankTransaction.description.toLowerCase().includes(q) ||
        (m.linkedPayment?.paymentRef || '').toLowerCase().includes(q) ||
        (m.linkedPayment?.customerName || '').toLowerCase().includes(q)
    );
  }, [matches, query]);

  const openConfirm = (item: QueueItem) => {
    setConfirmTarget(item);
    const rupees = ((item.attempt.reportedAmountPaise || item.attempt.expectedAmountPaise) / 100).toFixed(2);
    setConfirmForm({
      verifiedUtr: item.attempt.customerReportedUtr || item.suggestedBankMatches[0]?.bankTx.bankReferenceUtr || '',
      creditedRupees: rupees,
      bankDate: new Date().toISOString().slice(0, 10),
      notes: '',
      independentCheckConfirmed: false,
    });
    setError(null);
  };

  const handleConfirmManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTarget || !confirmForm.independentCheckConfirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{
        stage: string;
        paymentRef: string;
        receiptNumber?: string;
        ledgerRef?: string;
      }>(`/verifications/${confirmTarget.attempt.id}/confirm`, {
        method: 'POST',
        body: {
          verifiedUtr: confirmForm.verifiedUtr.trim(),
          creditedAmountPaise: rupeesInputToPaise(confirmForm.creditedRupees),
          bankTransactionDate: confirmForm.bankDate,
          notes: confirmForm.notes.trim(),
        },
      });
      if (res.stage === 'FIRST_APPROVAL_RECORDED') {
        setNotice(
          `First approval recorded for high-value payment ${res.paymentRef}. A second distinct Finance/Super Admin must now confirm.`
        );
      } else {
        setNotice(
          `Payment ${res.paymentRef} VERIFIED. Ledger credit ${res.ledgerRef} and Receipt ${res.receiptNumber} issued atomically.`
        );
      }
      setConfirmTarget(null);
      setReviewItem(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/verifications/${rejectTarget.attempt.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason.trim(), markAsReview },
      });
      setNotice(
        `${rejectTarget.attempt.paymentRef} moved to ${markAsReview ? 'REVIEW_REQUIRED' : 'FAILED_REPORTED'}.`
      );
      setRejectTarget(null);
      setReviewItem(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvFileUpload = (file: File) => {
    setCsvFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvContent(text);
      const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
      const cols = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
      setCsvHeaders(cols);
      if (cols.length >= 3) {
        setMapping({
          dateColumn: cols.find((c) => /date/i.test(c)) || cols[0],
          directionColumn: cols.find((c) => /type|dr|cr|dir/i.test(c)) || cols[1] || '',
          amountColumn: cols.find((c) => /amt|amount|credit/i.test(c)) || cols[2] || '',
          utrColumn: cols.find((c) => /utr|ref|chq/i.test(c)) || cols[3] || cols[0],
          descriptionColumn: cols.find((c) => /desc|narr|partic|rem/i.test(c)) || cols[cols.length - 1],
        });
      }
    };
    reader.readAsText(file);
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{
        importBatch: {
          importRef: string;
          creditRows: number;
          matchedCount: number;
          ambiguousCount: number;
          unmatchedCount: number;
          duplicateQuarantinedCount: number;
        };
      }>('/reconciliation/imports', {
        method: 'POST',
        body: {
          receivingAccountId: csvAccountId,
          sourceFilename: csvFilename,
          csvContent,
          columnMapping: mapping,
        },
      });
      const b = res.importBatch;
      setNotice(
        `Imported ${b.importRef}: ${b.creditRows} credits analyzed (${b.matchedCount} matched, ${b.ambiguousCount} ambiguous, ${b.unmatchedCount} unmatched, ${b.duplicateQuarantinedCount} duplicates quarantined).`
      );
      setCsvOpen(false);
      setTab('reconciliation');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV reconciliation import failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmMatch = async (matchRow: ReconMatchRow, attemptOverride?: string, utrOverride?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ verification: { paymentRef: string; receiptNumber?: string } }>(
        `/reconciliation/matches/${matchRow.id}/confirm`,
        {
          method: 'POST',
          body: {
            paymentAttemptId: attemptOverride || matchRow.linkedPayment?.id,
            utrOverride: utrOverride || matchRow.bankTransaction.bankReferenceUtr || '',
            note: 'Confirmed from imported bank statement credit',
          },
        }
      );
      setNotice(
        `Bank credit confirmed for ${res.verification.paymentRef}. Receipt ${res.verification.receiptNumber || '(awaiting 2nd approval)'}.`
      );
      setBindMatch(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match confirmation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectMatch = async (matchId: string) => {
    setError(null);
    try {
      await apiRequest(`/reconciliation/matches/${matchId}/reject`, {
        method: 'POST',
        body: { note: 'Rejected by Finance Admin during statement review' },
      });
      setNotice('Reconciliation match rejected.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject match.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Queue & Statement Reconciliation"
        description="Verify incoming UPI transfers strictly against your banking application or imported CSV bank statements. Returning from a UPI app never verifies funds automatically."
        actions={
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            disabled={accounts.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 whitespace-nowrap transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>Import Bank Statement CSV</span>
          </button>
        }
      />

      <AlertBanner
        tone="info"
        message="Authoritative Finance Boundary: Customer-submitted UTRs and screenshots are supporting context only. Confirm a payment solely after observing a matching settled credit in your receiving bank account."
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs<'queue' | 'reconciliation'>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'queue', label: 'Manual Verification Queue', count: queue.length },
            { id: 'reconciliation', label: 'Statement Matches', count: matches.length },
          ]}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search Payment ID, customer, invoice, or UTR..."
        />
      </div>

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : tab === 'queue' ? (
        filteredQueue.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={queue.length === 0 ? 'Verification queue is clear' : 'No matching queue cases'}
            description="Customer-initiated and customer-reported UPI payments awaiting bank-credit verification appear here."
          />
        ) : (
          <>
            {/* Mobile Card List */}
            <div className="lg:hidden space-y-3">
              {filteredQueue.map((item) => (
                <div
                  key={item.attempt.id}
                  className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                        {item.attempt.paymentRef}
                      </div>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                        {item.customer.name} · {item.invoice.invoiceRef}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">
                        {formatInr(item.attempt.expectedAmountPaise)}
                      </div>
                      <StatusBadge status={item.attempt.status} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                    UTR: {item.attempt.customerReportedUtr || 'Not reported'} · {item.receivingAccount.bankName}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setReviewItem(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review Case</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openConfirm(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Confirm Credit</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden lg:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                      <th className="py-3 px-4 font-semibold">Payment ID · Invoice</th>
                      <th className="py-3 px-4 font-semibold">Customer · Account</th>
                      <th className="py-3 px-4 font-semibold text-right">Expected</th>
                      <th className="py-3 px-4 font-semibold">Reported UTR · Bank Match</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredQueue.map((item) => (
                      <tr
                        key={item.attempt.id}
                        onClick={() => setReviewItem(item)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {item.attempt.paymentRef}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {item.invoice.invoiceRef} · {item.paymentRequest.category}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {item.customer.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {item.receivingAccount.bankName} ({item.receivingAccount.accountNumberMasked})
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatInr(item.attempt.expectedAmountPaise)}
                          </div>
                          {item.attempt.requiresDualApproval && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400">
                              {item.attempt.firstApproverUserId
                                ? '1st Approved · Needs 2nd'
                                : 'Dual Approval Required'}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-slate-800 dark:text-slate-200">
                            {item.attempt.customerReportedUtr || 'No UTR reported'}
                          </div>
                          {item.suggestedBankMatches.length > 0 && (
                            <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                              Statement match: {item.suggestedBankMatches[0].match.matchClassification} (
                              {item.suggestedBankMatches[0].bankTx.bankReferenceUtr || 'No UTR'})
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={item.attempt.status} />
                        </td>
                        <td
                          className="py-3.5 px-4 text-right whitespace-nowrap space-x-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => openConfirm(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Confirm Credit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectTarget(item);
                              setRejectReason('');
                              setMarkAsReview(false);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject / Review</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : filteredMatches.length === 0 ? (
        <EmptyState
          icon={Upload}
          title={matches.length === 0 ? 'No bank statement credits imported' : 'No matching statement rows'}
          description="Import a CSV bank statement for a specific receiving account. Only CREDIT rows are evaluated, duplicate rows are quarantined, and transactions are never auto-matched solely by amount."
          action={
            accounts.length > 0 && matches.length === 0 ? (
              <button
                type="button"
                onClick={() => setCsvOpen(true)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Import CSV Statement
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-4 font-semibold">Bank Credit · UTR</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount</th>
                  <th className="py-3 px-4 font-semibold">Candidate Payment</th>
                  <th className="py-3 px-4 font-semibold">Classification · Reasoning</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredMatches.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {m.bankTransaction.bankReferenceUtr || 'NO UTR'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs truncate">
                        {m.bankTransaction.description || '—'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {formatUtcDateTime(m.bankTransaction.transactionDate)} · {m.receivingAccount.bankName}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                      {formatInr(m.bankTransaction.amountPaise)}
                    </td>
                    <td className="py-3.5 px-4">
                      {m.linkedPayment ? (
                        <>
                          <div className="font-mono font-medium text-slate-900 dark:text-slate-100">
                            {m.linkedPayment.paymentRef}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {m.linkedPayment.customerName} · {m.linkedPayment.invoiceRef}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">Unassigned (manual bind required)</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 max-w-sm">
                      <StatusBadge status={m.matchClassification} />
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {m.matchReasonsJson.join(' · ')}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                      {m.matchClassification !== 'CONFIRMED' &&
                        m.matchClassification !== 'REJECTED' && (
                          <>
                            {m.linkedPayment ? (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleConfirmMatch(m)}
                                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setBindMatch(m);
                                  setBindAttemptId(queue[0]?.attempt.id || '');
                                  setBindUtrOverride(m.bankTransaction.bankReferenceUtr || '');
                                }}
                                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                              >
                                Bind & Verify
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRejectMatch(m.id)}
                              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                            >
                              Reject
                            </button>
                          </>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Structured Case Review Drawer */}
      <DetailDrawer
        open={Boolean(reviewItem)}
        onClose={() => setReviewItem(null)}
        title={reviewItem?.attempt.paymentRef || 'Case Review'}
        subtitle={
          reviewItem
            ? `${reviewItem.customer.name} · ${reviewItem.project.name} (${reviewItem.invoice.invoiceRef})`
            : undefined
        }
        headerBadge={reviewItem && <StatusBadge status={reviewItem.attempt.status} />}
        footer={
          reviewItem && (
            <>
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(reviewItem);
                  setRejectReason('');
                  setMarkAsReview(false);
                }}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Reject / Flag Review
              </button>
              <button
                type="button"
                onClick={() => openConfirm(reviewItem)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Confirm Bank Credit
              </button>
            </>
          )
        }
      >
        {reviewItem && (
          <>
            {/* 1. Payment Information */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                1. Payment Information
              </h3>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Expected Amount</span>
                  <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatInr(reviewItem.attempt.expectedAmountPaise)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Request Stage</span>
                  <span className="font-mono">{reviewItem.paymentRequest.category} ({reviewItem.paymentRequest.requestRef})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Receiving Account</span>
                  <span className="font-mono">
                    {reviewItem.receivingAccount.bankName} · {reviewItem.receivingAccount.upiId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Initiated UTC</span>
                  <span className="font-mono tabular-nums">{formatUtcDateTime(reviewItem.attempt.createdAt)}</span>
                </div>
              </div>
            </section>

            {/* 2. Customer Report */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                2. Customer Report (Supporting Context Only)
              </h3>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Claimed UTR / RRN</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">
                      {reviewItem.attempt.customerReportedUtr || 'Not submitted'}
                    </span>
                    {reviewItem.attempt.customerReportedUtr && (
                      <CopyButton value={reviewItem.attempt.customerReportedUtr} label="Copy" />
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Reported Amount</span>
                  <span className="font-mono tabular-nums">
                    {reviewItem.attempt.reportedAmountPaise
                      ? formatInr(reviewItem.attempt.reportedAmountPaise)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-0.5">Customer Note</span>
                  <p className="text-slate-700 dark:text-slate-300">
                    {reviewItem.attempt.customerReportNote || 'No note submitted.'}
                  </p>
                </div>
              </div>
            </section>

            {/* 3. Bank Verification & Suggested Statement Matches */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                3. Bank Statement Verification
              </h3>
              {reviewItem.suggestedBankMatches.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  No imported bank statement match linked yet. Open your banking app or import a CSV statement to confirm this transfer before issuing a receipt.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {reviewItem.suggestedBankMatches.map((sm) => (
                    <div
                      key={sm.match.id}
                      className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <StatusBadge status={sm.match.matchClassification} />
                        <span className="font-mono font-bold tabular-nums">
                          {formatInr(sm.bankTx.amountPaise)}
                        </span>
                      </div>
                      <div className="font-mono">
                        Bank UTR: {sm.bankTx.bankReferenceUtr || 'Missing'} · Confidence {sm.match.confidenceScore}%
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400">
                        {sm.match.matchReasonsJson.join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </DetailDrawer>

      {/* Manual Verification Confirmation Modal */}
      <Modal
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        title={`Confirm Bank Credit — ${confirmTarget?.attempt.paymentRef}`}
        subtitle="Only confirm after verifying the actual credit inside your authorised banking application. Duplicate UTRs are rejected."
      >
        <form onSubmit={handleConfirmManual} className="space-y-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-xs space-y-1 bg-slate-50/70 dark:bg-slate-950/40">
            <div>
              Customer: <span className="font-medium">{confirmTarget?.customer.name}</span> · Invoice:{' '}
              <span className="font-mono">{confirmTarget?.invoice.invoiceRef}</span>
            </div>
            <div>
              Expected Amount:{' '}
              <span className="font-mono font-semibold">
                {formatInr(confirmTarget?.attempt.expectedAmountPaise)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Bank Reference / UTR</label>
              <input
                type="text"
                required
                value={confirmForm.verifiedUtr}
                onChange={(e) => setConfirmForm({ ...confirmForm, verifiedUtr: e.target.value })}
                placeholder="6–35 alphanumeric chars"
                className="forge-input w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Credited Amount (INR)</label>
              <input
                type="text"
                required
                value={confirmForm.creditedRupees}
                onChange={(e) => setConfirmForm({ ...confirmForm, creditedRupees: e.target.value })}
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Bank Transaction Date</label>
            <input
              type="date"
              required
              value={confirmForm.bankDate}
              onChange={(e) => setConfirmForm({ ...confirmForm, bankDate: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Verification Notes</label>
            <textarea
              rows={2}
              value={confirmForm.notes}
              onChange={(e) => setConfirmForm({ ...confirmForm, notes: e.target.value })}
              placeholder="Confirmed in corporate bank statement"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={confirmForm.independentCheckConfirmed}
              onChange={(e) =>
                setConfirmForm({ ...confirmForm, independentCheckConfirmed: e.target.checked })
              }
              className="mt-0.5"
            />
            <span>
              I have independently checked the receiving bank&apos;s transaction history and confirmed this credit.
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !confirmForm.independentCheckConfirmed}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Confirm & Issue Receipt'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject / Flag Review Modal */}
      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={`Reject or Flag — ${rejectTarget?.attempt.paymentRef}`}
      >
        <form onSubmit={handleReject} className="space-y-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={markAsReview}
              onChange={(e) => setMarkAsReview(e.target.checked)}
            />
            <span>Keep in REVIEW_REQUIRED instead of FAILED_REPORTED</span>
          </label>
          <div>
            <label className="block text-xs font-medium mb-1">Audit Reason</label>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. No matching credit found in bank statement as of EOD"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Confirm Action
            </button>
          </div>
        </form>
      </Modal>

      {/* CSV Statement Import Modal */}
      <Modal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Import Bank Statement CSV"
        subtitle="Explicitly select the receiving bank account and map statement columns. Only CREDIT rows are processed; duplicates are quarantined."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleImportCsv} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Receiving Bank Account</label>
            <select
              required
              value={csvAccountId}
              onChange={(e) => setCsvAccountId(e.target.value)}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountCode} — {a.bankName} ({a.accountNumberMasked}) · {a.upiId}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Upload CSV File</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsvFileUpload(f);
                }}
                className="w-full text-xs text-slate-600 dark:text-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Source File Label</label>
              <input
                type="text"
                required
                value={csvFilename}
                onChange={(e) => setCsvFilename(e.target.value)}
                className="forge-input w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              CSV Content (Paste or edit after upload)
            </label>
            <textarea
              required
              rows={5}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                const first = e.target.value.split(/\r?\n/)[0] || '';
                setCsvHeaders(first.split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean));
              }}
              placeholder={'Date,Type,Amount,UTR,Narration\n2026-11-19,CR,5000.00,432198765432,UPI/CR/FXPAY-2026-XXXXXX'}
              className="forge-input w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(
              [
                ['dateColumn', 'Date Col'],
                ['directionColumn', 'CR/DR Col'],
                ['amountColumn', 'Amount Col'],
                ['utrColumn', 'UTR Col'],
                ['descriptionColumn', 'Narration Col'],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label className="block text-[11px] font-medium mb-1">{label}</label>
                {csvHeaders.length > 0 ? (
                  <select
                    value={mapping[field]}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={mapping[field]}
                    onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Imported statement records are sensitive financial data restricted strictly to Finance HQ & Super Admin. Debits are ignored; credits never auto-verify until confirmed.
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCsvOpen(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {submitting ? 'Importing & Classifying...' : 'Run Reconciliation Import'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Manual Bind Modal for Ambiguous/Unmatched Bank Credit */}
      <Modal
        open={Boolean(bindMatch)}
        onClose={() => setBindMatch(null)}
        title="Bind Bank Credit to Payment Attempt"
        subtitle="Explicitly assign an ambiguous or unmatched bank credit to a verified payment obligation."
      >
        <div className="space-y-4">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Bank Credit:{' '}
            <span className="font-mono font-semibold">
              {formatInr(bindMatch?.bankTransaction.amountPaise)}
            </span>{' '}
            · UTR:{' '}
            <span className="font-mono">
              {bindMatch?.bankTransaction.bankReferenceUtr || 'Missing'}
            </span>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Target Payment Attempt</label>
            <select
              value={bindAttemptId}
              onChange={(e) => setBindAttemptId(e.target.value)}
              className="forge-input w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              {queue.map((q) => (
                <option key={q.attempt.id} value={q.attempt.id}>
                  {q.attempt.paymentRef} — {q.customer.name} ({formatInr(q.attempt.expectedAmountPaise)})
                </option>
              ))}
            </select>
          </div>
          {!bindMatch?.bankTransaction.bankReferenceUtr && (
            <div>
              <label className="block text-xs font-medium mb-1">Verified Bank UTR</label>
              <input
                type="text"
                required
                value={bindUtrOverride}
                onChange={(e) => setBindUtrOverride(e.target.value)}
                className="forge-input w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBindMatch(null)}
              className="px-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !bindAttemptId}
              onClick={() =>
                bindMatch && handleConfirmMatch(bindMatch, bindAttemptId, bindUtrOverride)
              }
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Confirm & Verify Payment
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
