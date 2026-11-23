/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { PairingCardRecipe } from "./pairing-card-recipe";

afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

it.each(["en", "zh"] as const)(
  "renders unified 50/50 cards, header link-before-button order, compact select and dynamic combine selection in %s",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    const isZh = locale === "zh";
    render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <PairingCardRecipe locale={locale} />
      </NextIntlClientProvider>,
    );

    // At rest: no checkboxes shown; combined card places text link ahead of boxed Split button.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const splitButton = screen.getByRole("button", {
      name: isZh ? "拆分此分组" : "Split this group",
    });
    const combinedHeader = splitButton.parentElement!;
    const sessionsLink = within(combinedHeader).getByRole("link", {
      name: isZh ? "查看课次" : "View sessions",
    });
    expect(
      sessionsLink.compareDocumentPosition(splitButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Compact content-sized select uses field-auto-bounded and updates displayed schedule.
    const slotSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /Mathematics \+ Physics/,
    });
    expect(slotSelect.className).toContain("field-auto-bounded");
    fireEvent.change(slotSelect, { target: { value: "wed-1600" } });
    expect(slotSelect.value).toBe("wed-1600");

    // Enter combine mode: checkboxes appear; selecting combined Math+Physics greys out Chemistry (Sam Wu).
    fireEvent.click(
      screen.getByRole("button", { name: isZh ? "合并分组" : "Combine groups" }),
    );
    const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    expect(checkboxes).toHaveLength(4);

    const combinedCheck = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Mathematics \+ Physics \(Alex Chen\)/,
    });
    const mathMinaCheck = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Mathematics \(Mina Li\)/,
    });
    const physMinaCheck = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Physics \(Mina Li\)/,
    });
    const chemSamCheck = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Chemistry \(Sam Wu\)/,
    });

    fireEvent.click(combinedCheck);
    expect(combinedCheck.checked).toBe(true);
    expect(chemSamCheck.disabled).toBe(true);
    expect(
      chemSamCheck.closest("[data-combine-unavailable]")?.className,
    ).toContain("opacity-55");

    // Selecting Mathematics (Mina Li) auto-selects companion Physics (Mina Li).
    fireEvent.click(mathMinaCheck);
    expect(mathMinaCheck.checked).toBe(true);
    expect(physMinaCheck.checked).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Physics (Mina Li)",
    );

    // Reviewing combine closes combine mode and updates local synthetic status.
    fireEvent.click(
      screen.getByRole("button", {
        name: isZh ? "审核合并（3）" : "Review combine (3)",
      }),
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain(
      "Mathematics + Physics (Alex Chen)",
    );
  },
);
