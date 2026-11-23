import { pageMetadata } from "~/server/branding-metadata";
import { DatabaseInspector } from "~/app/_components/database-inspector";

export async function generateMetadata() {
  return pageMetadata("recordInspector.nav");
}

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; key?: string }>;
}) {
  const params = await searchParams;
  return (
    <DatabaseInspector
      initialTable={
        typeof params.table === "string" && params.table.length <= 100
          ? params.table
          : ""
      }
      initialKey={
        typeof params.key === "string" && params.key.length <= 4096
          ? params.key
          : ""
      }
    />
  );
}
