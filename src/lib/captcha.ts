import { z } from "zod";

export const captchaAction = z.enum([
  "tutee.submit",
  "tutee.resend",
  "viewer.start",
]);
export type CaptchaAction = z.infer<typeof captchaAction>;
export type CaptchaOutcome = "accepted" | "rejected" | "unavailable";
export type CaptchaPublicConfig = {
  provider: "aliyun-v2";
  region: "cn";
  prefix: string;
  scenes: { tutee: string; viewer: string };
};
export const captchaGrantInput = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();
export function captchaScene(
  config: CaptchaPublicConfig,
  action: CaptchaAction,
) {
  return config.scenes[action === "viewer.start" ? "viewer" : "tutee"];
}
