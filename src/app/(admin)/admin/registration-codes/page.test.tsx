// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "postcss";
import { compile } from "tailwindcss";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import chinese from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { downloadCardImage } from "~/lib/download-card-image";
import RegistrationCodesPage from "./page";
import { type RegistrationKind } from "~/lib/registration-kind";

const state = vi.hoisted(
  (): {
    role: string;
    status: string;
    code: string | null;
    label: string | null;
    tutorName: string | null;
    invalidate: () => void;
    issue: (input: {
      kind: RegistrationKind;
      label?: string;
      email?: string;
    }) => void;
    revoke: (input: { id: string }) => void;
  } => ({
    role: "HEAD",
    status: "active",
    code: "TEST5",
    label: "Test invitation",
    tutorName: null,
    invalidate: vi.fn(),
    issue: vi.fn(),
    revoke: vi.fn(),
  }),
);
const record = () => ({
  id: "invite",
  label: state.label,
  tutorName: state.tutorName,
  kind: "TUTOR",
  code: state.code,
  expiresAt: new Date("2099-10-16"),
  status: state.status,
});
vi.mock("~/lib/download-card-image", () => ({ downloadCardImage: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { registrationCodes: { invalidate: state.invalidate } },
    }),
    account: { me: { useQuery: () => ({ data: { role: state.role } }) } },
    admin: {
      registrationCodes: { useQuery: () => ({ data: [record()] }) },
      issueRegistrationCode: {
        useMutation: (options: {
          onSuccess: (data: ReturnType<typeof record>) => Promise<void>;
        }) => ({
          mutate: (input: {
            kind: RegistrationKind;
            label?: string;
            email?: string;
          }) => {
            state.issue(input);
            void options.onSuccess({ ...record(), kind: input.kind });
          },
        }),
      },
      revokeRegistrationCode: {
        useMutation: (options: {
          onSuccess: (data: null, input: { id: string }) => Promise<void>;
        }) => ({
          mutateAsync: async (input: { id: string }) => {
            state.revoke(input);
            await options.onSuccess(null, input);
          },
        }),
      },
    },
  },
}));

function show(readOnly = false, locale: "en" | "zh" = "en") {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? chinese : messages}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={readOnly}>
          <RegistrationCodesPage />
        </ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
  vi.clearAllMocks();
  state.role = "HEAD";
  state.status = "active";
  state.code = "TEST5";
  state.label = "Test invitation";
  state.tutorName = null;
  vi.mocked(downloadCardImage).mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

it.each([
  ["en", "active"],
  ["en", "used"],
  ["en", "expired"],
  ["zh", "active"],
  ["zh", "used"],
  ["zh", "expired"],
] as const)(
  "centers the identity and badges without fixing a wrapped %s %s row height",
  async (locale, status) => {
    state.status = status;
    state.label =
      "Avery Stone — 很长的邀请姓名 " + "LongUnbrokenName".repeat(5);
    const { container } = show(false, locale);
    const text = locale === "zh" ? chinese : messages;
    const toggle = screen.getByRole("button", {
      name: `${text.admin.registrationCodes.expand}: ${state.label}`,
    });
    const identity = toggle.parentElement!;
    const label = within(identity).getByText(state.label);
    const line = label.closest("p")!;
    expect(
      line.contains(
        within(identity).getByText(text.admin.registrationCodes.status[status]),
      ),
    ).toBe(true);
    expect(
      line.contains(
        within(identity).getByText(text.admin.registrationCodes.kindTutor),
      ),
    ).toBe(true);

    // Compile the utilities actually rendered by the real page. jsdom has no
    // flex geometry: this guards layout semantics; browser rects verify centers.
    const require = createRequire(import.meta.url);
    const theme = readFileSync(
      require.resolve("tailwindcss/theme.css"),
      "utf8",
    );
    const compiler = await compile(`${theme}\n@tailwind utilities;`);
    const candidates = [
      ...new Set(
        [...container.querySelectorAll("[class]")].flatMap((element) => [
          ...element.classList,
        ]),
      ),
    ];
    const rules = parse(compiler.build(candidates));
    function valueFor(element: Element, property: string) {
      let value: string | undefined;
      rules.walkRules((rule) => {
        // Only simple utility selectors participate in these base layout properties.
        if (
          !/^\.[a-z][a-z0-9-]*$/.test(rule.selector) ||
          !element.matches(rule.selector)
        )
          return;
        for (const node of rule.nodes) {
          if (node.type === "decl" && node.prop === property)
            value = node.value;
        }
      });
      return value;
    }
    expect(valueFor(identity, "align-items")).toBe("center");
    expect(valueFor(line, "display")).toBe("flex");
    expect(valueFor(line, "align-items")).toBe("center");
    expect(valueFor(line, "flex-wrap")).toBe("wrap");
    expect(valueFor(label, "min-width")).toMatch(/^0(?:px)?$/);
    expect(valueFor(line, "height")).toBeUndefined();
    for (const name of [
      text.admin.registrationCodes.copy,
      text.admin.registrationCodes.revoke,
    ]) {
      if (status === "active")
        expect(screen.getByRole("button", { name })).toBeTruthy();
      else expect(screen.queryByRole("button", { name })).toBeNull();
    }
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(toggle.getAttribute("aria-controls")!)?.hidden,
    ).toBe(false);
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.revoke).not.toHaveBeenCalled();
  },
);

describe("registration code export availability", () => {
  it.each(["Synthetic invited tutor", null])(
    "identifies an unlabeled invitation by its tutor or stable id (%s)",
    (name) => {
      state.label = null;
      state.tutorName = name;
      show();
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
      expect(screen.getByRole("dialog").textContent).toContain(
        name ?? "invite",
      );
      expect(state.revoke).not.toHaveBeenCalled();
    },
  );
  it("exports newly issued and reopened cards without another mutation", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Issue Code" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Export Image" }),
    );
    await waitFor(() => expect(downloadCardImage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Export Image" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand: Test invitation" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Image" }));
    await waitFor(() => expect(downloadCardImage).toHaveBeenCalledTimes(2));
    expect(state.issue).toHaveBeenCalledOnce();
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it.each(["used", "expired"])("does not export %s records", (status) => {
    state.status = status;
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand: Test invitation" }),
    );
    expect(screen.queryByRole("button", { name: "Export Image" })).toBeNull();
  });

  it("does not offer export for masked records", () => {
    state.code = null;
    show(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand: Test invitation" }),
    );
    expect(screen.queryByRole("button", { name: "Export Image" })).toBeNull();
    expect(screen.queryByText("TEST5")).toBeNull();
  });

  it("removes the freshly issued share card after revocation", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Issue Code" }));
    expect(
      await screen.findByRole("button", { name: "Export Image" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(state.revoke).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("Test invitation");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Export Image" })).toBeNull(),
    );
    expect(state.revoke).toHaveBeenCalledWith({ id: "invite" });
  });
});

it("lets Coordinators request only participant invitations", () => {
  state.role = "COORDINATOR";
  show();
  expect(
    screen.queryByRole("option", {
      name: messages.admin.registrationCodes.kindAdmin,
    }),
  ).toBeNull();
  expect(
    screen.queryByRole("option", {
      name: messages.admin.registrationCodes.kindCoordinator,
    }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: messages.approvals.requestHead }),
  ).toBeTruthy();
});

it.each([
  ["HEAD", "TUTOR", true],
  ["HEAD", "CREW", true],
  ["HEAD", "ADMIN", true],
  ["HEAD", "COORDINATOR", true],
  ["ADMIN", "TUTOR", true],
  ["ADMIN", "CREW", true],
  ["ADMIN", "ADMIN", false],
  ["ADMIN", "COORDINATOR", false],
  ["COORDINATOR", "TUTOR", false],
  ["COORDINATOR", "CREW", false],
] as const)(
  "shows the correct issuance action for %s issuing %s",
  (role, kind, direct) => {
    state.role = role;
    show();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: kind } });
    expect(
      screen.getByRole("button", {
        name: direct
          ? messages.admin.registrationCodes.issue
          : messages.approvals.requestHead,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: direct
          ? messages.approvals.requestHead
          : messages.admin.registrationCodes.issue,
      }),
    ).toBeNull();
  },
);

it.each(["TUTOR", "CREW"] as const)(
  "lets Admin issue and share a %s code directly",
  async (kind) => {
    state.role = "ADMIN";
    show();
    // Switching from a management kind must recalculate the action immediately.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ADMIN" },
    });
    expect(
      screen.getByRole("button", { name: messages.approvals.requestHead }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: kind } });
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.admin.registrationCodes.issue,
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Export Image" }),
    ).toBeTruthy();
    expect(state.issue).toHaveBeenCalledWith({
      kind,
      label: undefined,
      email: undefined,
    });
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(screen.queryByText(messages.approvals.queuedBody)).toBeNull();
  },
);

it("reveals the authorized invitation selected by an incoming interview link without issuing a code", async () => {
  window.history.replaceState(
    null,
    "",
    "/admin/registration-codes#registration-code-invite",
  );
  show();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", {
          name: `${messages.admin.registrationCodes.collapse}: ${state.label}`,
        })
        .getAttribute("aria-expanded"),
    ).toBe("true"),
  );
  expect(document.getElementById("registration-code-invite")?.hidden).toBe(
    false,
  );
  expect(state.issue).not.toHaveBeenCalled();
  window.history.replaceState(null, "", "/");
});
