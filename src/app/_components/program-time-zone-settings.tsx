"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { isProgramTimeZone, programDateTimeInput } from "~/lib/program-time";

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
  const utils = api.useUtils();
  const [zone, setZone] = useState(timeZone);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [example] = useState(() => new Date());
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
        <span className="label">{t("zone")}</span>
        <select
          className="input w-full"
          value={zone}
          disabled={!canEdit || save.isPending}
          onChange={(e) => {
            setZone(e.target.value);
            setConfirmed(false);
            setSaved(false);
          }}
        >
          <option value="UTC">UTC</option>
          {[...new Set(timeZoneOptions.filter(value=>value!=="UTC").map(value=>value.split("/")[0]!))].map(region=>(
            <optgroup key={region} label={region}>
              {timeZoneOptions.filter(value=>value.startsWith(region+"/")).map(value=>(
                <option key={value} value={value}>{value.slice(region.length+1).replaceAll("_"," ")}</option>
              ))}
            </optgroup>
          ))}
        </select>
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
              <dt className="inline font-medium">{timeZone}: </dt>
              <dd className="inline">
                {programDateTimeInput(example, timeZone).replace("T", " ")}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">{zone}: </dt>
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
          <label className="flex items-start gap-2 text-sm">
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
            className="btn-primary"
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
