import { describe, it, expect } from 'vitest';
import { formatInr, rupeesInputToPaise, humanizeStatus } from '../format.ts';
import { filterByDateRange } from '../../components/AnalyticsPanel.tsx';

describe('INR Currency & Status Formatting', () => {
  it('formats paise into Indian numbering INR strings accurately', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(1250050)).toBe('₹12,500.50');
    expect(formatInr(10000000)).toBe('₹1,00,000.00');
    expect(formatInr(-25000)).toBe('-₹250.00');
  });

  it('parses rupee inputs cleanly into integer paise without floating-point drift', () => {
    expect(rupeesInputToPaise('1,250.50')).toBe(125050);
    expect(rupeesInputToPaise('₹5000')).toBe(500000);
    expect(rupeesInputToPaise('invalid')).toBe(0);
  });

  it('humanizes backend enum statuses for readable UI badges', () => {
    expect(humanizeStatus('VERIFICATION_PENDING')).toBe('Verification Pending');
    expect(humanizeStatus('AWAITING_PAYMENT')).toBe('Awaiting Payment');
    expect(humanizeStatus('VERIFIED')).toBe('Verified');
  });
});

describe('Date Range Filtering Utility', () => {
  it('filters records accurately for TODAY, 7D, 30D, and ALL', () => {
    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

    const rows = [
      { id: 'recent', createdAt: hoursAgo(2) },
      { id: 'week', createdAt: daysAgo(4) },
      { id: 'month', createdAt: daysAgo(15) },
      { id: 'older', createdAt: daysAgo(60) },
    ];

    expect(filterByDateRange(rows, 'TODAY').map((r) => r.id)).toEqual(['recent']);
    expect(filterByDateRange(rows, '7D').map((r) => r.id)).toEqual(['recent', 'week']);
    expect(filterByDateRange(rows, '30D').map((r) => r.id)).toEqual(['recent', 'week', 'month']);
    expect(filterByDateRange(rows, 'ALL').map((r) => r.id)).toEqual([
      'recent',
      'week',
      'month',
      'older',
    ]);
  });
});
