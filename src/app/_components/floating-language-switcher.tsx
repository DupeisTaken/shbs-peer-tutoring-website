import { LanguageSwitcher } from "~/app/_components/language-switcher";

/**
 * Fixed top-right language toggle for the public / auth pages that have no header bar of their
 * own (signup, sign-in, password reset, onboarding). The tutor/admin areas embed the switcher
 * in their header instead.
 */
export function FloatingLanguageSwitcher() {
  return (
    <div className="fixed top-4 right-4 z-40">
      <LanguageSwitcher />
    </div>
  );
}
