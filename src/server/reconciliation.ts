import { sha256Hex } from './crypto.ts';

export interface CsvColumnMapping {
  dateColumn: string;
  amountColumn: string;
  directionColumn?: string; // Optional if separate creditColumn is used
  creditColumn?: string;
  debitColumn?: string;
  utrColumn: string;
  descriptionColumn: string;
}

export interface NormalizedBankRow {
  rowIndex: number;
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  bankReferenceUtr: string | null;
  transactionDate: Date;
  description: string;
  dedupFingerprint: string;
  rawRow: Record<string, string>;
}

export interface CandidatePaymentAttempt {
  id: string;
  paymentRef: string;
  paymentRequestId: string;
  receivingAccountId: string;
  expectedAmountPaise: number;
  status: string;
  customerReportedUtr: string | null;
}

export interface MatchEvaluation {
  classification: 'MATCHED' | 'POTENTIAL_MATCH' | 'AMBIGUOUS' | 'UNMATCHED';
  confidenceScore: number;
  matchedAttemptId: string | null;
  matchedRequestId: string | null;
  reasons: string[];
}

/**
 * Parses CSV text cleanly, supporting quoted commas and CRLF/LF line endings.
 */
export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleaned = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return { headers: [], rows: [] };

  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n') {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowArr = lines[i];
    if (rowArr.every((cell) => cell === '')) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (rowArr[j] ?? '').trim();
    }
    rows.push(obj);
  }

  return { headers, rows };
}

/**
 * Parses an INR string (e.g. "5,000.00", "₹5000", "5000.5") strictly into integer paise
 * without floating-point arithmetic.
 */
export function parseRupeesToPaise(raw: string): number {
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/^\+/, '');
  if (!cleaned || cleaned === '-') return 0;
  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(unsigned)) {
    throw new Error(`Invalid currency amount format: "${raw}"`);
  }
  const [rupeePart, paisePart = ''] = unsigned.split('.');
  const paddedPaise = paisePart.padEnd(2, '0').slice(0, 2);
  const total = Number(rupeePart) * 100 + Number(paddedPaise);
  return negative ? -total : total;
}

export function normalizeBankStatementRows(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping,
  receivingAccountId: string
): NormalizedBankRow[] {
  const normalized: NormalizedBankRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[mapping.dateColumn] || '';
    const parsedDate = new Date(dateRaw);
    const txDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    let direction: 'CREDIT' | 'DEBIT' = 'CREDIT';
    let amountPaise = 0;

    if (mapping.creditColumn && mapping.debitColumn) {
      const creditVal = parseRupeesToPaise(row[mapping.creditColumn] || '0');
      const debitVal = parseRupeesToPaise(row[mapping.debitColumn] || '0');
      if (creditVal > 0) {
        direction = 'CREDIT';
        amountPaise = creditVal;
      } else {
        direction = 'DEBIT';
        amountPaise = Math.abs(debitVal);
      }
    } else {
      const rawAmt = parseRupeesToPaise(row[mapping.amountColumn] || '0');
      const dirRaw = (mapping.directionColumn ? row[mapping.directionColumn] : '')
        .trim()
        .toUpperCase();
      if (dirRaw === 'DR' || dirRaw === 'DEBIT' || dirRaw === 'D' || rawAmt < 0) {
        direction = 'DEBIT';
        amountPaise = Math.abs(rawAmt);
      } else {
        direction = 'CREDIT';
        amountPaise = Math.abs(rawAmt);
      }
    }

    const utrRaw = (row[mapping.utrColumn] || '').trim();
    const bankReferenceUtr = utrRaw.length > 0 ? utrRaw.toUpperCase() : null;
    const description = (row[mapping.descriptionColumn] || '').trim();

    const fingerprintInput = [
      receivingAccountId,
      txDate.toISOString().slice(0, 10),
      direction,
      String(amountPaise),
      bankReferenceUtr || 'NO_UTR',
      description.toLowerCase().slice(0, 120),
    ].join('|');

    normalized.push({
      rowIndex: i + 1,
      direction,
      amountPaise,
      bankReferenceUtr,
      transactionDate: txDate,
      description,
      dedupFingerprint: sha256Hex(fingerprintInput),
      rawRow: row,
    });
  }

  return normalized;
}

/**
 * Evaluates a single CREDIT bank transaction against open/pending payment attempts.
 * CRITICAL BUSINESS RULES:
 * - Never matches solely by amount!
 * - Uses exact UTR or ForgeX Payment Reference (FXPAY-*) in narration + receiving account + amount.
 * - Multiple candidates -> AMBIGUOUS.
 * - Amount mismatch (partial/overpayment) with matching UTR/Ref -> POTENTIAL_MATCH (manual review required).
 */
export function evaluateCreditMatch(
  bankTx: {
    receivingAccountId: string;
    amountPaise: number;
    bankReferenceUtr: string | null;
    description: string;
  },
  candidates: CandidatePaymentAttempt[]
): MatchEvaluation {
  const accountCandidates = candidates.filter(
    (c) => c.receivingAccountId === bankTx.receivingAccountId && c.status !== 'VERIFIED'
  );

  if (accountCandidates.length === 0) {
    return {
      classification: 'UNMATCHED',
      confidenceScore: 0,
      matchedAttemptId: null,
      matchedRequestId: null,
      reasons: ['No open or pending payment attempts exist for this receiving account.'],
    };
  }

  const txUtr = bankTx.bankReferenceUtr?.trim().toUpperCase() || null;
  const descUpper = bankTx.description.toUpperCase();

  // 1. Exact UTR match against customer-reported UTR
  if (txUtr) {
    const utrMatches = accountCandidates.filter(
      (c) => c.customerReportedUtr && c.customerReportedUtr.trim().toUpperCase() === txUtr
    );
    if (utrMatches.length === 1) {
      const target = utrMatches[0];
      if (target.expectedAmountPaise === bankTx.amountPaise) {
        return {
          classification: 'MATCHED',
          confidenceScore: 98,
          matchedAttemptId: target.id,
          matchedRequestId: target.paymentRequestId,
          reasons: [
            `Exact UTR match (${txUtr})`,
            'Exact amount match',
            'Receiving account matches',
          ],
        };
      }
      const diffType =
        bankTx.amountPaise < target.expectedAmountPaise ? 'Partial payment' : 'Overpayment';
      return {
        classification: 'POTENTIAL_MATCH',
        confidenceScore: 70,
        matchedAttemptId: target.id,
        matchedRequestId: target.paymentRequestId,
        reasons: [
          `Exact UTR match (${txUtr})`,
          `${diffType}: bank credited ${bankTx.amountPaise} paise vs expected ${target.expectedAmountPaise} paise. Manual review required.`,
        ],
      };
    }
    if (utrMatches.length > 1) {
      return {
        classification: 'AMBIGUOUS',
        confidenceScore: 40,
        matchedAttemptId: null,
        matchedRequestId: null,
        reasons: [`Multiple payment attempts (${utrMatches.length}) reference UTR ${txUtr}.`],
      };
    }
  }

  // 2. Exact ForgeX Payment ID (FXPAY-*) present in bank narration/description
  const refMatches = accountCandidates.filter((c) => descUpper.includes(c.paymentRef.toUpperCase()));
  if (refMatches.length === 1) {
    const target = refMatches[0];
    if (target.expectedAmountPaise === bankTx.amountPaise) {
      return {
        classification: 'MATCHED',
        confidenceScore: 95,
        matchedAttemptId: target.id,
        matchedRequestId: target.paymentRequestId,
        reasons: [
          `ForgeX Payment ID (${target.paymentRef}) found in bank narration`,
          'Exact amount match',
          'Receiving account matches',
        ],
      };
    }
    const diffType =
      bankTx.amountPaise < target.expectedAmountPaise ? 'Partial payment' : 'Overpayment';
    return {
      classification: 'POTENTIAL_MATCH',
      confidenceScore: 68,
      matchedAttemptId: target.id,
      matchedRequestId: target.paymentRequestId,
      reasons: [
        `ForgeX Payment ID (${target.paymentRef}) found in bank narration`,
        `${diffType}: credited ${bankTx.amountPaise} paise vs expected ${target.expectedAmountPaise} paise. Manual review required.`,
      ],
    };
  }
  if (refMatches.length > 1) {
    return {
      classification: 'AMBIGUOUS',
      confidenceScore: 35,
      matchedAttemptId: null,
      matchedRequestId: null,
      reasons: ['Bank narration contains multiple ForgeX Payment IDs. Manual review required.'],
    };
  }

  // 3. Amount-only candidates — NEVER classify as MATCHED!
  const amountMatches = accountCandidates.filter(
    (c) => c.expectedAmountPaise === bankTx.amountPaise
  );

  if (amountMatches.length > 1) {
    return {
      classification: 'AMBIGUOUS',
      confidenceScore: 25,
      matchedAttemptId: null,
      matchedRequestId: null,
      reasons: [
        `${amountMatches.length} payment attempts share the same expected amount with no corroborating UTR or Payment ID. Cannot auto-match.`,
      ],
    };
  }

  if (amountMatches.length === 1) {
    return {
      classification: 'POTENTIAL_MATCH',
      confidenceScore: 45,
      matchedAttemptId: amountMatches[0].id,
      matchedRequestId: amountMatches[0].paymentRequestId,
      reasons: [
        'Amount and receiving account match a single candidate, but no UTR or ForgeX Payment ID corroborated. Manual finance verification required.',
      ],
    };
  }

  return {
    classification: 'UNMATCHED',
    confidenceScore: 0,
    matchedAttemptId: null,
    matchedRequestId: null,
    reasons: ['No matching UTR, Payment ID, or candidate payment amount found.'],
  };
}
