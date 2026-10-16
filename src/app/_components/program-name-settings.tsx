"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import {
  NAME_ACCOUNT_TYPES,
  NAME_FIELD_KEYS,
  type NameAccountType,
  type NameFieldStates,
} from "~/lib/name-field-policy";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { SummaryTable, TableAction, TableActions } from "./ui/summary-table";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

export function ProgramNameSettings() {
  const t = useTranslations("nameFields");
  const roles = useTranslations("admin.users.roles");
  const query = api.program.nameFieldSettings.useQuery();
  const [editing, setEditing] = useState<{
    accountType: NameAccountType;
    states: NameFieldStates;
    version: number;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  if (!query.data)
    return (
      <section className="card p-5">
        <StatePanel
          kind={query.error ? "error" : "loading"}
          title={t(query.error ? "loadFailed" : "loading")}
          action={
            query.error && (
              <Button onClick={() => void query.refetch()}>
                {t("refresh")}
              </Button>
            )
          }
        />
      </section>
    );
  const data = query.data;
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("title")}</h2>
      <p className="muted text-sm">{t("help")}</p>
      {query.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
          }
        >
          {t("loadFailed")}
        </InlineNotice>
      )}
      <SummaryTable label={t("title")}>
        <thead>
          <tr>
            <th>{t("accountType")}</th>
            <th>{t("summary")}</th>
            <th className="table-actions-heading">{t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          {NAME_ACCOUNT_TYPES.map((role) => (
            <tr key={role}>
              <td>{roles(role)}</td>
              <td>
                {t("requiredCount", {
                  count: NAME_FIELD_KEYS.filter(
                    (field) => data.policies[role][field] === "required",
                  ).length,
                })}{" "}
                ·{" "}
                {t("hiddenCount", {
                  count: NAME_FIELD_KEYS.filter(
                    (field) => data.policies[role][field] === "hidden",
                  ).length,
                })}
              </td>
              <TableActions>
                {data.canEdit && (
                  <TableAction
                    disabled={!!query.error}
                    onClick={() =>
                      setEditing({
                        accountType: role,
                        states: data.policies[role],
                        version: data.version,
                      })
                    }
                  >
                    {t("configure")}
                  </TableAction>
                )}
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
      {editing && (
        <ProfileDialog
          title={`${t("title")} · ${roles(editing.accountType)}`}
          onClose={() => setEditing(null)}
        >
          <NamePolicyEditor
            key={generation}
            initial={editing}
            canApply={data.canApply}
            disabled={!!query.error}
            onReload={async () => {
              const result = await query.refetch();
              if (!result.isSuccess)
                throw new Error(result.error?.message ?? t("loadFailed"));
              setEditing({
                accountType: editing.accountType,
                states: result.data.policies[editing.accountType],
                version: result.data.version,
              });
              setGeneration((value) => value + 1);
            }}
          />
        </ProfileDialog>
      )}
    </section>
  );
}
/** This one policy draft/version serves signup and shared profiles; sibling display/academic saves stay independent. */
function NamePolicyEditor({
  initial,
  canApply,
  disabled,
  onReload,
}: {
  initial: {
    accountType: NameAccountType;
    states: NameFieldStates;
    version: number;
  };
  canApply: boolean;
  disabled: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("nameFields");
  const names = useTranslations("personName");
  const requirements = useTranslations("signupFields");
  const approvals = useTranslations("approvals");
  const router = useRouter();
  const utils = api.useUtils();
  const [states, setStates] = useState(initial.states);
  const [version, setVersion] = useState(initial.version);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const admitted = useRef(false);
  const committed = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const save = api.program.setNameFields.useMutation();
  const pending = useDialogPending(save.isPending || reading);
  const synchronize = async () => {
    setReading(true);
    try {
      // Every live reader may materialize a name. Wait for all active cache reads
      // and report read failures separately from the already accepted policy write.
      await invalidateAndReport(utils);
      const latest = await utils.program.nameFieldSettings.fetch(undefined, {
        staleTime: 0,
      });
      setVersion(latest.version);
      setStates(latest.policies[initial.accountType]);
      setReadFailed(false);
      committed.current = false;
      setAccepted(false);
      router.refresh();
    } catch {
      setReadFailed(true);
    } finally {
      setReading(false);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || pending || admitted.current || committed.current)
          return;
        admitted.current = true;
        try {
          await save.mutateAsync({
            accountType: initial.accountType,
            states,
            expectedVersion: version,
          });
          committed.current = true;
          setAccepted(true);
          setSaved(true);
          await synchronize();
        } catch (error) {
          if (queuedApprovalId(error)) {
            committed.current = true;
            setAccepted(true);
          }
        } finally {
          admitted.current = false;
        }
      }}
    >
      <p className="muted text-sm">{t("help")}</p>
      <fieldset
        className="min-w-0 space-y-4"
        disabled={disabled || pending || accepted}
      >
        {NAME_FIELD_KEYS.map((field) => (
          <label key={field} className="block">
            <span className="label">{names(field)}</span>
            <select
              className="input w-full"
              value={states[field]}
              onChange={(event) => {
                setStates((before) => ({
                  ...before,
                  [field]: event.target.value as NameFieldStates[typeof field],
                }));
                setSaved(false);
              }}
            >
              {(["required", "optional", "hidden"] as const).map((state) => (
                <option key={state} value={state}>
                  {requirements(state)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <FormActions>
          <Button type="submit" variant="primary">
            {pending
              ? t("saving")
              : canApply
                ? t("save")
                : approvals("requestHead")}
          </Button>
        </FormActions>
      </fieldset>
      {saved && (
        <InlineNotice tone="success" announcement="status">
          {t("saved")}
        </InlineNotice>
      )}
      {save.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {approvals("queuedBody")}
        </InlineNotice>
      )}
      {save.error && !save.error.data?.approvalId && (
        <InlineNotice tone="error" announcement="alert">
          {save.error.message}
        </InlineNotice>
      )}
      {readFailed && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={pending} onClick={() => void synchronize()}>
              {t("refresh")}
            </Button>
          }
        >
          {t("refreshFailed")}
        </InlineNotice>
      )}
      {!accepted && save.error?.data?.code === "CONFLICT" && (
        <Button
          disabled={pending}
          onClick={async () => {
            setReading(true);
            try {
              await onReload();
            } catch {
              setReloadFailed(true);
            } finally {
              setReading(false);
            }
          }}
        >
          {t("reload")}
        </Button>
      )}
      {reloadFailed && <p role="alert">{t("loadFailed")}</p>}
    </form>
  );
}
