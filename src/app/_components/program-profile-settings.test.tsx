/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProfilePolicyEditor } from "./program-profile-settings";
import { ProfilePolicyHint, ProfilePolicyError } from "./profile-policy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const mock = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  requireLatinNames: false,
  requireLatinLegalNames: false,
  error: null as null | { message: string; data: { code: string } },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      invalidate: mock.invalidate,
      program: {
        profilePolicy: { invalidate: mock.invalidate },
        profilePolicySettings: { invalidate: mock.invalidate },
      },
    }),
    program: {
      profilePolicy: {
        useQuery: () => ({
          data: {
            requireLatinNames: mock.requireLatinNames,
            requireLatinLegalNames: mock.requireLatinLegalNames,
            offeredGrades: [9, 10, 11, 12],
            currentSchoolYear: "26-27",
          },
        }),
      },
      setProfilePolicy: {
        useMutation: () => ({
          mutate: mock.mutate,
          isPending: false,
          error: mock.error,
        }),
      },
    },
  },
}));
const policy = {
  usePreferredNames: false,
  showAlternateNames: false,
  requireLatinNames: true,
  requireLatinLegalNames: false,
  offeredGrades: [9, 10, 11, 12],
};
const wrap = (child: React.ReactNode, chinese = false) => (
  <NextIntlClientProvider
    locale={chinese ? "zh" : "en"}
    messages={chinese ? zh : en}
    timeZone="Asia/Shanghai"
  >
    {child}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mock.error = null;
  mock.requireLatinNames = false;
  mock.requireLatinLegalNames = false;
});
afterEach(cleanup);

it("saves the selected grades and toggle against the original policy snapshot", () => {
  const view = render(
    wrap(<ProfilePolicyEditor policy={policy} canEdit onReload={vi.fn()} />),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.profilePolicy.usePreferredNames }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Grade 1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Grade 9" }));
  view.rerender(
    wrap(
      <ProfilePolicyEditor
        policy={{
          ...policy,
          requireLatinNames: true,
          requireLatinLegalNames: false,
          offeredGrades: [12],
        }}
        canEdit
        onReload={vi.fn()}
      />,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: en.profilePolicy.save }));
  expect(mock.mutate).toHaveBeenCalledWith({
    ...policy,
    usePreferredNames: true,
    offeredGrades: [1, 10, 11, 12],
    expectedPolicy: policy,
  });
});
it("requires at least one grade even when the form is submitted directly", () => {
  render(
    wrap(
      <ProfilePolicyEditor
        policy={{ ...policy, offeredGrades: [9] }}
        canEdit
        onReload={vi.fn()}
      />,
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Grade 9" }));
  expect(screen.getByRole("alert").textContent).toBe(
    en.profilePolicy.atLeastOne,
  );
  fireEvent.submit(document.querySelector("form")!);
  expect(mock.mutate).not.toHaveBeenCalled();
});
it("keeps coordinator settings read-only, including direct form submission", () => {
  render(
    wrap(
      <ProfilePolicyEditor
        policy={policy}
        canEdit={false}
        onReload={vi.fn()}
      />,
    ),
  );
  expect(screen.getByText(en.profilePolicy.readOnly)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.profilePolicy.save }),
  ).toBeNull();
  expect(
    screen
      .getByRole("checkbox", { name: "Grade 9" })
      .closest("fieldset[disabled]"),
  ).not.toBeNull();
  fireEvent.submit(document.querySelector("form")!);
  expect(mock.mutate).not.toHaveBeenCalled();
});
it("explains a policy conflict and waits for explicit reload without dropping the draft", () => {
  mock.error = {
    message: "PROFILE_POLICY_CHANGED",
    data: { code: "CONFLICT" },
  };
  const reload = vi.fn();
  render(
    wrap(<ProfilePolicyEditor policy={policy} canEdit onReload={reload} />),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Grade 1" }));
  expect(screen.getByRole("alert").textContent).toBe(en.profilePolicy.conflict);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Grade 1" }).checked,
  ).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.profilePolicy.reload }),
  );
  expect(reload).toHaveBeenCalledOnce();
});
it.each([false, true])(
  "shows fixed localized Latin-name guidance (Chinese=%s)",
  (chinese) => {
    const view = render(wrap(<ProfilePolicyHint />, chinese));
    expect(view.container.textContent).toBe(
      (chinese ? zh : en).profilePolicy.nameHint,
    );
    mock.requireLatinNames = true;
    view.rerender(wrap(<ProfilePolicyHint />, chinese));
    expect(
      screen.getByText((chinese ? zh : en).profilePolicy.nameHint),
    ).toBeTruthy();
  },
);
it.each([
  ["PROFILE_LATIN_LEGAL_NAME_REQUIRED", "latinLegalRequired"],
  ["PROFILE_LATIN_NAME_REQUIRED", "latinRequired"],
  ["PROFILE_GRADE_NOT_OFFERED", "gradeNotOffered"],
  ["PROFILE_POLICY_CHANGED", "conflict"],
  ["PROFILE_PROGRAM_YEAR_CHANGED", "yearChanged"],
  ["PROFILE_NO_CURRENT_YEAR", "noCurrentYear"],
] as const)("localizes %s without leaking a server code", (message, key) => {
  render(wrap(<ProfilePolicyError message={message} />, true));
  expect(screen.getByText(zh.profilePolicy[key])).toBeTruthy();
});

it("saves additional-name display independently of preferred-name display", () => {
  render(
    wrap(<ProfilePolicyEditor policy={policy} canEdit onReload={vi.fn()} />),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: en.profilePolicy.showAlternateNames,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.profilePolicy.save }));
  expect(mock.mutate).toHaveBeenCalledWith({
    ...policy,
    showAlternateNames: true,
    expectedPolicy: policy,
  });
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: en.profilePolicy.usePreferredNames,
    }).checked,
  ).toBe(false);
});

it.each([false, true])(
  "does not apply Latin-name guidance to the other-language field (Chinese=%s)",
  (chinese) => {
    mock.requireLatinNames = true;
    const view = render(wrap(<ProfilePolicyHint field="legal" />, chinese));
    expect(view.container.textContent).toBe("");
    mock.requireLatinLegalNames = true;
    mock.requireLatinNames = false;
    view.rerender(wrap(<ProfilePolicyHint field="legal" />, chinese));
    expect(view.container.textContent).toBe("");
  },
);
