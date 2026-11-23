export function formatInr(paise: number | null | undefined): string {
  const safe = typeof paise === 'number' && Number.isFinite(paise) ? Math.round(paise) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${negative ? '-' : ''}₹${rupees.toLocaleString('en-IN')}.${String(rem).padStart(2, '0')}`;
}

export function rupeesInputToPaise(input: string): number {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return 0;
  const [r, p = ''] = cleaned.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0').slice(0, 2));
}

export function formatUtcDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatShortDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function statusColorClass(status: string): string {
  switch (status) {
    case 'VERIFIED':
    case 'PAID':
    case 'CONFIRMED':
    case 'APPROVED_VERIFIED':
    case 'MATCHED':
    case 'ACTIVE':
    case 'HEALTHY':
    case 'SUCCESS':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'VERIFICATION_PENDING':
    case 'PAYMENT_REPORTED':
    case 'REVIEW_REQUIRED':
    case 'PARTIALLY_VERIFIED':
    case 'PARTIALLY_PAID':
    case 'POTENTIAL_MATCH':
    case 'AMBIGUOUS':
    case 'AWAITING_PAYMENT':
    case 'OPEN':
    case 'ASSIGNED':
    case 'UNDER_BANK_CHECK':
    case 'CLARIFICATION_REQUESTED':
    case 'REOPENED':
      return 'text-amber-700 dark:text-amber-400';
    case 'DISPUTED':
    case 'FAILED_REPORTED':
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'DENIED':
    case 'FAILED':
    case 'UNMATCHED':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

export function humanizeStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
