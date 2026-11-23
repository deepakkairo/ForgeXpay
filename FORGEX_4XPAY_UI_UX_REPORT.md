# ForgeX 4XPay — UI/UX Architecture & Redesign Report

**Product:** ForgeX 4XPay (`4XPay by ForgeX`)  
**Scope:** Complete frontend UI/UX transformation across authentication, workspace shell, analytics, UPI QR checkout, manual bank-credit verification, billing documents, developer API console, and ecosystem portals — preserving 100% real backend Express/Drizzle APIs and Firebase Authentication.

---

## 1. Design System & Visual Tokens (`/src/index.css`)
- **Brand Identity:** Midnight Navy (`#101828` / `#080D1A`) paired with Electric Indigo (`#4F46E5` / `#3538CD`) primary actions and crisp `en-IN` tabular monospace figures (`JetBrains Mono`).
- **Typography:**
  - Headings: `Plus Jakarta Sans`
  - Body / UI Controls: `DM Sans`
  - Payment IDs, UTRs, IFSCs, UPI IDs & INR Amounts: `JetBrains Mono` with `tabular-nums`
- **Theme Support:** Full light (`#F8FAFC` canvas, `#FFFFFF` cards) and dark (`#080D1A` canvas, `#0D1424` cards) mode parity via Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *));`.
- **Accessibility & Print:**
  - Clear `:focus-visible` indigo focus rings across inputs and controls.
  - `@media (prefers-reduced-motion: reduce)` honors user motion preferences.
  - `@media print` `.no-print` rules support clean Invoice and Verified Receipt printing.
- **Branding Preservation:** Uses `/assets/aistudio/Screenshot_2026-11-20_141400_1e2e3f39.png` in `BrandLogo.tsx` and `/index.html` favicon without distortion or hardcoded overrides.

---

## 2. Reusable UI Primitives (`/src/components/ui/Primitives.tsx`) & Analytics (`/src/components/AnalyticsPanel.tsx`)
- `StatusBadge`: Semantic icon + text label indicator (never color-only, zero pill clutter).
- `PageHeader`: Standardized title, concise subtitle, optional kicker, and right-aligned action toolbar.
- `MetricCard`: Single-elevation summary block with INR tabular figures and interactive drill-down navigation.
- `AlertBanner`: Semantic success, warning, error, and info banners with accessible icons.
- `SegmentedTabs`, `SearchInput`, `CopyButton`, `EmptyState`, `SkeletonRows`.
- `Modal` & `DetailDrawer`: Escape-key accessible centered dialogs and desktop slide-over / mobile sheet inspection drawers.
- `Timeline`: Chronological payment and dispute lifecycle viewer.
- `VerifiedCollectionsChart` & `AnalyticsPage`: Dependency-free SVG area/line chart strictly tracking `VERIFIED` bank credits across Daily / Weekly / Monthly buckets, plus stage breakdowns (`ADVANCE`, `MILESTONE`, `FINAL`) and average verification turnaround.

---

## 3. Redesigned Pages & Connected API Endpoints

| Area | File | Key UX Enhancements | Connected Backend APIs |
| --- | --- | --- | --- |
| **Login Gate** | `/src/components/LoginGate.tsx` | Clean Midnight Navy + Electric Indigo auth card, zero demo/sandbox shortcuts, zero fake placeholders | Firebase Google/Email Auth + `/api/v1/auth/me` |
| **Workspace Shell** | `/src/components/Shell.tsx` | Collapsible desktop sidebar, mobile drawer, `Cmd/Ctrl+K` Quick Jump, Notification Center (`All \| Unread`), Verification Architecture help modal | `/api/v1/notifications`, `/api/v1/notifications/:id/read`, `/api/v1/notifications/read-all` |
| **Overview** | `/src/pages/OverviewPage.tsx` | Time-aware greeting, `DateRangeKey` filter (`Today`, `Last 7d`, `Last 30d`, `All Time`), 4-card financial grid, Verified Collections chart, Pending Attention queue, Quick Actions, Recent Attempts + Detail Drawer | `/api/v1/overview`, `/api/v1/transactions`, `/api/v1/settings` (role-gated) |
| **Analytics** | `/src/components/AnalyticsPanel.tsx` | Verified credits chart, Advance/Milestone/Final progress bars, turnaround metrics, lifecycle distribution | `/api/v1/transactions`, `/api/v1/invoices`, `/api/v1/disputes` |
| **Payment Requests & Transactions** | `/src/pages/PaymentRequestsTransactionsPage.tsx` | 4-step Payment Request Wizard, sortable INR & date columns, CSV export, mobile cards, `UpiCheckoutModal` with quiet-zone QR card + truthful awaiting screen, dedicated `UpiQrManagerPage` | `/api/v1/payment-requests`, `/api/v1/payment-requests/:id/attempts`, `/api/v1/transactions`, `/api/v1/payments/:ref/report-paid`, `/api/v1/payments/:ref/upi-qr` |
| **Verification Queue & Reconciliation** | `/src/pages/VerificationQueuePage.tsx` | Searchable queue, mobile cards, 3-section Case Review Drawer (`Payment Info`, `Customer Report`, `Bank Verification`), mandatory independent bank-history check checkbox before confirming credit, CSV statement import mapper | `/api/v1/verification-queue`, `/api/v1/verifications/:id/confirm`, `/api/v1/verifications/:id/reject`, `/api/v1/reconciliation/imports`, `/api/v1/reconciliation/matches` |
| **Invoices, Receipts & Disputes** | `/src/pages/InvoicesReceiptsDisputesPage.tsx` | Status filters, search, print-ready Invoice & Receipt Preview Drawers + signed PDF downloads, Dispute Timeline Drawer + Finance HQ investigation controls | `/api/v1/invoices`, `/api/v1/invoices/:id`, `/api/v1/receipts`, `/api/v1/disputes`, `/api/v1/disputes/:id` |
| **Receiving Bank Accounts** | `/src/pages/ReceivingAccountsPage.tsx` | Bank-neutral account cards with masked account numbers, IFSC, UPI copy controls, AES-256-GCM boundary disclosure, dual-entry `"Confirm Bank Account Number"` validation, manual attestation & change audit log | `/api/v1/admin/receiving-accounts`, `POST/PATCH/activate/attest` |
| **Customers & Projects** | `/src/pages/CustomersProjectsPage.tsx` | Search, segmented tabs, mobile cards, Customer & Project Detail Drawers with contract progress bars and project breakdowns | `/api/v1/customers`, `/api/v1/projects` |
| **API Keys, Docs, Audit & Governance** | `/src/pages/ApplicationsApiAuditPage.tsx` | Scoped server API key manager + interactive **API Documentation** tab (`X-4XPay-API-Key`, Payment Requests, Transactions, Verification, Receipts with clearly labeled synthetic cURL snippets), searchable Audit Logs + inspection drawer, TOTP MFA & Tax governance | `/api/v1/admin/applications`, `/api/v1/audit-logs`, `/api/v1/security/*`, `/api/v1/settings`, `/api/v1/health` |
| **Client & Employee Portals** | `/src/pages/ClientEmployeePortalsPage.tsx` | Customer preview selector, instalment progress bars, UPI checkout launch, missing-payment dispute submission, and redacted Employee HQ milestone view | `/api/v1/client/portal`, `/api/v1/employee/projects` |

---

## 4. Verification & Test Coverage
- **Automated Unit & Integration Tests (`npm test`):**
  - `src/lib/__tests__/upi.test.ts`: 5 passed (VPA validation, transaction ID validation, paise-to-INR conversion, `upi://pay` URI building, structured validation errors).
  - `src/lib/__tests__/format.test.ts`: 4 passed (INR formatting, rupee-to-paise parsing, status humanization, `filterByDateRange`).
  - `src/server/__tests__/4xpay.test.ts`: 14 passed (server-side state machine, RBAC, verification, reconciliation, encryption, receipts).
- **TypeScript & Vite Compilation:**
  - `tsc --noEmit` (`npm run lint`) and `vite build` (`compile_applet`) verified clean with zero errors.

---

## 5. Honest Version 1 Architectural Boundaries
- **No Automated Live Bank Feeds:** Generating a UPI QR link or receiving a customer-reported UTR does **not** prove funds settled. All payments remain in `AWAITING_PAYMENT`, `PAYMENT_REPORTED`, or `VERIFICATION_PENDING` until an authorised `FINANCE_ADMIN` or `SUPER_ADMIN` verifies settled bank records (manually or via CSV statement import).
- **No Pre-Seeded Connected Apps:** Connected applications remain empty until explicitly registered by an administrator.
- **No Unconfigured Tax Fabrication:** Invoices/receipts never invent GST numbers; tax behavior strictly reflects Admin configuration in Security & Tax Settings.
