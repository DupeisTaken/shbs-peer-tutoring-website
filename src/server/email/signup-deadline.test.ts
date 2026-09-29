import { afterEach, expect, it, vi } from "vitest";
import type { Socket } from "node:net";
const smtp = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), create: vi.fn() }));
vi.mock("~/env", () => ({ env: { EMAIL_FROM: "sender@example.test", SMTP_PASSWORD: "test-only", SMTP_HOST: "localhost", SMTP_PORT: 465, NODE_ENV: "test" } }));
vi.mock("nodemailer", () => ({ default: { createTransport: (options: unknown) => { smtp.create(options); return { sendMail: smtp.send, close: smtp.close }; } } }));
import { emailSender } from "./sender";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("aborts the actual signup socket at the overall deadline, even if SMTP keeps the dialog alive", async () => {
  vi.useFakeTimers(); smtp.send.mockImplementationOnce(() => new Promise(() => undefined));
  const attempt = emailSender.send({ category: "SECURITY", signup: true, to: "recipient@example.test", subject: "Test", text: "Test" });
  const assertion = expect(attempt).rejects.toThrow("Email delivery failed");
  const options = smtp.create.mock.calls[0]![0] as { socket: Socket; secure: boolean };
  expect(options.secure).toBe(true);
  expect(options.socket.destroyed).toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  expect(options.socket.destroyed).toBe(true);
  expect(smtp.close).toHaveBeenCalled();
});
it("keeps recovery mail on its independent pool without a signup socket", async () => {
  smtp.send.mockResolvedValueOnce({});
  await emailSender.send({ category: "SECURITY", to: "recipient@example.test", subject: "Recovery", text: "Test" });
  expect(smtp.create).toHaveBeenCalledWith(expect.objectContaining({ pool: true, socket: undefined }));
  expect(smtp.close).not.toHaveBeenCalled();
});
