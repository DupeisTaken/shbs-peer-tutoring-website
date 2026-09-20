"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { isProgramTimeZone, programDateTimeInput } from "~/lib/program-time";
import { programTimeZoneLabel } from "~/lib/program-time-zone-label";

export function ProgramTimeZoneSettings() {
  const settings = api.program.timeZoneSettings.useQuery();
  const t = useTranslations("programTimeZone");
  if (settings.error) return <p role="alert">{settings.error.message}</p>;
  if (!settings.data) return <p className="muted">{t("loading")}</p>;
  return <TimeZoneEditor key={settings.data.timeZone} {...settings.data} />;
}

export function TimeZoneEditor({
  timeZone,
  canEdit,
  timeZoneOptions,
}: {
  timeZone: string;
  canEdit: boolean;
  timeZoneOptions: string[];
}) {
  const t = useTranslations("programTimeZone");
  const router = useRouter();
  const locale = useLocale();
  const utils = api.useUtils();
  const [zone, setZone] = useState(timeZone);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [example, setExample] = useState(
    () => new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`),
  );
  // Reformat the several hundred options only when the preview instant or locale
  // changes. Labels are presentation; option values remain the original IANA IDs.
  const choices = useMemo(
    () =>
      [...new Set(["UTC", timeZone, ...timeZoneOptions])].map((value) => ({
        value,
        label: programTimeZoneLabel(value, example, locale),
      })),
    [timeZone, timeZoneOptions, example, locale],
  );
  const valid = isProgramTimeZone(zone);
  const save = api.program.setTimeZone.useMutation({
    onSuccess: async () => {
      setSaved(true);
      await utils.program.timeZoneSettings.invalidate();
      // Reload server i18n context so client and server render the same new zone.
      router.refresh();
    },
  });
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1">{t("help")}</p>
      </div>
      <label className="block space-y-1">
        <span className="label">{t("referenceDate")}</span>
        <input
          type="date"
          className="input min-h-11 lg:min-h-10"
          value={example.toISOString().slice(0, 10)}
          onChange={(event) => {
            // Noon UTC is an explicit shared reference instant for all choices.
            const next = new Date(`${event.target.value}T12:00:00Z`);
            if (Number.isFinite(next.getTime())) setExample(next);
          }}
        />
      </label>
      <label className="block space-y-1">
        <span className="label">{t("zone")}</span>
        <select
          className="input min-h-11 w-full min-w-0 lg:min-h-10"
          aria-describedby="program-time-zone-label"
          value={zone}
          disabled={!canEdit || save.isPending}
          onChange={(e) => {
            setZone(e.target.value);
            setConfirmed(false);
            setSaved(false);
          }}
        >
          <option value="UTC">
            {choices.find((choice) => choice.value === "UTC")?.label}
          </option>
          {[
            ...new Set(
              choices
                .filter((choice) => choice.value !== "UTC")
                .map((choice) => choice.value.split("/")[0]!),
            ),
          ].map((region) => (
            <optgroup key={region} label={region}>
              {/* Keep a supplied saved alias visible even when it has no region/city separator. */}
              {choices
                .filter(
                  (choice) =>
                    choice.value === region ||
                    choice.value.startsWith(region + "/"),
                )
                .map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span
          id="program-time-zone-label"
          className="block text-sm break-words"
        >
          {choices.find((choice) => choice.value === zone)?.label}
        </span>
        <span className="muted text-xs">{t("iana")}</span>
      </label>
      {!valid && (
        <p role="alert" className="text-sm text-red-700">
          {t("invalid")}
        </p>
      )}
      {valid && zone !== timeZone && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-medium">{t("preview")}</p>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="inline font-medium">
                {programTimeZoneLabel(timeZone, example, locale)}:{" "}
              </dt>
              <dd className="inline">
                {programDateTimeInput(example, timeZone).replace("T", " ")}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">
                {programTimeZoneLabel(zone, example, locale)}:{" "}
              </dt>
              <dd className="inline">
                {programDateTimeInput(example, zone).replace("T", " ")}
              </dd>
            </div>
          </dl>
          <p className="mt-3">{t("impact")}</p>
        </div>
      )}
      {canEdit ? (
        <>
          <label className="flex min-h-11 items-start gap-2 text-sm lg:min-h-0">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={zone === timeZone || !valid}
              className="mt-1"
            />
            <span>{t("confirm")}</span>
          </label>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={
              !valid || !confirmed || zone === timeZone || save.isPending
            }
            onClick={() =>
              save.mutate({ timeZone: zone, expectedTimeZone: timeZone })
            }
          >
            {save.isPending ? t("saving") : t("save")}
          </button>
        </>
      ) : (
        <p className="muted">{t("readOnly")}</p>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-red-700">
          {save.error.message}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
    </section>
  );
}
