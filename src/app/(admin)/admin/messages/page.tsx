import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { isMessageManager, isMessageSupervisor } from "~/lib/messaging";
import { MessageInbox } from "~/app/_components/message-inbox";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  if (!isMessageManager(user.role)) redirect("/messages");
  const t = await getTranslations("workflows");
  const m = await getTranslations("messaging");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("messages")}</h1>
        {isMessageSupervisor(user.role) && (
          <Link className="btn-secondary" href="/admin/messages/supervision">
            {m("supervision")}
          </Link>
        )}
      </div>
      <MessageInbox />
    </div>
  );
}
