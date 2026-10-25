// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import de from "../../../../../messages/de.json";
import el from "../../../../../messages/el.json";
import es from "../../../../../messages/es.json";
import fr from "../../../../../messages/fr.json";
import ja from "../../../../../messages/ja.json";
import ko from "../../../../../messages/ko.json";
import { TutorStatus } from "../../../../../generated/prisma";
import { RecipientPicker } from "./recipient-picker";
import { defaultAnnouncementAudience } from "~/lib/announcement-recipients";

const candidates = [
  {
    id: "a",
    name: "Amy",
    gradeLevel: 12,
    status: "ACTIVE",
    subjects: ["Biology"],
    activeTutees: 0,
  },
  {
    id: "b",
    name: "Bo",
    gradeLevel: 11,
    status: "ACTIVE",
    subjects: ["Math"],
    activeTutees: 2,
  },
];
function Harness() {
  const [audience, setAudience] = useState(defaultAnnouncementAudience);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <RecipientPicker
        candidates={candidates}
        audience={audience}
        onChange={setAudience}
        loading={false}
      />
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);
describe("announcement recipient interaction", () => {
  it.each(Object.entries({ en, zh, de, el, es, fr, ja, ko }))(
    "renders a translated filter for every persisted status in %s",
    (locale, messages) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <RecipientPicker
            candidates={candidates}
            audience={{ ...defaultAnnouncementAudience(), mode: "filtered" }}
            onChange={() => undefined}
            loading={false}
          />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("button"));
      for (const status of Object.values(TutorStatus))
        expect(
          screen.getByRole("checkbox", { name: messages.tutor.status[status] }),
        ).toBeTruthy();
      expect(document.body.textContent).not.toContain("recipients.status.");
    },
  );
  it("opens a filtered preview and applies individual overrides", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recipients · 2 recipients" }),
    );
    fireEvent.change(screen.getByLabelText("Choose recipients"), {
      target: { value: "filtered" },
    });
    fireEvent.click(screen.getByLabelText("G12"));
    expect(screen.getByRole("status").textContent).toBe("1 recipient");
    fireEvent.change(screen.getByLabelText("Recipient selection for Bo"), {
      target: { value: "include" },
    });
    expect(screen.getByRole("status").textContent).toBe("2 recipients");
    fireEvent.change(screen.getByLabelText("Recipient selection for Amy"), {
      target: { value: "exclude" },
    });
    expect(screen.getByRole("status").textContent).toBe("1 recipient");
    fireEvent.change(screen.getByLabelText("Find a tutor"), {
      target: { value: "Amy" },
    });
    expect(screen.getByRole("status").textContent).toBe("1 recipient");
    expect(screen.queryByLabelText("Recipient selection for Bo")).toBeNull();
  });
  it("specific selection starts empty and can close without discarding choices", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recipients · 2 recipients" }),
    );
    fireEvent.change(screen.getByLabelText("Choose recipients"), {
      target: { value: "specific" },
    });
    expect(screen.getByRole("status").textContent).toBe("0 recipients");
    expect(
      screen.getByText(
        "No recipients selected. Choose at least one tutor to publish.",
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Recipient selection for Amy"), {
      target: { value: "include" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen
        .getByRole("button", { name: "Recipients · 1 recipient" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
