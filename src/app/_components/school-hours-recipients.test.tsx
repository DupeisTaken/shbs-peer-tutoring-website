/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  SchoolHoursRecipients,
  type SchoolHoursRecipient,
} from "./school-hours-recipients";

afterEach(cleanup);

function setup(
  initial: SchoolHoursRecipient[] = [],
  locale: "en" | "zh" = "en",
) {
  const change = vi.fn();
  const editing = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const outerKeyDown = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <form onSubmit={submit} onKeyDown={outerKeyDown}>
        <SchoolHoursRecipients
          value={value}
          onChange={(next) => {
            change(next);
            setValue(next);
          }}
          onEditingChange={editing}
        />
      </form>
    );
  }
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <Harness />
    </NextIntlClientProvider>,
  );
  return {
    change,
    editing,
    submit,
    outerKeyDown,
    copy: locale === "zh" ? zh.schoolHours : en.schoolHours,
  };
}

function startAdd(copy = en.schoolHours) {
  fireEvent.click(screen.getByRole("button", { name: copy.addRecipient }));
  return within(screen.getByRole("group", { name: copy.addRecipient }));
}

it.each(["en", "zh"] as const)(
  "adds a normalized email and trimmed label to the local list (%s)",
  (locale) => {
    const { change, editing, submit, copy } = setup([], locale);
    expect(screen.getByText(copy.noRecipients)).toBeTruthy();
    const editor = startAdd(copy);
    const email = editor.getByLabelText<HTMLInputElement>(copy.recipientEmail);
    expect(document.activeElement).toBe(email);
    fireEvent.change(email, { target: { value: " Office@Example.test " } });
    fireEvent.change(editor.getByLabelText(copy.recipientLabel), {
      target: { value: " School office " },
    });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(editor.getByRole("button", { name: copy.addRecipient }));
    expect(change).toHaveBeenCalledExactlyOnceWith([
      { email: "office@example.test", label: "School office" },
    ]);
    expect(
      screen.getByRole("list", { name: copy.recipients }).textContent,
    ).toContain("School office");
    expect(editing.mock.calls).toEqual([[true], [false]]);
    expect(submit).not.toHaveBeenCalled();
  },
);

it("edits an existing recipient, clears its tag, and removes only the selected row", () => {
  const { change } = setup([
    { email: "office@example.test", label: "School office" },
    { email: "principal@example.test", label: "Principal" },
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.schoolHours.editRecipientEmail.replace(
        "{email}",
        "office@example.test",
      ),
    }),
  );
  const editor = within(
    screen.getByRole("group", { name: en.schoolHours.editRecipient }),
  );
  expect(
    editor.getByLabelText<HTMLInputElement>(en.schoolHours.recipientLabel)
      .value,
  ).toBe("School office");
  fireEvent.change(editor.getByLabelText(en.schoolHours.recipientEmail), {
    target: { value: "new-office@example.test" },
  });
  fireEvent.change(editor.getByLabelText(en.schoolHours.recipientLabel), {
    target: { value: "" },
  });
  fireEvent.click(
    editor.getByRole("button", { name: en.schoolHours.updateRecipient }),
  );
  expect(change).toHaveBeenLastCalledWith([
    { email: "new-office@example.test", label: "" },
    { email: "principal@example.test", label: "Principal" },
  ]);
  expect(screen.queryByText("School office")).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", {
      name: en.schoolHours.editRecipientEmail.replace(
        "{email}",
        "new-office@example.test",
      ),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.schoolHours.removeRecipientEmail.replace(
        "{email}",
        "new-office@example.test",
      ),
    }),
  );
  expect(change).toHaveBeenLastCalledWith([
    { email: "principal@example.test", label: "Principal" },
  ]);
  expect(screen.queryByText("new-office@example.test")).toBeNull();
});

it.each(["invalid", "duplicate"] as const)(
  "keeps the editor and accessible validation for an %s email",
  (kind) => {
    const { change } = setup([
      { email: "office@example.test", label: "School office" },
    ]);
    const editor = startAdd();
    const email = editor.getByLabelText<HTMLInputElement>(
      en.schoolHours.recipientEmail,
    );
    fireEvent.change(email, {
      target: {
        value: kind === "invalid" ? "not-an-email" : " OFFICE@EXAMPLE.TEST ",
      },
    });
    fireEvent.click(
      editor.getByRole("button", { name: en.schoolHours.addRecipient }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      en.schoolHours[
        kind === "invalid" ? "recipientInvalid" : "recipientDuplicate"
      ],
    );
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(email);
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: "different@example.test" } });
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it("allows retaining the same mailbox when editing only its label", () => {
  const { change } = setup([
    { email: "office@example.test", label: "School office" },
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.schoolHours.editRecipientEmail.replace(
        "{email}",
        "office@example.test",
      ),
    }),
  );
  fireEvent.change(screen.getByLabelText(en.schoolHours.recipientLabel), {
    target: { value: "Admissions" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolHours.updateRecipient }),
  );
  expect(change).toHaveBeenCalledExactlyOnceWith([
    { email: "office@example.test", label: "Admissions" },
  ]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("accepts with Enter without submitting the containing schedule form", () => {
  const { change, submit } = setup();
  const editor = startAdd();
  const email = editor.getByLabelText(en.schoolHours.recipientEmail);
  fireEvent.change(email, { target: { value: "office@example.test" } });
  expect(fireEvent.keyDown(email, { key: "Enter", code: "Enter" })).toBe(false);
  expect(change).toHaveBeenCalledExactlyOnceWith([
    { email: "office@example.test", label: "" },
  ]);
  expect(submit).not.toHaveBeenCalled();
});

it("lets Enter activate Cancel without adding the unfinished recipient", () => {
  const { change, submit } = setup();
  const editor = startAdd();
  fireEvent.change(editor.getByLabelText(en.schoolHours.recipientEmail), {
    target: { value: "unfinished@example.test" },
  });
  const cancel = editor.getByRole("button", {
    name: en.schoolHours.cancelRecipient,
  });
  cancel.focus();
  // Native buttons own Enter activation; the editor must not intercept it as Add.
  expect(fireEvent.keyDown(cancel, { key: "Enter", code: "Enter" })).toBe(true);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(
    screen.queryByRole("group", { name: en.schoolHours.addRecipient }),
  ).toBeNull();
  expect(change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: en.schoolHours.addRecipient }),
  );
});

it("does not accept Enter while composing a recipient label", () => {
  const { change, submit } = setup();
  const editor = startAdd();
  fireEvent.change(editor.getByLabelText(en.schoolHours.recipientEmail), {
    target: { value: "office@example.test" },
  });
  const label = editor.getByLabelText(en.schoolHours.recipientLabel);
  fireEvent.change(label, { target: { value: "学校办公室" } });
  expect(
    fireEvent.keyDown(label, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    }),
  ).toBe(true);
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole("group", { name: en.schoolHours.addRecipient }),
  ).toBeTruthy();
  expect(
    fireEvent.keyDown(label, {
      key: "Enter",
      code: "Enter",
      isComposing: false,
    }),
  ).toBe(false);
  expect(change).toHaveBeenCalledExactlyOnceWith([
    { email: "office@example.test", label: "学校办公室" },
  ]);
  expect(submit).not.toHaveBeenCalled();
});

it.each(["Escape", "Cancel"])(
  "discards unfinished entries with %s without changing the local list",
  (action) => {
    const { change, editing, outerKeyDown } = setup([
      { email: "office@example.test", label: "School office" },
    ]);
    const editor = startAdd();
    const email = editor.getByLabelText(en.schoolHours.recipientEmail);
    fireEvent.change(email, { target: { value: "unfinished@example.test" } });
    if (action === "Escape") {
      expect(fireEvent.keyDown(email, { key: "Escape" })).toBe(false);
      expect(outerKeyDown).not.toHaveBeenCalled();
    } else
      fireEvent.click(
        editor.getByRole("button", { name: en.schoolHours.cancelRecipient }),
      );
    expect(
      screen.queryByRole("group", { name: en.schoolHours.addRecipient }),
    ).toBeNull();
    expect(screen.getByText("office@example.test")).toBeTruthy();
    expect(screen.queryByText("unfinished@example.test")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(editing.mock.calls).toEqual([[true], [false]]);
  },
);

it("stops additions at 100 recipients and enables adding after a removal", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    email: `recipient-${index}@example.test`,
    label: "",
  }));
  const { change } = setup(rows);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolHours.addRecipient,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.schoolHours.removeRecipientEmail.replace(
        "{email}",
        rows[0]!.email,
      ),
    }),
  );
  expect(change).toHaveBeenCalledExactlyOnceWith(rows.slice(1));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolHours.addRecipient,
    }).disabled,
  ).toBe(false);
});
