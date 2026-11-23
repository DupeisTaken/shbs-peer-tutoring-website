import { TRPCError } from "@trpc/server";
import { quarterBlockAccountWhere } from "./history-row-ownership";
import {
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

/** Keep the public entry and submission on the same durable period restriction.
 * An optional submitted address is checked only when actually used; owning a
 * verified secondary address does not make its email-only restriction account-wide. */
export async function findStudentQuarterBlock(
  tx: TransactionDb,
  intakeTermId: string,
  account: { id: string; email: string } | null,
  submittedEmail?: string,
) {
  return tx.studentQuarterBlock.findFirst({
    where: {
      intakeTermId,
      OR: [
        ...(submittedEmail ? [{ email: submittedEmail }] : []),
        ...(account
          ? [
              await quarterBlockAccountWhere(tx, account.id),
              { email: account.email },
            ]
          : []),
      ],
    },
    select: { id: true },
  });
}

/** The caller supplies the actual active intake from a consistent read snapshot
 * or the existing public transition's period barrier,
 * never a staged setting or a future opening advertised on the public page.
 * This reads only the authenticated account and returns no restriction evidence. */
export async function readStudentSignupRestriction(
  tx: TransactionDb,
  intakeTermId: string | null,
  userId: string,
) {
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (!account) throw new TRPCError({ code: "UNAUTHORIZED" });
  return {
    blocked: !!(
      intakeTermId && (await findStudentQuarterBlock(tx, intakeTermId, account))
    ),
    canOpenWorkspace:
      account.role !== "VIEWER" &&
      !account.suspendedAt &&
      !account.mergedIntoId &&
      !account.recoveryVoidedAt,
  };
}

/** A mounted workspace refreshes this small projection through its existing
 * identity/query lifecycle. Displayed period IDs are cache namespaces only. */
export async function readCurrentStudentSignupRestriction(
  db: DomainDb,
  userId: string,
) {
  return inTransaction(
    db,
    async (tx) => {
      const term = await tx.term.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const intakeTermId = term?.id ?? null;
      return {
        intakeTermId,
        ...(await readStudentSignupRestriction(tx, intakeTermId, userId)),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
