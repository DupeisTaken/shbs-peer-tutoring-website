// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { downloadCardImage } from "~/lib/download-card-image";
import RegistrationCodesPage from "./page";

const state = vi.hoisted(
  (): {
    status: string;
    code: string | null;
    invalidate: () => void;
    issue: () => void;
    revoke: (input: { id: string }) => void;
  } => ({
    status: "active",
    code: "TEST5",
    invalidate: vi.fn(),
    issue: vi.fn(),
    revoke: vi.fn(),
  }),
);
const record = () => ({
  id: "invite",
  label: "Test invitation",
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
    admin: {
      registrationCodes: { useQuery: () => ({ data: [record()] }) },
      issueRegistrationCode: {
        useMutation: (options: {
          onSuccess: (data: ReturnType<typeof record>) => Promise<void>;
        }) => ({
          mutate: () => {
            state.issue();
            void options.onSuccess(record());
          },
        }),
      },
      revokeRegistrationCode: {
        useMutation: (options: {
          onSuccess: (data: null, input: { id: string }) => Promise<void>;
        }) => ({
          mutate: (input: { id: string }) => {
            state.revoke(input);
            void options.onSuccess(null, input);
          },
        }),
      },
    },
  },
}));

function show(readOnly = false) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <RegistrationCodesPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.status = "active";
  state.code = "TEST5";
  vi.mocked(downloadCardImage).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("registration code export availability", () => {
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
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Export Image" })).toBeNull(),
    );
    expect(state.revoke).toHaveBeenCalledWith({ id: "invite" });
  });
});
