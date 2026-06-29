import { redirect } from "next/navigation";

import { authorizeHomeEditor } from "~/server/home/images";
import { LandingView } from "~/app/_components/landing-view";

/**
 * Editor-only preview of the public landing page (`/`) — same render, but without the signed-in
 * redirect and with unpublished news + hidden sections shown (badged). Lives outside the `(admin)`
 * shell so it's a faithful, full-bleed copy of the real page. Middleware already requires a session;
 * this narrows it to landing editors.
 */
export default async function LandingPreviewPage() {
  const access = await authorizeHomeEditor();
  if (!access.ok) redirect("/");
  return <LandingView preview />;
}
