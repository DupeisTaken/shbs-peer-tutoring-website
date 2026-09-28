import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { RecordTransfer } from "~/app/_components/record-transfer";

export default async function RecordsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, suspendedAt: true },
  });
  if (user?.role !== "HEAD" || user.suspendedAt) redirect("/admin");
  return <RecordTransfer />;
}
