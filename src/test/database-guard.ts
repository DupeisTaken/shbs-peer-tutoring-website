// One policy for real client construction, raw-pg tests and fixture hooks.
export {
  assertIsolatedTestDatabase,
  TEST_DATABASE_GUARD_ERROR,
} from "../server/database-test-safety";
