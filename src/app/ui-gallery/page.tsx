import { notFound } from "next/navigation";
import { UIGallery } from "./gallery";

export const metadata = {
  title: "UI pattern gallery",
  robots: { index: false, follow: false },
};

/** Synthetic examples belong to development; this gate executes on the server. */
export default function UIGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UIGallery />;
}
