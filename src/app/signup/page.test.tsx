import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TRPCError } from "@trpc/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import SignupPage from "./page";
import TuteeSignupPage from "../tutee-signup/page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  draft: vi.fn(),
  transition: vi.fn(),
  restriction: vi.fn(),
  locale: "keys",
  notFound: vi.fn<() => never>(),
  redirect: vi.fn<(path: string) => never>(),
  form: vi.fn((_props: unknown) => null),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/recovery/workflow-draft", () => ({
  readRecoveryWorkflowDraft: mocks.draft,
}));
vi.mock("~/server/program/public-signup-transition", () => ({
  readPublicSignupTransition: mocks.transition,
}));
vi.mock("~/server/student-intake-restriction", () => ({
  readStudentSignupRestriction: mocks.restriction,
}));
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    mocks.locale === "keys"
      ? (key: string) => key
      : createTranslator({
          locale: mocks.locale,
          messages: mocks.locale === "zh" ? zh : en,
        }),
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("./signup-form", () => ({ SignupForm: mocks.form }));
vi.mock("./signup-intro", () => ({ SignupIntro: () => <p>survey.intro</p> }));
vi.mock("~/app/_components/public-form-page", () => ({
  PublicFormPage: ({
    children,
    description,
  }: {
    children: ReactNode;
    description?: ReactNode;
  }) => (
    <main>
      {description}
      {children}
    </main>
  ),
}));

const routes = [
  ["/signup", SignupPage],
  ["/tutee-signup", TuteeSignupPage],
] as const;
const unavailable = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
const input = () => ({
  searchParams: Promise.resolve({ recoveryDraft: "synthetic-draft" }),
});
const answers = {
  firstName: "Synthetic",
  lastName: "Learner",
  englishName: "Synthetic Learner",
  preferredContact: "Synthetic owner contact",
  firstChoiceId: "subject",
  slotIds: ["slot"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "keys";
  mocks.auth.mockResolvedValue({ user: { id: "synthetic-owner" } });
  mocks.transition.mockResolvedValue({
    current: { termId: "active-intake", kind: "quarter" },
    next: { label: "Future quarter" },
  });
  mocks.restriction.mockResolvedValue({
    blocked: false,
    canOpenWorkspace: true,
  });
  mocks.draft.mockResolvedValue({
    draftId: "synthetic-draft",
    version: 1,
    state: "PENDING_OWNER_REVIEW",
    sourceSurveyId: "private-source",
    submittedSurveyId: null,
    answers,
  });
  mocks.notFound.mockImplementation(() => {
    throw unavailable;
  });
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`redirect:${path}`);
  });
});

it.each(routes)(
  "uses the same privacy-preserving unavailable result for inaccessible drafts through %s",
  async (_route, page) => {
    for (const code of ["NOT_FOUND", "FORBIDDEN", "CONFLICT"] as const) {
      mocks.notFound.mockClear();
      mocks.draft.mockRejectedValueOnce(
        new TRPCError({ code, message: "Private source or owner information" }),
      );
      await expect(page(input())).rejects.toBe(unavailable);
      expect(mocks.notFound).toHaveBeenCalledOnce();
      expect(mocks.form).not.toHaveBeenCalled();
    }
  },
);

it.each(routes)(
  "preserves unexpected draft failures through %s",
  async (_route, page) => {
    for (const error of [
      new Error("Synthetic database unavailable"),
      new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
      new TRPCError({ code: "BAD_REQUEST" }),
      { code: "NOT_FOUND", message: "Unrecognized provider object" },
    ]) {
      mocks.draft.mockRejectedValueOnce(error);
      await expect(page(input())).rejects.toBe(error);
    }
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.form).not.toHaveBeenCalled();
  },
);

it.each(routes)(
  "passes an authorized owner's draft to the normal signup form through %s",
  async (_route, page) => {
    renderToStaticMarkup(await page(input()));
    expect(mocks.draft).toHaveBeenCalledWith(
      {},
      { draftId: "synthetic-draft" },
      { id: "synthetic-owner" },
    );
    expect(mocks.form.mock.calls[0]?.[0]).toMatchObject({
      recoveryDraft: { draftId: "synthetic-draft", version: 1, answers },
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  },
);

it.each(routes)(
  "preserves sign-in and consumed-draft behavior through %s",
  async (_route, page) => {
    mocks.auth.mockResolvedValueOnce(null);
    await expect(page(input())).rejects.toThrow(
      `redirect:/signin?callbackUrl=${encodeURIComponent("/signup?recoveryDraft=synthetic-draft")}`,
    );
    expect(mocks.draft).not.toHaveBeenCalled();
    mocks.draft.mockResolvedValueOnce({
      draftId: "synthetic-draft",
      version: 2,
      state: "CONSUMED",
      sourceSurveyId: "private-source",
      submittedSurveyId: "private-new-request",
      answers: null,
    });
    const html = renderToStaticMarkup(await page(input()));
    expect(html).toContain("recoveryWorkflow.consumed");
    expect(html).not.toContain("private-source");
    expect(html).not.toContain("private-new-request");
    expect(mocks.form).not.toHaveBeenCalled();
  },
);

it("keeps signed-out public signup independent of private account and draft reads", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  renderToStaticMarkup(await SignupPage());
  expect(mocks.draft).not.toHaveBeenCalled();
  expect(mocks.restriction).not.toHaveBeenCalled();
  expect(mocks.form.mock.calls[0]?.[0]).toMatchObject({
    initialTransition: { current: { termId: "active-intake" } },
  });
  expect(mocks.notFound).not.toHaveBeenCalled();
});

it.each(routes)(
  "reads the signed-in account's actual current intake through %s",
  async (_route, page) => {
    renderToStaticMarkup(await page());
    expect(mocks.restriction).toHaveBeenCalledWith(
      {},
      "active-intake",
      "synthetic-owner",
    );
    expect(mocks.form).toHaveBeenCalledOnce();
  },
);

it.each(routes)(
  "retains the normal error boundary for restriction read failures through %s",
  async (_route, page) => {
    const error = new Error("Synthetic restriction read failed");
    mocks.restriction.mockRejectedValueOnce(error);
    await expect(page()).rejects.toBe(error);
    expect(mocks.form).not.toHaveBeenCalled();
  },
);

it.each(["en", "zh"])(
  "explains same-period restrictions in %s through both signup aliases",
  async (locale) => {
    mocks.locale = locale;
    for (const [, page] of routes) {
      for (const kind of ["quarter", "semester"] as const) {
        mocks.transition.mockResolvedValue({
          current: { termId: "active-intake", kind },
          next: { label: "Future quarter", enabled: true },
        });
        mocks.restriction.mockResolvedValue({
          blocked: true,
          canOpenWorkspace: true,
        });
        const html = renderToStaticMarkup(await page());
        const messages = locale === "zh" ? zh : en;
        expect(html).toContain(
          kind === "semester"
            ? messages.workflow.semesterCopy.abortFinal
            : messages.workflow.abortFinal,
        );
        expect(html).toContain('role="status"');
        expect(html).toContain('href="/student?view=requests"');
        expect(html).toContain(messages.tuteePortal.viewMyRequests);
        expect(html).not.toContain(messages.survey.intro);
      }
    }
    expect(mocks.form).not.toHaveBeenCalled();
  },
);

it("does not link a restricted account into an unavailable workspace", async () => {
  mocks.restriction.mockResolvedValueOnce({
    blocked: true,
    canOpenWorkspace: false,
  });
  const html = renderToStaticMarkup(await SignupPage());
  expect(html).toContain("workflow.abortFinal");
  expect(html).not.toContain('href="/student');
  expect(mocks.form).not.toHaveBeenCalled();
});

it("keeps an unconsumed recovery draft behind the restriction and preserves a consumed receipt", async () => {
  mocks.restriction.mockResolvedValue({
    blocked: true,
    canOpenWorkspace: true,
  });
  const blocked = renderToStaticMarkup(await SignupPage(input()));
  expect(blocked).toContain("workflow.abortFinal");
  expect(mocks.form).not.toHaveBeenCalled();
  mocks.restriction.mockClear();
  mocks.draft.mockResolvedValueOnce({ state: "CONSUMED", answers: null });
  const consumed = renderToStaticMarkup(await SignupPage(input()));
  expect(consumed).toContain("recoveryWorkflow.consumed");
  expect(consumed).not.toContain("workflow.abortFinal");
  expect(mocks.restriction).not.toHaveBeenCalled();
});
