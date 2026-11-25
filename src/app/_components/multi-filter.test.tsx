/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Selection } from "~/lib/user-filters";
import messages from "../../../messages/en.json";
import { ActiveFilterChips, MultiFilter } from "./multi-filter";

afterEach(cleanup);

it("treats Include and Exclude as a mutually exclusive mode over one selection", () => {
  const seen: Selection[] = [];
  function Harness() {
    const [value, setValue] = useState<Selection>({
      include: ["HEAD"],
      exclude: [],
    });
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <MultiFilter
          label="Role"
          options={[
            { value: "ADMIN", label: "Admin" },
            { value: "HEAD", label: "Head" },
          ]}
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      </NextIntlClientProvider>
    );
  }
  render(<Harness />);

  const summary = screen.getByText("Role", { selector: "summary" });
  expect(summary.textContent).toContain("+1");
  fireEvent.click(summary);

  fireEvent.click(screen.getByRole("checkbox", { name: "Include Admin" }));
  expect(seen.at(-1)).toEqual({ include: ["HEAD", "ADMIN"], exclude: [] });
  expect(summary.textContent).toContain("+2");

  // Switching to Exclude moves the current selection into exclude (never both).
  fireEvent.click(screen.getByRole("button", { name: "Exclude" }));
  expect(seen.at(-1)).toEqual({ include: [], exclude: ["HEAD", "ADMIN"] });
  expect(summary.textContent).toContain("−2");
  expect(summary.textContent).not.toContain("+");

  // Unchecking Head leaves only Admin excluded.
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Head" }));
  expect(seen.at(-1)).toEqual({ include: [], exclude: ["ADMIN"] });

  // Unchecking the last excluded item returns to an unrestricted empty filter.
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude Admin" }));
  expect(seen.at(-1)).toEqual({ include: [], exclude: [] });
  expect(summary.textContent).toBe("Role");
});

it("lets empty mode switches decide whether the first checked option includes or excludes", () => {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MultiFilter
        label="Account"
        defaultOpen
        options={[
          { value: "registered", label: "Setup complete" },
          { value: "none", label: "No direct login attached" },
        ]}
        value={{ include: [], exclude: [] }}
        onChange={onChange}
      />
    </NextIntlClientProvider>,
  );

  // Switching mode with nothing selected emits no spurious filter change yet.
  fireEvent.click(screen.getByRole("button", { name: "Exclude" }));
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("checkbox", { name: "Exclude No direct login attached" }),
  );
  expect(onChange).toHaveBeenLastCalledWith({
    include: [],
    exclude: ["none"],
  });
});

it("resets cleanly and removes individual active chips", () => {
  const onRoleChange = vi.fn();
  const options = [
    { value: "ADMIN", label: "Admin" },
    { value: "HEAD", label: "Head" },
  ];
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MultiFilter
        label="Role"
        defaultOpen
        options={options}
        value={{ include: [], exclude: ["ADMIN", "HEAD"] }}
        onChange={onRoleChange}
      />
      <ActiveFilterChips
        groups={[
          {
            id: "role",
            label: "Role",
            options,
            value: { include: [], exclude: ["ADMIN", "HEAD"] },
            onChange: onRoleChange,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );

  const summary = screen.getByText("Role", { selector: "summary" });
  expect(summary.textContent).toContain("−2");

  // Removing a single chip removes only that item.
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Exclude · Role: Head" }),
  );
  expect(onRoleChange).toHaveBeenLastCalledWith({
    include: [],
    exclude: ["ADMIN"],
  });

  // Reset inside the popover clears the filter.
  fireEvent.click(
    screen.getByRole("button", { name: messages.userMultiFilters.resetFilter }),
  );
  expect(onRoleChange).toHaveBeenLastCalledWith({
    include: [],
    exclude: [],
  });
});

it("closes and blocks interaction when disabled", () => {
  const { container, rerender } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MultiFilter
        label="Role"
        defaultOpen
        options={[{ value: "ADMIN", label: "Admin" }]}
        value={{ include: [], exclude: [] }}
        onChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  const details = container.querySelector("details")!;
  expect(details.open).toBe(true);

  rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MultiFilter
        label="Role"
        disabled
        defaultOpen
        options={[{ value: "ADMIN", label: "Admin" }]}
        value={{ include: [], exclude: [] }}
        onChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  expect(details.open).toBe(false);
  expect(
    screen
      .getByText("Role", { selector: "summary" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});
