import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Copy,
  Check,
  RotateCw,
  Ban,
  Shield,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Code2,
  ScrollText,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatUtcDateTime, rupeesInputToPaise } from '../lib/format.ts';
import { useAuth, RoleCode } from '../context/AuthContext.tsx';
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

interface AppCredential {
  id: string;
  applicationId: string;
  label: string;
  keyPrefix: string;
  scopes: string[];
  isRevoked: boolean;
  lastUsedAt: string | null;
  requestCount: number;
  failureCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface ConnectedApp {
  id: string;
  appCode: string;
  name: string;
  category: string;
  description: string;
  webhookUrl: string | null;
  isActive: boolean;
  activeCredentialCount: number;
  totalRequests: number;
  totalFailures: number;
  credentials: AppCredential[];
}

const AVAILABLE_SCOPES = [
  'overview:read',
  'customers:read',
  'customers:write',
  'projects:read',
  'projects:write',
  'invoices:read',
  'payment_requests:read',
  'payment_requests:write',
  'payments:initiate',
  'payments:read',
  'payments:report',
  'verification:read',
  'verification:confirm',
  'reconciliation:read',
  'reconciliation:write',
  'transactions:read',
  'receipts:read',
  'disputes:read',
  'disputes:write',
  'employee_projects:read',
  'client_portal:read',
];

const API_DOCS_SECTIONS = [
  {
    id: 'auth',
    title: 'Authentication Header (Server-to-Server Only)',
    endpoint: 'Header: X-4XPay-API-Key',
    description:
      'Pass your SHA-256-backed API key via X-4XPay-API-Key from trusted server backends only. Never expose API keys inside browser bundles or mobile APKs.',
    curl: `curl -X GET "https://your-4xpay-host/api/v1/overview" \\
  -H "X-4XPay-API-Key: fxp_example_synthetic_key_not_valid"`,
  },
  {
    id: 'payment-requests',
    title: 'Payment Request API',
    endpoint: 'POST /api/v1/payment-requests',
    description:
      'Create an authoritative Advance, Milestone, or Final INR payment request against an existing Project and Invoice.',
    curl: `curl -X POST "https://your-4xpay-host/api/v1/payment-requests" \\
  -H "Content-Type: application/json" \\
  -H "X-4XPay-API-Key: fxp_example_synthetic_key_not_valid" \\
  -d '{"projectId":"PROJECT_UUID","category":"MILESTONE","title":"Phase 2 Delivery","amountDuePaise":1500000}'`,
  },
  {
    id: 'transactions',
    title: 'Transaction Status API',
    endpoint: 'GET /api/v1/transactions?status=ALL',
    description:
      'Inspect payment attempt lifecycles (AWAITING_PAYMENT, PAYMENT_REPORTED, VERIFICATION_PENDING, VERIFIED).',
    curl: `curl -X GET "https://your-4xpay-host/api/v1/transactions?status=VERIFIED" \\
  -H "X-4XPay-API-Key: fxp_example_synthetic_key_not_valid"`,
  },
  {
    id: 'verification',
    title: 'Verification API',
    endpoint: 'POST /api/v1/verifications/:attemptId/confirm',
    description:
      'Confirm bank credit atomically after verifying settlement in bank records, minting ledger credit and verified receipt.',
    curl: `curl -X POST "https://your-4xpay-host/api/v1/verifications/ATTEMPT_UUID/confirm" \\
  -H "Content-Type: application/json" \\
  -H "X-4XPay-API-Key: fxp_example_synthetic_key_not_valid" \\
  -d '{"verifiedUtr":"432198765432","creditedAmountPaise":1500000,"bankTransactionDate":"2026-11-23","notes":"Confirmed in corporate statement"}'`,
  },
  {
    id: 'receipts',
    title: 'Receipt API',
    endpoint: 'GET /api/v1/receipts',
    description:
      'Fetch official verified payment receipts and authenticated PDF download paths. Unverified attempts never have receipts.',
    curl: `curl -X GET "https://your-4xpay-host/api/v1/receipts" \\
  -H "X-4XPay-API-Key: fxp_example_synthetic_key_not_valid"`,
  },
];

export function ConnectedAppsAndApiPage({ mode }: { mode: 'apps' | 'credentials' }) {
  const [subTab, setSubTab] = useState<'keys' | 'docs'>('keys');
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newAppOpen, setNewAppOpen] = useState(false);
  const [appForm, setAppForm] = useState({
    name: '',
    category: 'CUSTOM' as 'ADMIN_HQ' | 'FINANCE_HQ' | 'EMPLOYEE_HQ' | 'CLIENT_APP' | 'CUSTOM',
    description: '',
    webhookUrl: '',
  });

  const [newCredOpen, setNewCredOpen] = useState(false);
  const [credForm, setCredForm] = useState({
    applicationId: '',
    label: 'Production Backend Key',
    scopes: ['payment_requests:read', 'payments:read'] as string[],
    expiresInDays: 90,
  });

  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ applications: ConnectedApp[] }>('/admin/applications');
      setApps(res.applications);
      if (res.applications.length > 0 && !credForm.applicationId) {
        setCredForm((f) => ({ ...f, applicationId: res.applications[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API applications.');
    } finally {
      setLoading(false);
    }
  }, [credForm.applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRegisterApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ application: { appCode: string } }>('/admin/applications', {
        method: 'POST',
        body: appForm,
      });
      setNotice(`Registered application ${res.application.appCode}.`);
      setNewAppOpen(false);
      setAppForm({ name: '', category: 'CUSTOM', description: '', webhookUrl: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register application.');
    } finally {
      setSaving(false);
    }
  };

  const toggleApp = async (app: ConnectedApp) => {
    setError(null);
    try {
      await apiRequest(`/admin/applications/${app.id}`, {
        method: 'PATCH',
        body: { isActive: !app.isActive },
      });
      setNotice(`${app.name} ${app.isActive ? 'disabled' : 'enabled'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update application.');
    }
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ secretKeyShownOnce: string }>(
        `/admin/applications/${credForm.applicationId}/credentials`,
        {
          method: 'POST',
          body: {
            label: credForm.label,
            scopes: credForm.scopes,
            expiresInDays: Number(credForm.expiresInDays) || 90,
          },
        }
      );
      setRevealedSecret(res.secretKeyShownOnce);
      setNewCredOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate API credential.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (credId: string) => {
    setError(null);
    try {
      await apiRequest(`/admin/credentials/${credId}/revoke`, { method: 'POST' });
      setNotice('API credential revoked permanently.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revocation failed.');
    }
  };

  const handleRotate = async (credId: string) => {
    setError(null);
    try {
      const res = await apiRequest<{ secretKeyShownOnce: string }>(
        `/admin/credentials/${credId}/rotate`,
        { method: 'POST' }
      );
      setRevealedSecret(res.secretKeyShownOnce);
      setNotice('Old key revoked and replacement key generated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotation failed.');
    }
  };

  const allCredentials = apps.flatMap((a) =>
    a.credentials.map((c) => ({ ...c, appName: a.name, appCode: a.appCode }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'apps' ? 'Connected ForgeX Applications' : 'Central API Keys & Docs'}
        description={
          mode === 'apps'
            ? 'All ForgeX services integrate with this single central 4XPay backend over scoped server-to-server credentials.'
            : 'API keys are SHA-256 hashed at rest, displayed once upon creation, and intended strictly for trusted server backends (never browser bundles or mobile APKs).'
        }
        actions={
          mode === 'apps' ? (
            <button
              type="button"
              onClick={() => setNewAppOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Register Application</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setNewCredOpen(true)}
              disabled={apps.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Generate Scoped API Key</span>
            </button>
          )
        }
      />

      {mode === 'credentials' && (
        <SegmentedTabs<'keys' | 'docs'>
          value={subTab}
          onChange={setSubTab}
          options={[
            { id: 'keys', label: 'API Keys', count: allCredentials.length },
            { id: 'docs', label: 'API Documentation' },
          ]}
        />
      )}

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {/* Secret Key Shown Once Banner */}
      {revealedSecret && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 rounded-xl p-5 space-y-2">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Copy Your New Server API Key Now — It Will Never Be Shown Again
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono break-all">
              {revealedSecret}
            </code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(revealedSecret);
                setCopiedSecret(true);
                setTimeout(() => setCopiedSecret(false), 1800);
              }}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSecret ? 'Copied' : 'Copy Key'}</span>
            </button>
            <button
              type="button"
              onClick={() => setRevealedSecret(null)}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 ml-2"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Pass via HTTP header <code className="font-mono">X-4XPay-API-Key</code> from your trusted server backend only.
          </p>
        </div>
      )}

      {mode === 'credentials' && subTab === 'docs' ? (
        <div className="space-y-4">
          <AlertBanner
            tone="warning"
            title="Synthetic Documentation Examples"
            message="All curl commands below use synthetic placeholder tokens (fxp_example_synthetic_key_not_valid) and are non-functional examples. Never embed real keys in client code."
          />
          <div className="grid grid-cols-1 gap-4">
            {API_DOCS_SECTIONS.map((doc) => (
              <div
                key={doc.id}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {doc.title}
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-indigo-700 dark:text-indigo-400 font-semibold">
                    {doc.endpoint}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {doc.description}
                </p>
                <div className="relative rounded-xl bg-slate-950 text-slate-100 p-4 border border-slate-800">
                  <div className="flex items-center justify-between mb-2 text-[11px] font-mono text-slate-400">
                    <span>Synthetic cURL Example</span>
                    <CopyButton value={doc.curl} label="Copy cURL" />
                  </div>
                  <pre className="text-xs font-mono overflow-x-auto leading-relaxed">
                    <code>{doc.curl}</code>
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <SkeletonRows rows={4} />
      ) : mode === 'apps' ? (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-4 font-semibold">App Code</th>
                  <th className="py-3 px-4 font-semibold">Application · Category</th>
                  <th className="py-3 px-4 font-semibold text-right">Active Keys</th>
                  <th className="py-3 px-4 font-semibold text-right">Requests / Failures</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {apps.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4 font-mono font-semibold">{app.appCode}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {app.name} · {app.category}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {app.description}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                      {app.activeCredentialCount}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                      {app.totalRequests} /{' '}
                      <span className={app.totalFailures > 0 ? 'text-red-600 dark:text-red-400' : ''}>
                        {app.totalFailures}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={app.isActive ? 'ACTIVE' : 'CANCELLED'} />
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleApp(app)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {app.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : allCredentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={apps.length === 0 ? 'No connected applications configured' : 'No API keys issued yet'}
          description={
            apps.length === 0
              ? 'Connected ForgeX applications are not configured yet. Register an external application later when you are ready to issue scoped API credentials.'
              : 'Generate least-privilege, scoped API credentials for your connected server backends.'
          }
          action={
            apps.length > 0 ? (
              <button
                type="button"
                onClick={() => setNewCredOpen(true)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Generate First API Key
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
                  <th className="py-3 px-4 font-semibold">Key Prefix · Label</th>
                  <th className="py-3 px-4 font-semibold">Application</th>
                  <th className="py-3 px-4 font-semibold">Scopes</th>
                  <th className="py-3 px-4 font-semibold text-right">Usage / Fails</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {allCredentials.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-semibold">{c.keyPrefix}••••••••</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.label}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium">{c.appName}</div>
                      <div className="text-[11px] font-mono text-slate-500">{c.appCode}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {c.scopes.join(', ')}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                      {c.requestCount} / {c.failureCount}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={c.isRevoked ? 'REJECTED' : 'ACTIVE'} />
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                      {!c.isRevoked && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRotate(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <RotateCw className="w-3 h-3" />
                            <span>Rotate</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Revoke</span>
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

      {/* Register App Modal */}
      <Modal
        open={newAppOpen}
        onClose={() => setNewAppOpen(false)}
        title="Register ForgeX Application"
      >
        <form onSubmit={handleRegisterApp} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Application Name</label>
            <input
              type="text"
              required
              value={appForm.name}
              onChange={(e) => setAppForm({ ...appForm, name: e.target.value })}
              placeholder="e.g. ForgeX SaaS Billing Portal"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Category</label>
            <select
              value={appForm.category}
              onChange={(e) =>
                setAppForm({
                  ...appForm,
                  category: e.target.value as 'ADMIN_HQ' | 'FINANCE_HQ' | 'EMPLOYEE_HQ' | 'CLIENT_APP' | 'CUSTOM',
                })
              }
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="ADMIN_HQ">Admin HQ</option>
              <option value="FINANCE_HQ">Finance HQ</option>
              <option value="EMPLOYEE_HQ">Employee HQ</option>
              <option value="CLIENT_APP">Client App</option>
              <option value="CUSTOM">Future ForgeX App</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input
              type="text"
              value={appForm.description}
              onChange={(e) => setAppForm({ ...appForm, description: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNewAppOpen(false)}
              className="px-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Register
            </button>
          </div>
        </form>
      </Modal>

      {/* Generate Scoped Credential Modal */}
      <Modal
        open={newCredOpen}
        onClose={() => setNewCredOpen(false)}
        title="Generate Scoped Server API Key"
        subtitle="Select minimum required scopes. The secret is hashed with SHA-256 and shown once."
      >
        <form onSubmit={handleGenerateKey} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Target Application</label>
            <select
              required
              value={credForm.applicationId}
              onChange={(e) => setCredForm({ ...credForm, applicationId: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.appCode} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Key Label</label>
              <input
                type="text"
                required
                value={credForm.label}
                onChange={(e) => setCredForm({ ...credForm, label: e.target.value })}
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Expires In (Days)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={credForm.expiresInDays}
                onChange={(e) => setCredForm({ ...credForm, expiresInDays: Number(e.target.value) })}
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-2">Permitted Scopes</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              {AVAILABLE_SCOPES.map((sc) => {
                const checked = credForm.scopes.includes(sc);
                return (
                  <label key={sc} className="flex items-center gap-2 text-[11px] font-mono">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setCredForm((f) => ({
                          ...f,
                          scopes: checked
                            ? f.scopes.filter((x) => x !== sc)
                            : [...f.scopes, sc],
                        }))
                      }
                    />
                    <span>{sc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNewCredOpen(false)}
              className="px-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || credForm.scopes.length === 0}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Issue Key
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface AuditLogRow {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: string;
  createdAt: string;
}

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);

  useEffect(() => {
    apiRequest<{ logs: AuditLogRow[] }>('/audit-logs')
      .then((res) => setLogs(res.logs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        l.action.toLowerCase().includes(q) ||
        l.resourceId.toLowerCase().includes(q) ||
        l.resourceType.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q)
      );
    });
  }, [logs, statusFilter, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & Financial Audit Logs"
        description="Append-only trail for bank configuration changes, verification approvals, RBAC denials, and API credential lifecycle. Sensitive account numbers and secrets are automatically redacted."
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All Events', count: logs.length },
            { id: 'SUCCESS', label: 'Success' },
            { id: 'DENIED', label: 'Denied' },
          ]}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search action, resource ID, or actor email..."
        />
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={logs.length === 0 ? 'No audit events yet' : 'No matching audit events'}
          description="Every sensitive operation across ForgeX 4XPay is recorded here."
        />
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((l) => (
              <div
                key={l.id}
                onClick={() => setSelectedLog(l)}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-1.5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 break-all">
                    {l.action}
                  </span>
                  <StatusBadge status={l.status} />
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {l.resourceType} · {l.resourceId}
                </div>
                <div className="text-[11px] text-slate-500 flex justify-between">
                  <span>{l.actorEmail}</span>
                  <span>{formatUtcDateTime(l.createdAt)}</span>
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
                    <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                    <th className="py-3 px-4 font-semibold">Action</th>
                    <th className="py-3 px-4 font-semibold">Resource</th>
                    <th className="py-3 px-4 font-semibold">Actor · Role</th>
                    <th className="py-3 px-4 font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filtered.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedLog(l)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatUtcDateTime(l.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {l.action}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {l.resourceType} · {l.resourceId}
                      </td>
                      <td className="py-3 px-4">
                        <span>{l.actorEmail}</span>{' '}
                        <span className="font-mono text-[11px] text-slate-500">({l.actorRole})</span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={l.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <DetailDrawer
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={selectedLog?.action || 'Audit Event'}
        subtitle={selectedLog ? formatUtcDateTime(selectedLog.createdAt) : undefined}
        headerBadge={selectedLog && <StatusBadge status={selectedLog.status} />}
      >
        {selectedLog && (
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Event ID</span>
              <span className="font-mono">{selectedLog.id}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Actor Email</span>
              <span className="font-medium">{selectedLog.actorEmail}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Actor Role</span>
              <span className="font-mono">{selectedLog.actorRole}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Resource Type</span>
              <span className="font-mono">{selectedLog.resourceType}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">Resource Identifier</span>
              <span className="font-mono font-semibold">{selectedLog.resourceId}</span>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

interface SecurityUser {
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  roles: RoleCode[];
}

export function SecuritySettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const [usersList, setUsersList] = useState<SecurityUser[]>([]);
  const [bp, setBp] = useState({
    legalName: 'ForgeX',
    address: '',
    email: '',
    taxRegime: 'UNCONFIGURED' as 'UNCONFIGURED' | 'NON_GST' | 'GST',
    gstin: '',
    taxNote: '',
  });
  const [policy, setPolicy] = useState({
    dualApprovalRupees: '50000',
    qrExpiryMinutes: 30,
    maxDisputesPerAttempt: 2,
  });
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [uRes, sRes] = await Promise.all([
        apiRequest<{ users: SecurityUser[] }>('/security/users'),
        apiRequest<{
          business_profile?: typeof bp;
          payment_policy?: {
            dualApprovalThresholdPaise: number;
            qrExpiryMinutes: number;
            maxDisputesPerAttempt: number;
          };
        }>('/settings'),
      ]);
      setUsersList(uRes.users);
      if (sRes.business_profile) setBp(sRes.business_profile);
      if (sRes.payment_policy) {
        setPolicy({
          dualApprovalRupees: String(Math.floor(sRes.payment_policy.dualApprovalThresholdPaise / 100)),
          qrExpiryMinutes: sRes.payment_policy.qrExpiryMinutes,
          maxDisputesPerAttempt: sRes.payment_policy.maxDisputesPerAttempt,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security settings.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startMfa = async () => {
    setError(null);
    const res = await apiRequest<{ secret: string; qrDataUrl: string }>('/security/mfa/setup', {
      method: 'POST',
    });
    setMfaSetup(res);
  };

  const enableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/security/mfa/enable', { method: 'POST', body: { code: mfaCode } });
      setMfaSetup(null);
      setMfaCode('');
      setNotice('TOTP Multi-Factor Authentication enabled for privileged operations.');
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid TOTP code.');
    }
  };

  const disableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/security/mfa/disable', { method: 'POST', body: { code: mfaCode } });
      setMfaCode('');
      setNotice('MFA disabled.');
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable MFA.');
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/settings', {
        method: 'PATCH',
        body: {
          businessProfile: bp,
          paymentPolicy: {
            dualApprovalThresholdPaise: rupeesInputToPaise(policy.dualApprovalRupees),
            qrExpiryMinutes: Number(policy.qrExpiryMinutes),
            maxDisputesPerAttempt: Number(policy.maxDisputesPerAttempt),
          },
        },
      });
      setNotice('Business legal/tax profile and verification policies saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const toggleUserRole = async (user: SecurityUser, role: RoleCode) => {
    const has = user.roles.includes(role);
    const nextRoles = has ? user.roles.filter((r) => r !== role) : [...user.roles, role];
    if (nextRoles.length === 0) return;
    try {
      await apiRequest(`/security/users/${user.id}/roles`, {
        method: 'POST',
        body: { roles: nextRoles },
      });
      setNotice(`Updated roles for ${user.email}.`);
      await load();
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update roles.');
    }
  };

  const ALL_ROLES: RoleCode[] = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'EMPLOYEE', 'CLIENT'];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security, Tax & Governance Settings"
        description="Manage TOTP MFA for privileged bank configuration changes, RBAC role assignments, dual-approval thresholds, and explicit GST/tax disclosure."
      />

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {/* TOTP MFA Card */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Multi-Factor Authentication (RFC 6238 TOTP)</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Required on receiving bank account updates once enabled.
              </p>
            </div>
          </div>
          <StatusBadge status={profile?.mfaEnabled ? 'ACTIVE' : 'PENDING'} />
        </div>

        {!profile?.mfaEnabled && !mfaSetup && (
          <button
            type="button"
            onClick={startMfa}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Set Up Authenticator App
          </button>
        )}

        {mfaSetup && (
          <form onSubmit={enableMfa} className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="flex flex-col items-center border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white">
              <img src={mfaSetup.qrDataUrl} alt="TOTP MFA QR Code" className="w-44 h-44" />
              <div className="mt-2 text-[11px] font-mono text-slate-600 break-all text-center">
                Secret: {mfaSetup.secret}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Scan the QR code in Google Authenticator, Authy, or 1Password, then enter the 6-digit code below to activate MFA.
              </p>
              <input
                type="text"
                required
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456"
                className="forge-input w-40 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Verify & Activate MFA
                </button>
              </div>
            </div>
          </form>
        )}

        {profile?.mfaEnabled && (
          <form onSubmit={disableMfa} className="flex flex-wrap items-center gap-3 pt-2">
            <input
              type="text"
              required
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="Current 6-digit code"
              className="forge-input w-44 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400"
            >
              Disable MFA
            </button>
          </form>
        )}
      </div>

      {/* Business Legal Identity, Explicit Tax Profile & Dual-Approval Policy */}
      <form
        onSubmit={saveSettings}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-6 space-y-5"
      >
        <div>
          <h2 className="text-sm font-semibold">Business Legal Identity, Tax Configuration & Policies</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            ForgeX 4XPay never invents tax registration details. Leave GSTIN blank unless registered.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Business Legal Name</label>
            <input
              type="text"
              required
              value={bp.legalName}
              onChange={(e) => setBp({ ...bp, legalName: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Tax Treatment</label>
            <select
              value={bp.taxRegime}
              onChange={(e) =>
                setBp({ ...bp, taxRegime: e.target.value as 'UNCONFIGURED' | 'NON_GST' | 'GST' })
              }
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              <option value="UNCONFIGURED">Unconfigured (Non-tax receipts only)</option>
              <option value="NON_GST">Non-GST Registered Entity</option>
              <option value="GST">GST Registered (Requires valid GSTIN)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">GSTIN (Only if GST Registered)</label>
            <input
              type="text"
              value={bp.gstin}
              disabled={bp.taxRegime !== 'GST'}
              onChange={(e) => setBp({ ...bp, gstin: e.target.value.toUpperCase() })}
              placeholder="15-char GSTIN"
              className="forge-input w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Business Address</label>
            <input
              type="text"
              value={bp.address}
              onChange={(e) => setBp({ ...bp, address: e.target.value })}
              placeholder="Registered office address"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Dual-Approval Verification Threshold (INR)
            </label>
            <input
              type="text"
              value={policy.dualApprovalRupees}
              onChange={(e) => setPolicy({ ...policy, dualApprovalRupees: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">UPI QR Validity Window (Minutes)</label>
            <input
              type="number"
              min={5}
              max={1440}
              value={policy.qrExpiryMinutes}
              onChange={(e) => setPolicy({ ...policy, qrExpiryMinutes: Number(e.target.value) })}
              className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>

      {/* RBAC Role Assignment Matrix */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold">Server-Enforced RBAC User Roles</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-4 font-semibold">MFA</th>
                {ALL_ROLES.map((r) => (
                  <th key={r} className="py-3 px-3 font-semibold text-center font-mono text-[11px]">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {usersList.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 px-4">
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {u.mfaEnabled ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">On</span>
                    ) : (
                      <span className="text-slate-400">Off</span>
                    )}
                  </td>
                  {ALL_ROLES.map((role) => (
                    <td key={role} className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={u.roles.includes(role)}
                        onChange={() => toggleUserRole(u, role)}
                        aria-label={`Assign ${role} to ${u.email}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface HealthData {
  status: string;
  service: string;
  timestampUtc: string;
  activeReceivingAccountConfigured: boolean;
  encryptionKeyConfigured: boolean;
  uptimeSeconds: number;
}

export function SystemHealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<HealthData>('/health')
      .then(setHealth)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonRows rows={4} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health & Production Readiness"
        description="Operational readiness checklist and explicit Version 1 banking boundary disclosure."
      />

      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
        {[
          {
            label: 'Core 4XPay Service',
            ok: health?.status === 'HEALTHY',
            detail: health ? `Status: ${health.status} · Uptime ${health.uptimeSeconds}s` : 'Unavailable',
          },
          {
            label: 'Active Receiving UPI Account',
            ok: Boolean(health?.activeReceivingAccountConfigured),
            detail: health?.activeReceivingAccountConfigured
              ? 'An active receiving UPI account is configured.'
              : 'Not configured yet. Configure in Receiving Accounts before accepting payments.',
          },
          {
            label: 'Dedicated Production AES-256-GCM Key (BANK_ENCRYPTION_KEY)',
            ok: Boolean(health?.encryptionKeyConfigured),
            detail: health?.encryptionKeyConfigured
              ? 'Dedicated 32-byte encryption key loaded from environment secrets.'
              : 'Using non-production derived fallback key. Set 64-hex-char BANK_ENCRYPTION_KEY in Secrets before production cutover.',
          },
          {
            label: 'Zero Third-Party Gateway / Zero Fabricated Bank APIs',
            ok: true,
            detail:
              'Version 1 uses native UPI linking URIs + QR generation with Authorised Manual Bank Verification and CSV Bank Statement Reconciliation only.',
          },
        ].map((item) => (
          <div key={item.label} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {item.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {item.label}
                </div>
                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {item.detail}
                </div>
              </div>
            </div>
            <StatusBadge status={item.ok ? 'HEALTHY' : 'PENDING'} />
          </div>
        ))}
      </div>
    </div>
  );
}
