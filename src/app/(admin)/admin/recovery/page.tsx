import { redirect } from "next/navigation";
import { AdmissionRecovery } from "~/app/_components/admission-recovery";
import { CheckpointRecovery } from "~/app/_components/checkpoint-recovery";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    receipt?: string;
    checkpoint?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const account = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (
    !account ||
    account.suspendedAt ||
    account.mergedIntoId ||
    account.recoveryVoidedAt ||
    !["ADMIN", "HEAD", "COORDINATOR"].includes(account.role)
  )
    redirect("/admin");
  const params = await searchParams;
  const checkpoint =
    typeof params.checkpoint === "string" && params.checkpoint.length <= 200
      ? params.checkpoint
      : "";
  return (
    <div className="space-y-8">
      <AdmissionRecovery
        actorId={
          ["ADMIN", "HEAD"].includes(account.role) ? session.user.id : undefined
        }
        initialAction={
          typeof params.action === "string" && params.action.length <= 200
            ? params.action
            : ""
        }
        initialReceipt={
          !checkpoint &&
          typeof params.receipt === "string" &&
          params.receipt.length <= 200
            ? params.receipt
            : ""
        }
        canInspectRecords={["ADMIN", "HEAD"].includes(account.role)}
        coordinator={account.role === "COORDINATOR"}
      />
      <CheckpointRecovery
        role={account.role as "ADMIN" | "HEAD" | "COORDINATOR"}
        initialCheckpoint={checkpoint}
        initialReceipt={
          checkpoint &&
          typeof params.receipt === "string" &&
          params.receipt.length <= 200
            ? params.receipt
            : ""
        }
      />
    </div>
  );
}
