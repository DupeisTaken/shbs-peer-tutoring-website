import type { db } from "~/server/db";
import {
  isEmailConfigured,
  isEmailDeliveryAvailable,
  verifyEmailTransport,
  type EmailCategory,
} from "./sender";

type ChannelStatus = {
  category: EmailCategory;
  state: "READY" | "UNAVAILABLE" | "UNCONFIGURED" | "LOCAL";
  checkedAt: Date;
};

const channels: EmailCategory[] = ["SECURITY", "PROGRAM"];
const cache = new Map<
  EmailCategory,
  { expiresAt: number; result: Promise<ChannelStatus> }
>();

/** One bounded check per category/minute/process, shared by concurrent management requests.
 * READY confirms only SMTP connection/authentication, never inbox delivery or sender acceptance.
 * Cache only safe status values; provider errors and account details never cross this boundary. */
function checkChannel(category: EmailCategory): Promise<ChannelStatus> {
  const previous = cache.get(category);
  if (previous && previous.expiresAt > Date.now()) return previous.result;
  const entry: { expiresAt: number; result: Promise<ChannelStatus> } = {
    expiresAt: Infinity,
    // Defer work until the entry exists, including immediately resolved local/unconfigured checks.
    result: Promise.resolve().then(async () => {
      let state: ChannelStatus["state"];
      if (!isEmailConfigured(category)) {
        state = isEmailDeliveryAvailable(category) ? "LOCAL" : "UNCONFIGURED";
      } else {
        state = (await verifyEmailTransport(category))
          ? "READY"
          : "UNAVAILABLE";
      }
      entry.expiresAt = Date.now() + 60_000;
      return { category, state, checkedAt: new Date() };
    }),
  };
  cache.set(category, entry);
  return entry.result;
}

/** Read existing queue evidence without sending/retrying mail or changing program settings. */
export async function getEmailDeliveryStatus(
  database: Pick<typeof db, "emailDelivery">,
) {
  const [status, retrying, failed] = await Promise.all([
    Promise.all(channels.map(checkChannel)),
    database.emailDelivery.count({
      where: { status: "PENDING", attempts: { gt: 0 } },
    }),
    database.emailDelivery.count({ where: { status: "FAILED" } }),
  ]);
  return { channels: status, retrying, failed };
}
