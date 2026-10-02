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
          <ProfileEditSection busy={false} saved refreshFailed>
            <input aria-label="Saved section" defaultValue="Committed value" />
          </ProfileEditSection>
          <ProfileEditSection busy={false}>
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
