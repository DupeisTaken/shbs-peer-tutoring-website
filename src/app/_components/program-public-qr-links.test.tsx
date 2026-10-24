/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import de from "../../../messages/de.json";
import el from "../../../messages/el.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import zh from "../../../messages/zh.json";
import { ProgramPublicQrLinks } from "./program-public-qr-links";

const catalogs = { en, zh, de, el, es, fr, ja, ko };
const entries = [
  ["tutor", "/tutor"],
  ["tutee", "/tutee"],
  ["crew", "/crew"],
  ["site", "/"],
] as const;

afterEach(cleanup);

it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
  "offers four distinct named public PNG downloads in %s",
  (locale) => {
    const messages = catalogs[locale];
    const copy = messages.admin.program.publicQr;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ProgramPublicQrLinks />
      </NextIntlClientProvider>,
    );
    const region = screen.getByRole("region", { name: copy.heading });
    expect(
      within(region).getByRole("heading", { name: copy.heading, level: 2 }),
    ).toBeTruthy();
    expect(within(region).getByText(copy.help)).toBeTruthy();
    const links = within(region).getAllByRole<HTMLAnchorElement>("link");
    expect(links).toHaveLength(4);

    const imageLocale = locale === "zh" ? "zh" : "en";
    for (const [destination, path] of entries) {
      const link = within(region).getByRole<HTMLAnchorElement>("link", {
        name: copy.downloadLabel.replace("{destination}", copy[destination]),
      });
      const row = link.closest("li")!;
      expect(within(row).getByText(copy[destination])).toBeTruthy();
      expect(within(row).getByText(path)).toBeTruthy();
      expect(link.textContent).toBe(copy.download);
      expect(link.getAttribute("href")).toBe(
        `/api/public-qr?destination=${destination}&locale=${imageLocale}&download=1`,
      );
      expect(link.download).toBe(`shbs-${destination}-qr-${imageLocale}.png`);
      // Downloads retain native focus and are not tied to a settings form.
      expect(link.closest("form, fieldset")).toBeNull();
      expect(link.tabIndex).toBe(0);
      link.focus();
      expect(document.activeElement).toBe(link);
    }
    expect(new Set(links.map((link) => link.download)).size).toBe(4);
  },
);

it("updates image labels and filenames when the current interface language changes", () => {
  const page = (locale: "en" | "zh") => (
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
      <ProgramPublicQrLinks />
    </NextIntlClientProvider>
  );
  const view = render(page("en"));
  expect(screen.getAllByRole<HTMLAnchorElement>("link")[0]?.download).toBe(
    "shbs-tutor-qr-en.png",
  );
  view.rerender(page("zh"));
  expect(screen.getAllByRole<HTMLAnchorElement>("link")[0]?.download).toBe(
    "shbs-tutor-qr-zh.png",
  );
  expect(
    screen.getByRole("region", { name: zh.admin.program.publicQr.heading }),
  ).toBeTruthy();
});
