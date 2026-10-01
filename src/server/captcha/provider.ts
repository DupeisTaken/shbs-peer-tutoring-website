import "server-only";
import type { CaptchaOutcome, CaptchaPublicConfig } from "~/lib/captcha";

/** Signup only sees normalized decisions. Provider SDK objects never cross this boundary. */
export interface CaptchaProvider {
  publicConfig: CaptchaPublicConfig;
  verify(proof: string, scene: string): Promise<CaptchaOutcome>;
}
