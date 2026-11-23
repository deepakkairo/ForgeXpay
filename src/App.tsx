import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { AuthPortal } from './components/AuthPortal.tsx';
import { AnalyticsPage } from './components/AnalyticsPanel.tsx';
import { Shell, NavSection, NAV_ITEMS } from './components/Shell.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { ReceivingAccountsPage } from './pages/ReceivingAccountsPage.tsx';
import { CustomersProjectsPage } from './pages/CustomersProjectsPage.tsx';
import {
  PaymentRequestsPage,
  TransactionsPage,
  UpiQrManagerPage,
} from './pages/PaymentRequestsTransactionsPage.tsx';
import { VerificationQueuePage } from './pages/VerificationQueuePage.tsx';
import {
  InvoicesPage,
  ReceiptsPage,
  DisputesPage,
} from './pages/InvoicesReceiptsDisputesPage.tsx';
import {
  ConnectedAppsAndApiPage,
  AuditLogsPage,
  SecuritySettingsPage,
  SystemHealthPage,
} from './pages/ApplicationsApiAuditPage.tsx';
import {
  ClientPortalPage,
  EmployeeHqPage,
} from './pages/ClientEmployeePortalsPage.tsx';
import { MerchantConsolePage } from './pages/MerchantConsolePage.tsx';

function AuthenticatedWorkspace() {
  const { profile, isSandboxSession, loading } = useAuth();
  const [section, setSection] = useState<NavSection>('overview');

  useEffect(() => {
    if (!profile) return;
    if (isSandboxSession) {
      if (section !== 'merchant-console') {
        setSection('merchant-console');
      }
      return;
    }
    const allowed = NAV_ITEMS.filter((i) => i.roles.some((r) => profile.roles.includes(r)));
    if (allowed.length > 0 && !allowed.some((i) => i.id === section)) {
      setSection(allowed[0].id);
    }
  }, [profile, isSandboxSession, section]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Loading forgeXPay session...
        </div>
      </div>
    );
  }

  if (!profile) {
    return <AuthPortal />;
  }

  const renderPage = () => {
    switch (section) {
      case 'overview':
        return <OverviewPage onNavigate={setSection} />;
      case 'analytics':
        return <AnalyticsPage />;
      case 'transactions':
        return <TransactionsPage />;
      case 'payment-requests':
        return <PaymentRequestsPage />;
      case 'qr-codes':
        return <UpiQrManagerPage />;
      case 'pending-verification':
        return <VerificationQueuePage />;
      case 'receiving-accounts':
        return <ReceivingAccountsPage />;
      case 'customers':
        return <CustomersProjectsPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'receipts':
        return <ReceiptsPage />;
      case 'disputes':
        return <DisputesPage />;
      case 'api-credentials':
        return <ConnectedAppsAndApiPage mode="credentials" />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'security-settings':
        return <SecuritySettingsPage />;
      case 'system-health':
        return <SystemHealthPage />;
      case 'merchant-console':
        return <MerchantConsolePage />;
      case 'client-portal':
        return <ClientPortalPage />;
      case 'employee-hq':
        return <EmployeeHqPage />;
      default:
        return <OverviewPage onNavigate={setSection} />;
    }
  };

  return (
    <Shell active={section} onNavigate={setSection}>
      {renderPage()}
    </Shell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthenticatedWorkspace />
      </AuthProvider>
    </ThemeProvider>
  );
}
