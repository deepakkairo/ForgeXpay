import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Download, Eye, FileText, Receipt as ReceiptIcon, AlertTriangle, Printer } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatInr, formatShortDate, formatUtcDateTime } from '../lib/format.ts';
import { useAuth } from '../context/AuthContext.tsx';
import {
  AlertBanner,
  CopyButton,
  DetailDrawer,
  EmptyState,
  PageHeader,
  SearchInput,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
  Timeline,
  TimelineEvent,
} from '../components/ui/Primitives.tsx';

interface InvoiceRow {
  id: string;
  invoiceRef: string;
  customerRef: string;
  customerName: string;
  projectRef: string;
  projectName: string;
  title: string;
  totalPaise: number;
  verifiedPaidPaise: number;
  outstandingPaise: number;
  taxRegime: string;
  status: string;
  createdAt: string;
}

export function InvoicesPage() {
  const [list, setList] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewInv, setPreviewInv] = useState<InvoiceRow | null>(null);

  useEffect(() => {
    apiRequest<{ invoices: InvoiceRow[] }>('/invoices')
      .then((res) => setList(res.invoices))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return list.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        inv.invoiceRef.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.projectName.toLowerCase().includes(q) ||
        inv.projectRef.toLowerCase().includes(q)
      );
    });
  }, [list, statusFilter, query]);

  const downloadPdf = async (id: string) => {
    try {
      const res = await apiRequest<{ pdfDownloadUrl: string }>(`/invoices/${id}`);
      const a = document.createElement('a');
      a.href = res.pdfDownloadUrl;
      a.download = '';
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch invoice download link.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Authoritative billing invoices synced from Admin HQ with print preview and authenticated expiring PDF downloads."
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: list.length },
            { id: 'ISSUED', label: 'Issued' },
            { id: 'PARTIALLY_PAID', label: 'Partially Paid' },
            { id: 'PAID', label: 'Paid' },
          ]}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search invoice ref, customer, or project..."
        />
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={list.length === 0 ? 'No invoices issued yet' : 'No matching invoices'}
          description="Create a project with an instalment schedule or create a payment request to generate an invoice."
        />
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((inv) => (
              <div
                key={inv.id}
                onClick={() => setPreviewInv(inv)}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-2.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                      {inv.invoiceRef}
                    </div>
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                      {inv.customerName}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {inv.projectName} ({inv.projectRef})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-sm font-bold">
                      {formatInr(inv.totalPaise)}
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <span className="font-mono text-slate-500">
                    Balance: {formatInr(inv.outstandingPaise)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadPdf(inv.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <Download className="w-3 h-3" />
                    <span>PDF</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 font-semibold">Invoice Ref</th>
                    <th className="py-3 px-4 font-semibold">Customer · Project</th>
                    <th className="py-3 px-4 font-semibold">Tax Profile</th>
                    <th className="py-3 px-4 font-semibold text-right">Total</th>
                    <th className="py-3 px-4 font-semibold text-right">Verified Paid</th>
                    <th className="py-3 px-4 font-semibold text-right">Balance</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filtered.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => setPreviewInv(inv)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {inv.invoiceRef}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {inv.customerName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {inv.projectName} ({inv.projectRef})
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {inv.taxRegime}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                        {formatInr(inv.totalPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                        {formatInr(inv.verifiedPaidPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatInr(inv.outstandingPaise)}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap space-x-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewInv(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPdf(inv.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          <Download className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Print-Ready Invoice Preview Drawer */}
      <DetailDrawer
        open={Boolean(previewInv)}
        onClose={() => setPreviewInv(null)}
        title={previewInv?.invoiceRef || 'Invoice Preview'}
        subtitle={previewInv ? `${previewInv.customerName} · ${previewInv.projectName}` : undefined}
        headerBadge={previewInv && <StatusBadge status={previewInv.status} />}
        footer={
          previewInv && (
            <>
              <CopyButton value={previewInv.invoiceRef} label="Copy Invoice Ref" />
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print View</span>
              </button>
              <button
                type="button"
                onClick={() => downloadPdf(previewInv.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Signed PDF</span>
              </button>
            </>
          )
        }
      >
        {previewInv && (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-white dark:bg-slate-950/60 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  ForgeX 4XPay Authoritative Billing Document
                </div>
                <h3 className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                  {previewInv.invoiceRef}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Issued: {formatShortDate(previewInv.createdAt)} · Tax Regime: {previewInv.taxRegime}
                </p>
              </div>
              <StatusBadge status={previewInv.status} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Billed To</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {previewInv.customerName}
                </div>
                <div className="font-mono text-slate-500">{previewInv.customerRef}</div>
              </div>
              <div>
                <div className="text-slate-500">Project Reference</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {previewInv.projectName}
                </div>
                <div className="font-mono text-slate-500">{previewInv.projectRef}</div>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              <div className="px-4 py-3 flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">{previewInv.title || 'Project Contract Billing'}</span>
                <span className="font-mono font-semibold tabular-nums">{formatInr(previewInv.totalPaise)}</span>
              </div>
              <div className="px-4 py-3 flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Verified Bank Credits Applied</span>
                <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  - {formatInr(previewInv.verifiedPaidPaise)}
                </span>
              </div>
              <div className="px-4 py-3 flex justify-between bg-slate-50/70 dark:bg-slate-900/50 font-semibold">
                <span>Remaining Payable Balance</span>
                <span className="font-mono tabular-nums">{formatInr(previewInv.outstandingPaise)}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Only payments verified against receiving bank credits reduce the remaining balance on this invoice. Tax fields reflect the explicit configuration in Security & Tax Governance.
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  paymentRef: string;
  invoiceRef: string;
  projectName: string;
  customerName: string;
  customerRef: string;
  category: string;
  paidAmountPaise: number;
  verifiedUtr: string;
  issuedAt: string;
  pdfDownloadUrl: string;
}

export function ReceiptsPage() {
  const [list, setList] = useState<ReceiptRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptRow | null>(null);

  useEffect(() => {
    apiRequest<{ receipts: ReceiptRow[] }>('/receipts')
      .then((res) => setList(res.receipts))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter(
      (rc) =>
        rc.receiptNumber.toLowerCase().includes(q) ||
        rc.paymentRef.toLowerCase().includes(q) ||
        rc.customerName.toLowerCase().includes(q) ||
        rc.verifiedUtr.toLowerCase().includes(q)
    );
  }, [list, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verified Payment Receipts"
        description="Official Advance, Milestone, and Final payment receipts issued strictly after backend bank-credit verification."
        actions={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search receipt no, UTR, or customer..."
          />
        }
      />

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ReceiptIcon}
          title={list.length === 0 ? 'No verified receipts yet' : 'No matching receipts'}
          description="Receipts are never generated for unverified or customer-reported payments. Confirm a payment credit in Finance HQ to issue its receipt."
        />
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((rc) => (
              <div
                key={rc.id}
                onClick={() => setPreviewReceipt(rc)}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-2 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {rc.receiptNumber}
                    </div>
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                      {rc.customerName}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {rc.paymentRef} · UTR {rc.verifiedUtr}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-sm font-bold">
                      {formatInr(rc.paidAmountPaise)}
                    </div>
                    <div className="text-[11px] text-slate-500">{formatShortDate(rc.issuedAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 font-semibold">Receipt No</th>
                    <th className="py-3 px-4 font-semibold">Payment ID · Category</th>
                    <th className="py-3 px-4 font-semibold">Customer · Project</th>
                    <th className="py-3 px-4 font-semibold">Verified UTR</th>
                    <th className="py-3 px-4 font-semibold text-right">Amount</th>
                    <th className="py-3 px-4 font-semibold text-right">Issued</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filtered.map((rc) => (
                    <tr
                      key={rc.id}
                      onClick={() => setPreviewReceipt(rc)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        {rc.receiptNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-slate-900 dark:text-slate-100">{rc.paymentRef}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {rc.category} · {rc.invoiceRef}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {rc.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {rc.projectName}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono">{rc.verifiedUtr}</td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatInr(rc.paidAmountPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-slate-500 dark:text-slate-400">
                        {formatShortDate(rc.issuedAt)}
                      </td>
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap space-x-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewReceipt(rc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview</span>
                        </button>
                        <a
                          href={rc.pdfDownloadUrl}
                          download
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          <Download className="w-3 h-3" />
                          <span>PDF</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Print-Ready Verified Receipt Preview Drawer */}
      <DetailDrawer
        open={Boolean(previewReceipt)}
        onClose={() => setPreviewReceipt(null)}
        title={previewReceipt?.receiptNumber || 'Receipt Preview'}
        subtitle={
          previewReceipt ? `${previewReceipt.customerName} · ${previewReceipt.projectName}` : undefined
        }
        headerBadge={<StatusBadge status="VERIFIED" />}
        footer={
          previewReceipt && (
            <>
              <CopyButton value={previewReceipt.verifiedUtr} label="Copy UTR" />
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
              <a
                href={previewReceipt.pdfDownloadUrl}
                download
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Signed PDF</span>
              </a>
            </>
          )
        }
      >
        {previewReceipt && (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-white dark:bg-slate-950/60 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Official Verified Payment Receipt
                </div>
                <h3 className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                  {previewReceipt.receiptNumber}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Issued UTC: {formatUtcDateTime(previewReceipt.issuedAt)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500">Verified Amount</div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatInr(previewReceipt.paidAmountPaise)}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Customer</span>
                <span className="font-medium">{previewReceipt.customerName} ({previewReceipt.customerRef})</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Project & Stage</span>
                <span className="font-medium">{previewReceipt.projectName} · {previewReceipt.category}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Linked Invoice</span>
                <span className="font-mono">{previewReceipt.invoiceRef}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Payment Attempt ID</span>
                <span className="font-mono">{previewReceipt.paymentRef}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Verified Bank UTR</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {previewReceipt.verifiedUtr}
                </span>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

interface DisputeRow {
  id: string;
  ticketRef: string;
  paymentRef: string;
  invoiceRef: string;
  customerName: string;
  customerRef: string;
  claimedUtr: string;
  claimedAmountPaise: number;
  expectedAmountPaise: number;
  approximateTime: string;
  explanation: string;
  supportingEvidenceNote: string;
  status: string;
  resolutionNote: string;
  createdAt: string;
}

export function DisputesPage() {
  const { hasAnyRole } = useAuth();
  const canResolve = hasAnyRole('SUPER_ADMIN', 'FINANCE_ADMIN');
  const [list, setList] = useState<DisputeRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const [nextStatus, setNextStatus] = useState('UNDER_BANK_CHECK');
  const [resolutionNote, setResolutionNote] = useState('');
  const [matchedUtr, setMatchedUtr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ disputes: DisputeRow[] }>('/disputes');
      setList(res.disputes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load disputes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter(
      (d) =>
        d.ticketRef.toLowerCase().includes(q) ||
        d.paymentRef.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.claimedUtr.toLowerCase().includes(q)
    );
  }, [list, query]);

  const openDispute = (d: DisputeRow) => {
    setSelected(d);
    setNextStatus(d.status === 'OPEN' ? 'UNDER_BANK_CHECK' : d.status);
    setResolutionNote(d.resolutionNote || '');
    setMatchedUtr(d.claimedUtr);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/disputes/${selected.id}`, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          resolutionNote: resolutionNote.trim(),
          matchedBankUtr: matchedUtr.trim() || undefined,
        },
      });
      setNotice(`Dispute ticket ${selected.ticketRef} updated to ${nextStatus}. Customer notified.`);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update dispute.');
    } finally {
      setSaving(false);
    }
  };

  const disputeTimeline: TimelineEvent[] = selected
    ? [
        {
          id: 'submitted',
          label: 'Ticket Submitted',
          detail: `Customer claimed ${formatInr(selected.claimedAmountPaise)} · UTR ${selected.claimedUtr}`,
          timestamp: formatUtcDateTime(selected.createdAt),
          state: 'completed',
        },
        {
          id: 'review',
          label: 'Finance HQ Triage',
          detail: selected.explanation || 'Submitted for bank statement comparison.',
          state: selected.status === 'OPEN' ? 'current' : 'completed',
        },
        ...(selected.status === 'CLARIFICATION_REQUESTED' || selected.status === 'UNDER_BANK_CHECK'
          ? [
              {
                id: 'check',
                label:
                  selected.status === 'CLARIFICATION_REQUESTED'
                    ? 'Clarification Requested'
                    : 'Under Bank Record Check',
                detail: selected.resolutionNote || 'Comparing claimed UTR against corporate bank credits.',
                state: 'current' as const,
              },
            ]
          : []),
        ...(selected.status === 'APPROVED_VERIFIED'
          ? [
              {
                id: 'resolved',
                label: 'Approved & Bank Credit Verified',
                detail: selected.resolutionNote || 'Credit matched and receipt issued.',
                state: 'completed' as const,
              },
            ]
          : selected.status === 'REJECTED'
            ? [
                {
                  id: 'rejected',
                  label: 'Dispute Rejected',
                  detail: selected.resolutionNote || 'No matching credit found in bank records.',
                  state: 'error' as const,
                },
              ]
            : []),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Missing Payments & Disputes"
        description="Investigate customer-submitted missing payment claims. Customer screenshots and notes are supporting context only and never conclusive proof without a confirmed bank credit."
        actions={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search ticket, Payment ID, or UTR..."
          />
        }
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title={list.length === 0 ? 'No missing payment disputes' : 'No matching disputes'}
          description="When a customer reports a missing payment from the Client Portal, a linked investigation ticket appears here for Finance HQ."
        />
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((d) => (
              <div
                key={d.id}
                onClick={() => openDispute(d)}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-2.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                      {d.ticketRef} · {d.paymentRef}
                    </div>
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                      {d.customerName}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-sm font-bold">
                      {formatInr(d.claimedAmountPaise)}
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                </div>
                <div className="text-xs font-mono text-slate-500">
                  UTR: {d.claimedUtr} · {d.approximateTime}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 font-semibold">Ticket · Payment ID</th>
                    <th className="py-3 px-4 font-semibold">Customer</th>
                    <th className="py-3 px-4 font-semibold">Claimed UTR · Time</th>
                    <th className="py-3 px-4 font-semibold text-right">Claimed Amount</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filtered.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => openDispute(d)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {d.ticketRef}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {d.paymentRef} · {d.invoiceRef}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium">{d.customerName}</div>
                        <div className="text-[11px] font-mono text-slate-500">{d.customerRef}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-slate-900 dark:text-slate-100">{d.claimedUtr}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {d.approximateTime} · {formatUtcDateTime(d.createdAt)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatInr(d.claimedAmountPaise)}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openDispute(d)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {canResolve ? 'Investigate' : 'Inspect'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Dispute Timeline & Investigation Drawer */}
      <DetailDrawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.ticketRef || 'Dispute Ticket'}
        subtitle={
          selected ? `Linked Payment: ${selected.paymentRef} · ${selected.customerName}` : undefined
        }
        headerBadge={selected && <StatusBadge status={selected.status} />}
      >
        {selected && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Claimed UTR</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{selected.claimedUtr}</span>
                  <CopyButton value={selected.claimedUtr} label="Copy" />
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Claimed / Expected</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatInr(selected.claimedAmountPaise)} / {formatInr(selected.expectedAmountPaise)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Customer Explanation</span>
                <p className="text-slate-800 dark:text-slate-200 mt-0.5">
                  {selected.explanation || 'No explanation provided.'}
                </p>
              </div>
              {selected.supportingEvidenceNote && (
                <div>
                  <span className="text-slate-500 block">
                    Supporting Context (Non-Conclusive)
                  </span>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                    {selected.supportingEvidenceNote}
                  </p>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Dispute Lifecycle Timeline
              </h3>
              <Timeline events={disputeTimeline} />
            </div>

            {canResolve && (
              <form
                onSubmit={handleUpdate}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4"
              >
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Finance HQ Investigation Action
                </h3>
                <div>
                  <label className="block text-xs font-medium mb-1">Update Ticket Status</label>
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                    className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="ASSIGNED">Assign to Me</option>
                    <option value="CLARIFICATION_REQUESTED">Request Clarification from Customer</option>
                    <option value="UNDER_BANK_CHECK">Mark Under Bank Record Check</option>
                    <option value="APPROVED_VERIFIED">Approve & Verify Bank Credit (Issues Receipt)</option>
                    <option value="REJECTED">Reject Dispute with Reason</option>
                    <option value="REOPENED">Reopen Investigation</option>
                  </select>
                </div>

                {nextStatus === 'APPROVED_VERIFIED' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">Verified Bank UTR</label>
                    <input
                      type="text"
                      required
                      value={matchedUtr}
                      onChange={(e) => setMatchedUtr(e.target.value)}
                      className="forge-input w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1">Resolution / Customer Update Note</label>
                  <textarea
                    required
                    rows={3}
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Explain findings from bank statement check..."
                    className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    {saving ? 'Updating...' : 'Save Ticket Update'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
