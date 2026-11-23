# ForgeX 4XPay

**ForgeX 4XPay** is a standalone, self-hosted UPI payment collection, hybrid verification, invoicing, CSV bank statement reconciliation, and central API management platform for the ForgeX software ecosystem (Admin HQ, Finance HQ, Employee HQ, and Client Application).

> **Important Scope & Compliance Notice:** Version 1 uses no commercial payment gateway SDKs (no Razorpay, Cashfree, or PayU) and performs no unauthorised bank automation or real-time bank balance/credit polling. Actual money movement occurs strictly through the customer's installed UPI application and the UPI banking network. Funds are marked `VERIFIED` exclusively through **Authorised Manual Bank Verification** or **CSV Bank Statement Reconciliation**.

## Architecture

- **Backend**: Modular Express + TypeScript REST API (`/api/v1/*`) with Zod request validation, AES-256-GCM bank account encryption, RFC 6238 TOTP MFA, SHA-256 scoped API keys, HMAC expiring PDF download links, and an append-only sanitized audit log.
- **Database**: PostgreSQL (Cloud SQL) managed via Drizzle ORM (`src/db/schema.ts`, 22 relational tables), storing all money strictly as integer paise (`bigint`), UUID primary keys, unique human-readable references (`FXC-*`, `FXPR-*`, `FXINV-*`, `FXREQ-*`, `FXPAY-*`, `FXRCPT-*`, `FXLED-*`, `FXDSP-*`), and UTC timestamps.
- **Frontend**: React + TypeScript + Tailwind CSS (Light & Dark dual-theme) featuring all 14 Super Admin dashboard views plus the Client Payment Portal and server-scoped Employee HQ view.

## Environment Variables

See `.env.example`. Configure secrets strictly outside source control:
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` (runtime app user)
- `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` (schema migrations via Drizzle Kit)
- `BANK_ENCRYPTION_KEY` (64-character hex 32-byte AES-256-GCM key)
- `RECEIPT_SIGNING_SECRET` (HMAC-SHA256 signing secret for expiring PDF tokens)
- `DUAL_APPROVAL_THRESHOLD_PAISE` (default `5000000` = ₹50,000)

## Scripts

- `npm run dev` — Start full-stack Express + Vite dev server on port `3000`
- `npm run build` — Build production frontend bundle
- `npm run lint` — TypeScript strict type-checking (`tsc --noEmit`)
- `npm test` — Execute Vitest automated test suite covering Payment Identity, AES-256-GCM/TOTP/API Key crypto, UPI URI & QR generation, Payment State Machine guards, and Bank Statement Reconciliation

## Production Readiness Checklist

1. Set a dedicated 32-byte `BANK_ENCRYPTION_KEY` and `RECEIPT_SIGNING_SECRET` in environment secrets.
2. Enable TOTP MFA in **Security Settings** for all `SUPER_ADMIN` accounts.
3. Register your real receiving bank account & UPI ID in **Settings → Payment Configuration → Receiving Accounts**, perform a manual check in your banking application, and record the Manual Configuration Check attestation.
4. Configure legal business identity and explicit GST/Non-GST tax treatment in **Security Settings** prior to issuing tax invoices.
5. Schedule encrypted daily PostgreSQL backups (`pg_dump --format=custom`) and verify restore procedures (`pg_restore`) in a staging database before cutover.
