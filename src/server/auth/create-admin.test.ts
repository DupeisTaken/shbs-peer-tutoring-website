import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn<(password: string) => string>(),
  client: vi.fn(),
  adapter: vi.fn(),
  initialize: vi.fn(),
  source: vi.fn(),
  namespace: vi.fn(),
  url: vi.fn<(url: string) => string>(),
  constructionBoundary: new Error(
    "Synthetic Prisma construction boundary reached",
  ),
}));

// The CLI is imported only up to its construction boundary. Every database or
// bootstrap descendant is mocked, so invalid credentials cannot reach real I/O.
vi.mock("dotenv/config", () => ({}));
vi.mock("../../../generated/prisma", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      mocks.client(options);
      throw mocks.constructionBoundary;
    }
  },
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(options: unknown) {
      mocks.adapter(options);
    }
  },
}));
vi.mock("./password", () => ({ hashPassword: mocks.hash }));
vi.mock("../database-url", () => ({ utcDatabaseUrl: mocks.url }));
vi.mock("../program/bootstrap", () => ({
  initializeProgram: mocks.initialize,
}));
vi.mock("../person-source-initialization", () => ({
  initializePersonSource: mocks.source,
}));
vi.mock("./username-namespace", () => ({
  lockUsernameNamespace: mocks.namespace,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://synthetic:synthetic@localhost/shbs_bootstrap_contract_test",
  );
  vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "synthetic-bootstrap@example.test");
  mocks.hash.mockReturnValue("synthetic-opaque-hash");
  mocks.url.mockImplementation((url) => url);
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  { name: "missing", password: undefined, message: "at least 12" },
  { name: "empty", password: "", message: "at least 12" },
  {
    name: "eleven characters",
    password: "x".repeat(11),
    message: "at least 12",
  },
  {
    name: "1025 characters",
    password: "x".repeat(1025),
    message: "at most 1024",
  },
])(
  "rejects $name before hashing or constructing database access",
  async ({ password, message }) => {
    vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", password);
    await expect(import("../../../scripts/create-admin")).rejects.toThrow(
      `BOOTSTRAP_ADMIN_PASSWORD must contain ${message} characters.`,
    );
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.url).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.namespace).not.toHaveBeenCalled();
  },
);

it.each([
  { length: 12, password: "  abcdefgh  " },
  { length: 1024, password: ` ${"x".repeat(1022)} ` },
])(
  "keeps the exact $length-character password before the fake construction boundary",
  async ({ password }) => {
    vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", password);
    await expect(import("../../../scripts/create-admin")).rejects.toBe(
      mocks.constructionBoundary,
    );
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(password);
    expect(mocks.adapter).toHaveBeenCalledOnce();
    expect(mocks.client).toHaveBeenCalledOnce();
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.namespace).not.toHaveBeenCalled();
  },
);
