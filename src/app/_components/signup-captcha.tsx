"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  captchaScene,
  type CaptchaAction,
  type CaptchaPublicConfig,
} from "~/lib/captcha";
import { SignupError } from "./signup-error";

type Widget = { destroy?: () => void; refresh?: () => void };
type WidgetOptions = {
  SceneId: string;
  mode: "embed";
  element: string;
  button: string;
  language: "cn" | "en";
  immediate: boolean;
  autoRefresh: boolean;
  timeout: number;
  slideStyle: { width: number; height: number };
  rem: number;
  getInstance: (instance: Widget) => void;
  captchaVerifyCallback: (
    proof: string,
  ) => Promise<{ captchaResult: boolean; bizResult: boolean }>;
  onBizResultCallback: () => void;
  onError: () => void;
};
declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: "cn"; prefix: string };
    initAliyunCaptcha?: (options: WidgetOptions) => void;
  }
}
const SCRIPT =
  "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
let scriptPromise: Promise<void> | null = null;
/** One SDK script per page. No script is fetched until an enabled, user-requested challenge.
 * Rejected loads can be retried explicitly; no automatic third-party retry loop. */
function loadScript(config: CaptchaPublicConfig) {
  window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => finish(false), 8000);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (ok && window.initAliyunCaptcha) resolve();
      else {
        script.remove();
        scriptPromise = null;
        reject(new Error("CAPTCHA_SCRIPT"));
      }
    };
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  });
  return scriptPromise;
}

const errors = {
  CAPTCHA_REQUIRED: "required",
  CAPTCHA_REJECTED: "rejected",
  CAPTCHA_UNAVAILABLE: "unavailable",
  CAPTCHA_CONFIG: "unavailable",
  CAPTCHA_SCRIPT: "scriptFailed",
  CAPTCHA_CHANGED: "changed",
} as const;
export function CaptchaError({
  error,
}: {
  error: {
    message: string;
    data?: { retryAfterSeconds?: number | null } | null;
  };
}) {
  const t = useTranslations("captcha");
  return Object.hasOwn(errors, error.message) ? (
    <>{t(errors[error.message as keyof typeof errors])}</>
  ) : (
    <SignupError error={error} />
  );
}

function Challenge({
  config,
  action,
  verify,
  onError,
}: {
  config: CaptchaPublicConfig;
  action: CaptchaAction;
  verify: (proof: string) => Promise<boolean>;
  onError: (error: Error) => void;
}) {
  const t = useTranslations("captcha");
  const locale = useLocale();
  const id = useId().replaceAll(":", "").replaceAll("_", "");
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(verify);
  const failed = useRef(onError);
  useEffect(() => {
    callback.current = verify;
    failed.current = onError;
  }, [verify, onError]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    let instance: Widget | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    void loadScript(config)
      .then(() => {
        if (!alive) return;
        window.initAliyunCaptcha!({
          SceneId: captchaScene(config, action),
          mode: "embed",
          element: `#captcha-${id}`,
          button: `#captcha-button-${id}`,
          language: locale === "zh" ? "cn" : "en",
          immediate: false,
          autoRefresh: false,
          timeout: 5000,
          slideStyle: { width: 320, height: 44 },
          rem: Math.min(1, (container.current?.clientWidth ?? 320) / 320),
          getInstance: (widget) => {
            instance = widget;
            if (!alive) widget.destroy?.();
          },
          captchaVerifyCallback: async (proof) => {
            if (!alive) return { captchaResult: false, bizResult: false };
            const ok = await callback.current(proof);

            return { captchaResult: ok, bizResult: ok };
          },
          onBizResultCallback: () => undefined,
          onError: () => {
            if (alive) failed.current(new Error("CAPTCHA_UNAVAILABLE"));
          },
        });
        // Aliyun requires at least two seconds between SDK initialization and verification.
        readyTimer = setTimeout(() => {
          if (alive) setLoaded(true);
        }, 2100);
      })
      .catch(() => {
        if (alive) failed.current(new Error("CAPTCHA_SCRIPT"));
      });
    return () => {
      alive = false;
      clearTimeout(readyTimer);
      instance?.destroy?.();
    };
  }, [config, action, id, locale]);
  return (
    <div className="space-y-3" ref={container}>
      <p className="text-sm font-medium">{t("required")}</p>
      <div id={`captcha-${id}`} />
      <button
        id={`captcha-button-${id}`}
        type="button"
        disabled={!loaded}
        className="btn-secondary min-h-11 w-full"
      >
        {t(loaded ? "verify" : "loading")}
      </button>
      <p className="muted text-xs">
        {t("privacy")}{" "}
        <a className="link" href="/privacy" target="_blank" rel="noreferrer">
          {t("privacyLink")}
        </a>
      </p>
    </div>
  );
}

/** Capture an explicit submit intent, then obtain a one-use server grant. Mutable form values
 * remain in their parent. Polling never submits or starts provider work by itself. */
export function useSignupCaptcha(action: CaptchaAction, email: string) {
  const t = useTranslations("captcha");
  const settings = api.program.captchaPublic.useQuery(undefined, {
    refetchInterval: 15_000,
    staleTime: 0,
    retry: false,
  });
  const verification = api.program.verifySignupCaptcha.useMutation();
  const [intent, setIntent] = useState<{
    run: (grant?: string) => Promise<unknown>;
    email: string;
    config: CaptchaPublicConfig;
    version: number;
  } | null>(null);
  const currentIntent = useRef<typeof intent>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    currentIntent.current = intent;
    if (
      intent &&
      (settings.data?.enabled === false ||
        (settings.data && settings.data.version !== intent.version) ||
        email.trim().toLowerCase() !== intent.email)
    ) {
      // External operational settings invalidate widget state; one follow-up render removes it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIntent(null);
      currentIntent.current = null;
      busy.current = false;
    }
  }, [settings.data, email, intent]);
  async function run(work: (grant?: string) => Promise<unknown>) {
    if (busy.current || submitting.current) return;
    busy.current = true;
    setError(null);
    setPending(true);
    try {
      const fresh = await settings.refetch();
      if (fresh.error || !fresh.data) throw new Error("CAPTCHA_UNAVAILABLE");
      if (fresh.data.enabled) {
        if (!fresh.data.config) throw new Error("CAPTCHA_UNAVAILABLE");
        setIntent({
          run: work,
          email: email.trim().toLowerCase(),
          config: fresh.data.config,
          version: fresh.data.version,
        });
      } else {
        await work();
        busy.current = false;
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("CAPTCHA_UNAVAILABLE"));
      busy.current = false;
      void settings.refetch();
    } finally {
      setPending(false);
    }
  }
  const panel = (
    <>
      {intent && (
        <section
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          aria-label={t("title")}
        >
          <Challenge
            config={intent.config}
            action={action}
            onError={(failure) => {
              setError(failure);
              setIntent(null);
              busy.current = false;
            }}
            verify={async (proof) => {
              if (submitting.current) return false;
              submitting.current = true;
              setPending(true);
              setError(null);
              try {
                const result = await verification.mutateAsync({
                  action,
                  email: intent.email,
                  proof,
                });
                // Editing/cancelling while the provider request is in flight must
                // not submit the captured form when its old grant eventually arrives.
                if (!active.current || currentIntent.current !== intent)
                  return false;
                await intent.run(result.grant ?? undefined);
                setIntent(null);
                busy.current = false;
                return true;
              } catch (err) {
                setError(
                  err instanceof Error ? err : new Error("CAPTCHA_UNAVAILABLE"),
                );
                setIntent(null);
                busy.current = false;
                void settings.refetch();
                return false;
              } finally {
                submitting.current = false;
                if (active.current) setPending(false);
              }
            }}
          />
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={pending}
            onClick={() => {
              setIntent(null);
              setError(null);
              busy.current = false;
            }}
          >
            {t("cancel")}
          </button>
        </section>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-700">
            <CaptchaError error={error} />
          </p>
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={pending}
            onClick={() => {
              setIntent(null);
              setError(null);
              busy.current = false;
              void settings.refetch();
            }}
          >
            {t("retry")}
          </button>
        </div>
      )}
    </>
  );
  return { run, panel, pending: pending || !!intent };
}
