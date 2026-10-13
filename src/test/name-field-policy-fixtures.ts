import {
  DEFAULT_NAME_FIELDS,
  nameFieldPolicies,
  type NameFieldStates,
} from "~/lib/name-field-policy";

/** Existing form tests exercise their own transport lifecycle under the shipped
 * default policy. Dedicated policy tests cover loading, failure and custom states. */
export function nameFieldPolicyQueries(
  states:
    NameFieldStates | (() => NameFieldStates | undefined) = DEFAULT_NAME_FIELDS,
) {
  const current = () =>
    (typeof states === "function" ? states() : states) ?? DEFAULT_NAME_FIELDS;
  return {
    nameFieldPolicy: {
      useQuery: () => ({
        data: {
          policies: nameFieldPolicies(
            Object.fromEntries(
              Object.keys(nameFieldPolicies({})).map((role) => [
                role,
                current(),
              ]),
            ),
          ),
          version: 0,
        },
        error: null,
      }),
    },
    nameFieldsForProfile: {
      useQuery: () => ({
        data: {
          states: current(),
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
