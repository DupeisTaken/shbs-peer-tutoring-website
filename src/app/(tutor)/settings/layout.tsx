import { pageMetadata } from "~/server/branding-metadata";

export async function generateMetadata() {
  return pageMetadata("tutor.settings.title");
}

export default function RouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
