import { z } from "zod";
import { db } from "./db";
import { emailOrigin } from "./email/urls";
import { rateLimit } from "./rate-limit";
import {
  schoolHoursHtmlResponse,
  schoolHoursResponseHeaders,
  schoolHoursUnavailableResponse,
} from "./school-hours-public";
import {
  cancelSchoolHoursRecipientReminder,
  getSchoolHoursRecipientState,
  scheduleSchoolHoursRecipientReminder,
  schoolHoursReminderInput,
  schoolHoursReminderTime,
  SchoolHoursRecipientFault,
} from "./school-hours-recipient";
import { schoolHoursReminderPanel } from "./school-hours-reminder-panel";
import { parseSchoolHoursRecipientToken } from "./school-hours-recipient-token";
import {
  parseSchoolHoursReportLocale,
  schoolHoursReportText,
  type SchoolHoursReportLocale,
} from "./school-hours-report-locale";

const inputSchema = z.discriminatedUnion("operation", [
  schoolHoursReminderInput.extend({ operation: z.literal("review") }).strict(),
  schoolHoursReminderInput
    .extend({ operation: z.literal("schedule") })
    .strict(),
  z
    .object({
      operation: z.literal("cancel"),
      reminderId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    })
    .strict(),
]);
const temporary = (status = 503, locale: SchoolHoursReportLocale = "en") =>
  new Response(
    `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${schoolHoursReportText(locale, "Please try again", "请重试")}</title><p>${schoolHoursReportText(locale, "Please try again shortly. Your saved report has not changed.", "请稍后重试，已保存的报告未改变。")}</p></html>`,
    {
      status,
      headers: {
        ...schoolHoursResponseHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Language": locale,
        ...(status === 429 ? { "Retry-After": "60" } : {}),
      },
    },
  );

function refused(error: unknown, locale: SchoolHoursReportLocale) {
  if (
    error instanceof SchoolHoursRecipientFault &&
    ["unavailable", "retired"].includes(error.code)
  )
    return schoolHoursUnavailableResponse(
      error.code === "retired" ? "retired" : "unavailable",
      locale,
    );
  return temporary(503, locale);
}

export async function getSchoolHoursRecipientResponse(
  request: Request,
  token: string,
  head = false,
) {
  const locale =
    parseSchoolHoursReportLocale(
      new URL(request.url).searchParams.get("lang"),
    ) ?? "en";
  const reply = (response: Response) =>
    head
      ? new Response(null, {
          status: response.status,
          headers: response.headers,
        })
      : response;
  if (!parseSchoolHoursRecipientToken(token))
    return reply(schoolHoursUnavailableResponse("unavailable", locale));
  if (
    !rateLimit("school-hours-recipient:read", { max: 600, windowMs: 60_000 }).ok
  )
    return reply(temporary(429, locale));
  try {
    const prefetch = /prefetch|prerender/i.test(
      `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`,
    );
    const state = await getSchoolHoursRecipientState(
      db,
      token,
      !head && !prefetch,
    );
    const response = schoolHoursHtmlResponse(state.report, token, {
      locale,
      recipientPanel: schoolHoursReminderPanel(state, token, { locale }),
    });
    return reply(response);
  } catch (error) {
    const response = refused(error, locale);
    return reply(response);
  }
}

/** Bound actual bytes, not just the optional Content-Length. Only native form
 * fields are accepted; duplicate keys and destination overrides fail closed. */
async function readForm(request: Request) {
  const max = 2048;
  if (Number(request.headers.get("content-length")) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if (new Set(fields.keys()).size !== [...fields.keys()].length) return null;
  const result = inputSchema.safeParse(Object.fromEntries(fields));
  return result.success ? result.data : null;
}

export async function postSchoolHoursRecipientResponse(
  request: Request,
  token: string,
) {
  const selectedLocale = parseSchoolHoursReportLocale(
    new URL(request.url).searchParams.get("lang"),
  );
  const locale = selectedLocale ?? "en";
  let draft: { requestId: string; localTime: string } | undefined;
  try {
    // These forms use a capability and configured public origin, never a site
    // session or request Host. GET, HEAD, previews and cross-site POST cannot send.
    if (request.headers.get("origin") !== emailOrigin())
      return temporary(403, locale);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/x-www-form-urlencoded"
    )
      return temporary(415, locale);
    if (!parseSchoolHoursRecipientToken(token))
      return schoolHoursUnavailableResponse("unavailable", locale);
    if (
      !rateLimit("school-hours-recipient:write", { max: 120, windowMs: 60_000 })
        .ok
    )
      return temporary(429, locale);
    const input = await readForm(request);
    if (!input) return temporary(400, locale);
    const state = await getSchoolHoursRecipientState(db, token);
    const parsed = parseSchoolHoursRecipientToken(token)!;
    if (
      !rateLimit(`school-hours-recipient:write:${parsed.deliveryId}`, {
        max: 20,
        windowMs: 60_000,
      }).ok
    )
      return temporary(429, locale);
    if (input.operation !== "cancel")
      draft = { requestId: input.requestId, localTime: input.localTime };
    if (input.operation === "review") {
      if (!state.eligible)
        throw new SchoolHoursRecipientFault("recipientRemoved");
      const review = {
        requestId: input.requestId,
        localTime: input.localTime,
        scheduledFor: schoolHoursReminderTime(
          input.localTime,
          state.report.timeZone,
        ),
      };
      return schoolHoursHtmlResponse(state.report, token, {
        locale,
        recipientPanel: schoolHoursReminderPanel(state, token, {
          review,
          locale,
        }),
      });
    }
    if (input.operation === "schedule")
      await scheduleSchoolHoursRecipientReminder(db, token, {
        requestId: input.requestId,
        localTime: input.localTime,
      });
    else await cancelSchoolHoursRecipientReminder(db, token, input.reminderId);
    // PRG also makes an ordinary browser refresh a read, rather than another write.
    return new Response(null, {
      status: 303,
      headers: {
        ...schoolHoursResponseHeaders,
        Location: `${emailOrigin()}/reports/service-hours/${encodeURIComponent(token)}${selectedLocale ? `?lang=${selectedLocale}` : ""}#reminder`,
      },
    });
  } catch (error) {
    if (
      error instanceof SchoolHoursRecipientFault &&
      ["unavailable", "retired"].includes(error.code)
    )
      return refused(error, locale);
    try {
      const state = await getSchoolHoursRecipientState(db, token);
      const code =
        error instanceof SchoolHoursRecipientFault ? error.code : "writeFailed";
      return schoolHoursHtmlResponse(state.report, token, {
        locale,
        recipientPanel: schoolHoursReminderPanel(state, token, {
          error: code,
          draft,
          locale,
        }),
        status: code === "limit" ? 429 : code === "writeFailed" ? 503 : 400,
      });
    } catch (readError) {
      return refused(readError, locale);
    }
  }
}
