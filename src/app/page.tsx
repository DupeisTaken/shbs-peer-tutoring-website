import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { APP_TITLE } from "~/lib/branding";
import { LanguageSwitcher } from "~/app/_components/language-switcher";

export default async function Home() {
  // Signed-in users skip the landing page and go straight to their area.
  const session = await auth();
  if (session?.user) {
    const adminArea =
      session.role === "ADMIN" || session.role === "COORDINATOR" || session.role === "VIEWER";
    redirect(adminArea ? "/admin" : "/dashboard");
  }

  const t = await getTranslations("landing");

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top banner: brand + the three entry points */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-slate-900">
            {APP_TITLE}
          </Link>
          <nav className="flex flex-wrap items-center gap-2">
            <Link href="/signup" className="btn-primary btn-sm">
              {t("nav.requestTutor")}
            </Link>
            <Link href="/tutor-signup" className="btn-secondary btn-sm">
              {t("nav.becomeTutor")}
            </Link>
            <Link href="/signin" className="btn-secondary btn-sm">
              {t("nav.teamSignin")}
            </Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero / brief program introduction (placeholder copy) */}
        <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50 via-white to-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-200/40 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
            <span className="badge-slate mb-5">{t("tagline")}</span>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
              <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                {t("heroTitle")}
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
              {t("intro", { appTitle: APP_TITLE })}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="btn-primary">
                {t("ctaPrimary")}
              </Link>
              <Link href="/tutor-signup" className="btn-secondary">
                {t("ctaSecondary")}
              </Link>
            </div>
          </div>
        </section>

        {/* Program highlights (placeholder) */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <FeatureCard
              emoji="🎓"
              title={t("features.students.title")}
              body={t("features.students.body")}
            />
            <FeatureCard
              emoji="🧑‍🏫"
              title={t("features.tutors.title")}
              body={t("features.tutors.body")}
            />
            <FeatureCard
              emoji="🗂️"
              title={t("features.team.title")}
              body={t("features.team.body")}
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6">
        <p className="muted text-center text-sm">{t("footer", { appTitle: APP_TITLE })}</p>
      </footer>
    </div>
  );
}

function FeatureCard({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card p-6">
      <div className="text-2xl">{emoji}</div>
      <h2 className="mt-3 font-semibold text-slate-900">{title}</h2>
      <p className="muted mt-1 text-sm">{body}</p>
    </div>
  );
}
