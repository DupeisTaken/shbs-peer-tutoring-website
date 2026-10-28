import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { RecordTransfer } from "~/app/_components/record-transfer";
import { SessionPagePosition } from "~/app/_components/session-view-state";

export default async function RecordsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, suspendedAt: true },
  });
  if ((!user || !["HEAD", "ADMIN"].includes(user.role)) || user.suspendedAt) redirect("/admin");
  return <><SessionPagePosition id="records" ready /><RecordTransfer /></>;
}
