import React, { useEffect, useState, useCallback } from 'react';
import { Plus, CheckCircle2, Edit3, Power, Landmark } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatUtcDateTime } from '../lib/format.ts';
import { useAuth } from '../context/AuthContext.tsx';
import {
  AlertBanner,
  CopyButton,
  EmptyState,
  Modal,
  PageHeader,
  SkeletonRows,
  StatusBadge,
} from '../components/ui/Primitives.tsx';

interface ReceivingAccount {
  id: string;
  accountCode: string;
  accountHolderName: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  accountType: 'SAVINGS' | 'CURRENT';
  upiId: string;
  displayPayeeName: string;
  internalLabel: string;
  isActive: boolean;
  manualCheckAttested: boolean;
  manualCheckAttestedAt: string | null;
  manualCheckNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  resourceId: string;
  createdAt: string;
  status: string;
}

export function ReceivingAccountsPage() {
  const { profile, hasAnyRole, refreshProfile } = useAuth();
  const isSuperAdmin = hasAnyRole('SUPER_ADMIN');
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReceivingAccount | null>(null);
  const [form, setForm] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    accountNumberConfirm: '',
    ifsc: '',
    accountType: 'CURRENT' as 'SAVINGS' | 'CURRENT',
    upiId: '',
    displayPayeeName: '',
    internalLabel: '',
    activateImmediately: true,
    mfaCode: '',
    confirmSecurity: false,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Manual configuration check attestation modal
  const [attestTarget, setAttestTarget] = useState<ReceivingAccount | null>(null);
  const [attestNote, setAttestNote] = useState('');
  const [attestMfa, setAttestMfa] = useState('');

  // Activate modal (with security confirmation)
  const [activateTarget, setActivateTarget] = useState<ReceivingAccount | null>(null);
  const [activateMfa, setActivateMfa] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        accounts: ReceivingAccount[];
        changeHistory: AuditEntry[];
      }>('/admin/receiving-accounts');
      setAccounts(res.accounts);
      setHistory(res.changeHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load receiving accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setForm({
      accountHolderName: '',
      bankName: '',
      accountNumber: '',
      accountNumberConfirm: '',
      ifsc: '',
      accountType: 'CURRENT',
      upiId: '',
      displayPayeeName: '',
      internalLabel: '',
      activateImmediately: accounts.length === 0,
      mfaCode: '',
      confirmSecurity: false,
    });
    setModalOpen(true);
  };

  const openEdit = (acc: ReceivingAccount) => {
    setEditing(acc);
    setFormError(null);
    setForm({
      accountHolderName: acc.accountHolderName,
      bankName: acc.bankName,
      accountNumber: '',
      accountNumberConfirm: '',
      ifsc: acc.ifsc,
      accountType: acc.accountType,
      upiId: acc.upiId,
      displayPayeeName: acc.displayPayeeName,
      internalLabel: acc.internalLabel,
      activateImmediately: acc.isActive,
      mfaCode: '',
      confirmSecurity: false,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedAcct = form.accountNumber.trim();
    const trimmedConfirm = form.accountNumberConfirm.trim();
    if ((!editing || trimmedAcct.length > 0) && trimmedAcct !== trimmedConfirm) {
      setFormError('Bank account numbers do not match. Re-enter both fields carefully.');
      return;
    }
    if (!profile?.mfaEnabled && !form.confirmSecurity) {
      setFormError('Check the security confirmation box before saving bank details.');
      return;
    }
    setSaving(true);
    try {
      const headers: Record<string, string> = {};
      if (profile?.mfaEnabled) {
        headers['X-MFA-Code'] = form.mfaCode.trim();
      } else {
        headers['X-Security-Confirm'] = 'CONFIRM_BANK_CHANGE';
      }

      if (editing) {
        const payload: Record<string, unknown> = {
          accountHolderName: form.accountHolderName,
          bankName: form.bankName,
          ifsc: form.ifsc.toUpperCase(),
          accountType: form.accountType,
          upiId: form.upiId,
          displayPayeeName: form.displayPayeeName,
          internalLabel: form.internalLabel,
        };
        if (trimmedAcct) {
          payload.accountNumber = trimmedAcct;
        }
        await apiRequest(`/admin/receiving-accounts/${editing.id}`, {
          method: 'PATCH',
          body: payload,
          headers,
        });
        setNotice(`Receiving account ${editing.accountCode} updated and audited.`);
      } else {
        await apiRequest('/admin/receiving-accounts', {
          method: 'POST',
          body: {
            accountHolderName: form.accountHolderName,
            bankName: form.bankName,
            accountNumber: trimmedAcct,
            ifsc: form.ifsc.toUpperCase(),
            accountType: form.accountType,
            upiId: form.upiId,
            displayPayeeName: form.displayPayeeName,
            internalLabel: form.internalLabel,
            activateImmediately: form.activateImmediately,
          },
          headers,
        });
        setNotice('Receiving account encrypted (AES-256-GCM) and saved.');
      }
      setModalOpen(false);
      await load();
      await refreshProfile();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save receiving account.');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activateTarget) return;
    setSaving(true);
    setFormError(null);
    try {
      const headers: Record<string, string> = profile?.mfaEnabled
        ? { 'X-MFA-Code': activateMfa.trim() }
        : { 'X-Security-Confirm': 'CONFIRM_BANK_CHANGE' };
      await apiRequest(`/admin/receiving-accounts/${activateTarget.id}/activate`, {
        method: 'POST',
        headers,
      });
      setNotice(`Active receiving UPI switched to ${activateTarget.upiId}.`);
      setActivateTarget(null);
      setActivateMfa('');
      await load();
      await refreshProfile();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleAttest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attestTarget) return;
    setSaving(true);
    setFormError(null);
    try {
      const headers: Record<string, string> = profile?.mfaEnabled
        ? { 'X-MFA-Code': attestMfa.trim() }
        : { 'X-Security-Confirm': 'CONFIRM_BANK_CHANGE' };
      await apiRequest(`/admin/receiving-accounts/${attestTarget.id}/attest`, {
        method: 'POST',
        body: { note: attestNote },
        headers,
      });
      setNotice(`Manual configuration check attested for ${attestTarget.accountCode}.`);
      setAttestTarget(null);
      setAttestNote('');
      setAttestMfa('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Attestation failed.');
    } finally {
      setSaving(false);
    }
  };

  const activeAcc = accounts.find((a) => a.isActive) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving Bank Accounts"
        description="Configure the authorised receiving UPI address and bank account used to generate customer payment URIs and QR codes."
        actions={
          isSuperAdmin ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Receiving Account</span>
            </button>
          ) : undefined
        }
      />

      <AlertBanner
        tone="warning"
        title="Important Verification Boundary"
        message="Saving an account number and UPI ID encrypts the account number at rest (AES-256-GCM) and masks it in all views, but does not establish live bank API connectivity. Never enter net-banking passwords, UPI PINs, or OTPs."
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No receiving bank account configured"
          description="ForgeX 4XPay starts empty with zero hardcoded bank data. Register your authorised business bank account and receiving UPI ID to enable customer UPI payment generation."
          action={
            isSuperAdmin ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                <span>Register First Receiving Account</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Active Receiving Account Spotlight */}
          {activeAcc && (
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-500 dark:text-slate-400">
                      {activeAcc.accountCode}
                    </span>
                    <StatusBadge status="ACTIVE" />
                    {activeAcc.internalLabel && (
                      <span className="text-slate-600 dark:text-slate-300">
                        · {activeAcc.internalLabel}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {activeAcc.displayPayeeName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span className="font-mono text-sm text-indigo-700 dark:text-indigo-400 font-semibold">
                      {activeAcc.upiId}
                    </span>
                    <CopyButton value={activeAcc.upiId} label="Copy UPI ID" />
                  </div>
                </div>

                {isSuperAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAttestTarget(activeAcc);
                        setAttestNote(activeAcc.manualCheckNote || '');
                        setFormError(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {activeAcc.manualCheckAttested
                          ? 'Update Manual Check'
                          : 'Attest Manual Check'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(activeAcc)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Account Holder</div>
                  <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                    {activeAcc.accountHolderName}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Bank & Type</div>
                  <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                    {activeAcc.bankName} · {activeAcc.accountType}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Account Number (Masked)</div>
                  <div className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {activeAcc.accountNumberMasked}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">IFSC Code</div>
                  <div className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {activeAcc.ifsc}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div>
                  Manual Configuration Check:{' '}
                  {activeAcc.manualCheckAttested ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      Attested on {formatUtcDateTime(activeAcc.manualCheckAttestedAt)} — “
                      {activeAcc.manualCheckNote}” (Manual check, not bank API)
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      Not yet attested via banking app
                    </span>
                  )}
                </div>
                <span className="font-mono tabular-nums">
                  Updated {formatUtcDateTime(activeAcc.updatedAt)}
                </span>
              </div>
            </div>
          )}

          {/* Bank-Neutral Account Cards Grid */}
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              All Registered Receiving Accounts ({accounts.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0">
                          <Landmark className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                            {acc.bankName} ({acc.accountType})
                          </div>
                          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {acc.accountCode} · {acc.accountNumberMasked}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={acc.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-slate-500 block">Receiving UPI</span>
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100 break-all">
                          {acc.upiId}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">IFSC Code</span>
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                          {acc.ifsc}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <span className={acc.manualCheckAttested ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-slate-500'}>
                      {acc.manualCheckAttested ? 'Manual Check Attested' : 'Manual Check Pending'}
                    </span>

                    {isSuperAdmin && (
                      <div className="flex items-center gap-2">
                        {!acc.isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setActivateTarget(acc);
                              setActivateMfa('');
                              setFormError(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                          >
                            <Power className="w-3 h-3" />
                            <span>Set Active</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(acc)}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Account Change Audit History */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Account Change History
          </h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-xs text-slate-500 dark:text-slate-400">
            No receiving account configuration events recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {history.map((h) => (
              <div
                key={h.id}
                className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                    {h.action}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600 dark:text-slate-400">{h.resourceId}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500 dark:text-slate-400">{h.actorEmail}</span>
                </div>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {formatUtcDateTime(h.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Receiving Account Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Receiving Account (${editing.accountCode})` : 'Register Receiving Account'}
        subtitle="Account numbers are encrypted server-side using AES-256-GCM and never exposed to customer endpoints."
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <AlertBanner tone="error" message={formError} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Account Holder Name
              </label>
              <input
                type="text"
                required
                value={form.accountHolderName}
                onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })}
                placeholder="Legal business or proprietor name"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bank Name
              </label>
              <input
                type="text"
                required
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="e.g. HDFC Bank, ICICI Bank, SBI"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Account Number {editing ? '(leave blank to keep existing)' : ''}
              </label>
              <input
                type="password"
                required={!editing}
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                placeholder="9–18 digits"
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Confirm Bank Account Number
              </label>
              <input
                type="password"
                required={!editing || Boolean(form.accountNumber.trim())}
                value={form.accountNumberConfirm}
                onChange={(e) => setForm({ ...form, accountNumberConfirm: e.target.value })}
                placeholder="Re-enter account number"
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                IFSC Code
              </label>
              <input
                type="text"
                required
                value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                placeholder="e.g. HDFC0001234"
                className="forge-input w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Account Type
              </label>
              <select
                value={form.accountType}
                onChange={(e) =>
                  setForm({ ...form, accountType: e.target.value as 'SAVINGS' | 'CURRENT' })
                }
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="CURRENT">Current Account</option>
                <option value="SAVINGS">Savings Account</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Receiving UPI ID (VPA)
              </label>
              <input
                type="text"
                required
                value={form.upiId}
                onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                placeholder="e.g. forgex@hdfcbank"
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Display Payee Name (UPI `pn`)
              </label>
              <input
                type="text"
                required
                value={form.displayPayeeName}
                onChange={(e) => setForm({ ...form, displayPayeeName: e.target.value })}
                placeholder="Shown in customer UPI app"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Internal Label (Optional)
              </label>
              <input
                type="text"
                value={form.internalLabel}
                onChange={(e) => setForm({ ...form, internalLabel: e.target.value })}
                placeholder="e.g. Primary Collection Account"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {!editing && (
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.activateImmediately}
                onChange={(e) => setForm({ ...form, activateImmediately: e.target.checked })}
              />
              <span>Activate immediately as the sole active UPI receiving account</span>
            </label>
          )}

          {/* Security Confirmation / MFA Gate */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            {profile?.mfaEnabled ? (
              <div>
                <label className="block text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  6-Digit MFA Authenticator Code (Required)
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={form.mfaCode}
                  onChange={(e) => setForm({ ...form, mfaCode: e.target.value })}
                  placeholder="000000"
                  className="forge-input w-40 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            ) : (
              <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.confirmSecurity}
                  onChange={(e) => setForm({ ...form, confirmSecurity: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  I confirm I am an authorised Super Admin modifying ForgeX receiving bank details, and this change will be permanently audited.
                </span>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Encrypting & Saving...' : editing ? 'Save Changes' : 'Register Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Activate Modal */}
      <Modal
        open={Boolean(activateTarget)}
        onClose={() => setActivateTarget(null)}
        title="Switch Active Receiving UPI Account"
        subtitle="All newly initiated customer UPI requests will route to this receiving address. Past attempts retain their original UPI snapshot."
      >
        <form onSubmit={handleActivate} className="space-y-4">
          {formError && <AlertBanner tone="error" message={formError} />}
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Activate <span className="font-mono font-semibold">{activateTarget?.upiId}</span> (
            {activateTarget?.bankName} {activateTarget?.accountNumberMasked})?
          </p>
          {profile?.mfaEnabled && (
            <div>
              <label className="block text-xs font-medium mb-1">6-Digit MFA Code</label>
              <input
                type="text"
                required
                maxLength={6}
                value={activateMfa}
                onChange={(e) => setActivateMfa(e.target.value)}
                className="forge-input w-40 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setActivateTarget(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Confirm Activation
            </button>
          </div>
        </form>
      </Modal>

      {/* Manual Configuration Check Attestation Modal */}
      <Modal
        open={Boolean(attestTarget)}
        onClose={() => setAttestTarget(null)}
        title="Manual Configuration Check Attestation"
        subtitle="This records that you verified the UPI ID and bank details directly inside your banking application. It is NOT an automated bank API verification."
      >
        <form onSubmit={handleAttest} className="space-y-4">
          {formError && <AlertBanner tone="error" message={formError} />}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Attestation Note
            </label>
            <textarea
              required
              rows={3}
              value={attestNote}
              onChange={(e) => setAttestNote(e.target.value)}
              placeholder="e.g. Sent ₹1 test transfer via BHIM and confirmed credit in corporate banking app."
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          {profile?.mfaEnabled && (
            <div>
              <label className="block text-xs font-medium mb-1">6-Digit MFA Code</label>
              <input
                type="text"
                required
                maxLength={6}
                value={attestMfa}
                onChange={(e) => setAttestMfa(e.target.value)}
                className="forge-input w-40 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAttestTarget(null)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Record Manual Attestation
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
