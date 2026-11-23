import QRCode from 'qrcode';
import { validateUpiId } from './crypto.ts';

export interface UpiPaymentUriParams {
  pa: string; // Payee UPI address
  pn: string; // Payee display name
  amPaise: number; // Expected amount strictly as positive integer paise
  tr: string; // Supported transaction reference (ForgeX Payment ID)
  tn: string; // Payment note
  cu?: string; // Currency (INR)
}

/**
 * Formats integer paise into exact INR decimal string without floating-point math.
 * Example: 500000 -> "5000.00", 12345 -> "123.45"
 */
export function paiseToInrAmountString(paise: number): string {
  if (!Number.isInteger(paise) || paise <= 0) {
    throw new Error('Payment amount must be a positive integer in paise.');
  }
  const rupees = Math.floor(paise / 100);
  const remPaise = paise % 100;
  return `${rupees}.${String(remPaise).padStart(2, '0')}`;
}

export function formatInrFromPaise(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const formattedRupees = rupees.toLocaleString('en-IN');
  return `${negative ? '-' : ''}₹${formattedRupees}.${String(rem).padStart(2, '0')}`;
}

/**
 * Generates a standards-compliant UPI linking URI (upi://pay?...)
 * Strictly percent-encodes parameters and avoids provider-specific invented fields.
 */
export function buildUpiUri(params: UpiPaymentUriParams): string {
  const pa = params.pa.trim();
  const pn = params.pn.trim();
  const tr = params.tr.trim();
  const tn = params.tn.trim().slice(0, 80);
  const cu = (params.cu || 'INR').trim().toUpperCase();

  if (!validateUpiId(pa)) {
    throw new Error('Invalid receiving UPI address configured.');
  }
  if (!pn) {
    throw new Error('Payee display name is required for UPI URI.');
  }
  if (!tr) {
    throw new Error('Transaction reference (Payment ID) is required.');
  }
  if (cu !== 'INR') {
    throw new Error('Only INR currency is supported for UPI payments.');
  }

  const am = paiseToInrAmountString(params.amPaise);

  const pairs: Array<[string, string]> = [
    ['pa', pa],
    ['pn', pn],
    ['am', am],
    ['cu', cu],
    ['tr', tr],
    ['tn', tn || `Payment ${tr}`],
  ];

  const query = pairs
    .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
    .join('&');

  return `upi://pay?${query}`;
}

export async function generateUpiQrDataUrl(upiUri: string): Promise<string> {
  return QRCode.toDataURL(upiUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

export async function generateUpiQrPngBuffer(upiUri: string): Promise<Buffer> {
  return QRCode.toBuffer(upiUri, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 420,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}
