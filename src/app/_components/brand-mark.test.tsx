// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandMark } from "./brand-mark";

afterEach(cleanup);

describe("BrandMark", () => {
  it("renders the official PT logo from /icon.png as a decorative mark", () => {
    const { container } = render(<BrandMark />);
    const wrapper = container.querySelector<HTMLElement>("[data-brand-mark]");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper?.className).toContain("h-7 w-7");

    const image = wrapper?.querySelector<HTMLImageElement>("img");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("/icon.png");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("supports custom sizing via className", () => {
    const { container } = render(<BrandMark className="h-9 w-9" />);
    const wrapper = container.querySelector<HTMLElement>("[data-brand-mark]");
    expect(wrapper?.className).toContain("h-9 w-9");
  });
});
