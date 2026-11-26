// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { HelpArticle, HelpAudience, HelpLocale } from "~/lib/help/types";
import { HelpCatalogue } from "./catalogue";
import { toHelpCatalogueEntry } from "./page";

const text = (en: string, zh = en) => ({ en, zh });
function article(
  slug: string,
  audience: HelpAudience,
  title: string,
): HelpArticle {
  return {
    slug,
    audience,
    title: text(title),
    summary: text("A short task summary"),
    route: "/signin",
    prerequisites: [text("Have access to your mailbox")],
    steps: [
      {
        title: text("Review the request"),
        body: text(
          audience === "tutor"
            ? "Confirm the delivery clock before proceeding"
            : "Complete the visible fields",
        ),
        focus: text("Named review controls"),
      },
    ],
    expected: text(
      audience === "tutor" ? "A review receipt is saved" : "You can continue",
    ),
    explanation: [text("Saved evidence remains unchanged")],
    troubleshooting: [
      {
        problem: text("The screen has not updated"),
        solution: text("Use read-only refresh"),
      },
    ],
    covers: ["confirmation workflow"],
    sources: ["synthetic-test.ts"],
  };
}
const articles = [
  article("join", "public", "Join the program"),
  article("password", "account", "Recover a password"),
  article("attendance", "tutor", "Record a session"),
];
const audienceTitles = {
  public: text("Get started", "开始使用"),
  account: text("Your account", "我的账号"),
  tutor: text("Tutor workspace", "辅导伙伴工作台"),
};
const projectArticles = (items: HelpArticle[], locale: HelpLocale) =>
  items.map((item) => toHelpCatalogueEntry(item, locale));
const projectTitles = (
  titles: Partial<Record<HelpAudience, { en: string; zh: string }>>,
  locale: HelpLocale,
) =>
  Object.fromEntries(
    Object.entries(titles).flatMap(([key, value]) =>
      value ? [[key, value[locale]]] : [],
    ),
  ) as Partial<Record<HelpAudience, string>>;

afterEach(cleanup);

it("searches directions, expected results and troubleshooting, including normalized multiword text", () => {
  render(
    <HelpCatalogue
      articles={projectArticles(articles, "en")}
      audienceTitles={projectTitles(audienceTitles, "en")}
      locale="en"
    />,
  );
  const search = screen.getByRole("searchbox", { name: "Search guides" });
  fireEvent.change(search, { target: { value: "ＤＥＬＩＶＥＲＹ clock" } });
  expect(screen.getByRole("link", { name: "Record a session" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Recover a password" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("1 of 3 guides found");
  fireEvent.change(search, { target: { value: "review receipt" } });
  expect(screen.getByRole("status").textContent).toBe("1 of 3 guides found");
  fireEvent.change(search, { target: { value: "read-only refresh" } });
  expect(screen.getByRole("status").textContent).toBe("3 of 3 guides found");
});

it("combines visible audience shortcuts with task filters and resets an empty result", () => {
  render(
    <HelpCatalogue
      articles={projectArticles(articles, "en")}
      audienceTitles={projectTitles(audienceTitles, "en")}
      locale="en"
    />,
  );
  const audiences = screen.getByRole("group", { name: "Guide audience" });
  fireEvent.click(
    within(audiences).getByRole("button", { name: "Tutor workspace" }),
  );
  expect(
    within(audiences)
      .getByRole("button", { name: "Tutor workspace" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("1 of 3 guides found");
  fireEvent.click(screen.getByRole("button", { name: "Join the Program" }));
  expect(
    screen.getByRole("heading", { name: "No guides match these filters" }),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("0 of 3 guides found");
  fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
  expect(screen.getByRole("status").textContent).toBe("3 of 3 guides found");
  expect(
    screen
      .getByRole("button", { name: "All tasks" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.queryByRole("heading", { name: "No guides match these filters" }),
  ).toBeNull();
});

it("keeps its count, categories and shortcuts scoped to the records supplied by the server", () => {
  render(
    <HelpCatalogue
      articles={projectArticles(articles.slice(0, 1), "en")}
      audienceTitles={projectTitles({ public: audienceTitles.public }, "en")}
      locale="en"
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("1 of 1 guides found");
  expect(screen.queryByRole("button", { name: "Tutor workspace" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Tutoring & patrol" }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "delivery clock" },
  });
  expect(screen.getByRole("status").textContent).toBe("0 of 1 guides found");
});

it("labels search and both filter groups in the Chinese edition", () => {
  render(
    <HelpCatalogue
      articles={projectArticles(articles, "zh")}
      audienceTitles={projectTitles(audienceTitles, "zh")}
      locale="zh"
    />,
  );
  expect(screen.getByRole("searchbox", { name: "搜索指南" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "指南适用对象" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "辅导伙伴工作台" }));
  expect(screen.getByRole("status").textContent).toBe("1 / 3 篇指南符合条件");
});

it("finds a staff publishing task under Settings & publishing independently of its audience", () => {
  const publishing: HelpArticle = {
    ...article("publish", "staff", "Publish an announcement"),
    category: "administration",
    steps: [
      {
        title: text("Review the publication"),
        body: text("Publish the scheduled school update after review"),
      },
    ],
  };
  render(
    <HelpCatalogue
      articles={projectArticles(
        [
          articles[0]!,
          publishing,
          article("daily-review", "staff", "Review a request"),
        ],
        "en",
      )}
      audienceTitles={projectTitles(
        {
          public: audienceTitles.public,
          staff: text("Program staff", "项目工作人员"),
        },
        "en",
      )}
      locale="en"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Program staff" }));
  expect(screen.getByRole("status").textContent).toBe("2 of 3 guides found");
  fireEvent.click(
    screen.getByRole("button", { name: "Settings & Publishing" }),
  );
  expect(
    screen.getByRole("heading", { name: "Settings & Publishing" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Publish an announcement" }),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Review a request" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "scheduled school update" },
  });
  expect(screen.getByRole("status").textContent).toBe("1 of 3 guides found");
  fireEvent.click(
    screen.getByRole("button", { name: "All available audiences" }),
  );
  expect(screen.getByRole("status").textContent).toBe("1 of 3 guides found");

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Daily Coordination" }));
  expect(screen.getByRole("link", { name: "Review a request" })).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Publish an announcement" }),
  ).toBeNull();
});
