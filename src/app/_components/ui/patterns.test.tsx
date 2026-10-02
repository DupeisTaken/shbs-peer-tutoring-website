/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Button, ChoiceButton, Switch } from "./button";
import { FormSection, ScrollTable, StatePanel } from "./patterns";
import { SectionTabs } from "./section-tabs";

afterEach(cleanup);

it("keeps a completed section disabled without announcing pending work", () => {
  const view = render(
    <FormSection title="Completed profile" disabled>
      <input aria-label="Saved name" />
      <Button>Save</Button>
    </FormSection>,
  );
  const group = screen.getByRole("group", { name: "Completed profile" });
  expect(group.getAttribute("aria-busy")).toBe("false");
  expect(screen.getByLabelText("Saved name").matches(":disabled")).toBe(true);
  expect(screen.getByRole("button").matches(":disabled")).toBe(true);
  view.rerender(
    <FormSection title="Completed profile" disabled busy>
      <input aria-label="Saved name" />
      <Button>Save</Button>
    </FormSection>,
  );
  expect(group.getAttribute("aria-busy")).toBe("true");
});

it("keeps button actions from submitting surrounding forms unless explicitly requested", () => {
  const submit = vi.fn();
  const act = vi.fn();
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Button onClick={act}>Preview</Button>
      <Button type="submit">Save profile</Button>
    </form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(act).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(submit).toHaveBeenCalledOnce();
});

it("exposes persistent choice state and allows a selection to be reversed", () => {
  function Choice() {
    const [selected, setSelected] = useState(false);
    return (
      <ChoiceButton selected={selected} onClick={() => setSelected(!selected)}>
        Tutor availability
      </ChoiceButton>
    );
  }
  render(<Choice />);
  const choice = screen.getByRole("button", {
    name: "Tutor availability",
    pressed: false,
  });
  fireEvent.click(choice);
  expect(
    screen.getByRole("button", { name: "Tutor availability", pressed: true }),
  ).toBe(choice);
  fireEvent.click(choice);
  expect(choice.getAttribute("aria-pressed")).toBe("false");
});

it("names switches, communicates their current state, and blocks disabled changes", () => {
  const onChange = vi.fn();
  const view = render(
    <Switch
      label="Accept meeting requests"
      checked={false}
      onChange={onChange}
    />,
  );
  const toggle = screen.getByRole("switch", {
    name: "Accept meeting requests",
    checked: false,
  });
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenLastCalledWith(true);
  view.rerender(
    <Switch label="Accept meeting requests" checked onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole("switch", { checked: true }));
  expect(onChange).toHaveBeenLastCalledWith(false);
  view.rerender(
    <Switch
      label="Accept meeting requests"
      checked
      disabled
      onChange={onChange}
    />,
  );
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledTimes(2);
});

it("names the editable scope and disables its fields and actions for the complete pending interval", () => {
  const content = (busy: boolean) => (
    <>
      <FormSection
        title="Profile"
        description="Names shown to other members."
        busy={busy}
        actions={
          <>
            <Button>Save profile</Button>
            <Button>Cancel profile edits</Button>
          </>
        }
      >
        <label>
          English name
          <input defaultValue="Sammy" />
        </label>
        <label>
          Chinese name
          <input defaultValue="小明" />
        </label>
      </FormSection>
      <Button>Open help</Button>
    </>
  );
  const view = render(content(true));
  const group = screen.getByRole("group", { name: "Profile" });
  expect(group.getAttribute("aria-busy")).toBe("true");
  for (const control of [
    ...within(group).getAllByRole("textbox"),
    ...within(group).getAllByRole("button"),
  ]) {
    // :disabled includes native fieldset inheritance, which a disabled property
    // assertion on each child alone would incorrectly overlook.
    expect(control.matches(":disabled")).toBe(true);
  }
  expect(
    screen.getByRole("button", { name: "Open help" }).matches(":disabled"),
  ).toBe(false);
  view.rerender(content(false));
  expect(group.getAttribute("aria-busy")).toBe("false");
  expect(
    screen.getByRole("textbox", { name: "English name" }).matches(":disabled"),
  ).toBe(false);
  expect(
    screen.getByRole("button", { name: "Save profile" }).matches(":disabled"),
  ).toBe(false);
});

it("distinguishes loading, denial and retryable failure for assistive technology", () => {
  const retry = vi.fn();
  const view = render(<StatePanel kind="loading" title="Loading editor" />);
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  view.rerender(
    <StatePanel kind="denied" title="Editor access required">
      Ask an administrator for access.
    </StatePanel>,
  );
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
  expect(screen.getByText("Ask an administrator for access.")).toBeTruthy();
  view.rerender(
    <StatePanel
      kind="error"
      title="Could not load editor"
      action={<Button onClick={retry}>Try again</Button>}
    />,
  );
  expect(screen.getByRole("alert").getAttribute("aria-busy")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("keeps comparison tables in a named keyboard reachable scroll region", () => {
  render(
    <ScrollTable label="Weekly availability" hint="Scroll to see every period.">
      <table>
        <caption>Availability by period</caption>
        <tbody>
          <tr>
            <th>Monday</th>
            <td>Available</td>
          </tr>
        </tbody>
      </table>
    </ScrollTable>,
  );
  const region = screen.getByRole("region", { name: "Weekly availability" });
  expect(region.tabIndex).toBe(0);
  expect(
    within(region).getByRole("table", { name: "Availability by period" }),
  ).toBeTruthy();
  expect(screen.getByText("Scroll to see every period.")).toBeTruthy();
});

it("moves tab focus with arrows/Home/End while leaving the active editor and draft unchanged", () => {
  const change = vi.fn();
  render(
    <SectionTabs
      label="Landing sections"
      items={[
        { value: "overview", label: "Overview" },
        { value: "details", label: "Details" },
        { value: "translations", label: "Translations" },
      ]}
      value="overview"
      onChange={change}
    >
      <input aria-label="Overview draft" defaultValue="Unsaved text" />
    </SectionTabs>,
  );
  const first = screen.getByRole("tab", { name: "Overview" });
  const second = screen.getByRole("tab", { name: "Details" });
  const last = screen.getByRole("tab", { name: "Translations" });
  expect(
    screen.getByRole("tablist", { name: "Landing sections" }),
  ).toBeTruthy();
  act(() => first.focus());
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "ArrowRight" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(second);
  expect(second.tabIndex).toBe(0);
  expect(first.tabIndex).toBe(-1);
  expect(first.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(second, { key: "End" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Home" });
  expect(document.activeElement).toBe(first);
  expect(change).not.toHaveBeenCalled();
  expect(first.getAttribute("aria-selected")).toBe("true");
  expect(first.tabIndex).toBe(0);
  expect(second.tabIndex).toBe(-1);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Overview draft" })
      .value,
  ).toBe("Unsaved text");
  fireEvent.keyDown(first, { key: "ArrowRight" });
  act(() => screen.getByRole("tabpanel").focus());
  expect(first.tabIndex).toBe(0);
  expect(second.tabIndex).toBe(-1);
  expect(change).not.toHaveBeenCalled();
});

it("updates the panel name and tab stop only after a tab is activated", () => {
  function Tabs() {
    const [value, setValue] = useState("overview");
    return (
      <SectionTabs
        label="Landing sections"
        items={[
          { value: "overview", label: "Overview" },
          { value: "details", label: "Details" },
        ]}
        value={value}
        onChange={setValue}
      >
        {value === "overview" ? "Overview editor" : "Details editor"}
      </SectionTabs>
    );
  }
  render(<Tabs />);
  const details = screen.getByRole("tab", { name: "Details" });
  // Native button activation (pointer, Enter or Space) invokes onClick. jsdom
  // cannot synthesize the browser's key-to-click default action itself.
  fireEvent.click(details);
  const panel = screen.getByRole("tabpanel", { name: "Details" });
  expect(details.getAttribute("aria-selected")).toBe("true");
  expect(details.tabIndex).toBe(0);
  expect(panel.id).toBe(details.getAttribute("aria-controls"));
  expect(panel.textContent).toBe("Details editor");
  expect(screen.getByRole("tab", { name: "Overview" }).tabIndex).toBe(-1);
});
