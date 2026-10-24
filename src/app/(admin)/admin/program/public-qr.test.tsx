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
        useMutation: () => ({ mutate: state.refresh, isPending: false }),
      },
    },
    program: {
      setSignupWindow: {
        useMutation: () => ({
          mutate: state.saveRecruitment,
          isPending: false,
        }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "HEAD";
  state.readOnly = false;
  state.denied = false;
  state.hasPeriod = true;
  state.enabled = true;
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
  "keeps real recruitment and Refresh drafts while downloading and switching panels in %s",
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
    expect(confirmation.value).toBe("REFRESH");
    expect(state.saveRecruitment).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "departed HEAD"])(
  "keeps public downloads independent of closed recruitment and the %s edit boundary",
  (role) => {
    state.role = role === "departed HEAD" ? "HEAD" : role;
    state.readOnly = role === "VIEWER" || role === "departed HEAD";
    state.enabled = false;
    show();
    const region = screen.getByRole("region", {
      name: en.admin.program.publicQr.heading,
    });
    const links = within(region).getAllByRole<HTMLAnchorElement>("link");
    expect(links).toHaveLength(4);
    // Crew exports have no feature-setting query or mutation dependency. The
    // destination retains its own live feature gate after a recipient scans it.
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      "/api/public-qr?destination=crew&locale=en&download=1",
    );
    expect(links.every((link) => link.closest("[disabled]") === null)).toBe(
      true,
    );
    if (state.readOnly) {
      expect(state.privateChild).not.toHaveBeenCalled();
      for (const input of screen.getAllByLabelText(en.recruitment.previewLink, {
        exact: false,
      })) {
        expect(input.closest("fieldset")?.disabled).toBe(true);
      }
    }
    expect(state.saveRecruitment).not.toHaveBeenCalled();
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
});

it("preserves authoritative page denial instead of exposing sharing through a denied management page", () => {
  state.denied = true;
  show();
  expect(
    screen.queryByRole("region", { name: en.admin.program.publicQr.heading }),
  ).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(state.privateChild).not.toHaveBeenCalled();
  expect(state.saveRecruitment).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
