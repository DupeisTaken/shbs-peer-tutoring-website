// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import {
  REGISTRATION_KINDS,
  registrationKindLabel,
} from "~/lib/registration-kind";
import { downloadCardImage } from "~/lib/download-card-image";
import { ShareCard } from "./share-card";

vi.mock("~/lib/download-card-image", () => ({ downloadCardImage: vi.fn() }));
const props = {
  code: "AB2CD3",
  expiresAt: new Date("2099-10-16T00:00:00Z"),
  registerUrl: "https://school.example/register",
  kind: "TUTOR" as const,
};
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(downloadCardImage).mockReset().mockResolvedValue(undefined);
});

function show(locale = "en", readOnly = false, extra = {}) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <ReadOnlyProvider value={readOnly}>
        <ShareCard {...props} {...extra} actions={<button>Dismiss</button>} />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
  );
}

describe("setup card image export", () => {
  it.each(REGISTRATION_KINDS)(
    "exports the %s card without surrounding actions",
    async (kind) => {
      show("en", false, { kind });
      fireEvent.click(screen.getByRole("button", { name: "Export Image" }));
      await waitFor(() => expect(downloadCardImage).toHaveBeenCalledOnce());
      const card = vi.mocked(downloadCardImage).mock.calls[0]![0];
      expect(within(card).getByText(props.code)).toBeDefined();
      expect(
        within(card).getByText(
          en.admin.registrationCodes[registrationKindLabel[kind]],
        ),
      ).toBeDefined();
      expect(card.textContent).toContain(props.registerUrl);
      expect(card.textContent).toContain("Oct 16, 2099");
      expect(within(card).queryByRole("button")).toBeNull();
    },
  );

  it("announces rendering and suppresses duplicate clicks", async () => {
    let resolve!: () => void;
    vi.mocked(downloadCardImage).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    show();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Export Image",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("Exporting…");
    expect(downloadCardImage).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(button.disabled).toBe(false);
  });

  it("shows a localized error and allows retry without losing the card", async () => {
    vi.mocked(downloadCardImage).mockRejectedValueOnce(new Error("blocked"));
    show("zh");
    fireEvent.click(screen.getByRole("button", { name: "导出图片" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      zh.admin.registrationCodes.exportImageError,
    );
    expect(screen.getByText(props.code)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "导出图片" }));
    await waitFor(() => expect(downloadCardImage).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not offer export to read-only viewers", () => {
    show("en", true);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("rejects a code that expired while the card was open", () => {
    show("en", false, { expiresAt: new Date("2000-01-01") });
    fireEvent.click(screen.getByRole("button", { name: "Export Image" }));
    expect(downloadCardImage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
  });
});
