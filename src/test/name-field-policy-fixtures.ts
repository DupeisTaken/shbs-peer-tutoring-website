import {
  DEFAULT_NAME_FIELDS,
  nameFieldPolicies,
} from "~/lib/name-field-policy";

/** Existing form tests exercise their own transport lifecycle under the shipped
 * default policy. Dedicated policy tests cover loading, failure and custom states. */
export function nameFieldPolicyQueries() {
  return {
    nameFieldPolicy: {
      useQuery: () => ({
        data: { policies: nameFieldPolicies({}), version: 0 },
        error: null,
      }),
    },
    nameFieldsForProfile: {
      useQuery: () => ({
        data: {
          states: DEFAULT_NAME_FIELDS,
          accountType: "STUDENT",
          version: 0,
        },
        error: null,
      }),
    },
    nameFieldSettings: {
      useQuery: () => ({
        data: {
          policies: nameFieldPolicies({}),
          version: 0,
          canEdit: false,
          canApply: false,
        },
        error: null,
      }),
    },
  };
}
