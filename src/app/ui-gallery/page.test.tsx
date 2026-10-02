import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("./gallery", () => ({ UIGallery: () => null }));
import UIGalleryPage from "./page";

afterEach(() => vi.unstubAllEnvs());

it("does not expose the gallery in a production build", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => UIGalleryPage()).toThrow("NOT_FOUND");
});

it("allows synthetic examples during development", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(UIGalleryPage()).toBeTruthy();
});
