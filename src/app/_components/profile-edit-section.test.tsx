/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProfileDialog } from "./profile-dialog";
import { ProfileEditSection } from "./profile-edit-section";

afterEach(cleanup);
it.each(["en", "zh"] as const)(
  "announces %s saved/refresh-failed state without locking a sibling draft or idle Close",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const close = vi.fn();
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <ProfileDialog title="Independent sections" onClose={close}>
          <ProfileEditSection
            title="Saved profile"
            actions={null}
            busy={false}
            saved
            refreshFailed
          >
            <input aria-label="Saved section" defaultValue="Committed value" />
          </ProfileEditSection>
          <ProfileEditSection title="Other profile" actions={null} busy={false}>
            <input aria-label="Other section" defaultValue="Retained draft" />
          </ProfileEditSection>
        </ProfileDialog>
      </NextIntlClientProvider>,
    );
    const saved = screen.getByLabelText<HTMLInputElement>("Saved section");
    const draft = screen.getByLabelText<HTMLInputElement>("Other section");
    expect(saved.matches(":disabled")).toBe(true);
    expect(saved.closest("fieldset")!.getAttribute("aria-busy")).toBe("false");
    expect(draft.matches(":disabled")).toBe(false);
    expect(draft.value).toBe("Retained draft");
    expect(screen.getByRole("status").textContent).toBe(
      messages.accountProfile.sectionSaved,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      messages.accountProfile.sectionRefreshFailed,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: messages.accountProfile.close }),
    );
    expect(close).toHaveBeenCalledOnce();
  },
);

it("keeps saved feedback while an automatically refreshed section is editable", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileEditSection
        title="Profile"
        actions={null}
        busy={false}
        saved
        readOnly={false}
      >
        <input aria-label="Fresh draft" defaultValue="Fresh" />
      </ProfileEditSection>
    </NextIntlClientProvider>,
  );
  expect(screen.getByLabelText("Fresh draft").matches(":disabled")).toBe(false);
  expect(screen.getByRole("status").textContent).toBe(
    en.accountProfile.sectionSaved,
  );
  expect(
    screen.queryByRole("button", { name: en.accountProfile.retryRefresh }),
  ).toBeNull();
});
it("exposes read recovery only for a committed refresh failure", () => {
  const retry = vi.fn();
  const content = (failed: boolean) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileEditSection
        title="Profile"
        actions={null}
        busy={false}
        saved
        refreshFailed={failed}
        onRefresh={retry}
      >
        <input aria-label="Draft" />
      </ProfileEditSection>
    </NextIntlClientProvider>
  );
  const view = render(content(false));
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(content(true));
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.retryRefresh }),
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Draft").matches(":disabled")).toBe(true);
});
