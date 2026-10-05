// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { TutorActivation } from "./tutor-activation";
const state = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  mutate: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  onSuccess: async (): Promise<void> => undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ tutor: { me: { invalidate: state.invalidate } } }),
    tutor: {
      activateAccount: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          state.onSuccess = options.onSuccess;
          return { mutate: state.mutate };
        },
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.confirm.mockResolvedValue(false);
});
it.each([true, false])(
  "confirms participation choice %s and refreshes server eligibility only after success",
  async (available) => {
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <TutorActivation />
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole("button", {
      name: messages.tutor.activate[available ? "available" : "optOut"],
    });
    fireEvent.click(button);
    await waitFor(() => expect(state.confirm).toHaveBeenCalled());
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
    state.confirm.mockResolvedValue(true);
    fireEvent.click(button);
    await waitFor(() =>
      expect(state.mutate).toHaveBeenCalledWith({ available }),
    );
    await act(async () => state.onSuccess());
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.invalidate).toHaveBeenCalledOnce();
  },
);
