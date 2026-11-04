import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TRPCError } from "@trpc/server";
import { beforeEach, expect, it, vi } from "vitest";
import SignupPage from "./page";
import TuteeSignupPage from "../tutee-signup/page";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  draft: vi.fn(),
  transition: vi.fn(),
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
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("./signup-form", () => ({ SignupForm: mocks.form }));
vi.mock("~/app/_components/public-form-page", () => ({
  PublicFormPage: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
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
  mocks.auth.mockResolvedValue({ user: { id: "synthetic-owner" } });
  mocks.transition.mockResolvedValue({ state: "OPEN" });
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

it("keeps ordinary public signup independent of draft authorization", async () => {
  renderToStaticMarkup(await SignupPage());
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.draft).not.toHaveBeenCalled();
  expect(mocks.form.mock.calls[0]?.[0]).toMatchObject({
    initialTransition: { state: "OPEN" },
  });
  expect(mocks.notFound).not.toHaveBeenCalled();
});
