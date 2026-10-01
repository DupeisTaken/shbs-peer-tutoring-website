import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as password from "./password";
import {
  verifyPasswordConfirmation as confirm,
  PASSWORD_CONFIRMATION_MAX_ATTEMPTS as LIMIT,
  PASSWORD_CONFIRMATION_WINDOW_MS as WINDOW,
} from "./password-confirmation";

const hash = password.hashPassword("  valid password  ");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("reserves before hashing, including valid attempts, and expires without extending on denial", () => {
  const id = randomUUID();
  const verify = vi.spyOn(password, "verifyPassword");
  expect(confirm(id, "  valid password  ", hash)).toBe(true);
  for (let i = 1; i < LIMIT; i++) expect(confirm(id, "wrong", hash)).toBe(false);
  expect(() => confirm(id, "  valid password  ", hash)).toThrow(/Too many/);
  expect(verify).toHaveBeenCalledTimes(LIMIT);
  vi.advanceTimersByTime(WINDOW - 1);
  expect(() => confirm(id, "wrong", hash)).toThrow(/Too many/);
  vi.advanceTimersByTime(1);
  expect(confirm(id, "  valid password  ", hash)).toBe(true);
  expect(verify).toHaveBeenCalledTimes(LIMIT + 1);
});

it("bounds inputs without trimming, rejects passwordless accounts, and isolates account budgets", () => {
  const id = randomUUID();
  const verify = vi.spyOn(password, "verifyPassword");
  for (const input of ["", "x".repeat(1025)])
    expect(() => confirm(id, input, hash)).toThrow(/1.1024/);
  expect(confirm(id, "anything", null)).toBe(false);
  expect(verify).not.toHaveBeenCalled();
  expect(confirm(id, "valid password", hash)).toBe(false); // whitespace is credential data
  for (let i = 2; i < LIMIT; i++) confirm(id, "wrong", hash);
  expect(() => confirm(id, "wrong", hash)).toThrow(/Too many/);
  expect(confirm(randomUUID(), "  valid password  ", hash)).toBe(true);
  const long = "x".repeat(1024);
  expect(confirm(randomUUID(), long, password.hashPassword(long))).toBe(true);
});
