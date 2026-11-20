import { deferUntilCommit } from "~/server/db-scope";
import { emailSender, isEmailConfigured, type EmailMessage } from "./sender";

export type DirectEmailReceipt = { emailed: boolean };

/** Retain this exact object through the resolver: an audited send settles after
 * commit, before serialization. A queued effect or local log is not SMTP acceptance.
 * Outside an audit owner, preserve the caller's existing delivery-failure boundary. */
export async function sendEmailWithReceipt(
  message: EmailMessage,
  receipt: DirectEmailReceipt,
): Promise<void> {
  const send = async () => {
    await emailSender.send(message);
    receipt.emailed = isEmailConfigured(message.category);
  };
  if (!deferUntilCommit(send)) await send();
}
