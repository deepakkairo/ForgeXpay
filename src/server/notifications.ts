import { db } from '../db/index.ts';
import { notifications } from '../db/schema.ts';

export type NotificationEventType =
  | 'NEW_PAYMENT_REQUEST'
  | 'PAYMENT_REPORTED'
  | 'VERIFICATION_REQUIRED'
  | 'PAYMENT_VERIFIED'
  | 'DISPUTE_CREATED'
  | 'DISPUTE_UPDATED'
  | 'RECEIPT_AVAILABLE'
  | 'RECONCILIATION_EXCEPTION'
  | 'SECURITY_CONFIG_CHANGE';

export interface NotificationInput {
  recipientUserId?: string | null;
  recipientRole?: string | null;
  eventType: NotificationEventType;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
}

/**
 * Emits an internal in-app notification.
 * CRITICAL RULE: Notification delivery failures must NEVER reverse or block financial truth.
 */
export async function emitNotification(input: NotificationInput): Promise<void> {
  try {
    await db.insert(notifications).values({
      recipientUserId: input.recipientUserId ?? null,
      recipientRole: input.recipientRole ?? null,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      isRead: false,
      deliveryChannel: 'IN_APP',
    });
  } catch (err) {
    console.error('Notification dispatch failed (non-blocking):', err);
  }
}
