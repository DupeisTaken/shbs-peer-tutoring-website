import { TRPCError } from "@trpc/server";

/** Cached clients treat a successful legacy completion as account creation. Call only
 * after invitation delivery commits so they receive honest, recoverable continuation. */
export function continueInEmailedInvitation(): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Account setup now uses invitations. Open the invitation we emailed to continue. / 账号设置现通过邀请完成，请打开邮件中的邀请继续。",
  });
}
