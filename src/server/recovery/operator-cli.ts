/** Strict argv parsing stays independent of Next, environment loading and database startup. */
export type RecordKey = Record<string, string | number | boolean>;
export type RecoveryCommand =
  | { kind: "help" }
  | { kind: "records.tables" }
  | {
      kind: "records.inspect";
      table: string;
      key?: RecordKey;
      cursor?: string;
      limit: number;
    }
  | {
      kind: "records.dependencies";
      table: string;
      key: RecordKey;
      cursor?: string;
      limit: number;
    }
  | {
      kind: "admission.inspect";
      actionId: string;
      actorId: string;
      out?: string;
    }
  | {
      kind: "admission.compare";
      plan: string;
      planHash: string;
      actorId: string;
    }
  | { kind: "admission.receipt"; receiptId: string; actorId: string }
  | { kind: "checkpoint.capture"; adapter: string; sourceId: string; actorId: string; out?: string }
  | { kind: "checkpoint.inspect"; checkpointId: string; actorId: string; out?: string }
  | { kind: "checkpoint.compare"; plan: string; planHash: string; actorId: string }
  | { kind: "checkpoint.apply"; plan: string; planHash: string; actorId: string; reason: string; clientKey: string }
  | { kind: "checkpoint.receipt"; receiptId: string; actorId: string }
  | {
      kind: "admission.apply";
      plan: string;
      planHash: string;
      actorId: string;
      reason: string;
      clientKey: string;
    }
  | {
      kind: "site.plan";
      backup: string;
      targetName: string;
      evidenceDir: string;
      out: string;
    }
  | { kind: "site.stage"; plan: string; planHash: string; reason: string }
  | { kind: "site.reconcile-plan" | "site.acceptance-plan" | "site.cutover-plan" | "site.rollback-plan";
      plan: string; planHash: string; receipt: string; receiptHash: string; out: string; actorId?: string; pointerPath?: string }
  | { kind: "site.reconcile" | "site.acceptance" | "site.cutover" | "site.rollback"; plan: string; planHash: string; reason: string };

export class OperatorError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OperatorError";
  }
}
export function operatorAssert(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw new OperatorError(code);
}
function text(value: string | undefined, label: string, max = 4096): string {
  operatorAssert(
    typeof value === "string" &&
      value.length > 0 &&
      value.trim() === value &&
      value.length <= max &&
      !/[\u0000-\u001f]/.test(value),
    `INVALID_${label}`,
  );
  return value;
}
export function parseRecordKey(value: string): RecordKey {
  operatorAssert(value.length <= 8192, "INVALID_KEY");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OperatorError("INVALID_KEY");
  }
  operatorAssert(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "INVALID_KEY",
  );
  const entries = Object.entries(parsed as Record<string, unknown>);
  operatorAssert(entries.length >= 1 && entries.length <= 8, "INVALID_KEY");
  for (const [field, item] of entries) {
    operatorAssert(
      /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field) &&
        !["constructor", "prototype", "__proto__"].includes(field),
      "INVALID_KEY",
    );
    operatorAssert(
      (typeof item === "string" && item.length <= 1024) ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)),
      "INVALID_KEY",
    );
  }
  return parsed as RecordKey;
}
export function parseRecoveryCommand(argv: readonly string[]): RecoveryCommand {
  operatorAssert(argv.length <= 30, "TOO_MANY_ARGUMENTS");
  if (
    !argv.length ||
    (argv.length === 1 && ["--help", "help"].includes(argv[0]!))
  )
    return { kind: "help" };
  const verb =
    argv[0] === "admission" && argv[1] === "checkpoint"
      ? "inspect"
      : argv[0] === "admission" && argv[1] === "restore"
        ? "apply"
        : argv[1];
  const name = `${argv[0]}.${verb}`;
  const allowed: Record<string, string[]> = {
    "records.tables": [],
    "records.inspect": ["table", "key", "cursor", "limit"],
    "records.dependencies": ["table", "key", "cursor", "limit"],
    "admission.inspect": ["action-id", "actor-id", "out"],
    "admission.compare": ["plan", "plan-hash", "actor-id"],
    "admission.receipt": ["receipt-id", "actor-id"],
    "checkpoint.capture": ["adapter", "source-id", "actor-id", "out"],
    "checkpoint.inspect": ["checkpoint-id", "actor-id", "out"],
    "checkpoint.compare": ["plan", "plan-hash", "actor-id"],
    "checkpoint.receipt": ["receipt-id", "actor-id"],
    "checkpoint.apply": ["plan", "plan-hash", "actor-id", "reason", "client-key"],
    "admission.apply": [
      "plan",
      "plan-hash",
      "actor-id",
      "reason",
      "client-key",
    ],
    "site.plan": ["backup", "target-name", "evidence-dir", "out"],
    "site.stage": ["plan", "plan-hash", "reason"],
    "site.reconcile-plan": ["plan", "plan-hash", "receipt", "receipt-hash", "out"],
    "site.acceptance-plan": ["plan", "plan-hash", "receipt", "receipt-hash", "out", "actor-id"],
    "site.cutover-plan": ["plan", "plan-hash", "receipt", "receipt-hash", "out", "pointer-path"],
    "site.rollback-plan": ["plan", "plan-hash", "receipt", "receipt-hash", "out"],
    "site.reconcile": ["plan", "plan-hash", "reason"],
    "site.acceptance": ["plan", "plan-hash", "reason"],
    "site.cutover": ["plan", "plan-hash", "reason"],
    "site.rollback": ["plan", "plan-hash", "reason"],
  };
  const flags = allowed[name];
  operatorAssert(flags, "UNKNOWN_COMMAND");
  const values = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i]!;
    operatorAssert(
      flag.startsWith("--") &&
        flags.includes(flag.slice(2)) &&
        !values.has(flag.slice(2)),
      "INVALID_OR_DUPLICATE_OPTION",
    );
    operatorAssert(
      argv[i + 1] && !argv[i + 1]!.startsWith("--"),
      "MISSING_OPTION_VALUE",
    );
    values.set(flag.slice(2), text(argv[i + 1], "OPTION", 8192));
  }
  const get = (key: string, max = 4096) =>
    text(values.get(key), key.toUpperCase().replaceAll("-", "_"), max);
  const planHash = () => {
    const hash = get("plan-hash", 64);
    operatorAssert(/^[a-f0-9]{64}$/.test(hash), "INVALID_PLAN_HASH");
    return hash;
  };
  switch (name) {
    case "records.tables":
      return { kind: "records.tables" };
    case "records.inspect":
    case "records.dependencies": {
      const table = get("table", 100);
      operatorAssert(/^[A-Za-z][A-Za-z0-9_]*$/.test(table), "INVALID_TABLE");
      const limitText = values.get("limit") ?? "25";
      operatorAssert(
        /^[1-9][0-9]*$/.test(limitText) &&
          Number(limitText) <= (name === "records.dependencies" ? 50 : 100),
        "INVALID_LIMIT",
      );
      if (name === "records.dependencies")
        return {
          kind: "records.dependencies",
          table,
          key: parseRecordKey(get("key", 8192)),
          limit: Number(limitText),
          ...(values.has("cursor") ? { cursor: get("cursor", 4096) } : {}),
        };
      return {
        kind: "records.inspect",
        table,
        limit: Number(limitText),
        ...(values.has("key") ? { key: parseRecordKey(get("key", 8192)) } : {}),
        ...(values.has("cursor") ? { cursor: get("cursor", 4096) } : {}),
      };
    }
    case "admission.inspect":
      return {
        kind: "admission.inspect",
        actionId: get("action-id", 100),
        actorId: get("actor-id", 100),
        ...(values.has("out") ? { out: get("out") } : {}),
      };
    case "checkpoint.capture": {
      const adapter = get("adapter", 50);
      operatorAssert(["PARTICIPANT_TUTOR", "PARTICIPANT_TUTEE", "STUDENT_WORKFLOW", "ATTENDANCE", "CARD", "PROGRAM_REFRESH"].includes(adapter), "INVALID_ADAPTER");
      return { kind: name, adapter, sourceId: get("source-id", 200), actorId: get("actor-id", 100), ...(values.has("out") ? { out: get("out") } : {}) };
    }
    case "checkpoint.inspect":
      return { kind: name, checkpointId: get("checkpoint-id", 200), actorId: get("actor-id", 100), ...(values.has("out") ? { out: get("out") } : {}) };
    case "admission.compare":
    case "checkpoint.compare":
      return {
        kind: name,
        plan: get("plan"),
        planHash: planHash(),
        actorId: get("actor-id", 100),
      };
    case "admission.receipt":
    case "checkpoint.receipt":
      return {
        kind: name,
        receiptId: get("receipt-id", 100),
        actorId: get("actor-id", 100),
      };
    case "admission.apply":
    case "checkpoint.apply": {
      const clientKey = get("client-key", 100);
      operatorAssert(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          clientKey,
        ),
        "INVALID_CLIENT_KEY",
      );
      return {
        kind: name,
        plan: get("plan"),
        planHash: planHash(),
        actorId: get("actor-id", 100),
        reason: get("reason", 1000),
        clientKey,
      };
    }
    case "site.plan": {
      const targetName = get("target-name", 63);
      operatorAssert(
        /^shbs_recovery_[a-z0-9_]+$/.test(targetName),
        "INVALID_TARGET_NAME",
      );
      return {
        kind: "site.plan",
        backup: get("backup"),
        targetName,
        evidenceDir: get("evidence-dir"),
        out: get("out"),
      };
    }
    case "site.stage":
    case "site.reconcile":
    case "site.acceptance":
    case "site.cutover":
    case "site.rollback":
      return {
        kind: name,
        plan: get("plan"),
        planHash: planHash(),
        reason: get("reason", 1000),
      };
    case "site.reconcile-plan":
    case "site.acceptance-plan":
    case "site.cutover-plan":
    case "site.rollback-plan": {
      const receiptHash = get("receipt-hash", 64);
      operatorAssert(/^[a-f0-9]{64}$/.test(receiptHash), "INVALID_RECEIPT_HASH");
      return { kind: name, plan: get("plan"), planHash: planHash(), receipt: get("receipt"), receiptHash, out: get("out"),
        ...(name === "site.acceptance-plan" ? { actorId: get("actor-id", 200) } : {}),
        ...(name === "site.cutover-plan" ? { pointerPath: get("pointer-path") } : {}) };
    }
    default:
      throw new OperatorError("UNKNOWN_COMMAND");
  }
}

export const RECOVERY_HELP = `Recovery operator CLI (JSON output; no application startup)
records tables
records inspect --table MODEL [--key '{"id":"ID"}'] [--cursor CURSOR] [--limit 1..100]
records dependencies --table MODEL --key '{"id":"ID"}' [--cursor CURSOR] [--limit 1..50]
admission inspect --action-id ID --actor-id USER [--out PLAN.json]
admission compare --plan PLAN.json --plan-hash SHA256 --actor-id USER
admission receipt --receipt-id ID --actor-id USER
admission apply --plan PLAN.json --plan-hash SHA256 --actor-id USER --reason TEXT --client-key UUID
admission checkpoint / restore are aliases for inspect / apply (causal void only).
checkpoint capture --adapter ADAPTER --source-id ID --actor-id USER [--out PLAN.json]
checkpoint inspect --checkpoint-id ID --actor-id USER [--out PLAN.json]
checkpoint compare --plan PLAN.json --plan-hash SHA256 --actor-id USER
checkpoint receipt --receipt-id ID --actor-id USER
checkpoint apply --plan PLAN.json --plan-hash SHA256 --actor-id USER --reason TEXT --client-key UUID
ADAPTER: PARTICIPANT_TUTOR, PARTICIPANT_TUTEE, STUDENT_WORKFLOW, ATTENDANCE, CARD, PROGRAM_REFRESH.
site plan --backup FILE.sql.gz --target-name shbs_recovery_NAME --evidence-dir DIR --out PLAN.json
site stage --plan PLAN.json --plan-hash SHA256 --reason TEXT
site reconcile-plan|acceptance-plan|cutover-plan|rollback-plan --plan PREVIOUS_PLAN.json --plan-hash SHA256 --receipt PREVIOUS_RECEIPT.json --receipt-hash SHA256 --out PLAN.json
  acceptance-plan also requires --actor-id SYNTHETIC_USER; cutover-plan requires --pointer-path FILE.
site reconcile|acceptance|cutover|rollback --plan PLAN.json --plan-hash SHA256 --reason TEXT
DATABASE_URL names the current site. RECOVERY_DATABASE_URL names a separate loopback
PostgreSQL maintenance connection. Site stage creates a fresh database, then freezes
it against connections. Later phases require separate reviewed plans and current fingerprints.
Acceptance/cutover/rollback are restricted to isolated synthetic loopback databases.
Signing keys, fresh synthetic password and application/rollback URLs use environment variables only.`;
