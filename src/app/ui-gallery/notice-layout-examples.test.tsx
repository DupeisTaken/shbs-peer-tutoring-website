/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NoticeLayoutExamples } from "./notice-layout-examples";

afterEach(cleanup);

it.each(["en", "zh"] as const)(
  "exercises long recovery shapes, pending controls and announcements in %s",
  (locale) => {
    const english = locale === "en";
    render(<NoticeLayoutExamples locale={locale} />);
    const group = screen.getByRole("group", {
      name: english ? "Narrow notice examples" : "窄版提示示例",
    });
    const shape = within(group).getByRole("combobox", {
      name: english ? "Notice action" : "提示操作",
    });
    const tone = within(group).getByRole("combobox", {
      name: english ? "Notice tone" : "提示类型",
    });
    const announcement = within(group).getByRole("combobox", {
      name: english ? "Notice announcement" : "提示播报",
    });
    const retryName = english
      ? "Retry example history and corrections"
      : "重新加载示例历史与更正记录";
    const attempts = english ? "Local recovery attempts" : "本地恢复次数";
    for (const value of ["button", "native", "group"]) {
      fireEvent.change(shape, { target: { value } });
      fireEvent.click(within(group).getByRole("button", { name: retryName }));
    }
    expect(within(group).getByText(`${attempts}: 3`)).toBeTruthy();
    fireEvent.click(
      within(group).getByRole("checkbox", {
        name: english ? "Recovery pending" : "正在恢复",
      }),
    );
    for (const button of within(group).getAllByRole("button"))
      expect(button.matches(":disabled")).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: retryName }));
    expect(within(group).getByText(`${attempts}: 3`)).toBeTruthy();
    fireEvent.change(shape, { target: { value: "link" } });
    expect(within(group).getByRole("link").getAttribute("href")).toBe(
      "#notice-layout-example",
    );
    fireEvent.change(shape, { target: { value: "none" } });
    expect(within(group).queryByRole("button")).toBeNull();
    expect(within(group).queryByRole("link")).toBeNull();
    expect(within(group).queryByRole("alert")).toBeNull();
    expect(within(group).queryByRole("status")).toBeNull();
    for (const value of ["info", "warning", "success", "error"]) {
      fireEvent.change(tone, { target: { value } });
      fireEvent.change(announcement, { target: { value: "alert" } });
      expect(within(group).getByRole("alert").textContent).toContain(
        english
          ? "Previously loaded content is still shown."
          : "之前加载的内容仍然显示。",
      );
      fireEvent.change(announcement, { target: { value: "status" } });
      expect(within(group).queryByRole("alert")).toBeNull();
      expect(within(group).getByRole("status")).toBeTruthy();
    }
  },
);
