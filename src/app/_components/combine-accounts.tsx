"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";

/** Kept independent of roster filters: a deliberate pair selection never follows matching names.
 * Any selection change discards the preview and password, preventing stale confirmation. */
export function CombineAccounts() {
  const t = useTranslations("combineAccounts");
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState("");
  const [duplicateId, setDuplicateId] = useState("");
  const [preview, setPreview] = useState<
    RouterOutputs["accountCombine"]["preview"] | null
  >(null);
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const candidates = api.accountCombine.candidates.useQuery(undefined, {
    enabled: open,
  });
  const combine = api.accountCombine.combine.useMutation({
    onSuccess: async () => {
      setPreview(null);
      setPassword("");
      setAcknowledged(false);
      setSurvivorId("");
      setDuplicateId("");
      setDone(true);
      await Promise.all([
        utils.admin.accounts.invalidate(),
        utils.accountCombine.candidates.invalidate(),
      ]);
    },
    onError: (failure) => {
      setError(failure.message);
      setPassword("");
      setAcknowledged(false);
      setPreview(null);
    },
  });
  const pending = loading || combine.isPending;
  function resetReview() {
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
    setError(null);
    setDone(false);
  }
  async function review() {
    resetReview();
    setLoading(true);
    try {
      setPreview(
        await utils.accountCombine.preview.fetch({ survivorId, duplicateId }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("failed"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="card overflow-hidden" aria-labelledby="combine-title">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 id="combine-title" className="font-semibold">
            {t("title")}
          </h2>
          <p className="muted mt-1 text-sm">{t("intro")}</p>
        </div>
        <button
          type="button"
          className="btn-secondary min-h-11 lg:min-h-9"
          aria-expanded={open}
          aria-controls="combine-content"
          disabled={pending}
          onClick={() => {
            setOpen(!open);
            resetReview();
          }}
        >
          {open ? t("close") : t("open")}
        </button>
      </div>
      {open && (
        <div
          id="combine-content"
          className="space-y-4 border-t border-slate-200 p-4"
        >
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            {t("warning")}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {(["survivor", "duplicate"] as const).map((kind) => (
              <label key={kind} className="space-y-1 text-sm font-medium">
                <span>{t(kind)}</span>
                <select
                  className="input min-h-11 w-full"
                  value={kind === "survivor" ? survivorId : duplicateId}
                  disabled={pending}
                  onChange={(event) => {
                    resetReview();
                    (kind === "survivor" ? setSurvivorId : setDuplicateId)(
                      event.target.value,
                    );
                  }}
                >
                  <option value="">{t("choose")}</option>
                  {candidates.data?.map((person) => (
                    <option
                      key={person.id}
                      value={person.id}
                      disabled={
                        person.id ===
                        (kind === "survivor" ? duplicateId : survivorId)
                      }
                    >
                      {person.name ?? person.username ?? person.email} ·{" "}
                      {person.email} · {person.role}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {candidates.error && (
            <p role="alert" className="text-sm text-red-700">
              {candidates.error.message}
            </p>
          )}
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={
              pending ||
              !survivorId ||
              !duplicateId ||
              survivorId === duplicateId
            }
            onClick={() => void review()}
          >
            {loading ? t("loading") : t("preview")}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {done && (
            <p
              role="status"
              className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
            >
              {t("success")}
            </p>
          )}
          {preview && (
            <div className="space-y-4" aria-live="polite">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <h3 className="text-sm font-semibold">{t("retained")}</h3>
                  <p className="mt-2 font-medium">{preview.survivor.name}</p>
                  <p className="mt-2 font-medium break-all">
                    {preview.survivor.email}
                  </p>
                  <p className="text-sm">
                    @{preview.survivor.username ?? "—"} · {preview.result.role}
                  </p>
                  <p className="mt-2 text-sm">
                    {t("access", {
                      tutor: preview.linkedProfiles?.tutor ?? "—",
                      student: preview.linkedProfiles?.student ?? "—",
                      crew: preview.result.crewStatus ?? "—",
                      translator: preview.result.canTranslate
                        ? t("yes")
                        : t("no"),
                    })}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold">{t("retired")}</h3>
                  <p className="mt-2 font-medium break-all">
                    {preview.duplicate.email}
                  </p>
                  <p className="text-sm">
                    @{preview.duplicate.username ?? "—"}
                  </p>
                  <p className="muted mt-2 text-sm break-all">
                    {t("reserved", {
                      emails: preview.retiredEmails.join(", "),
                    })}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {Object.entries(preview.counts).map(([key, count]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <p className="text-xl font-semibold tabular-nums">
                      {count}
                    </p>
                    <p className="muted text-sm">{t(`counts.${key}`)}</p>
                  </div>
                ))}
              </div>
              <p className="muted text-sm">{t("history")}</p>
              {preview.conflicts.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
                >
                  <h3 className="font-semibold">{t("blocked")}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {preview.conflicts.map((conflict) => (
                      <li key={conflict}>{conflict}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <form
                  className="space-y-3 border-t border-slate-200 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (password && acknowledged)
                      combine.mutate({
                        survivorId,
                        duplicateId,
                        fingerprint: preview.fingerprint,
                        confirmPassword: password,
                      });
                  }}
                >
                  <label className="flex min-h-11 items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={pending}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                    <span>{t("acknowledge")}</span>
                  </label>
                  <label className="block max-w-sm space-y-1 text-sm font-medium">
                    <span>{t("password")}</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={pending}
                      className="input min-h-11 w-full"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-primary min-h-11"
                    disabled={pending || !password || !acknowledged}
                  >
                    {combine.isPending ? t("working") : t("confirm")}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
