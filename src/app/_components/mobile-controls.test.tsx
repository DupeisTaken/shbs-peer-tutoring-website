/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { SortHeader, useSort } from "./sortable";
import { NavSidebarClient } from "./nav-sidebar-client";
import { AvailabilityEditor } from "../(tutor)/_components/availability-editor";
import PatrolPage from "../patrol/page";
import ProgramPage from "../(admin)/admin/program/page";
import RegistrationCodesPage from "../(admin)/admin/registration-codes/page";

const state = vi.hoisted(() => ({
  saveAvailability: vi.fn(),
  resetAvailability: vi.fn(),
  refetchAvailability: vi.fn<() => Promise<void>>(),
  onAvailabilitySuccess: undefined as (() => Promise<void>) | undefined,
  availabilityError: null as { message: string } | null,
  availabilitySaved: false,
  submitPatrol:
    vi.fn<
      (input: {
        submissionKey: string;
        observations: { roomId: string; headcount: string; observedAt: Date }[];
      }) => void
    >(),
  setFeature: vi.fn(),
  revokeCode: vi.fn(),
  pending: false,
  canEdit: true,
  readOnly: false,
  hasStagedFeature: true,
  crewStatus: "ACTIVE",
  availability: {
    slots: [
      { id: "early", label: "Early", dayOfWeek: 1, startMin: 480, endMin: 540 },
      { id: "late", label: "Late", dayOfWeek: 1, startMin: 540, endMin: 600 },
    ],
    selectedSlotIds: ["early"],
  },
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/rooms" }));
vi.mock("~/app/_components/program-email-settings", () => ({
  ProgramEmailSettings: () => null,
}));
// This integration suite owns staged feature switches; the independent settings
// have dedicated loading/error/permission tests and must not share its mocks.
vi.mock("~/app/_components/program-captcha-settings", () => ({
  ProgramCaptchaSettings: () => null,
}));
vi.mock("~/app/_components/program-profile-settings", () => ({
  ProgramProfileSettings: () => null,
}));
vi.mock("~/app/_components/program-time-zone-settings", () => ({
  ProgramTimeZoneSettings: () => null,
}));
vi.mock("~/app/_components/recruitment-settings", () => ({
  RecruitmentSettings: () => null,
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readOnly,
}));
vi.mock("~/app/_components/branding-provider", () => ({
  useBranding: () => ({ APP_TITLE: "Tutoring" }),
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: { role: state.readOnly ? "VIEWER" : "HEAD" } }) } },
    useUtils: () => ({
      admin: { registrationCodes: { invalidate: async () => undefined } },
    }),
    tutor: {
      myAvailability: {
        useQuery: () => ({
          data: state.availability,
          isLoading: false,
          refetch: state.refetchAvailability,
        }),
      },
      setAvailability: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          state.onAvailabilitySuccess = options.onSuccess;
          return {
            mutate: state.saveAvailability,
            isPending: state.pending,
            isSuccess: state.availabilitySaved,
            error: state.availabilityError,
            reset: () => {
              state.resetAvailability();
              state.availabilityError = null;
              state.availabilitySaved = false;
            },
          };
        },
      },
    },
    crew: {
      myStatus: { useQuery: () => ({ data: { status: state.crewStatus } }) },
      patrolConfig: {
        useQuery: () => ({
          data: {
            rooms: [
              { id: "room-a", name: "Room A" },
              { id: "room-b", name: "Room B" },
            ],
          },
        }),
      },
      myPatrols: { useQuery: () => ({ data: [] }) },
      requestOptOut: { useMutation: () => ({}) },
      recallOptOut: { useMutation: () => ({}) },
      requestReentry: { useMutation: () => ({}) },
      submitPatrol: {
        useMutation: () => ({
          mutate: state.submitPatrol,
          isPending: state.pending,
        }),
      },
    },
    admin: {
      currentPeriod: {
        useQuery: () => ({
          data: {
            name: "Current term",
            canEdit: state.canEdit,
            canApply: true,
            semester: 1,
            termId: "term",
            recruitment: {},
            next: {
              name: "Next term",
              crossesSemester: false,
              crossesYear: false,
              graduates: false,
            },
          },
        }),
      },
      refresh: { useMutation: () => ({}) },
      registrationCodes: {
        useQuery: () => ({
          data: [
            {
              id: "active-code",
              label: "Tutor invite",
              tutorName: null,
              status: "active",
              kind: "TUTOR",
              code: "123456",
              issuedByName: "School coordinator",
              issuedByEmail: null,
              expiresAt: new Date("2026-10-10T00:00:00Z"),
            },
          ],
        }),
      },
      issueRegistrationCode: { useMutation: () => ({}) },
      revokeRegistrationCode: {
        useMutation: () => ({
          mutateAsync: state.revokeCode,
          isPending: state.pending,
        }),
      },
    },
    program: {
      featureSettings: {
        useQuery: () => ({
          data: {
            canEdit: state.canEdit,
            features: [
              {
                key: "QUARTER_SYSTEM",
                enabled: true,
                pending: state.hasStagedFeature ? false : null,
              },
            ],
          },
        }),
      },
      setFeaturePending: {
        useMutation: () => ({
          mutate: state.setFeature,
          isPending: state.pending,
        }),
      },
    },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="Asia/Shanghai"
  >
    {children}
  </NextIntlClientProvider>
);

beforeEach(() => {
  state.pending = false;
  state.canEdit = true;
  state.readOnly = false;
  state.hasStagedFeature = true;
  state.crewStatus = "ACTIVE";
  state.availability = { ...state.availability, selectedSlotIds: ["early"] };
  state.availabilityError = null;
  state.availabilitySaved = false;
  state.onAvailabilitySuccess = undefined;
  state.refetchAvailability.mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sortable column controls", () => {
  function Table() {
    const sort = useSort("name");
    return (
      <table>
        <thead>
          <tr>
            <SortHeader sort={sort} sortKey="name">
              Name
            </SortHeader>
            <SortHeader sort={sort} sortKey="hours">
              Hours
            </SortHeader>
          </tr>
        </thead>
      </table>
    );
  }

  it("announces the active column direction and resets a different column to ascending", () => {
    render(<Table />);
    const name = screen.getByRole("columnheader", { name: "Name" });
    const hours = screen.getByRole("columnheader", { name: "Hours" });
    expect(name.getAttribute("aria-sort")).toBe("ascending");
    expect(hours.hasAttribute("aria-sort")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(name.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    expect(hours.getAttribute("aria-sort")).toBe("ascending");
    expect(name.hasAttribute("aria-sort")).toBe(false);
  });
});

describe("sidebar disclosures", () => {
  const props = {
    sections: [
      {
        key: "people",
        title: "People",
        items: [{ href: "/admin/tutors", label: "Tutors" }],
      },
      {
        key: "settings",
        title: "Settings",
        items: [{ href: "/admin/rooms", label: "Rooms" }],
      },
    ],
    collapseAllLabel: "Collapse all",
    expandAllLabel: "Expand all",
  };

  it("keeps expanded state and disclosure destinations in sync when sections or all groups change", () => {
    render(<NavSidebarClient {...props} />);
    const people = screen.getByRole("button", { name: "People" });
    const target = document.getElementById(
      people.getAttribute("aria-controls")!,
    )!;
    expect(people.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(people);
    expect(people.getAttribute("aria-expanded")).toBe("false");
    expect(target.hidden).toBe(true);
    expect(screen.queryByRole("link", { name: "Tutors" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(target.hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem("adminNavCollapsed")!)).toEqual({
      people: false,
      settings: false,
    });
  });

  it("assigns unique destinations when desktop and drawer copies are mounted", () => {
    render(
      <>
        <NavSidebarClient {...props} />
        <NavSidebarClient {...props} sticky={false} />
      </>,
    );
    const controls = screen
      .getAllByRole("button", { name: "People" })
      .map((button) => button.getAttribute("aria-controls"));
    expect(new Set(controls).size).toBe(2);
    expect(controls.every((id) => document.getElementById(id!))).toBe(true);
  });
});

describe("availability choices", () => {
  it("loads saved choices, toggles their pressed states, and submits only the current selection", () => {
    render(<AvailabilityEditor />, { wrapper });
    const early = screen.getByRole("button", { name: /Early/ });
    const late = screen.getByRole("button", { name: /Late/ });
    expect(early.getAttribute("aria-pressed")).toBe("true");
    expect(late.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(early);
    fireEvent.click(late);
    expect(early.getAttribute("aria-pressed")).toBe("false");
    expect(late.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    expect(state.saveAvailability).toHaveBeenCalledWith({ slotIds: ["late"] });
  });

  it("freezes choices and Save/Cancel while the request is pending", () => {
    state.pending = true;
    render(<AvailabilityEditor />, { wrapper });
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.availability.saving,
    });
    expect(save.disabled).toBe(true);
    const early = screen.getByRole<HTMLButtonElement>("button", {
      name: /Early/,
    });
    const late = screen.getByRole<HTMLButtonElement>("button", {
      name: /Late/,
    });
    const cancel = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.uiPatterns.cancel,
    });
    for (const control of [early, late, cancel]) {
      expect(control.disabled).toBe(true);
      fireEvent.click(control);
    }
    expect(early.getAttribute("aria-pressed")).toBe("true");
    expect(late.getAttribute("aria-pressed")).toBe("false");
    expect(state.resetAvailability).not.toHaveBeenCalled();
    fireEvent.click(save);
    expect(state.saveAvailability).not.toHaveBeenCalled();
  });

  it("keeps the local draft after a failed save and announces the failure", () => {
    const view = render(<AvailabilityEditor />, { wrapper });
    const early = screen.getByRole("button", { name: /Early/ });
    const late = screen.getByRole("button", { name: /Late/ });
    fireEvent.click(early);
    fireEvent.click(late);
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    state.availabilityError = {
      message: "Availability could not be saved. Please retry.",
    };
    view.rerender(<AvailabilityEditor />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Availability could not be saved",
    );
    expect(early.getAttribute("aria-pressed")).toBe("false");
    expect(late.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    expect(state.saveAvailability).toHaveBeenLastCalledWith({
      slotIds: ["late"],
    });
  });

  it("preserves dirty choices across a background refetch and Cancel adopts the latest server state", () => {
    const view = render(<AvailabilityEditor />, { wrapper });
    const early = screen.getByRole("button", { name: /Early/ });
    const late = screen.getByRole("button", { name: /Late/ });
    fireEvent.click(late);
    state.availability = { ...state.availability, selectedSlotIds: [] };
    view.rerender(<AvailabilityEditor />);
    expect(early.getAttribute("aria-pressed")).toBe("true");
    expect(late.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: messages.uiPatterns.cancel }),
    );
    expect(early.getAttribute("aria-pressed")).toBe("false");
    expect(late.getAttribute("aria-pressed")).toBe("false");
    expect(state.saveAvailability).not.toHaveBeenCalled();
    expect(state.resetAvailability).toHaveBeenCalled();
  });

  it("follows background server changes when no local draft exists", () => {
    const view = render(<AvailabilityEditor />, { wrapper });
    state.availability = { ...state.availability, selectedSlotIds: ["late"] };
    view.rerender(<AvailabilityEditor />);
    expect(
      screen
        .getByRole("button", { name: /Early/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /Late/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("retains the submitted draft until an explicit refresh succeeds, then follows the saved snapshot", async () => {
    let finishRefresh!: () => void;
    state.refetchAvailability.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const view = render(<AvailabilityEditor />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /Late/ }));
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    let completing!: Promise<void>;
    act(() => {
      completing = state.onAvailabilitySuccess!();
    });
    state.availability = { ...state.availability, selectedSlotIds: ["late"] };
    view.rerender(<AvailabilityEditor />);
    expect(
      screen
        .getByRole("button", { name: /Early/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () => {
      finishRefresh();
      await completing;
    });
    state.availabilitySaved = true;
    view.rerender(<AvailabilityEditor />);
    expect(
      screen
        .getByRole("button", { name: /Early/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /Late/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      messages.tutor.availability.saved,
    );
  });

  it("keeps the submitted selection after a successful write followed by a failed GET, and retries synchronization before unlocking", async () => {
    state.refetchAvailability.mockRejectedValueOnce(
      new Error("Could not refresh availability."),
    );
    const view = render(<AvailabilityEditor />, { wrapper });
    const early = screen.getByRole<HTMLButtonElement>("button", {
      name: /Early/,
    });
    const late = screen.getByRole<HTMLButtonElement>("button", {
      name: /Late/,
    });
    fireEvent.click(early);
    fireEvent.click(late);
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    expect(state.saveAvailability).toHaveBeenCalledExactlyOnceWith({
      slotIds: ["late"],
    });
    state.availabilitySaved = true;
    await act(async () => {
      await state.onAvailabilitySuccess!();
    });
    expect(state.refetchAvailability).toHaveBeenCalledWith({
      throwOnError: true,
    });
    expect(state.availability.selectedSlotIds).toEqual(["early"]);
    expect(early.getAttribute("aria-pressed")).toBe("false");
    expect(late.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not refresh availability.",
    );
    expect(screen.queryByRole("status")).toBeNull();
    for (const control of [
      early,
      late,
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.uiPatterns.cancel,
      }),
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.tutor.availability.save,
      }),
    ]) {
      expect(control.disabled).toBe(true);
      fireEvent.click(control);
    }
    expect(state.saveAvailability).toHaveBeenCalledTimes(1);
    // The accepted result may exclude a slot that became inactive after the
    // form loaded, so synchronization must use the GET rather than copy input.
    state.availability = { ...state.availability, selectedSlotIds: [] };
    view.rerender(<AvailabilityEditor />);
    expect(late.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: messages.uiPatterns.retry }),
      );
    });
    expect(state.refetchAvailability).toHaveBeenCalledTimes(2);
    expect(late.getAttribute("aria-pressed")).toBe("false");
    expect(early.disabled).toBe(false);
    expect(late.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      messages.tutor.availability.saved,
    );
    fireEvent.click(
      screen.getByRole("button", { name: messages.tutor.availability.save }),
    );
    expect(state.saveAvailability).toHaveBeenLastCalledWith({ slotIds: [] });
  });
});

describe("patrol headcount choices", () => {
  it("keeps a single selected count per named room and submits only recorded rooms", () => {
    render(<PatrolPage />, { wrapper });
    const roomA = within(screen.getByRole("group", { name: "Room A" }));
    const roomB = within(screen.getByRole("group", { name: "Room B" }));
    expect(roomA.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    fireEvent.click(roomA.getByRole("button", { name: "1" }));
    fireEvent.click(roomA.getByRole("button", { name: "4+" }));
    expect(roomA.getByRole("button", { pressed: true }).textContent).toBe("4+");
    expect(roomB.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Submit patrol/i }));
    expect(state.submitPatrol).toHaveBeenCalledOnce();
    const submitted = state.submitPatrol.mock.calls[0]![0];
    expect(submitted.submissionKey).toEqual(expect.any(String));
    expect(submitted.observations).toHaveLength(1);
    expect(submitted.observations[0]).toMatchObject({
      roomId: "room-a",
      headcount: "FOUR_PLUS",
    });
    expect(submitted.observations[0]!.observedAt).toBeInstanceOf(Date);
  });

  it("keeps inactive crew outside the headcount controls", () => {
    state.crewStatus = "INACTIVE";
    render(<PatrolPage />, { wrapper });
    expect(screen.queryByRole("group", { name: "Room A" })).toBeNull();
  });
});

describe("program feature switches", () => {
  it("names a switch and derives the next request from its staged state", () => {
    render(<ProgramPage />, { wrapper });
    const toggle = screen.getByRole("switch", {
      name: messages.admin.program.features.name.QUARTER_SYSTEM,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(state.setFeature).toHaveBeenCalledWith({
      key: "QUARTER_SYSTEM",
      enabled: true,
    });
  });

  it("uses the effective state when no staged state exists and prevents duplicate writes", () => {
    state.hasStagedFeature = false;
    state.pending = true;
    render(<ProgramPage />, { wrapper });
    const toggle = screen.getByRole<HTMLButtonElement>("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(state.setFeature).not.toHaveBeenCalled();
  });

  it("keeps switch actions hidden for viewers", () => {
    state.canEdit = false;
    render(<ProgramPage />, { wrapper });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("registration code records", () => {
  it("names the record disclosure and keeps its target available when closed", () => {
    render(<RegistrationCodesPage />, { wrapper });
    const disclosure = screen.getByRole("button", {
      name: `${messages.admin.registrationCodes.expand}: Tutor invite`,
    });
    const panel = document.getElementById(
      disclosure.getAttribute("aria-controls")!,
    )!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(within(panel).getByText("123456")).toBeDefined();
    fireEvent.click(disclosure);
    expect(panel.hidden).toBe(true);
    expect(screen.queryByText("123456")).toBeNull();
  });

  it("reviews the exact invitation before revoking and honors pending and read-only states", async () => {
    let finish: () => void = () => undefined;
    state.revokeCode.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(<RegistrationCodesPage />, { wrapper });
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.registrationCodes.revoke,
      }),
    );
    const review = screen.getByRole("dialog", {
      name: messages.actionReview.revokeTitle,
    });
    expect(within(review).getByText(/^Tutor invite ·/)).toBeTruthy();
    expect(state.revokeCode).not.toHaveBeenCalled();
    fireEvent.click(
      within(review).getByRole("button", {
        name: messages.admin.registrationCodes.revoke,
      }),
    );
    expect(state.revokeCode).toHaveBeenCalledExactlyOnceWith({
      id: "active-code",
    });
    expect(
      within(review)
        .getByRole<HTMLButtonElement>("button", {
          name: messages.admin.registrationCodes.revoke,
        })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      within(review)
        .getByRole<HTMLButtonElement>("button", {
          name: messages.actionReview.cancel,
        })
        .matches(":disabled"),
    ).toBe(true);
    await act(async () => finish());
    fireEvent.click(
      within(review).getByRole("button", { name: messages.actionReview.close }),
    );
    state.readOnly = true;
    rerender(<RegistrationCodesPage />);
    expect(
      screen.queryByRole("button", {
        name: messages.admin.registrationCodes.revoke,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: messages.admin.registrationCodes.copy,
      }),
    ).toBeNull();
  });
});
