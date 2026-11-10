/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import {
  createTranslationIntentClient,
  TRANSLATION_INTENT_STORAGE_KEY,
  type TranslationIntentMetadata,
  type TranslationIntentClient,
} from "~/lib/translation-intent-client";
import { TranslationIntentRecoveryLink } from "./translation-intent-recovery-link";
import RootLayout from "../layout";
import type * as IntentClientModule from "~/lib/translation-intent-client";

const fixture = vi.hoisted(() => ({
  auth: vi.fn(),
  network: vi.fn(),
  intentClient: undefined as TranslationIntentClient | undefined,
}));
vi.mock("~/lib/translation-intent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof IntentClientModule>();
  return {
    ...actual,
    get translationIntentClient() {
      return fixture.intentClient!;
    },
  };
});
// Exercise the actual root's mount/actor wiring; unrelated shell providers keep
// their children but cannot start queries or policy work in this focused fixture.
vi.mock("~/server/auth", () => ({ auth: fixture.auth }));
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "synthetic-font" },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getMessages: async () => ({}),
  getTimeZone: async () => "UTC",
}));
vi.mock("~/app/_components/intl-provider", () => ({
  IntlProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/app/_components/branding-provider", () => ({
  BrandingProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/trpc/react", () => ({
  TRPCReactProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/app/_components/student-policy-gate", () => ({
  StudentPolicyGate: () => null,
}));

const metadata: TranslationIntentMetadata = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  actorId: "synthetic-original-actor",
  operation: "home.setPageTitle",
  mode: "PUBLISH",
};
const secondActor = "private-other-actor";

function restored(records: TranslationIntentMetadata[] = []) {
  sessionStorage.setItem(
    TRANSLATION_INTENT_STORAGE_KEY,
    JSON.stringify(records),
  );
  return createTranslationIntentClient(() => sessionStorage);
}
function localStore() {
  return fixture.intentClient!;
}
function show(actorId: string | null = metadata.actorId) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TranslationIntentRecoveryLink actorId={actorId} client={localStore()} />
    </NextIntlClientProvider>,
  );
}
function expectPassive() {
  expect(fixture.network).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(metadata.id);
  expect(document.body.textContent).not.toContain(metadata.actorId);
  expect(document.body.textContent).not.toContain(secondActor);
  expect(document.body.textContent).not.toContain("PRIVATE-PAYLOAD-HASH");
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem("unrelated-private-data", "PRIVATE-PAYLOAD-HASH");
  fixture.intentClient = createTranslationIntentClient(() => sessionStorage);
  fixture.auth.mockResolvedValue({
    user: { id: metadata.actorId },
    role: "STUDENT",
    tutorId: null,
  });
  fixture.network.mockImplementation(() => {
    throw new Error("Passive recovery link started network work");
  });
  vi.stubGlobal("fetch", fixture.network);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders nothing for empty recovery metadata", () => {
  show();
  expect(screen.queryByRole("link")).toBeNull();
  expectPassive();
});
it("renders nothing for another actor's restored metadata", () => {
  fixture.intentClient = restored([{ ...metadata, actorId: secondActor }]);
  show();
  expect(localStore().getSnapshot().entries).toHaveLength(1);
  expect(screen.queryByRole("link")).toBeNull();
  expectPassive();
});
it("conceals retained metadata when no authenticated actor is supplied", () => {
  fixture.intentClient = restored([metadata]);
  localStore().hydrate();
  show(null);
  expect(screen.queryByRole("link")).toBeNull();
  expectPassive();
});
it("offers the localized native recovery destination for restored own unknown metadata without prefetch", () => {
  fixture.intentClient = restored([metadata]);
  show();
  const link = screen.getByRole("link", { name: en.translationIntent.title });
  expect(localStore().getSnapshot().entries[0]?.status).toBe("UNKNOWN");
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe("/localization");
  const clicked = vi.fn((event: Event) => event.preventDefault());
  link.addEventListener("click", clicked);
  fireEvent.mouseEnter(link);
  fireEvent.focus(link);
  fireEvent.click(link);
  expect(clicked).toHaveBeenCalledOnce();
  expectPassive();
});
it.each(["ACCEPTED", "STOPPED"] as const)(
  "keeps the passive link for an own %s receipt retained in memory",
  (status) => {
    localStore().admit(metadata);
    localStore().resolve(
      metadata,
      status === "STOPPED"
        ? {
            status,
            version: 1,
            intentId: metadata.id,
            stoppedAt: new Date("2026-11-09"),
          }
        : {
            status,
            version: 1,
            intentId: metadata.id,
            operation: metadata.operation,
            mode: "PUBLISH",
            outcome: "PUBLISHED",
            draftId: null,
            cleared: null,
            acceptedAt: new Date("2026-11-09"),
            replayed: false,
          },
    );
    show();
    expect(
      screen
        .getByRole("link", { name: en.translationIntent.title })
        .getAttribute("href"),
    ).toBe("/localization");
    expectPassive();
  },
);
it("subscribes to new unknown metadata and removes the link after local dismissal", () => {
  show();
  expect(screen.queryByRole("link")).toBeNull();
  act(() => {
    localStore().admit(metadata);
    localStore().unknown(metadata);
  });
  expect(
    screen.getByRole("link", { name: en.translationIntent.title }),
  ).toBeTruthy();
  act(() => {
    localStore().resolve(metadata, {
      status: "STOPPED",
      version: 1,
      intentId: metadata.id,
      stoppedAt: new Date("2026-11-09"),
    });
    localStore().dismiss(metadata);
  });
  expect(screen.queryByRole("link")).toBeNull();
  expectPassive();
});
it("does not add a recovery link for an ordinary in-flight pending submission", () => {
  localStore().admit(metadata);
  show();
  expect(screen.queryByRole("link")).toBeNull();
  expectPassive();
});
it("conceals the previous partition immediately when the authenticated actor changes", () => {
  fixture.intentClient = restored([metadata]);
  const view = show();
  expect(
    screen.getByRole("link", { name: en.translationIntent.title }),
  ).toBeTruthy();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <TranslationIntentRecoveryLink
        actorId={secondActor}
        client={localStore()}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByRole("link")).toBeNull();
  act(() => {
    localStore().admit({ ...metadata, actorId: secondActor });
    localStore().unknown({ ...metadata, actorId: secondActor });
  });
  expect(
    screen.getByRole("link", { name: en.translationIntent.title }),
  ).toBeTruthy();
  expectPassive();
});

async function showRoot() {
  const root = await RootLayout({ children: <p>Current public route</p> });
  // Mount body contents without nesting document/html/body inside RTL's div.
  const documentTree = root as unknown as {
    props: { children: { props: { children: ReactNode } } };
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {documentTree.props.children.props.children}
    </NextIntlClientProvider>,
  );
}
it("makes recovery discoverable under the authenticated root after a former workspace redirects away", async () => {
  fixture.intentClient = restored([metadata]);
  await showRoot();
  expect(screen.getByText("Current public route")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.translationIntent.title })
      .getAttribute("href"),
  ).toBe("/localization");
  expectPassive();
});
it("does not mount recovery from the root for an anonymous session", async () => {
  fixture.intentClient = restored([metadata]);
  fixture.auth.mockResolvedValue(null);
  await showRoot();
  expect(screen.getByText("Current public route")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(localStore().getSnapshot().ready).toBe(false);
  expectPassive();
});
