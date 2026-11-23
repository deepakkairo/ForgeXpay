import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Copy,
  Check,
  Download,
  ExternalLink,
  RotateCcw,
  FileCode2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { buildUpiDeepLink, UpiDeepLinkParams } from '../lib/upi.ts';
import { formatInr } from '../lib/format.ts';
import { Modal } from './Shell.tsx';

export interface UpiDeepLinkQrCardProps extends UpiDeepLinkParams {
  /** QR pixel width for PNG generation (default: 320) */
  qrSize?: number;
  /** Show the raw encoded `upi://pay?...` deep-link string (default: true) */
  showUriPreview?: boolean;
  /** Show action buttons for Open App, Copy URI, Download PNG/SVG (default: true) */
  showActions?: boolean;
  /** Optional subtitle or context badge shown above the QR */
  contextLabel?: string;
  /** Optional callback whenever the generated URI changes */
  onUriChange?: (uri: string | null) => void;
  className?: string;
}

/**
 * Reusable utility component that generates and renders an NPCI UPI deep-link QR code
 * directly from payment parameters (VPA, payee name, amount, transaction ID, and note).
 */
export function UpiDeepLinkQrCard({
  vpa,
  payeeName = 'ForgeX 4XPay',
  amountPaise,
  amountRupees,
  transactionId,
  transactionNote,
  merchantCode,
  currency = 'INR',
  qrSize = 320,
  showUriPreview = true,
  showActions = true,
  contextLabel,
  onUriChange,
  className = '',
}: UpiDeepLinkQrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'uri' | 'vpa' | 'tr' | null>(null);

  const linkResult = useMemo(
    () =>
      buildUpiDeepLink({
        vpa,
        payeeName,
        amountPaise,
        amountRupees,
        transactionId,
        transactionNote,
        merchantCode,
        currency,
      }),
    [vpa, payeeName, amountPaise, amountRupees, transactionId, transactionNote, merchantCode, currency]
  );

  useEffect(() => {
    onUriChange?.(linkResult.uri);
  }, [linkResult.uri, onUriChange]);

  useEffect(() => {
    let cancelled = false;

    if (!linkResult.uri) {
      setQrDataUrl(null);
      setQrSvg(null);
      setRenderError(null);
      return;
    }

    const uri = linkResult.uri;
    setRenderError(null);

    Promise.all([
      QRCode.toDataURL(uri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: qrSize,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      }),
      QRCode.toString(uri, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: qrSize,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      }),
    ])
      .then(([dataUrl, svgStr]) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrSvg(svgStr);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrSvg(null);
          setRenderError(err instanceof Error ? err.message : 'Unable to encode UPI QR code.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [linkResult.uri, qrSize]);

  const copyValue = async (target: 'uri' | 'vpa' | 'tr', text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget((cur) => (cur === target ? null : cur)), 1800);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  const downloadPng = () => {
    if (!qrDataUrl) return;
    const safeId = (transactionId.trim() || 'UPI').replace(/[^A-Za-z0-9._-]/g, '_');
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${safeId}-UPI-QR.png`;
    a.click();
  };

  const downloadSvg = () => {
    if (!qrSvg) return;
    const safeId = (transactionId.trim() || 'UPI').replace(/[^A-Za-z0-9._-]/g, '_');
    const blob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeId}-UPI-QR.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const validationErrors = Object.values(linkResult.errors).filter(Boolean);
  const isOverStandardUpiCap =
    linkResult.normalizedAmountPaise !== null && linkResult.normalizedAmountPaise > 10_000_000;

  return (
    <div
      className={`border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 rounded-lg p-5 flex flex-col items-center ${className}`}
    >
      {contextLabel && (
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {contextLabel}
        </div>
      )}

      <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
        {linkResult.normalizedAmountPaise && linkResult.normalizedAmountPaise > 0
          ? formatInr(linkResult.normalizedAmountPaise)
          : '₹0.00'}
      </div>

      {isOverStandardUpiCap && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 text-center">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Exceeds standard ₹1,00,000 per-transaction UPI P2P/merchant limit.</span>
        </div>
      )}

      {/* QR Surface */}
      <div className="mt-4 bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
        {qrDataUrl && linkResult.uri ? (
          <img
            src={qrDataUrl}
            alt={`UPI deep-link QR code for ${transactionId}`}
            className="w-48 h-48 sm:w-52 sm:h-52 object-contain block"
          />
        ) : (
          <div className="w-48 h-48 sm:w-52 sm:h-52 flex flex-col items-center justify-center text-center p-4 bg-slate-50 rounded border border-dashed border-slate-300">
            <QrCode className="w-8 h-8 text-slate-400 mb-2" />
            <p className="text-xs font-medium text-slate-700">
              {renderError || 'Complete required UPI fields'}
            </p>
            {validationErrors.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                {validationErrors[0]}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Key Metadata Strip */}
      <div className="mt-4 w-full space-y-1.5 text-xs border-t border-slate-200 dark:border-slate-800 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">Payee VPA</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
              {vpa.trim() || '—'}
            </span>
            {vpa.trim() && (
              <button
                type="button"
                onClick={() => copyValue('vpa', vpa.trim())}
                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                title="Copy VPA"
                aria-label="Copy VPA"
              >
                {copiedTarget === 'vpa' ? (
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">Transaction ID</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
              {transactionId.trim() || '—'}
            </span>
            {transactionId.trim() && (
              <button
                type="button"
                onClick={() => copyValue('tr', transactionId.trim())}
                className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                title="Copy Transaction ID"
                aria-label="Copy Transaction ID"
              >
                {copiedTarget === 'tr' ? (
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Deep-Link URI Preview */}
      {showUriPreview && linkResult.uri && (
        <div className="mt-3 w-full">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Encoded UPI Deep-Link URI
            </span>
            <button
              type="button"
              onClick={() => copyValue('uri', linkResult.uri!)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              {copiedTarget === 'uri' ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Copied Link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
          <code className="block w-full px-2.5 py-2 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 break-all leading-relaxed select-all">
            {linkResult.uri}
          </code>
        </div>
      )}

      {/* Action Buttons */}
      {showActions && (
        <div className="mt-4 w-full space-y-2">
          {linkResult.uri ? (
            <a
              href={linkResult.uri}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in UPI App</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 opacity-40 cursor-not-allowed"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in UPI App</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!qrDataUrl}
              onClick={downloadPng}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG</span>
            </button>
            <button
              type="button"
              disabled={!qrSvg}
              onClick={downloadSvg}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>SVG</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface UpiQrPreset {
  requestId?: string;
  requestRef?: string;
  customerName?: string;
  projectName?: string;
  vpa: string;
  payeeName: string;
  amountRupees: string;
  transactionId: string;
  transactionNote: string;
  merchantCode?: string;
}

/**
 * Interactive modal utility for generating and inspecting UPI deep-link QR codes
 * from Payment Request parameters (VPA, amount, transaction ID, note).
 */
export function UpiQrGeneratorModal({
  open,
  onClose,
  preset,
  onMintOfficialAttempt,
}: {
  open: boolean;
  onClose: () => void;
  preset: UpiQrPreset | null;
  onMintOfficialAttempt?: (requestId: string) => void;
}) {
  const [vpa, setVpa] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [transactionNote, setTransactionNote] = useState('');
  const [merchantCode, setMerchantCode] = useState('');

  useEffect(() => {
    if (open && preset) {
      setVpa(preset.vpa);
      setPayeeName(preset.payeeName);
      setAmountRupees(preset.amountRupees);
      setTransactionId(preset.transactionId);
      setTransactionNote(preset.transactionNote);
      setMerchantCode(preset.merchantCode || '');
    }
  }, [open, preset]);

  const handleReset = () => {
    if (!preset) return;
    setVpa(preset.vpa);
    setPayeeName(preset.payeeName);
    setAmountRupees(preset.amountRupees);
    setTransactionId(preset.transactionId);
    setTransactionNote(preset.transactionNote);
    setMerchantCode(preset.merchantCode || '');
  };

  const validation = useMemo(
    () =>
      buildUpiDeepLink({
        vpa,
        payeeName,
        amountRupees,
        transactionId,
        transactionNote,
        merchantCode,
      }),
    [vpa, payeeName, amountRupees, transactionId, transactionNote, merchantCode]
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        preset?.requestRef
          ? `UPI Deep-Link QR Utility — ${preset.requestRef}`
          : 'UPI Deep-Link QR Generator'
      }
      subtitle="Live NPCI upi://pay QR generator bound to VPA, payee display name, exact INR amount, and transaction ID."
      maxWidth="max-w-3xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Parameter Controls */}
        <div className="md:col-span-6 space-y-4">
          {preset?.customerName && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-950/40 text-xs">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                {preset.customerName}
                {preset.projectName ? ` · ${preset.projectName}` : ''}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Linked Request: {preset.requestRef}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Receiving VPA / UPI ID (<code className="font-mono">pa</code>)
            </label>
            <input
              type="text"
              value={vpa}
              onChange={(e) => setVpa(e.target.value)}
              placeholder="e.g. forgex@hdfcbank"
              className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            {validation.errors.vpa && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                {validation.errors.vpa}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Payee Display Name (<code className="font-mono">pn</code>)
            </label>
            <input
              type="text"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="ForgeX Technologies"
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            {validation.errors.payeeName && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                {validation.errors.payeeName}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Amount in INR (<code className="font-mono">am</code>)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="5000.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              {validation.errors.amount && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                  {validation.errors.amount}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Transaction ID (<code className="font-mono">tr</code>)
              </label>
              <input
                type="text"
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="FXPAY-2026-XXXXXX"
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              {validation.errors.transactionId && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                  {validation.errors.transactionId}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Payment Note (<code className="font-mono">tn</code>)
              </label>
              <input
                type="text"
                maxLength={80}
                value={transactionNote}
                onChange={(e) => setTransactionNote(e.target.value)}
                placeholder="Project advance / milestone"
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                MCC (<code className="font-mono">mc</code>)
              </label>
              <input
                type="text"
                maxLength={4}
                value={merchantCode}
                onChange={(e) => setMerchantCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              {validation.errors.merchantCode && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                  {validation.errors.merchantCode}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            {preset?.requestId && onMintOfficialAttempt && (
              <button
                type="button"
                onClick={() => onMintOfficialAttempt(preset.requestId!)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Mint Tracked FXPAY Attempt</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200 dark:border-slate-800 pt-3">
            Client-side QR preview encodes standard NPCI UPI parameters without creating a ledger row. For tracked reconciliation and receipt issuance, mint an official <span className="font-mono">FXPAY-*</span> attempt.
          </p>
        </div>

        {/* Live QR Card */}
        <div className="md:col-span-6">
          <UpiDeepLinkQrCard
            vpa={vpa}
            payeeName={payeeName}
            amountRupees={amountRupees}
            transactionId={transactionId}
            transactionNote={transactionNote}
            merchantCode={merchantCode || undefined}
            contextLabel="Live UPI Deep-Link QR"
          />
        </div>
      </div>
    </Modal>
  );
}
