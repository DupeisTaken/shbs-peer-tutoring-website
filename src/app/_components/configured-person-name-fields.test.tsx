/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import {
  DEFAULT_NAME_FIELDS,
  nameFieldPolicies,
  type NameFieldStates,
} from "~/lib/name-field-policy";
import { nameDraft } from "~/lib/person-name";
import {
  ConfiguredPersonNameFields,
  useNameFieldPresentation,
} from "./person-name-fields";
const query = vi.hoisted(() => ({
  states: undefined as NameFieldStates | undefined,
  error: null as Error | null,
  refresh: vi.fn(),
  save: vi.fn(),
}));
function PresentationForm({ intake = false }: { intake?: boolean }) {
  const { ready, hasFields, hasLatinFields, observe } =
    useNameFieldPresentation();
  const [names, setNames] = useState(() =>
    nameDraft({ firstName: "Original", lastName: "Retained" }),
  );
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && hasFields) query.save(names);
        }}
      >
        <ConfiguredPersonNameFields
          accountType={intake ? "VIEWER" : undefined}
          value={names}
          onChange={setNames}
          onPolicyAvailabilityChange={observe}
        />
        {hasFields && <button disabled={!ready}>Save names</button>}
        {intake && hasLatinFields && <p>Latin guidance</p>}
        <input aria-label="Independent contact" />
      </form>
    </NextIntlClientProvider>
  );
}
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      nameFieldPolicy: {
        useQuery: () => ({
          data: query.states
            ? {
                policies: Object.fromEntries(
                  [
                    "STUDENT",
                    "TUTOR",
                    "CREW",
                    "VIEWER",
                    "ADMIN",
                    "HEAD",
                    "COORDINATOR",
                  ].map((role) => [role, query.states]),
                ),
              }
            : undefined,
          error: query.error,
          refetch: query.refresh,
        }),
      },
      nameFieldsForProfile: {
        useQuery: () => ({
          data: query.states
            ? { accountType: "STUDENT", states: query.states, version: 1 }
            : undefined,
          error: query.error,
          refetch: query.refresh,
        }),
      },
    },
  },
}));
beforeEach(() => {
  query.states = undefined;
  query.error = null;
  vi.clearAllMocks();
});
afterEach(cleanup);
function DraftForm({ management = false }: { management?: boolean }) {
  const [names, setNames] = useState(() =>
    nameDraft({
      firstName: "Retained first",
      lastName: "Original last",
      preferredName: "Retained alias",
    }),
  );
  const [ready, setReady] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) query.save(names);
        }}
      >
        <ConfiguredPersonNameFields
          value={names}
          onChange={setNames}
          onPolicyAvailabilityChange={setReady}
          management={management}
        />
        <button disabled={!ready}>Save profile</button>
      </form>
    </NextIntlClientProvider>
  );
}
it("does not mount default required/visible name fields before the current policy loads", () => {
  const view = render(<DraftForm />);
  expect(view.container.querySelectorAll("input")).toHaveLength(0);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save profile" })
      .disabled,
  ).toBe(true);
  query.states = {
    ...DEFAULT_NAME_FIELDS,
    firstName: "hidden",
    preferredName: "hidden",
  };
  view.rerender(<DraftForm />);
  expect(view.container.querySelector('input[name="firstName"]')).toBeNull();
  expect(
    view.container.querySelector('input[name="preferredName"]'),
  ).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save profile" })
      .disabled,
  ).toBe(false);
});
it("retains cached configured fields and a typed draft through failure, but blocks edits/saves until read recovery", () => {
  query.states = {
    ...DEFAULT_NAME_FIELDS,
    firstName: "hidden",
    preferredName: "hidden",
  };
  const view = render(<DraftForm />);
  const last = view.container.querySelector<HTMLInputElement>(
    'input[name="lastName"]',
  )!;
  fireEvent.change(last, { target: { value: "Unsaved draft" } });
  query.error = new Error("Transport unavailable");
  view.rerender(<DraftForm />);
  expect(
    view.container.querySelector<HTMLInputElement>('input[name="lastName"]')!
      .value,
  ).toBe("Unsaved draft");
  expect(view.container.querySelector('input[name="firstName"]')).toBeNull();
  expect(last.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save profile" })
      .disabled,
  ).toBe(true);
  fireEvent.submit(view.container.querySelector("form")!);
  expect(query.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.nameFields.refresh }));
  expect(query.refresh).toHaveBeenCalledTimes(1);
  query.error = null;
  view.rerender(<DraftForm />);
  expect(
    view.container.querySelector<HTMLInputElement>('input[name="lastName"]')!
      .value,
  ).toBe("Unsaved draft");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save profile" })
      .disabled,
  ).toBe(false);
});
it("renders hidden originals only in the explicit management projection", () => {
  query.states = nameFieldPolicies({
    STUDENT: { firstName: "hidden", preferredName: "hidden" },
  }).STUDENT;
  const view = render(<DraftForm management />);
  expect(
    view.container.querySelector<HTMLInputElement>('input[name="firstName"]')!
      .value,
  ).toBe("Retained first");
  expect(
    view.container.querySelector<HTMLInputElement>(
      'input[name="preferredName"]',
    )!.value,
  ).toBe("Retained alias");
  expect(screen.getAllByText(/Hidden from participant forms/)).toHaveLength(2);
  const first = view.container.querySelector<HTMLInputElement>(
    'input[name="firstName"]',
  )!;
  expect(
    view.container.querySelector(`label[for="${first.id}"]`)!.textContent,
  ).toBe(en.personName.firstName);
});
it("omits an unsplit legacy label when its hidden components cannot be separated, while management retains the original", () => {
  query.states = { ...DEFAULT_NAME_FIELDS, firstName: "hidden" };
  const names = nameDraft();
  const tree = (management = false) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <ConfiguredPersonNameFields
        value={names}
        originalValue={names}
        legacyName="Raw unsplit original"
        onChange={() => undefined}
        management={management}
      />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  expect(screen.queryByText(/Raw unsplit original/)).toBeNull();
  view.rerender(tree(true));
  expect(screen.getByText(/Raw unsplit original/)).toBeTruthy();
});
it("retains all-Hidden presentation during failed policy reads without exposing raw values or suppressing contact", () => {
  query.states = {
    firstName: "hidden",
    lastName: "hidden",
    preferredName: "hidden",
    alternativeNames: "hidden",
  };
  const view = render(<PresentationForm />);
  expect(screen.getByText(en.nameFields.hiddenProfileHelp)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save names" })).toBeNull();
  expect(view.container.querySelector('input[name="firstName"]')).toBeNull();
  query.error = new Error("Read unavailable");
  view.rerender(<PresentationForm />);
  expect(screen.getByText(en.nameFields.hiddenProfileHelp)).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>("Independent contact").disabled,
  ).toBe(false);
  fireEvent.submit(view.container.querySelector("form")!);
  expect(query.save).not.toHaveBeenCalled();
  query.error = null;
  query.states = DEFAULT_NAME_FIELDS;
  view.rerender(<PresentationForm />);
  expect(
    view.container.querySelector<HTMLInputElement>('input[name="firstName"]')
      ?.value,
  ).toBe("Original");
});
it("shows no orphan Latin guidance for an intake with only an other-language field", () => {
  const view = render(<PresentationForm intake />);
  expect(screen.queryByText("Latin guidance")).toBeNull();
  query.states = {
    firstName: "hidden",
    lastName: "hidden",
    preferredName: "hidden",
    alternativeNames: "optional",
  };
  view.rerender(<PresentationForm intake />);
  expect(screen.queryByText("Latin guidance")).toBeNull();
  expect(
    screen.getByLabelText("Name in Another Language Optional"),
  ).toBeTruthy();
  query.states = DEFAULT_NAME_FIELDS;
  view.rerender(<PresentationForm intake />);
  expect(screen.getByText("Latin guidance")).toBeTruthy();
});
