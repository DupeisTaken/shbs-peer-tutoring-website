/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { PatrolCorrections } from "./patrol-corrections";

const { mutate, row } = vi.hoisted(() => ({
  mutate: vi.fn(),
  row: {
    id: "synthetic-patrol",
    createdAt: new Date("2026-11-01T06:30:00Z"),
    updatedAt: new Date("2026-11-01T06:30:00Z"),
    hours: 0.5,
    note: null,
    crewUser: { name: "Synthetic crew" },
    observations: [
      {
        id: "observation",
        roomId: "room",
        room: { name: "Synthetic room" },
        headcount: "ONE",
        observedAt: new Date("2026-11-01T06:30:00Z"),
      },
    ],
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    admin: {
      rooms: {
        useQuery: () => ({ data: [{ id: "room", name: "Synthetic room" }] }),
      },
    },
    corrections: {
      patrols: { useQuery: () => ({ data: [row] }) },
      correctPatrol: { useMutation: () => ({ mutate, isPending: false }) },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("labels a stored repeated-hour instant correctly and updates the offset when editing its date", () => {
  const { container } = render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="America/New_York"
    >
      <PatrolCorrections />
    </NextIntlClientProvider>,
  );
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const input = screen.getByLabelText<HTMLInputElement>(/EST \(GMT-05:00\)/);
  expect(input.value).toBe("2026-11-01T01:30");
  fireEvent.submit(container.querySelector("form")!);
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      observations: [
        expect.objectContaining({
          observedAt: new Date("2026-11-01T06:30:00Z"),
        }),
      ],
    }),
  );
  fireEvent.change(input, { target: { value: "2026-07-15T09:00" } });
  expect(screen.getByLabelText(/EDT \(GMT-04:00\)/)).toBe(input);
  fireEvent.submit(container.querySelector("form")!);
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      observations: [
        expect.objectContaining({
          observedAt: new Date("2026-07-15T13:00:00Z"),
        }),
      ],
    }),
  );
});
