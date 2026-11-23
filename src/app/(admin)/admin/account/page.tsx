import { pageMetadata } from "~/server/branding-metadata";
import { AdminAccountView } from "~/app/_components/admin-account-view";

export async function generateMetadata() {
  return pageMetadata("account.title");
}

export default function AccountPage() {
  return <AdminAccountView />;
}
