type Count = { count: number };
export interface DatabaseSafetyFake {
  $disconnect(): Promise<void>;
  $queryRaw(): Promise<Array<{ tablename: string }>>;
  $executeRawUnsafe(): Promise<number>;
  $transaction<T>(work: (tx: DatabaseSafetyFake) => Promise<T>): Promise<T>;
  $transaction<T>(work: readonly Promise<T>[]): Promise<T[]>;
  person: {
    findMany(): Promise<Array<{ id: string }>>;
    updateMany(): Promise<Count>;
    deleteMany(): Promise<Count>;
  };
  user: { createMany(): Promise<Count>; deleteMany(): Promise<Count> };
}

/** Model the actual cleanup contracts, including callback transactions and the
 * Person rows they consume. Unknown calls are recorded before failing, so a
 * missing fake method cannot masquerade as a successful target refusal. */
export function createDatabaseSafetyFake(
  record: (operation: string, writes: boolean) => void,
): DatabaseSafetyFake {
  const db: DatabaseSafetyFake = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "$disconnect")
          return async () => record("disconnect", false);
        if (key === "$transaction")
          return async (
            work:
              | ((tx: DatabaseSafetyFake) => Promise<unknown>)
              | readonly Promise<unknown>[],
          ) => {
            record("transaction", false);
            return typeof work === "function" ? work(db) : Promise.all(work);
          };
        if (key === "$queryRaw")
          return async () => {
            record("query", false);
            return [{ tablename: "User" }];
          };
        if (key === "$executeRawUnsafe")
          return async () => {
            record("execute", true);
            return 1;
          };
        if (typeof key !== "string" || key.startsWith("$"))
          return async () => {
            record(`unsupported.${String(key)}`, false);
            throw new Error(
              `Unsupported fake database operation: ${String(key)}`,
            );
          };
        return new Proxy(
          {},
          {
            get(_delegate, operation) {
              return async () => {
                const name = `${key}.${String(operation)}`;
                if (key === "person" && operation === "findMany") {
                  record(name, false);
                  return [{ id: "synthetic-person" }];
                }
                if (
                  operation === "deleteMany" ||
                  operation === "updateMany" ||
                  (key === "user" && operation === "createMany")
                ) {
                  record(name, true);
                  return { count: operation === "createMany" ? 4 : 1 };
                }
                record(name, false);
                throw new Error(`Unsupported fake database operation: ${name}`);
              };
            },
          },
        );
      },
    },
  ) as DatabaseSafetyFake;
  return db;
}
