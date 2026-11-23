import { describe, it, expect } from 'vitest';
import {
  buildUpiDeepLink,
  paiseToUpiAmountString,
  validateUpiTransactionId,
  validateUpiVpa,
} from '../upi.ts';

describe('Client UPI Deep-Link Utility', () => {
  it('validates standard NPCI VPA formats', () => {
    expect(validateUpiVpa('forgex@hdfcbank')).toBe(true);
    expect(validateUpiVpa('billing.ops-01@okicici')).toBe(true);
    expect(validateUpiVpa('invalid-vpa')).toBe(false);
    expect(validateUpiVpa('@hdfcbank')).toBe(false);
  });

  it('validates transaction IDs', () => {
    expect(validateUpiTransactionId('FXREQ-2026-AB12C')).toBe(true);
    expect(validateUpiTransactionId('FXPAY-2026-99XY12')).toBe(true);
    expect(validateUpiTransactionId('ab')).toBe(false);
    expect(validateUpiTransactionId('bad id with spaces')).toBe(false);
  });

  it('formats paise into exact 2-decimal INR strings without float drift', () => {
    expect(paiseToUpiAmountString(500000)).toBe('5000.00');
    expect(paiseToUpiAmountString(12345)).toBe('123.45');
    expect(paiseToUpiAmountString(5)).toBe('0.05');
  });

  it('builds a percent-encoded upi://pay deep link from payment request parameters', () => {
    const result = buildUpiDeepLink({
      vpa: 'forgex@hdfcbank',
      payeeName: 'ForgeX Tech Pvt Ltd',
      amountRupees: '12500.50',
      transactionId: 'FXREQ-2026-ABC12',
      transactionNote: 'Milestone 1 Advance',
      merchantCode: '5734',
    });

    expect(result.errors).toEqual({});
    expect(result.normalizedAmountPaise).toBe(1250050);
    expect(result.formattedAmount).toBe('12500.50');
    expect(result.uri).toBe(
      'upi://pay?pa=forgex%40hdfcbank&pn=ForgeX%20Tech%20Pvt%20Ltd&am=12500.50&cu=INR&tr=FXREQ-2026-ABC12&tn=Milestone%201%20Advance&mc=5734'
    );
  });

  it('returns structured field errors when required parameters are invalid', () => {
    const result = buildUpiDeepLink({
      vpa: 'not-a-vpa',
      payeeName: '',
      amountRupees: '0',
      transactionId: '',
      merchantCode: '12A',
    });

    expect(result.uri).toBeNull();
    expect(result.errors.vpa).toBeDefined();
    expect(result.errors.payeeName).toBeDefined();
    expect(result.errors.amount).toBeDefined();
    expect(result.errors.transactionId).toBeDefined();
    expect(result.errors.merchantCode).toBeDefined();
  });
});
