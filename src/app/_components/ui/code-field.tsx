"use client";

import { useId, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import {
  EMAIL_CODE_PATTERN,
  normalizeRegCodeDraft,
} from "~/lib/registration-code";
import { FieldRequirement } from "../field-requirement";

type CodePurpose = "invitation" | "email";
type CodeInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "size"
> & {
  purpose: CodePurpose;
  value?: string;
  onValueChange?: (value: string) => void;
};

/** Keep the legacy single text box. Purpose changes only its background and
 * placeholder length; one native editor preserves selection, paste and autofill.
 * Compatibility limits deliberately accept complete outstanding codes. */
export function CodeInput({
  purpose,
  value,
  onValueChange,
  id,
  required = true,
  className = "",
  ...props
}: CodeInputProps) {
  const t = useTranslations("codes");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState("");
  const code = value ?? draft;
  const keyboard =
    purpose === "invitation" || /[A-Z]/i.test(code) ? "text" : "numeric";
  const positions = purpose === "invitation" ? 5 : 4;
  const update = (raw: string) => {
    // Do not reinterpret digit 1 while a partially typed legacy code grows.
    const next = normalizeRegCodeDraft(raw, true);
    setDraft(next);
    onValueChange?.(next);
  };
  return (
    <div
      className={`code-field min-w-0 ${className}`}
      data-code-purpose={purpose}
    >
      <label className="label" htmlFor={inputId}>
        {t(`${purpose}Label`)}
        {required && <FieldRequirement state="required" />}
      </label>
      <input
        {...props}
        id={inputId}
        className="input code-native w-full text-center text-2xl tracking-[0.4em] uppercase"
        type="text"
        inputMode={keyboard}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        required={required}
        placeholder={"X".repeat(positions)}
        minLength={positions}
        pattern={
          purpose === "email"
            ? EMAIL_CODE_PATTERN
            : "(?:[0-9A-Z]{5}|[0-9A-F]{12})"
        }
        maxLength={30}
        value={code}
        aria-describedby={[`${inputId}-help`, props["aria-describedby"]]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) => update(event.target.value)}
        onPaste={(event) => {
          // Full-code paste may contain spaces/hyphens; never let maxlength
          // remove the last digit before normalization.
          event.preventDefault();
          const input = event.currentTarget;
          update(
            code.slice(0, input.selectionStart ?? 0) +
              event.clipboardData.getData("text") +
              code.slice(input.selectionEnd ?? code.length),
          );
        }}
      />
      <p id={`${inputId}-help`} className="sr-only">
        {t(`${purpose}Help`)}
      </p>
    </div>
  );
}

/** Keep copy/export text intact, including leading zeros and issued legacy codes. */
export function CodeDisplay({
  code,
  purpose = "invitation",
  className = "",
}: {
  code: string;
  purpose?: CodePurpose;
  className?: string;
}) {
  const t = useTranslations("codes");
  return (
    <div className={`code-display ${className}`} data-code-purpose={purpose}>
      <p className="mb-2 text-sm text-slate-500">{t(`${purpose}Label`)}</p>
      <p className="text-2xl font-semibold tracking-[0.4em] break-all text-slate-900">
        {code}
      </p>
    </div>
  );
}
