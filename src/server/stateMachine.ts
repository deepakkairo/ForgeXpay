export type PaymentAttemptStatus =
  | 'CREATED'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_REPORTED'
  | 'VERIFICATION_PENDING'
  | 'REVIEW_REQUIRED'
  | 'VERIFIED'
  | 'FAILED_REPORTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPUTED';

export const PAYMENT_STATUSES: PaymentAttemptStatus[] = [
  'CREATED',
  'AWAITING_PAYMENT',
  'PAYMENT_REPORTED',
  'VERIFICATION_PENDING',
  'REVIEW_REQUIRED',
  'VERIFIED',
  'FAILED_REPORTED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED',
];

const ALLOWED_TRANSITIONS: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  CREATED: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: [
    'PAYMENT_REPORTED',
    'VERIFICATION_PENDING',
    'FAILED_REPORTED',
    'EXPIRED',
    'CANCELLED',
    'DISPUTED',
    'REVIEW_REQUIRED',
    'VERIFIED', // Only via authorised Finance verification / bank statement reconciliation
  ],
  PAYMENT_REPORTED: ['VERIFICATION_PENDING', 'REVIEW_REQUIRED', 'DISPUTED'],
  VERIFICATION_PENDING: ['VERIFIED', 'REVIEW_REQUIRED', 'FAILED_REPORTED', 'DISPUTED'],
  REVIEW_REQUIRED: ['VERIFIED', 'VERIFICATION_PENDING', 'FAILED_REPORTED', 'DISPUTED'],
  FAILED_REPORTED: ['VERIFICATION_PENDING', 'REVIEW_REQUIRED', 'DISPUTED', 'VERIFIED'],
  // Expired in 4XPay cannot prevent a customer from paying a previously saved QR; late payments reconcile safely.
  EXPIRED: ['VERIFICATION_PENDING', 'REVIEW_REQUIRED', 'DISPUTED', 'VERIFIED'],
  CANCELLED: ['REVIEW_REQUIRED', 'DISPUTED'],
  DISPUTED: ['VERIFICATION_PENDING', 'REVIEW_REQUIRED', 'VERIFIED', 'FAILED_REPORTED'],
  // Verified is terminal for the attempt status to preserve immutable financial history.
  VERIFIED: [],
};

export function canTransitionPaymentStatus(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidPaymentTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
  actorContext: 'CLIENT' | 'FINANCE_BACKEND' | 'SYSTEM'
): void {
  if (to === 'VERIFIED' && actorContext === 'CLIENT') {
    throw new Error(
      'Forbidden: Client applications cannot mark a payment as VERIFIED. Only authorised Finance verification or bank reconciliation may verify payments.'
    );
  }
  if (!canTransitionPaymentStatus(from, to)) {
    throw new Error(`Invalid payment status transition from ${from} to ${to}.`);
  }
}

export function isCustomerFacingVerified(status: PaymentAttemptStatus): boolean {
  return status === 'VERIFIED';
}
