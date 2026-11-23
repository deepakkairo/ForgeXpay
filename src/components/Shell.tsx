import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  ArrowLeftRight,
  FileSpreadsheet,
  QrCode,
  ShieldCheck,
  Landmark,
  Users,
  FileText,
  Receipt,
  AlertTriangle,
  KeyRound,
  ScrollText,
  Lock,
  Activity,
  Briefcase,
  Smartphone,
  Store,
  Bell,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  HelpCircle,
  ChevronDown,
  Shield,
} from 'lucide-react';
import { useAuth, RoleCode } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { formatUtcDateTime } from '../lib/format.ts';
import { BrandLogo } from './BrandLogo.tsx';
import {
  EmptyState,
  Modal,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
} from './ui/Primitives.tsx';

export { EmptyState, Modal, SkeletonRows };
export const StatusText = StatusBadge;

export type NavSection =
  | 'overview'
  | 'analytics'
  | 'transactions'
  | 'payment-requests'
  | 'qr-codes'
  | 'pending-verification'
  | 'receiving-accounts'
  | 'customers'
  | 'invoices'
  | 'receipts'
  | 'disputes'
  | 'api-credentials'
  | 'audit-logs'
  | 'security-settings'
  | 'system-health'
  | 'client-portal'
  | 'employee-hq'
  | 'merchant-console';

export interface NavItem {
  id: NavSection;
  label: string;
  breadcrumb: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Workspace' | 'Finance' | 'Management' | 'System' | 'Ecosystem Portals';
  roles: RoleCode[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    breadcrumb: 'Workspace / Overview',
    icon: LayoutDashboard,
    group: 'Workspace',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    breadcrumb: 'Workspace / Financial Analytics',
    icon: BarChart3,
    group: 'Workspace',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    breadcrumb: 'Workspace / Transactions',
    icon: ArrowLeftRight,
    group: 'Workspace',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'payment-requests',
    label: 'Payment Requests',
    breadcrumb: 'Workspace / Payment Requests',
    icon: FileSpreadsheet,
    group: 'Workspace',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'qr-codes',
    label: 'UPI QR Codes',
    breadcrumb: 'Workspace / UPI QR Code Manager',
    icon: QrCode,
    group: 'Workspace',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'pending-verification',
    label: 'Payment Verification',
    breadcrumb: 'Finance / Verification & Reconciliation',
    icon: ShieldCheck,
    group: 'Finance',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    breadcrumb: 'Finance / Invoices',
    icon: FileText,
    group: 'Finance',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'receipts',
    label: 'Receipts',
    breadcrumb: 'Finance / Verified Receipts',
    icon: Receipt,
    group: 'Finance',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'disputes',
    label: 'Disputes',
    breadcrumb: 'Finance / Missing Payments & Disputes',
    icon: AlertTriangle,
    group: 'Finance',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'customers',
    label: 'Customers & Projects',
    breadcrumb: 'Management / Customers & Projects',
    icon: Users,
    group: 'Management',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
  },
  {
    id: 'receiving-accounts',
    label: 'Receiving Accounts',
    breadcrumb: 'Management / Receiving Accounts',
    icon: Landmark,
    group: 'Management',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  },
  {
    id: 'api-credentials',
    label: 'API Credentials',
    breadcrumb: 'Management / API Credentials & Docs',
    icon: KeyRound,
    group: 'Management',
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    breadcrumb: 'System / Audit Logs',
    icon: ScrollText,
    group: 'System',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  },
  {
    id: 'security-settings',
    label: 'Security & Settings',
    breadcrumb: 'System / Security & Tax Settings',
    icon: Lock,
    group: 'System',
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'system-health',
    label: 'System Health',
    breadcrumb: 'System / Readiness & Health',
    icon: Activity,
    group: 'System',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  },
  {
    id: 'merchant-console',
    label: 'Merchant Console',
    breadcrumb: 'Ecosystem / Merchant Gateway Console',
    icon: Store,
    group: 'Ecosystem Portals',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'EMPLOYEE', 'CLIENT'],
  },
  {
    id: 'client-portal',
    label: 'Client App Portal',
    breadcrumb: 'Ecosystem / Client Payment Portal',
    icon: Smartphone,
    group: 'Ecosystem Portals',
    roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
  },
  {
    id: 'employee-hq',
    label: 'Employee HQ',
    breadcrumb: 'Ecosystem / Employee HQ (Restricted)',
    icon: Briefcase,
    group: 'Ecosystem Portals',
    roles: ['SUPER_ADMIN', 'ADMIN_HQ', 'EMPLOYEE'],
  },
];

interface NotificationItem {
  id: string;
  eventType: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export function Shell({
  active,
  onNavigate,
  children,
}: {
  active: NavSection;
  onNavigate: (section: NavSection) => void;
  children: React.ReactNode;
}) {
  const { profile, isSandboxSession, unreadNotifications, logout, refreshProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [notifList, setNotifList] = useState<NotificationItem[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isSandboxSession) return item.id === 'merchant-console';
    return profile ? item.roles.some((r) => profile.roles.includes(r)) : false;
  });

  const currentItem = visibleItems.find((i) => i.id === active) || visibleItems[0];
  const groups: Array<NavItem['group']> = [
    'Workspace',
    'Finance',
    'Management',
    'System',
    'Ecosystem Portals',
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setSearchTerm('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openNotifications = async () => {
    if (isSandboxSession) return;
    setNotifOpen(true);
    setNotifLoading(true);
    try {
      const data = await apiRequest<{ notifications: NotificationItem[] }>('/notifications');
      setNotifList(data.notifications);
    } catch {
      // handled silently
    } finally {
      setNotifLoading(false);
    }
  };

  const markOneRead = async (id: string) => {
    if (isSandboxSession) return;
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
      setNotifList((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      await refreshProfile();
    } catch {
      // silent
    }
  };

  const markAllRead = async () => {
    if (isSandboxSession) return;
    await apiRequest('/notifications/read-all', { method: 'POST' });
    setNotifList((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await refreshProfile();
  };

  const filteredNotifs =
    notifFilter === 'UNREAD' ? notifList.filter((n) => !n.isRead) : notifList;

  const quickJumpResults = visibleItems.filter((item) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      item.label.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q) ||
      item.breadcrumb.toLowerCase().includes(q)
    );
  });

  const renderSidebar = (isMobile = false) => {
    const compact = !isMobile && sidebarCollapsed;
    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#0D1424] border-r border-slate-200 dark:border-slate-800">
        <div className="h-[72px] px-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              onNavigate(visibleItems[0]?.id || 'overview');
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2 min-w-0 whitespace-nowrap"
            aria-label="Go to workspace home"
          >
            {compact ? (
              <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                4X
              </span>
            ) : (
              <BrandLogo size="sm" />
            )}
          </button>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
              title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {compact ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary navigation">
          {groups.map((group) => {
            const items = visibleItems.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {!compact && (
                  <div className="px-2.5 mb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                    {group}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={compact ? item.label : undefined}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => {
                          onNavigate(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center ${
                          compact ? 'justify-center px-2' : 'gap-2.5 px-2.5'
                        } py-2.5 rounded-xl text-[13px] font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {!compact && <span className="truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
          {compact ? (
            <div
              title={`${profile?.displayName} (${profile?.email})`}
              className="w-9 h-9 mx-auto rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center justify-center"
            >
              {(profile?.displayName || 'FX').slice(0, 2).toUpperCase()}
            </div>
          ) : (
            <div className="px-2 py-1.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {profile?.displayName}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {profile?.email}
              </div>
              <div className="mt-1 text-[11px] font-mono text-indigo-600 dark:text-indigo-400 truncate">
                {isSandboxSession ? 'MERCHANT CONSOLE' : profile?.roles.join(' · ')}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#060B16] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 sticky top-0 h-screen transition-all duration-200 ${
          sidebarCollapsed ? 'w-[74px]' : 'w-64'
        }`}
      >
        {renderSidebar(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full">{renderSidebar(true)}</div>
          <div
            className="flex-1 bg-slate-950/55 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[72px] sticky top-0 z-30 bg-white/95 dark:bg-[#0D1424]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
              <span className="truncate">{currentItem?.breadcrumb || '4XPay by ForgeX'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSearchOpen(true);
              }}
              aria-label="Quick navigation search"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Quick Jump</span>
              <kbd className="font-mono text-[10px] text-slate-400">⌘K</kbd>
            </button>

            {!isSandboxSession && (
              <button
                type="button"
                onClick={openNotifications}
                className="relative inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                aria-label="Open notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifications > 0 && (
                  <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                    {unreadNotifications}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              aria-label="Verification architecture guide"
              title="How 4XPay Verification Works"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
              >
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold flex items-center justify-center">
                  {(profile?.displayName || 'FX').slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden md:inline max-w-[120px] truncate">
                  {profile?.displayName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {accountOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setAccountOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 rounded-xl bg-white dark:bg-[#0D1424] border border-slate-200 dark:border-slate-800 shadow-lg p-3 z-40 space-y-2.5"
                  >
                    <div className="pb-2 border-b border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {profile?.displayName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {profile?.email}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <Shield className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        <span>
                          {isSandboxSession
                            ? 'Merchant Session'
                            : profile?.mfaEnabled
                              ? 'TOTP MFA Enabled'
                              : 'Standard Auth'}
                        </span>
                      </div>
                    </div>

                    {!isSandboxSession && visibleItems.some((i) => i.id === 'security-settings') && (
                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          onNavigate('security-settings');
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Security &amp; Tax Settings
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setAccountOpen(false);
                        void logout();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Quick Jump Modal */}
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Quick Navigation"
        subtitle="Jump directly to any authorised 4XPay workspace module."
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Type a module name..."
              className="forge-input w-full h-11 pl-9 pr-3 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl max-h-72 overflow-y-auto">
            {quickJumpResults.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">No matching pages.</div>
            ) : (
              quickJumpResults.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setSearchOpen(false);
                    }}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                      {item.group}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* Notifications Modal */}
      <Modal
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title="Notification Center"
        subtitle="Real event alerts across ForgeX 4XPay. Notification delivery never alters verified financial state."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SegmentedTabs<'ALL' | 'UNREAD'>
            value={notifFilter}
            onChange={setNotifFilter}
            options={[
              { id: 'ALL', label: 'All', count: notifList.length },
              {
                id: 'UNREAD',
                label: 'Unread',
                count: notifList.filter((n) => !n.isRead).length,
              },
            ]}
          />
          {notifList.some((n) => !n.isRead) && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        {notifLoading ? (
          <SkeletonRows rows={3} />
        ) : filteredNotifs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
            {notifFilter === 'UNREAD'
              ? 'All notifications are caught up.'
              : 'No notifications recorded yet.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {filteredNotifs.map((n) => (
              <div
                key={n.id}
                className={`p-4 transition-colors ${
                  n.isRead ? 'opacity-75' : 'bg-indigo-50/40 dark:bg-indigo-950/20'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {n.title}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {n.eventType} · {formatUtcDateTime(n.createdAt)}
                    </div>
                  </div>
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => void markOneRead(n.id)}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                    >
                      Mark read
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {n.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Truthful Verification Workflow Guide */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="4XPay Verification Architecture"
        subtitle="How direct UPI payments move from customer initiation to verified receipts."
      >
        <ol className="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <li className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              1. Unique Payment ID &amp; UPI QR Generation
            </div>
            <p className="mt-1">
              Each payment attempt mints a unique ForgeX Payment ID and embeds it as the NPCI UPI transaction reference (`tr`) pointing to your authorised receiving UPI ID.
            </p>
          </li>
          <li className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              2. Customer Payment Report ≠ Bank Verification
            </div>
            <p className="mt-1">
              When a customer returns from their UPI app or submits a UTR reference, the status updates to Awaiting Verification—never auto-marked Paid.
            </p>
          </li>
          <li className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              3. Authorised Finance HQ Bank Check &amp; Atomic Receipt
            </div>
            <p className="mt-1">
              An authorised Finance or Super Admin verifies the credit via banking app inspection or CSV bank statement import, then confirms to post the ledger entry and issue a signed PDF receipt.
            </p>
          </li>
        </ol>
      </Modal>
    </div>
  );
}
