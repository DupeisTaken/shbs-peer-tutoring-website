/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  SummaryTable,
  TableAction,
  TableActions,
  TableDetails,
} from "./summary-table";
import { RoomGrid } from "../room-grid";
import { Modal } from "./modal";
import en from "../../../../messages/en.json";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("lets a portalled nested submenu own Tab and Escape without closing its parent", () => {
  const closeParent = vi.fn();
  render(
    <Modal
      title="Parent editor"
      onClose={closeParent}
      footer={<button>Close parent</button>}
    >
      <TableDetails title="Nested details">
        <input aria-label="First" />
        <input aria-label="Second" />
      </TableDetails>
    </Modal>,
    { wrapper },
  );
  const trigger = screen.getByRole("button", {
    name: "View details: Nested details",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const nested = screen.getByRole("dialog", { name: "Nested details" });
  const first = within(nested).getByRole("textbox", { name: "First" });
  first.focus();
  expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
  const last = within(nested).getByRole("button", { name: "Close" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent(nested, new Event("cancel", { cancelable: true, bubbles: true }));
  expect(closeParent).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Nested details" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Parent editor" })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
});

it("keeps the summary brief, mounts detail content on demand, and restores the rightmost trigger", () => {
  const loadDetail = vi.fn();
  function Detail() {
    loadDetail();
    return <p>Full profile and private contact details</p>;
  }
  render(
    <SummaryTable label="People">
      <thead>
        <tr>
          <th>Name</th>
          <th className="table-actions-heading">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Alex</td>
          <TableActions>
            <TableDetails title="Alex">
              <Detail />
            </TableDetails>
          </TableActions>
        </tr>
      </tbody>
    </SummaryTable>,
    { wrapper },
  );
  expect(loadDetail).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", { name: "View details: Alex" });
  expect(trigger.closest("td")).toBe(trigger.closest("tr")?.lastElementChild);
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Alex" });
  expect(loadDetail).toHaveBeenCalledTimes(1);
  expect(dialog.parentElement).toBe(document.body);
  expect(
    within(dialog).getByText("Full profile and private contact details"),
  ).toBeTruthy();
  expect(screen.getByRole("table").textContent).not.toContain(
    "private contact",
  );
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("does not submit a parent form when a row action is used", () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const action = vi.fn();
  render(
    <form onSubmit={submit}>
      <TableAction onClick={action}>Edit</TableAction>
      <TableAction disabled onClick={action}>
        Unavailable
      </TableAction>
    </form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
  expect(action).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});

it("retains room comparisons but moves pairing names and block reasons into the last-column submenu", () => {
  render(
    <RoomGrid
      rooms={[
        { id: "open", name: "204" },
        { id: "blocked", name: "205" },
      ]}
      slots={[
        {
          id: "slot",
          label: "Afternoon",
          dayOfWeek: 1,
          startMin: 900,
          endMin: 960,
        },
      ]}
      pairings={[
        {
          id: "pair",
          subject: "Mathematics",
          tutorId: "tutor",
          roomId: "open",
          timeSlotId: "slot",
          tutor: { englishName: "Alex Tutor" },
        },
      ]}
      blocks={[
        {
          id: "block",
          roomId: "blocked",
          dayOfWeek: 1,
          startMin: 890,
          endMin: 970,
          reason: "Room reserved for a longer school assembly",
        },
      ]}
      highlightTutorId="tutor"
    />,
    { wrapper },
  );
  expect(screen.queryByText(/Alex Tutor/)).toBeNull();
  expect(screen.queryByText(/school assembly/)).toBeNull();
  expect(screen.getByText("1 record").className).toContain("badge-green");
  expect(screen.getByText("Unavailable")).toBeTruthy();
  const trigger = screen.getByRole("button", { name: /View schedule:/ });
  expect(trigger.closest("td")).toBe(trigger.closest("tr")?.lastElementChild);
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Mathematics · Alex Tutor/)).toBeTruthy();
  expect(within(dialog).getByText(/school assembly/)).toBeTruthy();
});
