// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { downloadCardImage } from "./download-card-image";

const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock("html-to-image", () => ({ toCanvas }));

describe("account card PNG download", () => {
  let card: HTMLDivElement;
  let rendered: HTMLCanvasElement;
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  let output: { width: number; height: number } | undefined;
  let encode: MockInstance<HTMLCanvasElement["toBlob"]>;
  let getContext: MockInstance<HTMLCanvasElement["getContext"]>;
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
    rendered = document.createElement("canvas");
    rendered.width = 768;
    rendered.height = 484;
    output = undefined;
    toCanvas.mockResolvedValue(rendered);
    getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    encode = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, callback, type) {
        output = { width: this.width, height: this.height };
        expect(type).toBe("image/png");
        callback(new Blob(["png"], { type: "image/png" }));
      });
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
    expect(toCanvas).toHaveBeenCalledWith(
      card,
      expect.objectContaining({ pixelRatio: 2, backgroundColor: "#ffffff" }),
    );
    expect(output?.width).toBe(816);
    expect(output?.height).toBe(532);
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 816, 532);
    expect(context.drawImage).toHaveBeenCalledWith(rendered, 24, 24);
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
    expect(toCanvas).not.toHaveBeenCalled();
    resolve();
    await result;
    expect(toCanvas).toHaveBeenCalledOnce();
  });

  it.each(["null", "reject"])(
    "reports %s renderer failures without downloading",
    async (failure) => {
      if (failure === "null")
        encode.mockImplementation((callback) => callback(null));
      else toCanvas.mockRejectedValue(new Error("canvas failed"));
      await expect(downloadCardImage(card)).rejects.toThrow();
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("cancels a download when its card is dismissed during rendering", async () => {
    toCanvas.mockImplementation(() => {
      card.remove();
      return rendered;
    });
    await downloadCardImage(card);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("reports unavailable canvas contexts without downloading", async () => {
    getContext.mockReturnValue(null);
    await expect(downloadCardImage(card)).rejects.toThrow(
      "Unable to create image canvas",
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("cancels when the card is dismissed during PNG encoding", async () => {
    encode.mockImplementation((callback) => {
      card.remove();
      callback(new Blob(["png"]));
    });
    await downloadCardImage(card);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("does not render a card that has already been removed", async () => {
    card.remove();
    await downloadCardImage(card);
    expect(toCanvas).not.toHaveBeenCalled();
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
