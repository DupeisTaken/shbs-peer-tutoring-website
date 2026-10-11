/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryFeedback } from "./query-feedback";

afterEach(cleanup);
const copy = {
  loadingTitle: "Loading policy documents",
  errorTitle: "Policy documents could not be loaded",
  retryLabel: "Retry policy documents",
};

it("distinguishes an initial pending read from a loaded empty collection", () => {
  const view = render(
    <QueryFeedback
      {...copy}
      hasData={false}
      loading
      error={false}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  view.rerender(
    <QueryFeedback
      {...copy}
      hasData
      loading={false}
      error={false}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(view.container.textContent).toBe("");
});

it("keeps initial failure visible while retrying and calls only the supplied recovery", () => {
  const retry = vi.fn();
  const view = render(
    <QueryFeedback {...copy} hasData={false} loading error onRetry={retry} />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(copy.errorTitle);
  fireEvent.click(screen.getByRole("button", { name: copy.retryLabel }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(
    <QueryFeedback
      {...copy}
      hasData={false}
      loading
      error
      retrying
      onRetry={retry}
    />,
  );
  expect(screen.getByRole("button").matches(":disabled")).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain(copy.errorTitle);
});

it("renders cached failure beside a retained feature draft without replacing it", () => {
  const view = render(
    <>
      <input aria-label="Draft" defaultValue="Original" />
      <QueryFeedback
        {...copy}
        hasData
        loading={false}
        error={false}
        onRetry={vi.fn()}
      />
    </>,
  );
  const input = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  fireEvent.change(input, { target: { value: "Unsaved policy draft" } });
  view.rerender(
    <>
      <input aria-label="Draft" defaultValue="Original" />
      <QueryFeedback
        {...copy}
        hasData
        loading
        error
        retrying
        errorDetail="Connection unavailable"
        onRetry={vi.fn()}
      />
    </>,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Connection unavailable",
  );
  expect(screen.getByRole("button").matches(":disabled")).toBe(true);
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input.value).toBe("Unsaved policy draft");
});
