import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, FolderPlus, Users, Briefcase } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatInr, rupeesInputToPaise } from '../lib/format.ts';
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
} from '../components/ui/Primitives.tsx';

interface CustomerRow {
  id: string;
  customerRef: string;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  projectCount: number;
  totalContractPaise: number;
  verifiedPaidPaise: number;
  outstandingPaise: number;
}

interface ProjectRow {
  id: string;
  projectRef: string;
  customerId: string;
  customerRef: string;
  customerName: string;
  name: string;
  totalContractPaise: number;
  verifiedPaidPaise: number;
  outstandingPaise: number;
  progressPercent: number;
  status: string;
}

export function CustomersProjectsPage() {
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole('SUPER_ADMIN', 'ADMIN_HQ');
  const [tab, setTab] = useState<'customers' | 'projects'>('customers');
  const [query, setQuery] = useState('');
  const [customersList, setCustomersList] = useState<CustomerRow[]>([]);
  const [projectsList, setProjectsList] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);

  const [custModal, setCustModal] = useState(false);
  const [custForm, setCustForm] = useState({
    name: '',
    email: '',
    phone: '',
    companyName: '',
    linkCurrentUser: false,
  });

  const [projModal, setProjModal] = useState(false);
  const [projForm, setProjForm] = useState({
    customerId: '',
    name: '',
    description: '',
    totalContractRupees: '20000',
    advanceRupees: '5000',
    milestoneRupees: '10000',
    finalRupees: '5000',
    includeSchedule: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, pRes] = await Promise.all([
        apiRequest<{ customers: CustomerRow[] }>('/customers'),
        apiRequest<{ projects: ProjectRow[] }>('/projects'),
      ]);
      setCustomersList(cRes.customers);
      setProjectsList(pRes.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers & projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCustomers = useMemo(() => {
    if (!query.trim()) return customersList;
    const q = query.trim().toLowerCase();
    return customersList.filter(
      (c) =>
        c.customerRef.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.companyName || '').toLowerCase().includes(q)
    );
  }, [customersList, query]);

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projectsList;
    const q = query.trim().toLowerCase();
    return projectsList.filter(
      (p) =>
        p.projectRef.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q) ||
        p.customerRef.toLowerCase().includes(q)
    );
  }, [projectsList, query]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ customer: { customerRef: string } }>('/customers', {
        method: 'POST',
        body: custForm,
      });
      setNotice(`Customer ${res.customer.customerRef} registered.`);
      setCustModal(false);
      setCustForm({ name: '', email: '', phone: '', companyName: '', linkCurrentUser: false });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const totalContractPaise = rupeesInputToPaise(projForm.totalContractRupees);
      const schedule = [];
      if (projForm.includeSchedule) {
        const adv = rupeesInputToPaise(projForm.advanceRupees);
        const mil = rupeesInputToPaise(projForm.milestoneRupees);
        const fin = rupeesInputToPaise(projForm.finalRupees);
        if (adv > 0) schedule.push({ category: 'ADVANCE', title: 'Project Advance Payment', amountDuePaise: adv });
        if (mil > 0) schedule.push({ category: 'MILESTONE', title: 'Milestone Payment', amountDuePaise: mil });
        if (fin > 0) schedule.push({ category: 'FINAL', title: 'Final Delivery Payment', amountDuePaise: fin });
      }
      const res = await apiRequest<{ project: { projectRef: string } }>('/projects', {
        method: 'POST',
        body: {
          customerId: projForm.customerId,
          name: projForm.name,
          description: projForm.description,
          totalContractPaise,
          schedule,
        },
      });
      setNotice(`Project ${res.project.projectRef} created with authorised payment schedule.`);
      setProjModal(false);
      setTab('projects');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const customerProjects = selectedCustomer
    ? projectsList.filter((p) => p.customerId === selectedCustomer.id)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers & Projects"
        description="Admin HQ billing entities with distinct Customer IDs (FXC-*), Project IDs (FXPRJ-*), and authorised instalment schedules."
        actions={
          canCreate ? (
            <>
              <button
                type="button"
                onClick={() => setCustModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1424] hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Customer</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjForm((f) => ({ ...f, customerId: customersList[0]?.id || '' }));
                  setProjModal(true);
                }}
                disabled={customersList.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Create Project & Schedule</span>
              </button>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs<'customers' | 'projects'>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'customers', label: 'Customers', count: customersList.length },
            { id: 'projects', label: 'Projects', count: projectsList.length },
          ]}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={tab === 'customers' ? 'Search customer ID, name, or email...' : 'Search project ID, name, or client...'}
        />
      </div>

      {notice && <AlertBanner tone="success" message={notice} />}
      {error && <AlertBanner tone="error" message={error} />}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : tab === 'customers' ? (
        filteredCustomers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={customersList.length === 0 ? 'No customers registered yet' : 'No matching customers'}
            description="Register your first ForgeX client to assign projects, invoices, and UPI payment requests. Customer IDs (FXC-*) are permanently distinct from Payment IDs (FXPAY-*)."
            action={
              canCreate && customersList.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setCustModal(true)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Register First Customer
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {filteredCustomers.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedCustomer(c)}
                  className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-2 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-bold">{c.customerRef}</div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {c.name}
                      </div>
                      <div className="text-xs text-slate-500">{c.email}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono tabular-nums text-sm font-bold">
                        {formatInr(c.outstandingPaise)}
                      </div>
                      <div className="text-[11px] text-slate-500">Outstanding</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                      <th className="py-3 px-4 font-semibold">Customer ID</th>
                      <th className="py-3 px-4 font-semibold">Name · Contact</th>
                      <th className="py-3 px-4 font-semibold text-right">Projects</th>
                      <th className="py-3 px-4 font-semibold text-right">Contract Value</th>
                      <th className="py-3 px-4 font-semibold text-right">Verified Paid</th>
                      <th className="py-3 px-4 font-semibold text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredCustomers.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCustomer(c)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {c.customerRef}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {c.name} {c.companyName ? `· ${c.companyName}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {c.email} {c.phone ? `· ${c.phone}` : ''}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right">{c.projectCount}</td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                          {formatInr(c.totalContractPaise)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                          {formatInr(c.verifiedPaidPaise)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                          {formatInr(c.outstandingPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={projectsList.length === 0 ? 'No projects created yet' : 'No matching projects'}
          description="Create a project linked to a customer with an agreed total contract value and Advance / Milestone / Final payment schedule."
        />
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {filteredProjects.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProject(p)}
                className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl p-4 space-y-2 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-bold">{p.projectRef}</div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.customerName}</div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="flex justify-between text-xs font-mono pt-1">
                  <span>Contract: {formatInr(p.totalContractPaise)}</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Paid: {formatInr(p.verifiedPaidPaise)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 font-semibold">Project ID</th>
                    <th className="py-3 px-4 font-semibold">Project · Customer</th>
                    <th className="py-3 px-4 font-semibold text-right">Contract Value</th>
                    <th className="py-3 px-4 font-semibold text-right">Verified Paid</th>
                    <th className="py-3 px-4 font-semibold text-right">Remaining Balance</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredProjects.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedProject(p)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {p.projectRef}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {p.customerName} ({p.customerRef})
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right">
                        {formatInr(p.totalContractPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                        {formatInr(p.verifiedPaidPaise)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatInr(p.outstandingPaise)}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Customer Detail Drawer */}
      <DetailDrawer
        open={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.name || 'Customer Profile'}
        subtitle={
          selectedCustomer
            ? `${selectedCustomer.customerRef} · ${selectedCustomer.email}`
            : undefined
        }
        footer={
          selectedCustomer && (
            <CopyButton value={selectedCustomer.customerRef} label="Copy Customer ID" />
          )
        }
      >
        {selectedCustomer && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs">
              <div>
                <div className="text-slate-500">Total Contract</div>
                <div className="font-mono font-bold mt-1">{formatInr(selectedCustomer.totalContractPaise)}</div>
              </div>
              <div>
                <div className="text-slate-500">Verified Paid</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                  {formatInr(selectedCustomer.verifiedPaidPaise)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Outstanding</div>
                <div className="font-mono font-bold mt-1">{formatInr(selectedCustomer.outstandingPaise)}</div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Company</span>
                <span className="font-medium">{selectedCustomer.companyName || '—'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">Phone</span>
                <span className="font-mono">{selectedCustomer.phone || '—'}</span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                Linked Projects ({customerProjects.length})
              </h3>
              {customerProjects.length === 0 ? (
                <p className="text-xs text-slate-500">No projects assigned to this customer yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {customerProjects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold">{p.name}</div>
                        <div className="font-mono text-slate-500">{p.projectRef}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold">{formatInr(p.totalContractPaise)}</div>
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Project Detail Drawer */}
      <DetailDrawer
        open={Boolean(selectedProject)}
        onClose={() => setSelectedProject(null)}
        title={selectedProject?.name || 'Project Detail'}
        subtitle={
          selectedProject
            ? `${selectedProject.projectRef} · ${selectedProject.customerName}`
            : undefined
        }
        headerBadge={selectedProject && <StatusBadge status={selectedProject.status} />}
        footer={
          selectedProject && (
            <CopyButton value={selectedProject.projectRef} label="Copy Project ID" />
          )
        }
      >
        {selectedProject && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Collection Progress</span>
                <span className="font-mono font-semibold">{selectedProject.progressPercent}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, selectedProject.progressPercent))}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div>
                  <div className="text-slate-500">Contract</div>
                  <div className="font-mono font-bold">{formatInr(selectedProject.totalContractPaise)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Verified</div>
                  <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {formatInr(selectedProject.verifiedPaidPaise)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Remaining</div>
                  <div className="font-mono font-bold">{formatInr(selectedProject.outstandingPaise)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Add Customer Modal */}
      <Modal
        open={custModal}
        onClose={() => setCustModal(false)}
        title="Register Customer"
        subtitle="Generates a unique FXC-* Customer ID stored separately from invoices and payment attempts."
      >
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Full Name</label>
            <input
              type="text"
              required
              value={custForm.name}
              onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
              placeholder="Client full name"
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={custForm.email}
                onChange={(e) => setCustForm({ ...custForm, email: e.target.value })}
                placeholder="billing@client-domain.com"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Phone (Optional)</label>
              <input
                type="text"
                value={custForm.phone}
                onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
                placeholder="+91 ..."
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Company / Organization (Optional)</label>
            <input
              type="text"
              value={custForm.companyName}
              onChange={(e) => setCustForm({ ...custForm, companyName: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCustModal(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {submitting ? 'Saving...' : 'Register Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Project & Schedule Modal */}
      <Modal
        open={projModal}
        onClose={() => setProjModal(false)}
        title="Create Project & Payment Schedule"
        subtitle="Creates the project, authoritative invoice, and Advance / Milestone / Final payment requests atomically."
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Customer</label>
            <select
              required
              value={projForm.customerId}
              onChange={(e) => setProjForm({ ...projForm, customerId: e.target.value })}
              className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            >
              {customersList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerRef} — {c.name} ({c.email})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Project Name</label>
              <input
                type="text"
                required
                value={projForm.name}
                onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
                placeholder="e.g. Website Development"
                className="forge-input w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Total Contract Value (INR)</label>
              <input
                type="text"
                required
                value={projForm.totalContractRupees}
                onChange={(e) => setProjForm({ ...projForm, totalContractRupees: e.target.value })}
                className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={projForm.includeSchedule}
              onChange={(e) => setProjForm({ ...projForm, includeSchedule: e.target.checked })}
            />
            <span>Generate invoice and instalment payment schedule immediately</span>
          </label>

          {projForm.includeSchedule && (
            <div className="grid grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium mb-1">Advance (₹)</label>
                <input
                  type="text"
                  value={projForm.advanceRupees}
                  onChange={(e) => setProjForm({ ...projForm, advanceRupees: e.target.value })}
                  className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Milestone (₹)</label>
                <input
                  type="text"
                  value={projForm.milestoneRupees}
                  onChange={(e) => setProjForm({ ...projForm, milestoneRupees: e.target.value })}
                  className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Final (₹)</label>
                <input
                  type="text"
                  value={projForm.finalRupees}
                  onChange={(e) => setProjForm({ ...projForm, finalRupees: e.target.value })}
                  className="forge-input w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setProjModal(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
