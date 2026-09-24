import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "./database-guard";

it.each([
  "postgresql://postgres@127.0.0.1:55439/shbs_shipping_test",
  "postgres://postgres@localhost/unit_test",
  "postgresql://postgres@[::1]/unit_test",
  "postgresql://postgres@localhost/unit_test?sslmode=disable",
])("accepts an explicit isolated local test database: %s", (url) => {
  expect(() => assertIsolatedTestDatabase(url)).not.toThrow();
});

it.each([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "database",
  "service",
  "HOST",
  "%68ost",
])(
  "rejects a query target override even when the visible target is safe: %s",
  (key) => {
    expect(() =>
      assertIsolatedTestDatabase(
        `postgresql://postgres@localhost/unit_test?${key}=other-target`,
      ),
    ).toThrow("explicit local PostgreSQL *_test");
  },
);

it.each([
  undefined,
  "",
  "not a URL",
  "postgresql://postgres@127.0.0.1:55439/shbs_program_demo",
  "postgresql://postgres@127.0.0.1/shbs-peer-tutoring-website",
  "postgresql://postgres@db.example.test/shbs_shipping_test",
  "postgresql://postgres@127.0.0.1/shbs_test_backup",
  "postgresql://postgres@127.0.0.1/contest",
  "https://localhost/shbs_test",
])("rejects unsafe or ambiguous database URLs: %s", (url) => {
  expect(() => assertIsolatedTestDatabase(url)).toThrow(
    "explicit local PostgreSQL *_test",
  );
});
