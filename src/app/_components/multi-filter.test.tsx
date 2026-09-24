/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { MultiFilter } from "./multi-filter";
afterEach(cleanup);
it("offers independently labelled include/exclude choices without clearing existing selections", () => {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MultiFilter
        label="Role"
        options={[
          { value: "ADMIN", label: "Admin" },
          { value: "HEAD", label: "Head" },
        ]}
        value={{ include: ["HEAD"], exclude: [] }}
        onChange={onChange}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("Role", { selector: "summary" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  expect(onChange).toHaveBeenLastCalledWith({
    include: ["HEAD", "ADMIN"],
    exclude: [],
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Head" }));
  expect(onChange).toHaveBeenLastCalledWith({
    include: ["HEAD"],
    exclude: ["HEAD"],
  });
});
