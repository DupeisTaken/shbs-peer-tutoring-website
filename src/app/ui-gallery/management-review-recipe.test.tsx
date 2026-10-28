/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ManagementReviewRecipe } from "./management-review-recipe";

// The real readers render local evidence; any accidental API mounting must fail.
vi.mock("~/trpc/react", () => ({ api: {} }));
afterEach(cleanup);

function show(locale: string) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? en : zh}
    >
      <ManagementReviewRecipe />
    </NextIntlClientProvider>,
  );
}

it.each(["en", "zh"])(
  "uses production sections and retains note and nested disclosure state (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(locale);
    const note = screen.getByRole("textbox");
    fireEvent.change(note, {
      target: { value: "Retain this review\n保留备注" },
    });
    const changed = screen.getByRole("button", {
      name: `${copy.approvals.review.requested} ${copy.approvals.review.collapse}`,
    });
    fireEvent.click(changed);
    const request = screen.getByRole("button", {
      name: `${copy.approvals.review.reviewDetails} ${copy.approvals.review.collapse}`,
    });
    fireEvent.click(request);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByRole("region", { name: copy.approvals.review.affected }),
    ).toBeTruthy();
    fireEvent.click(request);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Retain this review\n保留备注",
    );
    expect(changed.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("checkbox"));
    expect((request as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(request);
    expect(request.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);
  },
);

it.each(["en", "zh"])(
  "shows one changed attendance child and keeps the unchanged roster expandable (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(locale);
    expect(screen.getAllByText("Student 2").length).toBeGreaterThan(0);
    const unchangedTitle = copy.approvals.review.unchangedRows.replace(
      "{count}",
      "11",
    );
    const unchanged = screen.getByRole("button", {
      name: `${unchangedTitle} ${copy.approvals.review.expand}`,
    });
    expect(unchanged.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(unchanged);
    expect(unchanged.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("Student 12").length).toBeGreaterThan(0);
  },
);

it.each(["en", "zh"])(
  "switches among feature intent, exact text and all 75 audit comparisons without writes (%s)",
  (locale) => {
    const copy = locale === "en" ? en : zh;
    show(locale);
    const selector = screen.getByRole("combobox");
    fireEvent.change(selector, { target: { value: "stage" } });
    expect(
      screen.getByText(copy.approvals.review.featureOutcome.stage),
    ).toBeTruthy();
    expect(
      screen.getByText(copy.approvals.review.featureSource.default),
    ).toBeTruthy();
    fireEvent.change(selector, { target: { value: "clear" } });
    expect(
      screen.getByText(copy.approvals.review.featureOutcome.clear),
    ).toBeTruthy();
    fireEvent.change(selector, { target: { value: "translation" } });
    expect(
      within(
        screen.getByRole("region", { name: copy.approvals.review.requested }),
      ).getByText(
        (_, element) =>
          element?.textContent ===
          "欢迎参加同伴辅导。\n  Keep this indentation.\n第三行保留原文。",
      ),
    ).toBeTruthy();
    fireEvent.change(selector, { target: { value: "audit" } });
    const summary = within(
      screen.getByRole("region", { name: copy.auditEventDetails.summaryTitle }),
    );
    expect(summary.getByText("Study room 75")).toBeTruthy();
    expect(summary.getAllByRole("button")).toHaveLength(75);
    expect(screen.queryByText(copy.approvals.approve)).toBeNull();
  },
);
