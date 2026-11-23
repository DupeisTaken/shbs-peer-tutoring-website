import { pageMetadata } from "~/server/branding-metadata";

export async function generateMetadata() {
  return pageMetadata("admin.nav.links.tutorApplications");
}

export default function RouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
