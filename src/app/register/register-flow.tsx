"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";

import { FieldRequirement } from "~/app/_components/field-requirement";

import { useRef, useState } from "react";
import { Button } from "~/app/_components/ui/button";
import { FormActions } from "~/app/_components/ui/patterns";
import { RegistrationProgress } from "~/app/_components/registration-progress";
import { AcademicError } from "~/app/_components/academic-error";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  registrationKindLabel,
  type RegistrationKind,
} from "~/lib/registration-kind";
import { api } from "~/trpc/react";
import {
  useProfilePolicy,
  ProfilePolicyError,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";

type Step = "code" | "email" | "emailCode" | "profile" | "done";

/**
 * Multi-step self-registration: redeem a 5-character security key, verify email with a second emailed
 * code, then set name / grade / password. All validation + account creation happen server-side
 * (registration router); this component only drives the wizard.
 */
export function RegisterFlow() {
  const t = useTranslations();
  const policy = useProfilePolicy();
  const flow = useTranslations("registrationFlow");
  const checkedCode = useRef("");
  const [kind, setKind] = useState<RegistrationKind | null>(null);
  const [step, setStep] = useState<Step>("code");

  // Collected across steps.
  const [code, setCode] = useState("");
  const [boundEmail, setBoundEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [completionProof, setCompletionProof] = useState("");
  const [legacyName, setLegacyName] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [grade, setGrade] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [academicConfirmationRequired, setAcademicConfirmationRequired] =
    useState(false);

  const check = api.registration.check.useMutation({
    onSuccess: (data) => {
      setKind(data.kind);
      setLegacyName(data.legacyName);
      setBoundEmail(data.boundEmail);
      // Rechecking the same invitation must not overwrite an edited profile.
      // A different invitation is a different identity: replace its prefill and credentials.
      if (checkedCode.current !== code) {
        setEmail(data.boundEmail ?? "");
        setFirstName(data.firstName ?? "");
        setLastName(data.lastName ?? "");
        setAltNames(data.alternativeNames ?? "");
        setPreferredName(data.preferredName ?? "");
        setGrade(data.gradeLevel != null ? String(data.gradeLevel) : "");
        setPassword("");
        setConfirm("");
      } else if (data.boundEmail) setEmail(data.boundEmail);
      checkedCode.current = code;
      // Database verification belongs to its original browser; checking an invitation is not proof.
      setCompletionProof("");
      setStep("email");
    },
  });
  const sendCode = api.registration.sendEmailCode.useMutation({
    onSuccess: () => {
      setCompletionProof("");
      setEmailCode("");
      verifyEmail.reset();
      complete.reset();
      setStep("emailCode");
    },
  });
  const verifyEmail = api.registration.verifyEmail.useMutation({
    onSuccess: (data) => {
      setCompletionProof(data.completionProof);
      setStep("profile");
    },
  });
  const complete = api.registration.complete.useMutation({
    onSuccess: (data) => {
      setUsername(data.username);
      setAcademicConfirmationRequired(data.academicConfirmationRequired);
      setStep("done");
    },
  });

  const passwordMismatch =
    password.length > 0 && confirm.length > 0 && password !== confirm;

  const busy =
    check.isPending ||
    sendCode.isPending ||
    verifyEmail.isPending ||
    complete.isPending;
  const steps: Step[] = ["code", "email", "emailCode", "profile", "done"];
  const titles = [
    flow("invitationTitle"),
    flow("emailTitle"),
    flow("verifyTitle"),
    flow("profileTitle"),
    t("auth.register.done.title"),
  ];
  function returnTo(next: Step) {
    if (busy) return;
    // Local evidence never survives identity editing; the existing server send/verify
    // endpoints issue a new proof. Other profile drafts remain in this component.
    setCompletionProof("");
    setEmailCode("");
    check.reset();
    sendCode.reset();
    verifyEmail.reset();
    complete.reset();
    setStep(next);
  }

  return (
    <fieldset
      disabled={busy}
      aria-busy={busy}
      aria-label={flow("progressTitle")}
      className="min-w-0 space-y-4"
    >
      <RegistrationProgress
        steps={titles}
        current={steps.indexOf(step)}
        title={titles[steps.indexOf(step)]!}
        busy={busy}
      />
      {kind && step !== "code" && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm font-semibold">
          {t("auth.register.grantedRole", {
            role: t(`admin.registrationCodes.${registrationKindLabel[kind]}`),
          })}
        </p>
      )}
      {/* Step 1 — security key */}
      {step === "code" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (/^[0-9A-Z]{5}$/.test(code)) check.mutate({ code });
          }}
        >
          <label className="label" htmlFor="reg-code">
            {t("auth.register.step.code.label")}
            <FieldRequirement state="required" />
          </label>
          <input
            id="reg-code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            required
            maxLength={5}
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, "")
                  .slice(0, 5),
              )
            }
            placeholder="XXXXX"
            className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
          />
          <p className="muted text-xs">{t("auth.register.step.code.help")}</p>
          {check.error && (
            <p role="alert" className="text-sm text-red-600">
              {check.error.message}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!/^[0-9A-Z]{5}$/.test(code) || check.isPending}
          >
            {t("auth.register.step.code.submit")}
          </Button>
        </form>
      )}

      {/* Step 2 — email entry */}
      {step === "email" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (email.trim()) sendCode.mutate({ code, email: email.trim() });
          }}
        >
          <label className="label" htmlFor="reg-email">
            {t("auth.register.step.email.label")}
            <FieldRequirement state="required" />
          </label>
          <input
            id="reg-email"
            required
            autoComplete="email"
            type="email"
            value={email}
            readOnly={!!boundEmail}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.register.step.email.placeholder")}
            className="input w-full"
          />
          {boundEmail && (
            <p className="muted text-xs">
              {t("auth.register.step.email.bound")}
            </p>
          )}
          {sendCode.error && (
            <p role="alert" className="text-sm text-red-600">
              {sendCode.error.message}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!email.trim() || sendCode.isPending}
          >
            {t("auth.register.step.email.send")}
          </Button>
          <FormActions>
            <Button onClick={() => returnTo("code")}>{flow("back")}</Button>
          </FormActions>
          <p className="muted text-xs">{flow("reverifyHelp")}</p>
        </form>
      )}

      {/* Step 2b — email code */}
      {step === "emailCode" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (/^[0-9A-Z]{5}$/.test(emailCode))
              verifyEmail.mutate({ code, emailCode });
          }}
        >
          <p className="text-sm text-slate-700">
            {t("auth.register.step.email.sent", { email })}
          </p>
          <label className="label" htmlFor="reg-emailcode">
            {t("auth.register.step.email.codeLabel")}
            <FieldRequirement state="required" />
          </label>
          <input
            id="reg-emailcode"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            required
            maxLength={5}
            value={emailCode}
            onChange={(e) =>
              setEmailCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, "")
                  .slice(0, 5),
              )
            }
            placeholder="XXXXX"
            className="input w-full text-center text-2xl tracking-[0.4em] uppercase"
          />
          {verifyEmail.error && (
            <p role="alert" className="text-sm text-red-600">
              {verifyEmail.error.message}
            </p>
          )}
          {sendCode.error && (
            <p role="alert" className="text-sm text-red-600">
              {sendCode.error.message}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!/^[0-9A-Z]{5}$/.test(emailCode) || verifyEmail.isPending}
          >
            {t("auth.register.step.email.verify")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => sendCode.mutate({ code, email: email.trim() })}
            disabled={sendCode.isPending}
          >
            {t("auth.register.step.email.resend")}
          </Button>
          <FormActions>
            <Button onClick={() => returnTo("email")}>
              {flow("editEmail")}
            </Button>
            <Button onClick={() => returnTo("code")}>
              {flow("editInvitation")}
            </Button>
          </FormActions>
          <p className="muted text-xs">{flow("reverifyHelp")}</p>
        </form>
      )}

      {/* Step 3 — profile + password */}
      {step === "profile" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (
              firstName.trim() &&
              password.length >= 8 &&
              confirm === password &&
              completionProof &&
              !sendCode.isPending &&
              (!grade.trim() ||
                (!!policy.currentSchoolYear &&
                  policy.offeredGrades.includes(Number(grade))))
            ) {
              complete.mutate({
                code,
                completionProof,
                preferredName: preferredName.trim() || undefined,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                alternativeNames: altNames.trim() || undefined,
                gradeLevel: grade.trim() ? Number(grade) : null,
                password,
              });
            }
          }}
        >
          <p className="rounded-lg bg-slate-50 p-3 text-sm break-words">
            {email}
          </p>
          <PersonNameFields
            legacyName={legacyName}
            value={{
              firstName,
              lastName,
              preferredName,
              alternativeNames: altNames,
            }}
            onChange={(value) => {
              setFirstName(value.firstName);
              setLastName(value.lastName);
              setPreferredName(value.preferredName);
              setAltNames(value.alternativeNames);
            }}
          />
          <div>
            <label className="label" htmlFor="reg-grade">
              {t("auth.register.step.profile.grade")}
              <FieldRequirement state="optional" />
            </label>
            <OfferedGradeSelect
              id="reg-grade"
              value={grade}
              onChange={setGrade}
              offeredGrades={policy.offeredGrades}
            />
          </div>
          {grade.trim() && (
            <p className="muted text-sm">
              {policy.currentSchoolYear
                ? t("academics.autoYear", { year: policy.currentSchoolYear })
                : t("academics.noCurrentYear")}
            </p>
          )}
          <div>
            <label className="label" htmlFor="reg-pass">
              {t("auth.register.step.profile.password")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="reg-pass"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
            />
            <p className="muted text-xs">
              {t("auth.register.step.profile.passwordHint")}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="reg-confirm">
              {t("auth.register.step.profile.confirm")}
              <FieldRequirement state="required" />
            </label>
            <input
              id="reg-confirm"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
          </div>
          {passwordMismatch && (
            <p role="alert" className="text-sm text-red-600">
              {t("auth.register.step.profile.mismatch")}
            </p>
          )}
          {complete.error && (
            <p role="alert" className="text-sm text-red-600">
              <ProfilePolicyError message={complete.error.message} />
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              !firstName.trim() ||
              (!!grade.trim() &&
                (!policy.currentSchoolYear ||
                  !policy.offeredGrades.includes(Number(grade)))) ||
              password.length < 8 ||
              confirm !== password ||
              !completionProof ||
              sendCode.isPending ||
              passwordMismatch ||
              complete.isPending
            }
          >
            {t("auth.register.step.profile.submit")}
          </Button>
          {sendCode.error && (
            <p role="alert" className="text-sm text-red-600">
              {sendCode.error.message}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={sendCode.isPending || complete.isPending}
            onClick={() => sendCode.mutate({ code, email: email.trim() })}
          >
            {t("auth.register.step.email.resend")}
          </Button>
          <FormActions>
            <Button onClick={() => returnTo("email")}>
              {flow("editEmail")}
            </Button>
            <Button onClick={() => returnTo("code")}>
              {flow("editInvitation")}
            </Button>
          </FormActions>
          <p className="muted text-xs">{flow("reverifyHelp")}</p>
        </form>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-700">
            {t("auth.register.done.body", { username })}
          </p>
          {academicConfirmationRequired && (
            <p
              role="status"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AcademicError
                message="ACADEMIC_CONFIRMATION_REQUIRED"
                selfService
              />
            </p>
          )}
          <Link href="/signin" className="btn-primary inline-block">
            {t("auth.register.done.signIn")}
          </Link>
        </div>
      )}
    </fieldset>
  );
}
