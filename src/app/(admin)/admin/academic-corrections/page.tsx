import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { HistoricalAcademicCorrections } from "~/app/_components/historical-academic-corrections";

export default async function AcademicCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ participantId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, suspendedAt: true },
  });
  if (
    !user ||
    user.suspendedAt ||
    !["HEAD", "ADMIN"].includes(user.role)
  )
    redirect("/admin");
  const query = await searchParams;
  return (
    <HistoricalAcademicCorrections
      coordinator={user.role === "ADMIN"}
      initialSearch={
        typeof query.participantId === "string"
          ? query.participantId.slice(0, 100)
          : ""
      }
    />
  );
}
