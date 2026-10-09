// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCardImage } from "./download-card-image";

const { toBlob } = vi.hoisted(() => ({ toBlob: vi.fn() }));
vi.mock("html-to-image", () => ({ toBlob }));

describe("account card PNG download", () => {
  let card: HTMLDivElement;
  const createObjectURL = vi.fn(() => "blob:card");
  const revokeObjectURL = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    card = document.createElement("div");
    document.body.append(card);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    toBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads only the card at double resolution and releases temporary resources", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("account-setup.png");
        expect(this.href).toBe("blob:card");
        expect(this.isConnected).toBe(true);
      });
    await downloadCardImage(card);
    expect(toBlob).toHaveBeenCalledWith(
      card,
      expect.objectContaining({ pixelRatio: 2, backgroundColor: "#ffffff" }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:card");
  });

  it("waits for fonts before rendering", async () => {
    let resolve!: () => void;
    Object.defineProperty(document, "fonts", {
      value: {
        ready: new Promise<void>((r) => {
          resolve = r;
        }),
      },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const result = downloadCardImage(card);
    await vi.advanceTimersByTimeAsync(0);
    expect(toBlob).not.toHaveBeenCalled();
    resolve();
    await result;
    expect(toBlob).toHaveBeenCalledOnce();
  });

  it.each(["null", "reject"])(
    "reports %s renderer failures without downloading",
    async (failure) => {
      if (failure === "null") toBlob.mockResolvedValue(null);
      else toBlob.mockRejectedValue(new Error("canvas failed"));
      await expect(downloadCardImage(card)).rejects.toThrow();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("cancels a download when its card is dismissed during rendering", async () => {
    toBlob.mockImplementation(() => {
      card.remove();
      return new Blob(["png"]);
    });
    await downloadCardImage(card);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("does not render a card that has already been removed", async () => {
    card.remove();
    await downloadCardImage(card);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("cleans up even when starting the download fails", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("download blocked");
    });
    await expect(downloadCardImage(card)).rejects.toThrow("download blocked");
    expect(document.querySelector("a")).toBeNull();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:card");
  });
});
