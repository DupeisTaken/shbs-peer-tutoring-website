"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "~/app/_components/profile-dialog";

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
    <section className="card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <h2 className="section-title">{t("myTitle")}</h2>
        <p className="muted mt-1">{t("myHelp")}</p>
      </div>
      <button
        ref={trigger}
        type="button"
        className="btn-secondary min-h-11 whitespace-normal lg:min-h-10"
        onClick={() => setOpen(true)}
      >
        {t("editMine")}
      </button>
      {open && (
        <ProfileDialog title={t("myTitle")} onClose={close}>
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
  const rows = query.data.rows.filter((row) =>
    [row.name, row.group?.name ?? "", row.level?.name ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  );
  return (
    <div className="space-y-4">
      <p className="muted text-sm">{t("independent")}</p>
      <p className="text-sm">
        {t(query.data.canEdit ? "autoSave" : "readOnly")}
      </p>
      <label className="block">
        <span className="label">{t("searchMine")}</span>
        <input
          className="input min-h-11 w-full lg:min-h-10"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {save.error && (
        <p role="alert" className="text-sm text-red-700">
          {save.error.message}
        </p>
      )}
      <p role="status" className="text-sm text-green-700">
        {save.isPending ? t("saving") : save.isSuccess ? workflow("saved") : ""}
      </p>
      {rows.map((row) => (
        <article
          key={row.id}
          aria-label={row.name}
          className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <p className="muted text-xs">
              {row.group?.name ?? t("ungrouped")}
              {row.level ? ` · ${row.level.name}` : ""}
            </p>
            <h3 className="mt-1 font-semibold [overflow-wrap:anywhere]">
              {row.name}
            </h3>
            <span
              className={`${row.qualified ? "badge-green" : "badge-slate"} mt-2`}
            >
              {t(row.qualified ? "qualified" : "notQualified")}
            </span>
            {!row.active && (
              <span className="badge-slate mt-2 ml-2">
                {t("inactiveSubject")}
              </span>
            )}
          </div>
          <label>
            <span className="label">{t("willingness")}</span>
            <select
              className="select min-h-11 w-full lg:min-h-10"
              aria-label={t("willingnessFor", { subject: row.name })}
              disabled={!query.data.canEdit || save.isPending}
              value={
                row.willing === null ? "UNKNOWN" : row.willing ? "YES" : "NO"
              }
              onChange={(event) =>
                save.mutate({
                  subjectId: row.id,
                  willing: event.target.value === "YES",
                })
              }
            >
              <option value="UNKNOWN" disabled>
                {t("notRecorded")}
              </option>
              <option value="YES" disabled={!row.active}>
                {t("willing")}
              </option>
              <option value="NO">{t("notWilling")}</option>
            </select>
          </label>
        </article>
      ))}
      {rows.length === 0 && <p className="muted">{t("noMatchingSubjects")}</p>}
    </div>
  );
}
