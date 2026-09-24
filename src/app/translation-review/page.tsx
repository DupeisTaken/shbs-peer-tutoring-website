import { redirect } from "next/navigation";

/** Keep old bookmarks/notification links usable without retaining a standalone UI. */
export default function RetiredTranslationReviewPage() {
  redirect("/localization?view=review");
}
