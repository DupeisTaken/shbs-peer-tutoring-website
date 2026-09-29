"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import styles from "./subject-willingness.module.css";

/** Keep subject intent discoverable beside qualifications, independent of timetable slots. */
export function SubjectWillingness() {
  const t = useTranslations("subjectAvailability");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    // Run after the modal is unmounted and the page is no longer inert, even in background tabs.
    if (!open && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);
  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  return (
    <section className={`card ${styles.entrance}`}>
      <div className="min-w-0 flex-1">
        <h2 className="section-title">{t("myTitle")}</h2>
        <p className="muted mt-1 max-w-xl text-sm leading-relaxed">
          {t("myHelp")}
        </p>
      </div>
      <button
        ref={trigger}
        type="button"
        className="btn-secondary min-h-11 shrink-0 gap-3 whitespace-normal lg:min-h-10"
        onClick={() => setOpen(true)}
      >
        {t("editMine")}
        <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <ProfileDialog title={t("myTitle")} onClose={close} size="wide">
          <WillingnessEditor />
        </ProfileDialog>
      )}
    </section>
  );
}

/** Mounted on demand. Confirmed server values stay visible until each immediate save succeeds. */
function WillingnessEditor() {
  const t = useTranslations("subjectAvailability");
  const workflow = useTranslations("workflows");
  const query = api.subjectAvailability.mySubjects.useQuery();
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const save = api.subjectAvailability.setMine.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.subjectAvailability.mySubjects.invalidate(),
        utils.subjectAvailability.mine.invalidate(),
        utils.subjectAvailability.options.invalidate(),
        utils.tutorDetails.invalidate(),
      ]);
    },
  });
  if (query.error)
    return (
      <div role="alert">
        <p>{query.error.message}</p>
        <button
          className="btn-secondary mt-3 min-h-11 lg:min-h-10"
          onClick={() => void query.refetch()}
        >
          {t("retry")}
        </button>
      </div>
    );
  if (!query.data) return <p role="status">{workflow("loading")}</p>;
  const needle = search.trim().toLocaleLowerCase();
  // Also exclude unqualified entries from any previously cached catalogue response.
  const rows = query.data.rows.filter(
    (row) =>
      row.qualified &&
      [row.name, row.group?.name ?? "", row.level?.name ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
  );
  return (
    <div className={styles.editor}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>{t("qualifiedOnly")}</p>
          <p className={styles.description}>{t("choiceHelp")}</p>
        </div>
        <label className={styles.search}>
          <span className="sr-only">{t("searchMine")}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            className="input min-h-11 w-full lg:min-h-10"
            placeholder={t("searchMine")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {!query.data.canEdit && (
        <p className={styles.description}>{t("readOnly")}</p>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-red-700">
          {save.error.message}
        </p>
      )}
      <div className={styles.list}>
        {rows.map((row) => (
          <article key={row.id} aria-label={row.name} className={styles.row}>
            <div className="min-w-0">
              <h3 className={styles.subjectName}>{row.name}</h3>
              <p className={styles.metadata}>
                {row.group?.name ?? t("ungrouped")}
                {row.level ? ` · ${row.level.name}` : ""}
              </p>
              {row.willing === null && (
                <span className={styles.unrecorded}>{t("notRecorded")}</span>
              )}
              {!row.active && (
                <span className="badge-slate mt-2 ml-2">
                  {t("inactiveSubject")}
                </span>
              )}
            </div>
            <div
              role="group"
              aria-label={t("willingnessFor", { subject: row.name })}
              className={styles.choices}
            >
              {/* Unknown intent selects neither button. A repeated choice never clears a saved answer. */}
              {[true, false].map((willing) => (
                <button
                  key={String(willing)}
                  type="button"
                  aria-pressed={row.willing === willing}
                  className={styles.choice}
                  disabled={
                    !query.data.canEdit ||
                    save.isPending ||
                    (willing && !row.active)
                  }
                  onClick={() => {
                    if (row.willing !== willing)
                      save.mutate({ subjectId: row.id, willing });
                  }}
                >
                  <span className={styles.indicator} aria-hidden="true">
                    {row.willing === willing && (
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m4 8 2.5 2.5L12 5" />
                      </svg>
                    )}
                  </span>
                  <span className={styles.choiceLabel}>
                    {t(willing ? "willingChoice" : "unwillingChoice")}
                  </span>
                </button>
              ))}
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <p className="muted">
            {t(
              query.data.rows.some((row) => row.qualified)
                ? "noMatchingSubjects"
                : "noQualifiedSubjects",
            )}
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <p>{t("scheduleSeparate")}</p>
        {/* A permanent status slot prevents rows moving when a save starts or completes. */}
        <p role="status" className={styles.saveStatus}>
          {save.isPending
            ? t("saving")
            : save.error
              ? ""
              : save.isSuccess
                ? workflow("saved")
                : query.data.canEdit
                  ? t("savesAutomatically")
                  : ""}
        </p>
      </div>
    </div>
  );
}
