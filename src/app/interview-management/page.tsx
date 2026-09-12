import { redirect } from "next/navigation";
/** Existing notification links remain valid after moving the staff workspace. */
export default function Page() {
  redirect("/admin/interviews");
}
