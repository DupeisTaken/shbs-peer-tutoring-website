import { writeFile } from "node:fs/promises";
import type { Reporter } from "vitest/reporters";
import type {
  SerializedError,
  TestModule,
  TestRunEndReason,
} from "vitest/node";

export type SafetyError = {
  name: string;
  message: string;
  hasCause: boolean;
  hasNestedErrors: boolean;
};
export type SafetyErrorsReceipt = {
  reason: TestRunEndReason;
  unhandledErrors: SafetyError[];
  modules: Array<{
    file: string;
    errors: SafetyError[];
    suites: Array<{ name: string; errors: SafetyError[] }>;
    tests: Array<{ name: string; errors: SafetyError[] }>;
  }>;
};
const summarize = (errors: readonly SerializedError[]): SafetyError[] =>
  errors.map((error) => ({
    name: error.name ?? "",
    message: error.message,
    hasCause: error.cause !== undefined,
    hasNestedErrors: error.errors !== undefined,
  }));

/** Vitest's JSON reporter retains only the first module error. Collect every
 * final module/suite/test error so a setup guard cannot hide broken teardown. */
export class DatabaseSafetyReporter implements Reporter {
  constructor(private readonly outputFile: string) {}

  async onTestRunEnd(
    modules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
    reason: TestRunEndReason,
  ): Promise<void> {
    const receipt: SafetyErrorsReceipt = {
      reason,
      unhandledErrors: summarize(unhandledErrors),
      modules: modules.map((module) => ({
        file: module.moduleId,
        errors: summarize(module.errors()),
        suites: [...module.children.allSuites()].map((suite) => ({
          name: suite.fullName,
          errors: summarize(suite.errors()),
        })),
        tests: [...module.children.allTests()].map((test) => ({
          name: test.fullName,
          errors: summarize(test.result().errors ?? []),
        })),
      })),
    };
    await writeFile(this.outputFile, JSON.stringify(receipt, null, 2) + "\n");
  }
}
