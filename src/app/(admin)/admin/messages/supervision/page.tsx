import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { isMessageSupervisor } from "~/lib/messaging";
import { MessageAdmin } from "~/app/_components/message-admin";
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/signin");
  if (user.suspendedAt) redirect("/suspended");
  if (!isMessageSupervisor(user.role)) redirect("/messages");
  const t = await getTranslations("messaging");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("supervision")}</h1>
        <Link className="btn-secondary" href="/admin/messages">
          {t("ownInbox")}
        </Link>
      </div>
      <MessageAdmin />
    </div>
  );
}
