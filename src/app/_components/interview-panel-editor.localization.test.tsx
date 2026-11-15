/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { createQueryClient } from "~/trpc/query-client";
import type { AppRouter } from "~/server/api/root";

const fixture = vi.hoisted(() => ({
  save: vi.fn<(input: unknown) => Promise<{ ok: true }>>(),
  changed: vi.fn<() => Promise<void>>(),
  reload: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      admin: {
        subjectEligibility: {
          useQuery: () => ({
            data: [{ tutorId: "a", subjectId: "math" }],
            isLoading: false,
            error: null,
          }),
        },
        assignInterviewers: {
          useMutation: (callbacks: {
            onSuccess: () => Promise<void>;
            onError: () => void;
          }) =>
            useMutation({
              mutationKey: [["admin", "assignInterviewers"]],
              mutationFn: fixture.save,
              ...callbacks,
            }),
        },
      },
    },
  };
});

import {
  InterviewPanelEditor,
  type PanelTutor,
} from "./interview-panel-editor";
import { SaveNotifications } from "./save-notifications";

const catalogs = { en, zh };
const wireMessage = "This changed since you loaded it — refresh and try again.";
const originalVersion = new Date("2026-09-01T00:00:00Z");
const newerVersion = new Date("2026-09-01T00:01:00Z");
const tutors: PanelTutor[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({
  id,
  englishName: `Tutor ${id.toUpperCase()}`,
  status: "ACTIVE",
  user: {
    role: id === "a" ? "HEAD" : id === "c" ? "ADMIN" : "TUTOR",
    tutorAccessRevoked: false,
    suspendedAt: null,
  },
}));
const panel = (ids: string[], chair: string) =>
  ids.map((id) => ({
    isHead: id === chair,
    tutor: { id, englishName: `Tutor ${id.toUpperCase()}` },
  }));
const refusal = (message: string) =>
  TRPCClientError.from<AppRouter>({
    error: {
      code: -32009,
      message,
      data: {
        code: "CONFLICT",
        path: "admin.assignInterviewers",
        httpStatus: 409,
      },
    },
  });

let client: ReturnType<typeof createQueryClient>;
let previousHref: string;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.changed.mockResolvedValue(undefined);
  client = createQueryClient();
  client.setDefaultOptions({ mutations: { retry: false, gcTime: Infinity } });
  previousHref = window.location.href;
  window.history.replaceState(null, "", "/admin/applications");
});
afterEach(() => {
  cleanup();
  client.clear();
  window.history.replaceState(null, "", previousHref);
});

function subject(locale: "en" | "zh", refreshed = false) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
        <main>
          <InterviewPanelEditor
            applicationId="synthetic-application"
            updatedAt={refreshed ? newerVersion : originalVersion}
            repairRequired
            requestedTutorId={null}
            subjects={[{ id: "math", label: "Math" }]}
            interviewers={
              refreshed
                ? panel(["c", "e", "f"], "c")
                : panel(["a", "b", "c"], "a")
            }
            tutors={tutors}
            onChanged={fixture.changed}
            onReload={fixture.reload}
          />
        </main>
        <SaveNotifications />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

it.each(["en", "zh"] as const)(
  "localizes the retained %s refusal in both owners without replaying the panel save",
  async (locale) => {
    let rejectWrite!: (error: Error) => void;
    fixture.save.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const view = render(subject(locale));
    const catalog = catalogs[locale];
    const selectors = screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .slice(1);
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: catalog.admin.applications.panelRepair.reason,
    });
    fireEvent.change(selectors[1]!, { target: { value: "d" } });
    fireEvent.click(screen.getAllByRole("radio")[2]!);
    fireEvent.change(reason, {
      target: { value: "  Retained synthetic reason  " },
    });
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: catalog.admin.applications.panelRepair.save,
    });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
    expect(save.disabled).toBe(true);
    expect(reason.disabled).toBe(true);
    view.rerender(subject(locale, true));
    const error = refusal(wireMessage);
    await act(async () => rejectWrite(error));
    const expectRetained = (language: "en" | "zh") => {
      expect(
        within(screen.getByRole("main")).getByRole("alert").textContent,
      ).toBe(catalogs[language].saveErrors.staleRecord);
      expect(
        view.container.querySelector("aside[role='alert'] p")?.textContent,
      ).toBe(catalogs[language].saveErrors.staleRecord);
      expect(screen.getAllByRole("alert")).toHaveLength(2);
      expect(selectors.map((select) => select.value)).toEqual(["a", "d", "c"]);
      expect(screen.getAllByRole<HTMLInputElement>("radio")[2]?.checked).toBe(
        true,
      );
      expect(reason.value).toBe("  Retained synthetic reason  ");
      expect(reason.disabled).toBe(false);
      expect(fixture.save).toHaveBeenCalledExactlyOnceWith(
        {
          applicationId: "synthetic-application",
          tutorIds: ["a", "d", "c"],
          headTutorId: "c",
          expectedUpdatedAt: originalVersion,
          repairReason: "Retained synthetic reason",
        },
        expect.anything(),
      );
      expect(fixture.changed).toHaveBeenCalledOnce();
      expect(fixture.reload).not.toHaveBeenCalled();
      expect(client.getMutationCache().getAll()[0]?.state.error).toBe(error);
      expect(error.message).toBe(wireMessage);
      expect(error.data?.code).toBe("CONFLICT");
      expect(screen.queryByRole("status")).toBeNull();
    };
    await waitFor(() => expectRetained(locale));
    view.rerender(subject(locale === "en" ? "zh" : "en", true));
    expectRetained(locale === "en" ? "zh" : "en");
    view.rerender(subject(locale, true));
    expectRetained(locale);
  },
);

it.each(["en", "zh"] as const)(
  "preserves unknown and near-match CONFLICT messages in both %s owners",
  async (locale) => {
    const messages = [
      "Panel changed; reload",
      `${wireMessage} `,
      wireMessage.replace("—", "-"),
    ];
    const view = render(subject(locale));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Synthetic repair reason" },
    });
    for (const [index, message] of messages.entries()) {
      fixture.save.mockRejectedValue(refusal(message));
      fireEvent.click(
        screen.getByRole("button", {
          name: catalogs[locale].admin.applications.panelRepair.save,
        }),
      );
      await waitFor(() => {
        expect(
          within(screen.getByRole("main")).getByRole("alert").textContent,
        ).toBe(message);
        const notices = view.container.querySelectorAll(
          "aside[role='alert'] p",
        );
        expect(notices).toHaveLength(index + 1);
        expect(notices[index]?.textContent).toBe(message);
      });
    }
    expect(fixture.save).toHaveBeenCalledTimes(messages.length);
  },
);
