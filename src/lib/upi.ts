import { rupeesInputToPaise } from './format.ts';

export interface UpiDeepLinkParams {
  /** Payee Virtual Payment Address (VPA), e.g. merchant@hdfcbank */
  vpa: string;
  /** Payee display name shown in UPI apps */
  payeeName?: string;
  /** Amount in integer paise (takes precedence over amountRupees when provided) */
  amountPaise?: number;
  /** Amount in INR rupees as string or number, e.g. "5000.00" */
  amountRupees?: string | number;
  /** Unique transaction reference / Payment ID / Request Ref (`tr`) */
  transactionId: string;
  /** Optional payment note (`tn`), truncated to NPCI-safe 80 chars */
  transactionNote?: string;
  /** Optional 4-digit Merchant Category Code (`mc`) */
  merchantCode?: string;
  /** Currency code (UPI strictly supports INR) */
  currency?: 'INR';
}

export interface UpiDeepLinkResult {
  uri: string | null;
  normalizedAmountPaise: number | null;
  formattedAmount: string | null;
  errors: {
    vpa?: string;
    payeeName?: string;
    amount?: string;
    transactionId?: string;
    merchantCode?: string;
  };
}

/**
 * Validates standard NPCI UPI VPA format (handle@provider).
 */
export function validateUpiVpa(vpa: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa.trim());
}

/**
 * Validates UPI transaction reference (`tr`): 3-35 alphanumeric / hyphen / underscore chars.
 */
export function validateUpiTransactionId(transactionId: string): boolean {
  return /^[A-Za-z0-9._-]{3,35}$/.test(transactionId.trim());
}

/**
 * Converts positive integer paise to an exact 2-decimal INR string without float drift.
 * Example: 500050 -> "5000.50"
 */
export function paiseToUpiAmountString(paise: number): string {
  const safe = Math.round(paise);
  const rupees = Math.floor(safe / 100);
  const remPaise = safe % 100;
  return `${rupees}.${String(remPaise).padStart(2, '0')}`;
}

/**
 * Resolves amount in integer paise from either `amountPaise` or `amountRupees`.
 */
export function resolveAmountPaise(
  amountPaise?: number,
  amountRupees?: string | number
): number | null {
  if (typeof amountPaise === 'number' && Number.isFinite(amountPaise)) {
    return Math.round(amountPaise);
  }
  if (typeof amountRupees === 'number' && Number.isFinite(amountRupees)) {
    return Math.round(amountRupees * 100);
  }
  if (typeof amountRupees === 'string' && amountRupees.trim() !== '') {
    const parsed = rupeesInputToPaise(amountRupees);
    return parsed > 0 ? parsed : 0;
  }
  return null;
}

/**
 * Builds an NPCI standards-compliant `upi://pay?...` deep-link URI from payment parameters.
 * Returns structured field validation errors instead of throwing so UI forms can display live feedback.
 */
export function buildUpiDeepLink(params: UpiDeepLinkParams): UpiDeepLinkResult {
  const errors: UpiDeepLinkResult['errors'] = {};

  const vpa = params.vpa.trim();
  const payeeName = (params.payeeName ?? '').trim();
  const transactionId = params.transactionId.trim();
  const transactionNote = (params.transactionNote ?? '').trim().slice(0, 80);
  const merchantCode = (params.merchantCode ?? '').trim();
  const currency = (params.currency || 'INR').toUpperCase();

  if (!vpa) {
    errors.vpa = 'Receiving VPA / UPI ID is required.';
  } else if (!validateUpiVpa(vpa)) {
    errors.vpa = 'Enter a valid UPI VPA (e.g. forgex@hdfcbank).';
  }

  if (!payeeName) {
    errors.payeeName = 'Payee display name is required.';
  }

  const amountPaise = resolveAmountPaise(params.amountPaise, params.amountRupees);
  if (amountPaise === null || amountPaise <= 0) {
    errors.amount = 'Enter a positive INR amount (e.g. 5000 or 1250.50).';
  }

  if (!transactionId) {
    errors.transactionId = 'Transaction ID / Reference is required.';
  } else if (!validateUpiTransactionId(transactionId)) {
    errors.transactionId = 'Use 3–35 letters, digits, hyphens, dots, or underscores.';
  }

  if (merchantCode && !/^\d{4}$/.test(merchantCode)) {
    errors.merchantCode = 'Merchant code must be a 4-digit numeric MCC.';
  }

  if (Object.keys(errors).length > 0 || amountPaise === null || amountPaise <= 0) {
    return {
      uri: null,
      normalizedAmountPaise: amountPaise,
      formattedAmount: amountPaise && amountPaise > 0 ? paiseToUpiAmountString(amountPaise) : null,
      errors,
    };
  }

  const formattedAmount = paiseToUpiAmountString(amountPaise);

  const queryPairs: Array<[string, string]> = [
    ['pa', vpa],
    ['pn', payeeName],
    ['am', formattedAmount],
    ['cu', currency],
    ['tr', transactionId],
    ['tn', transactionNote || `Payment ${transactionId}`],
  ];

  if (merchantCode) {
    queryPairs.push(['mc', merchantCode]);
  }

  const query = queryPairs
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return {
    uri: `upi://pay?${query}`,
    normalizedAmountPaise: amountPaise,
    formattedAmount,
    errors: {},
  };
}
