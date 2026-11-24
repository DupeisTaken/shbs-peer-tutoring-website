// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { BrandMark } from "./brand-mark";

afterEach(cleanup);

it("renders the repository-owned official PT logo as a decorative brand mark", () => {
  const { container } = render(<BrandMark />);
  const wrapper = container.querySelector<HTMLElement>("[data-brand-mark]");
  expect(wrapper).toBeTruthy();
  expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
  const img = wrapper?.querySelector<HTMLImageElement>("img");
  expect(img).toBeTruthy();
  expect(img?.getAttribute("src")).toBe("/icon.png");
  expect(img?.getAttribute("alt")).toBe("");
});
