/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { useConfirmationSubmission } from "./use-confirmation-submission";

afterEach(cleanup);
it("uses actual mutation completion for repeated identical errors without observing pending props", async () => {
  const failure = new Error("Same rejection");
  const write = vi.fn(async () => {
    throw failure;
  });
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function Harness() {
    const mutation = useMutation({ mutationFn: write });
    // Model a caller whose pending render is absent/batched: the promise is the
    // authoritative completion signal, and the displayed error never changes.
    const review = useConfirmationSubmission(false, failure.message);
    return (
      <button
        disabled={review.admitted}
        onClick={() => review.run(() => mutation.mutateAsync())}
      >
        Confirm
      </button>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Confirm",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(button.disabled).toBe(false));
  view.unmount();
  client.clear();
});
