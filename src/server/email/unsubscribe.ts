import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { inTransaction, type DomainDb } from "~/server/transactions";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
import { effectiveNotificationPreference, informationCategories, isNotificationCategory, notificationCategories, type NotificationCategory } from "~/lib/notification-categories";

export type UnsubscribeCategory = NotificationCategory | "info" | "review" | "reminder";
export type UnsubscribeScope = "category" | "all";
export type UnsubscribeStatus =
  | { status: "invalid" }
  | { status: "ready" | "already-unsubscribed"; category: UnsubscribeCategory };
export type UnsubscribeResult =
  | { status: "invalid" }
  | { status: "unsubscribed"; category: UnsubscribeCategory };

/** Legacy information rows map to the same preference; unknown categories fail closed. */
export function optionalEmailCategory(
  category: string,
): UnsubscribeCategory | null {
