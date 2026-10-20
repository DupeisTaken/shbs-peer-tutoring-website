"use client";

import {
  useId,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
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

/** One native text field preserves selection, correction, paste and OTP autofill.
 * Slots are decoration only; the feature still owns challenge verification.
 * Longer issued codes switch to a plain editor instead of being truncated. */
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
  const [keyboardOverride, setKeyboardOverride] = useState<
    "numeric" | "text" | null
  >(null);
  const code = value ?? draft;
  const keyboard =
    keyboardOverride ?? (/[A-Z]/i.test(code) ? "text" : "numeric");
  const positions = purpose === "invitation" ? 5 : 4;
  const legacy = code.length > positions;
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
      <div
        className="code-entry"
        data-legacy={legacy || undefined}
        style={{ "--code-positions": positions } as CSSProperties}
      >
        {!legacy && (
          <div className="code-positions" aria-hidden="true">
            {Array.from({ length: positions }, (_, index) => (
              <span key={index} data-filled={Boolean(code[index])} />
            ))}
          </div>
        )}
        <input
          {...props}
          id={inputId}
          className="code-native"
          type="text"
          inputMode={keyboard}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required={required}
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
      </div>
      <p id={`${inputId}-help`} className="mt-2 text-xs text-slate-600">
        {t(`${purpose}Help`)}
      </p>
      {/* Mobile numeric keyboards may offer no alphabet switch. Keep a deliberate
       * text-keyboard escape hatch while outstanding legacy codes remain valid. */}
      <button
        type="button"
        disabled={props.disabled}
        className="inline-flex min-h-11 items-center text-left text-xs text-slate-700 underline underline-offset-2 lg:min-h-8"
        onClick={() =>
          setKeyboardOverride(keyboard === "numeric" ? "text" : "numeric")
        }
      >
        {t(keyboard === "numeric" ? "lettersKeyboard" : "numericKeyboard")}
      </button>
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
      <p className="text-sm font-medium">{t(`${purpose}Label`)}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.25em] break-all">
        {code}
      </p>
      <p className="mt-2 text-xs">{t(`${purpose}Help`)}</p>
    </div>
  );
}
