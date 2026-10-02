"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { graduationYear } from "~/lib/period";
import { ALL_GRADES } from "~/lib/profile-policy";
import {
  useProfilePolicy,
  OfferedGradeSelect,
  ProfilePolicyError,
  ProfilePolicyLoadError,
} from "./profile-policy";
import { academicInput, type AcademicSummary } from "~/lib/academics";
import { useDialogBusy, useDialogPending } from "./ui/modal";

/** Grade and graduation share one reference year; participation never determines academics. */
export function AcademicDetails({
  academic,
  showSchoolYear = true,
  compact = false,
}: {
  academic?: AcademicSummary;
  showSchoolYear?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("academics");
  // Rosters flag uncertain grades in two lines; detail views preserve the original report.
  if (
    compact &&
    (!academic ||
      academic.status === "UNKNOWN" ||
      (academic.status === "REPORTED" && academic.needsConfirmation))
  ) {
    return (
      <div className="text-sm leading-5">
        <p className="font-medium text-slate-900">{t("rosterUnknown")}</p>
        <p className="text-xs font-medium text-amber-800">
          {t("rosterNeedsConfirmation")}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium text-slate-900">
        {academic?.status === "NOT_APPLICABLE"
          ? t("notApplicable")
          : academic?.status === "GRADUATED"
            ? t("graduated")
            : academic?.status === "REPORTED" && academic.gradeLevel !== null
              ? t("gradeValue", { grade: academic.gradeLevel })
              : t("unknown")}
      </p>
      {academic?.rawGrade && academic.status === "UNKNOWN" && (
        <p className="break-words text-slate-600">
          {t("original", { value: academic.rawGrade })}
        </p>
      )}
      {showSchoolYear && academic?.schoolYear && (
        <p className="text-slate-600">
          {t("reference", { year: academic.schoolYear })}
        </p>
      )}
      {academic?.status !== "GRADUATED" && (
        <p className="text-slate-600">
          {academic?.expectedGraduationYear != null
            ? t("graduationValue", {
                year: String(academic.expectedGraduationYear),
              })
            : t("graduationUnknown")}
        </p>
      )}
      {academic?.needsConfirmation && (
        <p className="font-medium text-amber-800">{t("needsConfirmation")}</p>
      )}
    </div>
  );
}

type AcademicSnapshot = {
  academic: AcademicSummary;
  profileVersion: number;
  currentSchoolYear: string | null;
  offeredGrades?: number[];
};
type AcademicDraft = Parameters<
  ReturnType<typeof api.account.updateAcademics.useMutation>["mutate"]
>[0];

/** A draft owns its original version until saved or deliberately reloaded. Background refetches
 * cannot silently overwrite typed values or turn an old draft into an authorized fresh write. */
export function AcademicForm({
  snapshot,
  pending,
  disabled = false,
  error,
  onSave,
  onCancel,
}: {
  snapshot: AcademicSnapshot;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  onSave: (draft: AcademicDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("academics");
  const dialogBusy = useDialogBusy();
  const busy = pending || dialogBusy || disabled;
  const [status, setStatus] = useState(snapshot.academic.status);
  const [grade, setGrade] = useState(
    snapshot.academic.gradeLevel?.toString() ?? "",
  );
  const [rawGrade, setRawGrade] = useState(snapshot.academic.rawGrade ?? "");
  // Capture the program year with this draft; a rollover requires explicit review before retrying.
  const [schoolYear] = useState(snapshot.currentSchoolYear);
  const offeredGrades = snapshot.offeredGrades ?? ALL_GRADES;
  const [reason, setReason] = useState("");
  const [expectedProfileVersion] = useState(snapshot.profileVersion);
  const draft: AcademicDraft = {
    status,
    gradeLevel: status === "REPORTED" && grade ? Number(grade) : null,
    rawGrade: status === "UNKNOWN" ? rawGrade.trim() || null : null,
    schoolYear: status === "REPORTED" ? schoolYear : null,
    expectedSchoolYear: schoolYear,
    reason: reason.trim() || undefined,
    expectedProfileVersion,
  };
  const valid =
    academicInput.safeParse(draft).success &&
    (status !== "REPORTED" ||
      (!!schoolYear && offeredGrades.includes(Number(grade))));
  const graduation =
    status === "REPORTED" &&
    schoolYear &&
    grade &&
    offeredGrades.includes(Number(grade))
      ? graduationYear(Number(grade), schoolYear)
      : null;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSave(draft);
      }}
    >
      <fieldset disabled={busy} aria-busy={busy} className="space-y-4">
        <legend className="sr-only">{t("edit")}</legend>
        <label className="block">
          <span className="label">{t("status")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AcademicSummary["status"])
            }
          >
            <option value="REPORTED">{t("reported")}</option>
            <option value="UNKNOWN">{t("unknown")}</option>
            <option value="GRADUATED">{t("graduated")}</option>
            <option value="NOT_APPLICABLE">{t("notApplicable")}</option>
          </select>
        </label>
        {status === "REPORTED" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">{t("grade")}</span>
              <OfferedGradeSelect
                required
                value={grade}
                onChange={setGrade}
                offeredGrades={offeredGrades}
              />
            </label>
            <div className="space-y-1">
              <p className="label">{t("schoolYear")}</p>
              <p className="text-sm text-slate-700">
                {schoolYear
                  ? t("autoYear", { year: schoolYear })
                  : t("noCurrentYear")}
              </p>
              <p className="text-sm font-medium text-slate-700">
                {graduation
                  ? t("graduationValue", { year: String(graduation) })
                  : t("graduationUnknown")}
              </p>
            </div>
          </div>
        )}
        {status === "UNKNOWN" && (
          <label className="block">
            <span className="label">{t("rawGrade")}</span>
            <input
              className="input min-h-11 w-full lg:min-h-10"
              value={rawGrade}
              maxLength={200}
              onChange={(event) => setRawGrade(event.target.value)}
            />
            <span className="muted text-xs">{t("rawHelp")}</span>
          </label>
        )}
        <label className="block">
          <span className="label">{t("reason")}</span>
          <textarea
            className="textarea w-full"
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="muted text-sm">{t("confirmHelp")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={!valid || busy}
          >
            {t(pending ? "saving" : "confirm")}
          </button>
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={busy}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            {t("cancel")}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          <ProfilePolicyError message={error} />
        </p>
      )}
    </form>
  );
}

export function AcademicPanel({ userId }: { userId?: string }) {
  const t = useTranslations("academics");
  const format = useFormatter();
  const utils = api.useUtils();
  const router = useRouter();
  const policy = useProfilePolicy();
  const self = api.account.me.useQuery(undefined, { enabled: !userId });
  const staff = api.admin.accountAcademics.useQuery(
    { userId: userId ?? "" },
    { enabled: !!userId },
  );
  const [showHistory, setShowHistory] = useState(false);
  const selfHistory = api.account.academicHistory.useQuery(undefined, {
    enabled: !userId && showHistory,
  });
  const data = userId ? staff.data : self.data;
  const history = userId ? staff.data?.history : selfHistory.data;
  const [snapshot, setSnapshot] = useState<AcademicSnapshot | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  // Own refs exclude a second submit/reload before mutation state reaches a render.
  const submitting = useRef(false);
  const reloadPending = useRef(false);
  const settled = () => {
    submitting.current = false;
  };
  const refresh = async () => {
    // These records also appear in rosters, workspaces and server-rendered headers.
    await Promise.all([
      utils.account.me.invalidate(),
      utils.account.academicHistory.invalidate(),
      utils.admin.accountAcademics.invalidate(),
      utils.admin.accounts.invalidate(),
      utils.admin.tutors.invalidate(),
      utils.admin.tutees.invalidate(),
      utils.tuteeHistory.invalidate(),
      utils.tutor.me.invalidate(),
      utils.tutor.myProfile.invalidate(),
      utils.tutorDetails.invalidate(),
    ]);
    setSnapshot(null);
    setSaved(true);
    router.refresh();
  };
  const ownSave = api.account.updateAcademics.useMutation({
    onSuccess: refresh,
    onSettled: settled,
  });
  const staffSave = api.admin.updateAccountAcademics.useMutation({
    onSuccess: refresh,
    onSettled: settled,
  });
  const mutation = userId ? staffSave : ownSave;
  // The panel outlives its editable snapshot, so registration covers the whole
  // write and awaited refresh, plus both required explicit Reload reads.
  // Never register the inherited dialog busy state.
  const pending = useDialogPending(mutation.isPending || reloading);
  const query = userId ? staff : self;
  const beginEdit = () => {
    if (pending || submitting.current || reloadPending.current) return;
    if (data && policy.data) {
      mutation.reset();
      setReloadFailed(false);
      setSaved(false);
      setSnapshot({
        academic: data.academic,
        profileVersion: data.profileVersion,
        currentSchoolYear: policy.currentSchoolYear,
        offeredGrades: policy.offeredGrades,
      });
    }
  };
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 max-w-prose text-sm">{t("help")}</p>
        </div>
        {!snapshot && data && (
          <button
            type="button"
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={!policy.data || pending}
            onClick={beginEdit}
          >
            {t(data.academic.needsConfirmation ? "review" : "edit")}
          </button>
        )}
      </div>
      <ProfilePolicyLoadError
        error={policy.error}
        onRetry={() => void policy.refetch()}
      />
      {(query.isLoading || policy.isLoading) && (
        <p role="status" className="muted text-sm">
          {t("loading")}
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-red-700">
          {query.error.message}
        </p>
      )}
      {snapshot ? (
        <AcademicForm
          snapshot={snapshot}
          pending={mutation.isPending}
          disabled={reloading}
          error={
            mutation.error?.data?.approvalId
              ? undefined
              : mutation.error?.data?.code === "CONFLICT" &&
                  !mutation.error.message.startsWith("PROFILE_")
                ? t("conflict")
                : mutation.error?.message
          }
          onSave={(draft) => {
            if (pending || submitting.current || reloadPending.current) return;
            submitting.current = true;
            if (userId) staffSave.mutate({ ...draft, userId });
            else ownSave.mutate(draft);
          }}
          onCancel={() => {
            if (pending || submitting.current || reloadPending.current) return;
            setSnapshot(null);
            mutation.reset();
            setReloadFailed(false);
          }}
        />
      ) : (
        data && <AcademicDetails academic={data.academic} />
      )}
      {snapshot && mutation.error?.data?.code === "CONFLICT" && (
        <button
          type="button"
          className="btn-secondary min-h-11 lg:min-h-10"
          disabled={pending}
          onClick={async () => {
            if (pending || submitting.current || reloadPending.current) return;
            // Reload is explicit because it discards the conflicting academic draft only.
            reloadPending.current = true;
            setReloading(true);
            setReloadFailed(false);
            try {
              // Failed refetches can retain cached data. Both reads must report
              // success before discarding the draft; wait for both even if one throws.
              const [academicRead, policyRead] = await Promise.allSettled([
                (async () => query.refetch())(),
                (async () => policy.refetch())(),
              ]);
              if (
                academicRead.status === "fulfilled" &&
                policyRead.status === "fulfilled" &&
                academicRead.value.isSuccess &&
                policyRead.value.isSuccess &&
                academicRead.value.data &&
                policyRead.value.data
              ) {
                setSnapshot(null);
                mutation.reset();
              } else {
                setReloadFailed(true);
              }
            } catch {
              setReloadFailed(true);
            } finally {
              reloadPending.current = false;
              setReloading(false);
            }
          }}
        >
          {t("reload")}
        </button>
      )}
      {snapshot && reloadFailed && (
        <p role="alert" className="text-sm text-red-700">
          {t("reloadFailed")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
      {mutation.error?.data?.approvalId && (
        <p role="status" className="text-sm text-amber-800">
          {t("requested")}
        </p>
      )}
      {data?.academic.confirmedAt && (
        <p className="muted text-xs">
          {t("confirmed", {
            date: format.dateTime(new Date(data.academic.confirmedAt), {
              dateStyle: "medium",
            }),
          })}
        </p>
      )}
      <details
        className="border-t border-slate-100 pt-3"
        onToggle={(event) => setShowHistory(event.currentTarget.open)}
      >
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700 lg:min-h-8">
          {t("history")}
        </summary>
        {showHistory && (
          <div className="mt-2 space-y-3">
            {selfHistory.isFetching && !userId && (
              <p role="status" className="muted text-sm">
                {t("loading")}
              </p>
            )}
            {selfHistory.error && !userId && (
              <p role="alert" className="text-sm text-red-700">
                {selfHistory.error.message}
              </p>
            )}
            {history?.length === 0 && (
              <p className="muted text-sm">{t("noHistory")}</p>
            )}
            {history?.map((item) => (
              <div
                key={item.id}
                className="border-l-2 border-slate-200 pl-3 text-sm"
              >
                <p className="font-medium">
                  {item.status === "REPORTED" && item.gradeLevel !== null
                    ? t("gradeValue", { grade: item.gradeLevel })
                    : t(
                        item.status === "NOT_APPLICABLE"
                          ? "notApplicable"
                          : item.status === "GRADUATED"
                            ? "graduated"
                            : "unknown",
                      )}
                  {item.schoolYear ? ` · ${item.schoolYear}` : ""}
                </p>
                <p className="muted">
                  {format.dateTime(new Date(item.confirmedAt), {
                    dateStyle: "medium",
                  })}{" "}
                  ·{" "}
                  {t(
                    item.source === "STAFF"
                      ? "staffSource"
                      : item.source === "SELF_SERVICE"
                        ? "selfSource"
                        : "intakeSource",
                  )}
                </p>
                {item.rawGrade && (
                  <p className="break-words">
                    {t("original", { value: item.rawGrade })}
                  </p>
                )}
                {item.reason && (
                  <p className="break-words text-slate-600">{item.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
