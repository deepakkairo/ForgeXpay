import { describe, it, expect } from 'vitest';
import {
  encryptSensitive,
  decryptSensitive,
  maskAccountNumber,
  generateApiKey,
  verifyApiKeyHash,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  createDocumentDownloadToken,
  verifyDocumentDownloadToken,
  validateIfsc,
  validateUpiId,
  validateBankAccountNumber,
  generatePaymentRef,
  generateCustomerRef,
} from '../crypto.ts';
import {
  buildUpiUri,
  paiseToInrAmountString,
  generateUpiQrDataUrl,
  generateUpiQrPngBuffer,
} from '../upi.ts';
import {
  assertValidPaymentTransition,
  canTransitionPaymentStatus,
  isCustomerFacingVerified,
} from '../stateMachine.ts';
import {
  parseCsvText,
  parseRupeesToPaise,
  normalizeBankStatementRows,
  evaluateCreditMatch,
} from '../reconciliation.ts';

describe('ForgeX 4XPay — Payment Identity & Validation', () => {
  it('generates distinct unique Payment IDs separate from Customer IDs', () => {
    const custRef = generateCustomerRef();
    const pay1 = generatePaymentRef();
    const pay2 = generatePaymentRef();
    expect(custRef).toMatch(/^FXC-[A-Z0-9]{5}$/);
    expect(pay1).toMatch(/^FXPAY-\d{4}-[A-Z0-9]{6}$/);
    expect(pay2).toMatch(/^FXPAY-\d{4}-[A-Z0-9]{6}$/);
    expect(pay1).not.toBe(pay2);
    expect(pay1).not.toBe(custRef);
  });

  it('validates Indian IFSC, UPI ID, and Bank Account numbers accurately', () => {
    expect(validateIfsc('HDFC0001234')).toBe(true);
    expect(validateIfsc('INVALID123')).toBe(false);
    expect(validateUpiId('forgex.billing@okhdfcbank')).toBe(true);
    expect(validateUpiId('not-a-upi-id')).toBe(false);
    expect(validateBankAccountNumber('123456789012')).toBe(true);
    expect(validateBankAccountNumber('12345')).toBe(false);
  });
});

describe('ForgeX 4XPay — Cryptographic Security & Masking', () => {
  it('encrypts and decrypts bank account numbers using AES-256-GCM with unique IVs', () => {
    const plain = '50200048291044';
    const c1 = encryptSensitive(plain);
    const c2 = encryptSensitive(plain);
    expect(c1).not.toBe(c2);
    expect(c1).not.toContain(plain);
    expect(decryptSensitive(c1)).toBe(plain);
    expect(decryptSensitive(c2)).toBe(plain);
  });

  it('masks account numbers leaving only the last 4 digits visible', () => {
    expect(maskAccountNumber('50200048291044')).toBe('XXXXXXXXXX1044');
    expect(maskAccountNumber('1234')).toBe('XXXX');
  });

  it('hashes scoped API keys with SHA-256 and verifies in constant time', () => {
    const { rawKey, keyPrefix, keyHash } = generateApiKey();
    expect(rawKey.startsWith('fx4x_live_')).toBe(true);
    expect(keyPrefix).toBe(rawKey.slice(0, 16));
    expect(verifyApiKeyHash(rawKey, keyHash)).toBe(true);
    expect(verifyApiKeyHash(`${rawKey}tampered`, keyHash)).toBe(false);
  });

  it('generates and verifies RFC 6238 TOTP MFA codes', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, '000000')).toBe(false);
  });

  it('issues and validates HMAC expiring document download tokens', () => {
    const token = createDocumentDownloadToken('receipt', 'rcpt-123', 'user-1', 120);
    expect(verifyDocumentDownloadToken(token, 'receipt')).toEqual({
      resourceId: 'rcpt-123',
      userId: 'user-1',
    });
    expect(verifyDocumentDownloadToken(token, 'invoice')).toBeNull();
    expect(verifyDocumentDownloadToken(`${token}x`, 'receipt')).toBeNull();
  });
});

describe('ForgeX 4XPay — UPI Payment URI & QR Generation Engine', () => {
  it('formats integer paise to exact INR strings with zero floating-point errors', () => {
    expect(paiseToInrAmountString(500000)).toBe('5000.00');
    expect(paiseToInrAmountString(19995)).toBe('199.95');
    expect(() => paiseToInrAmountString(0)).toThrow();
    expect(() => paiseToInrAmountString(-100)).toThrow();
    expect(() => paiseToInrAmountString(12.5)).toThrow();
  });

  it('builds percent-encoded UPI URI and generates valid QR PNG & Data URL', async () => {
    const uri = buildUpiUri({
      pa: 'forgex@icici',
      pn: 'ForgeX Tech LLP',
      amPaise: 500000,
      tr: 'FXPAY-2026-A81F01',
      tn: 'FXINV-0102 Advance Payment',
      cu: 'INR',
    });
    expect(uri).toContain('upi://pay?');
    expect(uri).toContain('pa=forgex%40icici');
    expect(uri).toContain('pn=ForgeX%20Tech%20LLP');
    expect(uri).toContain('am=5000.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tr=FXPAY-2026-A81F01');

    const dataUrl = await generateUpiQrDataUrl(uri);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const pngBuf = await generateUpiQrPngBuffer(uri);
    expect(pngBuf.length).toBeGreaterThan(200);
  });

  it('rejects invalid UPI addresses and non-INR currencies', () => {
    expect(() =>
      buildUpiUri({
        pa: 'invalid-upi',
        pn: 'ForgeX',
        amPaise: 10000,
        tr: 'FXPAY-2026-AAAAAA',
        tn: 'Test',
      })
    ).toThrow();

    expect(() =>
      buildUpiUri({
        pa: 'forgex@icici',
        pn: 'ForgeX',
        amPaise: 10000,
        tr: 'FXPAY-2026-AAAAAA',
        tn: 'Test',
        cu: 'USD',
      })
    ).toThrow();
  });
});

describe('ForgeX 4XPay — Payment Status State Machine Security', () => {
  it('blocks client apps from transitioning any payment to VERIFIED', () => {
    expect(() =>
      assertValidPaymentTransition('AWAITING_PAYMENT', 'VERIFIED', 'CLIENT')
    ).toThrow(/Forbidden/);
    expect(() =>
      assertValidPaymentTransition('VERIFICATION_PENDING', 'VERIFIED', 'CLIENT')
    ).toThrow(/Forbidden/);
  });

  it('allows Finance backend to verify pending or late expired payments and locks VERIFIED terminal state', () => {
    expect(() =>
      assertValidPaymentTransition('VERIFICATION_PENDING', 'VERIFIED', 'FINANCE_BACKEND')
    ).not.toThrow();
    expect(() =>
      assertValidPaymentTransition('EXPIRED', 'VERIFIED', 'FINANCE_BACKEND')
    ).not.toThrow();
    expect(canTransitionPaymentStatus('VERIFIED', 'FAILED_REPORTED')).toBe(false);
    expect(isCustomerFacingVerified('VERIFICATION_PENDING')).toBe(false);
    expect(isCustomerFacingVerified('VERIFIED')).toBe(true);
  });
});

describe('ForgeX 4XPay — CSV Bank Statement Reconciliation Engine', () => {
  const sampleCsv = [
    'Date,Type,Amount,UTR,Narration',
    '2026-11-18,CR,"5,000.00",UTR42900112233,UPI/CR/FXPAY-2026-A81F01/SATYAM',
    '2026-11-18,DR,1200.00,UTR999888777,OFFICE EXPENSE',
    '2026-11-18,CR,5000.00,UTR42900998877,UPI TRANSFER NO REF',
  ].join('\n');

  it('parses CSV rows and converts currency strings strictly to integer paise', () => {
    const { headers, rows } = parseCsvText(sampleCsv);
    expect(headers).toEqual(['Date', 'Type', 'Amount', 'UTR', 'Narration']);
    expect(rows).toHaveLength(3);
    expect(parseRupeesToPaise('5,000.00')).toBe(500000);
    expect(parseRupeesToPaise('₹19,999.50')).toBe(1999950);

    const normalized = normalizeBankStatementRows(
      rows,
      {
        dateColumn: 'Date',
        directionColumn: 'Type',
        amountColumn: 'Amount',
        utrColumn: 'UTR',
        descriptionColumn: 'Narration',
      },
      'acc-1'
    );
    expect(normalized[0].direction).toBe('CREDIT');
    expect(normalized[0].amountPaise).toBe(500000);
    expect(normalized[1].direction).toBe('DEBIT');
  });

  it('matches exact UTR + amount + account, flags partial/overpayments, and NEVER auto-matches solely by amount', () => {
    const candidates = [
      {
        id: 'att-1',
        paymentRef: 'FXPAY-2026-A81F01',
        paymentRequestId: 'req-1',
        receivingAccountId: 'acc-1',
        expectedAmountPaise: 500000,
        status: 'VERIFICATION_PENDING',
        customerReportedUtr: 'UTR42900112233',
      },
      {
        id: 'att-2',
        paymentRef: 'FXPAY-2026-B93K02',
        paymentRequestId: 'req-2',
        receivingAccountId: 'acc-1',
        expectedAmountPaise: 500000,
        status: 'AWAITING_PAYMENT',
        customerReportedUtr: null,
      },
    ];

    // 1. Exact UTR + exact amount -> MATCHED
    const exactMatch = evaluateCreditMatch(
      {
        receivingAccountId: 'acc-1',
        amountPaise: 500000,
        bankReferenceUtr: 'UTR42900112233',
        description: 'UPI CR',
      },
      candidates
    );
    expect(exactMatch.classification).toBe('MATCHED');
    expect(exactMatch.matchedAttemptId).toBe('att-1');

    // 2. Partial payment with exact UTR -> POTENTIAL_MATCH (requires manual review)
    const partialMatch = evaluateCreditMatch(
      {
        receivingAccountId: 'acc-1',
        amountPaise: 300000,
        bankReferenceUtr: 'UTR42900112233',
        description: 'UPI CR PARTIAL',
      },
      candidates
    );
    expect(partialMatch.classification).toBe('POTENTIAL_MATCH');
    expect(partialMatch.reasons.join(' ')).toContain('Partial payment');

    // 3. Multiple clients with same amount & no UTR/PaymentRef -> AMBIGUOUS (never auto-matches solely by amount!)
    const ambiguous = evaluateCreditMatch(
      {
        receivingAccountId: 'acc-1',
        amountPaise: 500000,
        bankReferenceUtr: 'UTRUNKNOWN555',
        description: 'UPI TRANSFER',
      },
      candidates
    );
    expect(ambiguous.classification).toBe('AMBIGUOUS');
    expect(ambiguous.matchedAttemptId).toBeNull();

    // 4. Single candidate amount-only without UTR/Ref -> POTENTIAL_MATCH (never MATCHED!)
    const singleAmountOnly = evaluateCreditMatch(
      {
        receivingAccountId: 'acc-1',
        amountPaise: 500000,
        bankReferenceUtr: 'UTRUNKNOWN999',
        description: 'UPI TRANSFER',
      },
      [candidates[1]]
    );
    expect(singleAmountOnly.classification).toBe('POTENTIAL_MATCH');
  });
});
