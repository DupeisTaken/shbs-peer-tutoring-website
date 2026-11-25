/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckboxListbox,
  type CheckboxListboxOption,
} from "./checkbox-listbox";

afterEach(cleanup);

const shortOptions: CheckboxListboxOption[] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
];

const longOptions: CheckboxListboxOption[] = [
  { value: "calc-ab", label: "AP Calculus AB", group: "AP" },
  { value: "calc-bc", label: "AP Calculus BC", group: "AP" },
  { value: "phys-c", label: "AP Physics C", group: "AP" },
  { value: "chem", label: "AP Chemistry", group: "AP" },
  { value: "bio", label: "AP Biology", group: "AP" },
  { value: "alg2", label: "Honors Algebra II", group: "Honors" },
  { value: "geom", label: "Honors Geometry", group: "Honors" },
  { value: "precalc", label: "Honors Precalculus", group: "Honors" },
  { value: "eng10", label: "English 10", group: "Core" },
];

describe("CheckboxListbox", () => {
  it("omits search chrome for short lists and toggles native checkboxes cleanly", () => {
    const onChange = vi.fn();
    render(
      <CheckboxListbox
        label="Available days"
        options={shortOptions}
        value={["mon"]}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 selected");

    fireEvent.click(screen.getByRole("checkbox", { name: "Wednesday" }));
    expect(onChange).toHaveBeenLastCalledWith(["mon", "wed"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("enables search, selected-only view, and preserves hidden selections on long grouped lists", () => {
    const onChange = vi.fn();
    render(
      <CheckboxListbox
        label="Courses"
        options={longOptions}
        value={["calc-bc", "alg2", "eng10"]}
        onChange={onChange}
        maxVisibleSummary={2}
      />,
    );

    // Search input and group headers appear automatically for long option sets.
    const search = screen.getByRole("searchbox", { name: "Filter options" });
    expect(screen.getByText("AP")).toBeTruthy();
    expect(screen.getByText("Honors")).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();

    // Filtering hides non-matching items without clearing existing selections.
    fireEvent.change(search, { target: { value: "Physics" } });
    expect(screen.getByRole("checkbox", { name: "AP Physics C" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "English 10" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("3 selected");

    // Selecting a filtered candidate appends to existing hidden selections.
    fireEvent.click(screen.getByRole("checkbox", { name: "AP Physics C" }));
    expect(onChange).toHaveBeenLastCalledWith([
      "calc-bc",
      "alg2",
      "eng10",
      "phys-c",
    ]);

    // Clearing search and activating "Selected only" narrows to chosen items.
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Selected only" }));
    expect(screen.getByRole("checkbox", { name: "AP Calculus BC" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "AP Biology" })).toBeNull();

    // Removing via the summary pill deselects that item without clearing others.
    fireEvent.click(
      screen.getByRole("button", { name: "Remove AP Calculus BC" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(["alg2", "eng10"]);
  });
});
