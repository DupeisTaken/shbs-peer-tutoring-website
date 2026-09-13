import { getTranslations } from "next-intl/server";
import { WorkflowShell } from "~/app/_components/workflow-shell";
import { MessageInbox } from "~/app/_components/message-inbox";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { messageDestination } from "~/lib/messaging";
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  const destination = messageDestination(user.role);
  if (destination !== "/messages") redirect(destination);
  const t = await getTranslations("workflows");
  return (
    <WorkflowShell title={t("messages")}>
      <MessageInbox />
    </WorkflowShell>
  );
}
