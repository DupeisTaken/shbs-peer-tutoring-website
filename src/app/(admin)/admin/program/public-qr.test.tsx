/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import type { NextRecruitmentSettingsData } from "~/app/_components/next-recruitment-settings";
import ProgramPage from "./page";

const state = vi.hoisted(() => ({
  role: "HEAD",
  readOnly: false,
  denied: false,
  hasPeriod: true,
  enabled: true,
  replace: vi.fn(),
  refresh: vi.fn(),
  saveRecruitment: vi.fn(),
  saveNextRecruitment: vi.fn(),
  nextRecruitment: vi.fn(),
  privateChild: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("panel=period"),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/program-captcha-settings", () => ({
  ProgramCaptchaSettings: state.privateChild,
}));
vi.mock("~/app/_components/program-profile-settings", () => ({
  ProgramProfileSettings: state.privateChild,
}));
vi.mock("~/app/_components/program-email-settings", () => ({
  ProgramEmailSettings: state.privateChild,
}));
vi.mock("~/app/_components/program-time-zone-settings", () => ({
  ProgramTimeZoneSettings: state.privateChild,
}));
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarSettings: state.privateChild,
}));
vi.mock("~/app/_components/school-calendar", () => ({
  SchoolCalendar: state.privateChild,
}));
vi.mock("~/app/_components/program-name-settings", () => ({
  ProgramNameSettings: state.privateChild,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessagePermissions: state.privateChild,
}));
vi.mock("~/app/_components/program-feature-settings", () => ({
  FeatureToggles: state.privateChild,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { invalidate: vi.fn(), currentPeriod: { fetch: vi.fn() } },
      program: { nextRecruitment: { fetch: vi.fn(), cancel: vi.fn() } },
    }),
    account: {
      me: {
        useQuery: () => ({
          data: { role: state.role },
          error: state.denied ? { data: { code: "FORBIDDEN" } } : null,
        }),
      },
    },
    admin: {
      currentPeriod: {
        useQuery: () => ({
          data: state.hasPeriod
            ? {
                name: "Current",
                semester: 1,
                termId: "term-1",
                canEdit:
                  ["HEAD", "ADMIN"].includes(state.role) && !state.readOnly,
                canApply: state.role === "HEAD" && !state.readOnly,
                recruitment: {
                  tutee: {
                    enabled: state.enabled,
                    opensAt: null,
                    closesAt: null,
                    previewUrl: null,
                  },
                  tutor: {
                    enabled: state.enabled,
                    opensAt: null,
                    closesAt: null,
                    previewUrl: null,
                  },
                },
                next: { name: "Next", semester: 1 },
              }
            : null,
        }),
      },
      refresh: {
        useMutation: () => ({ mutateAsync: state.refresh, isPending: false }),
      },
    },
    program: {
      nextRecruitment: { useQuery: state.nextRecruitment },
      prepareNextRecruitment: {
        useMutation: () => ({
          mutateAsync: state.saveNextRecruitment,
          isPending: false,
        }),
      },
      setSignupWindow: {
        useMutation: () => ({
          mutate: state.saveRecruitment,
          isPending: false,
        }),
      },
    },
  },
}));

/** Keep the actual next-period editors and refresh review mounted. Their separate
 * server authority must not be inferred from the public download controls. */
function nextRecruitmentData(): NextRecruitmentSettingsData {
  const target = {
    sourceTermId: "term-1",
    sourceSchoolYear: "26-27",
    sourceQuarter: "Q1",
    destinationSchoolYear: "26-27",
    destinationQuarter: "Q2",
    semesterMode: false,
    modeRevision: 1,
  } as const;
  const preparations = { tutor: null, tutee: null };
  const timeZone = "Asia/Shanghai";
  return {
    target,
    currentName: "Current",
    nextName: "Next",
    timeZone,
    preparations,
    canEdit: ["HEAD", "ADMIN", "COORDINATOR"].includes(state.role) && !state.readOnly,
    canApply: ["HEAD", "ADMIN"].includes(state.role) && !state.readOnly,
    refreshEvidence: { target, timeZone, preparations, destination: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "HEAD";
  state.readOnly = false;
  state.denied = false;
  state.hasPeriod = true;
  state.enabled = true;
  state.nextRecruitment.mockImplementation(() => ({
    data: nextRecruitmentData(),
    error: null,
    isFetching: false,
    isSuccess: true,
    refetch: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function show(locale: "en" | "zh" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ProgramPage />
    </NextIntlClientProvider>,
  );
}

it.each(["en", "zh"] as const)(
  "keeps real current/next recruitment and Refresh drafts while downloading and switching panels in %s",
  (locale) => {
    const copy = locale === "zh" ? zh : en;
    show(locale);
    const previews = screen.getAllByLabelText<HTMLInputElement>(
      copy.recruitment.previewLink,
      { exact: false },
    );
    const drafts = [
      "https://example.test/tutee-draft",
      "https://example.test/tutor-draft",
    ];
    previews.forEach((input, index) =>
      fireEvent.change(input, { target: { value: drafts[index] } }),
    );
    const nextDrafts = ["2026-11-02T09:00", "2026-11-03T10:30"];
    const nextOpenings = (["tutor", "tutee"] as const).map((audience, index) => {
      const editor = within(screen.getByRole("region", {
        name: copy.nextRecruitment[audience],
      }));
      fireEvent.click(editor.getByLabelText(copy.nextRecruitment.setOpening));
      const input = editor.getByLabelText<HTMLInputElement>(copy.nextRecruitment.opening);
      fireEvent.change(input, { target: { value: nextDrafts[index] } });
      return input;
    });
    const confirmation = screen.getByLabelText<HTMLInputElement>(
      copy.admin.program.confirmLabel,
    );
    fireEvent.change(confirmation, { target: { value: "REFRESH" } });

    const region = screen.getByRole("region", {
      name: copy.admin.program.publicQr.heading,
    });
    const links = within(region).getAllByRole<HTMLAnchorElement>("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.closest("form,fieldset")).toBeNull();
      link.focus();
      expect(document.activeElement).toBe(link);
      // jsdom cannot download. Only suppress the native default; feature click
      // handlers still run, so accidental settings writes remain observable.
      link.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      fireEvent.click(link);
      expect(previews.map((input) => input.value)).toEqual(drafts);
      expect(nextOpenings.map((input) => input.value)).toEqual(nextDrafts);
      expect(confirmation.value).toBe("REFRESH");
    }
    fireEvent.click(
      screen.getByRole("tab", {
        name: copy.admin.program.panels.communication,
      }),
    );
    expect(
      screen.queryByRole("region", {
        name: copy.admin.program.publicQr.heading,
      }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("tab", { name: copy.admin.program.panels.period }),
    );
    expect(
      screen.getByRole("region", { name: copy.admin.program.publicQr.heading }),
    ).toBe(region);
    expect(
      screen.getAllByLabelText(copy.recruitment.previewLink, {
        exact: false,
      })[0],
    ).toBe(previews[0]);
    expect(previews.map((input) => input.value)).toEqual(drafts);
    expect(nextOpenings.map((input) => input.value)).toEqual(nextDrafts);
    expect(
      within(screen.getByRole("region", { name: copy.nextRecruitment.tutor }))
        .getByLabelText(copy.nextRecruitment.opening),
    ).toBe(nextOpenings[0]);
    expect(confirmation.value).toBe("REFRESH");
    expect(state.saveRecruitment).not.toHaveBeenCalled();
    expect(state.saveNextRecruitment).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  },
);

it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    ["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "departed HEAD"].map((role) => ({ locale, role })),
  ),
)(
  "keeps public downloads independent of closed recruitment and the $role edit boundary in $locale",
  ({ locale, role }) => {
    const copy = locale === "zh" ? zh : en;
    state.role = role === "departed HEAD" ? "HEAD" : role;
    state.readOnly = role === "VIEWER" || role === "departed HEAD";
    state.enabled = false;
    show(locale);
    const region = screen.getByRole("region", {
      name: copy.admin.program.publicQr.heading,
    });
    const links = within(region).getAllByRole<HTMLAnchorElement>("link");
    expect(links).toHaveLength(4);
    // Crew exports have no feature-setting query or mutation dependency. The
    // destination retains its own live feature gate after a recipient scans it.
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      `/api/public-qr?destination=crew&locale=${locale}&download=1`,
    );
    expect(links.every((link) => link.closest("[disabled]") === null)).toBe(
      true,
    );
    const editable = ["HEAD", "ADMIN", "COORDINATOR"].includes(state.role) && !state.readOnly;
    const canPrepareRefresh = ["HEAD", "ADMIN"].includes(state.role) && !state.readOnly;
    for (const input of screen.getAllByLabelText(copy.recruitment.previewLink, {
      exact: false,
    })) {
      expect(input.closest("fieldset")?.disabled).toBe(!editable);
    }
    if (state.readOnly) {
      expect(state.privateChild).not.toHaveBeenCalled();
      expect(state.nextRecruitment).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(copy.admin.program.confirmLabel)).toBeNull();
    } else {
      expect(state.nextRecruitment).toHaveBeenCalled();
      for (const audience of ["tutor", "tutee"] as const) {
        const editor = within(screen.getByRole("region", {
          name: copy.nextRecruitment[audience],
        }));
        expect(editor.getByLabelText(copy.nextRecruitment.setOpening).matches(":disabled")).toBe(!editable);
        expect(editor.getByRole("button", {
          name: role === "COORDINATOR" ? copy.approvals.requestAdmin : copy.nextRecruitment.clear,
        })).toBeTruthy();
      }
      expect(screen.getByLabelText<HTMLInputElement>(copy.admin.program.confirmLabel).disabled).toBe(!canPrepareRefresh);
    }
    if (!editable) {
      // Synthetic submit bypasses disabled controls; the real forms must still
      // enforce authority without a write, while their QR links stay usable.
      for (const form of document.querySelectorAll("form")) fireEvent.submit(form);
    }
    for (const link of links) {
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(link);
    }
    expect(state.saveRecruitment).not.toHaveBeenCalled();
    expect(state.saveNextRecruitment).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  },
);

it("preserves the existing no-period presentation without mounting period actions", () => {
  state.hasPeriod = false;
  show();
  expect(screen.getByText(en.admin.program.noPeriod)).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: en.admin.program.publicQr.heading }),
  ).toBeNull();
  expect(screen.queryByLabelText(en.admin.program.confirmLabel)).toBeNull();
  expect(state.nextRecruitment).not.toHaveBeenCalled();
});

it("preserves authoritative page denial instead of exposing sharing through a denied management page", () => {
  state.denied = true;
  show();
  expect(
    screen.queryByRole("region", { name: en.admin.program.publicQr.heading }),
  ).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(state.privateChild).not.toHaveBeenCalled();
  expect(state.nextRecruitment).not.toHaveBeenCalled();
  expect(state.saveRecruitment).not.toHaveBeenCalled();
  expect(state.saveNextRecruitment).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
