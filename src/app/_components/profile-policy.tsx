"use client";

import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { GRADUATED_GRADE } from "~/lib/academics";

/** The public policy is cached once by tRPC, even when several fields share these helpers. */
export function useProfilePolicy() {
  const query = api.program.profilePolicy.useQuery();
  return {
    ...query,
    offeredGrades: query.data?.offeredGrades ?? [],
    currentSchoolYear: query.data?.currentSchoolYear ?? null,
  };
}

export function ProfilePolicyHint({
  field = "preferred",
}: {
  field?: "preferred" | "legal";
}) {
  const t = useTranslations("profilePolicy");
  const policy = useProfilePolicy();
  if (policy.error)
    return (
      <ProfilePolicyLoadError
        error={policy.error}
        onRetry={() => void policy.refetch()}
      />
    );
  // The other-language field is unrestricted; Latin guidance is a fixed rule now.
  return field !== "legal" ? (
    <p className="muted text-sm">{t("nameHint")}</p>
  ) : null;
}

export { ProfilePolicyError } from "./profile-policy-error";

/** Failed policy reads must be visible; form fields never guess which grades are currently offered. */
export function ProfilePolicyLoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations("profilePolicy");
  if (!error) return null;
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-red-700">
        {t("loadFailed")}
      </p>
      <button
        type="button"
        className="btn-secondary min-h-11 lg:min-h-8"
        onClick={onRetry}
      >
        {t("retry")}
      </button>
    </div>
  );
}

/** Removed grades require a fresh choice for confirmation. Provisional roster edits can
 * retain an unchanged legacy value so correcting a name never erases historical evidence. */
export function OfferedGradeSelect({
  id,
  name,
  preserveLegacy = false,
  includeGraduated = false,
  value,
  onChange,
  offeredGrades,
  required = false,
}: {
  id?: string;
  name?: string;
  preserveLegacy?: boolean;
  includeGraduated?: boolean;
  value: string;
  onChange: (value: string) => void;
  offeredGrades: number[];
  required?: boolean;
}) {
  const t = useTranslations();
  const unavailable =
    !!value &&
    value !== GRADUATED_GRADE &&
    !offeredGrades.includes(Number(value));
  return (
    <select
      id={id}
      name={name}
      className="select min-h-11 w-full lg:min-h-10"
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        {t(required ? "academics.selectGrade" : "profilePolicy.unknownGrade")}
      </option>
      {unavailable && (
        <option value={value} disabled={!preserveLegacy}>
          {t("profilePolicy.previousGrade", { grade: value })}
        </option>
      )}
      {offeredGrades.map((grade) => (
        <option key={grade} value={grade}>
          {t("academics.gradeValue", { grade })}
        </option>
      ))}
      {includeGraduated && (
        <option value={GRADUATED_GRADE}>{t("academics.graduated")}</option>
      )}
    </select>
  );
}
