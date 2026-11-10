import { z } from "zod";

export const TRANSLATION_OPERATIONS = [
  "localization.setString",
  "home.setContent",
  "home.setNewsTranslation",
  "home.setSectionTranslation",
  "home.setPageTitle",
] as const;
export type TranslationOperation = (typeof TRANSLATION_OPERATIONS)[number];
export const translationIntentMode = z.enum(["DRAFT", "PUBLISH"]);
export type TranslationIntentMode = z.output<typeof translationIntentMode>;

// UUID spelling is not a second intent identity (the terminal PK is TEXT).
const intentId = z.uuid().transform((value) => value.toLowerCase());
export const translationIntentEnvelope = z.object({
  version: z.literal(1),
  id: intentId,
  actorId: z.string().min(1),
  mode: translationIntentMode,
});
export type TranslationIntentEnvelope = z.output<
  typeof translationIntentEnvelope
>;
export const translationIntentReference = z.object({
  actorId: z.string().min(1),
  intentId,
});
export type TranslationIntentReference = z.output<
  typeof translationIntentReference
>;

/** The original setters' parse/trim/clear business contracts stay unchanged. */
export const translationBusinessInputs = {
  "localization.setString": z.object({
    locale: z.string(),
    key: z.string().min(1),
    value: z.string(),
  }),
  "home.setContent": z.object({
    locale: z.string().min(1),
    key: z.string().min(1),
    value: z.string(),
  }),
  "home.setNewsTranslation": z.object({
    postId: z.string(),
    locale: z.string().trim().min(2),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20_000),
  }),
  "home.setSectionTranslation": z.object({
    sectionId: z.string(),
    locale: z.string().trim().min(2),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20_000),
  }),
  "home.setPageTitle": z.object({
    id: z.string(),
    locale: z.string().min(2),
    value: z.string().max(200),
  }),
};
export const translationSetterInputs = {
  "localization.setString": translationBusinessInputs[
    "localization.setString"
  ].extend({ intent: translationIntentEnvelope.optional() }),
  "home.setContent": translationBusinessInputs["home.setContent"].extend({
    intent: translationIntentEnvelope.optional(),
  }),
  "home.setNewsTranslation": translationBusinessInputs[
    "home.setNewsTranslation"
  ].extend({ intent: translationIntentEnvelope.optional() }),
  "home.setSectionTranslation": translationBusinessInputs[
    "home.setSectionTranslation"
  ].extend({ intent: translationIntentEnvelope.optional() }),
  "home.setPageTitle": translationBusinessInputs["home.setPageTitle"].extend({
    intent: translationIntentEnvelope.optional(),
  }),
};

export type AcceptedTranslationReceipt = {
  status: "ACCEPTED";
  version: 1;
  intentId: string;
  operation: TranslationOperation;
  mode: TranslationIntentMode;
  outcome: "DRAFT_SUBMITTED" | "PUBLISHED";
  acceptedAt: Date;
  draftId: string | null;
  cleared: boolean | null;
  replayed: boolean;
};
export type TranslationReceiptResult =
  | AcceptedTranslationReceipt
  | { status: "STOPPED"; version: 1; intentId: string; stoppedAt: Date }
  | { status: "NOT_RECORDED"; version: 1; intentId: string };
