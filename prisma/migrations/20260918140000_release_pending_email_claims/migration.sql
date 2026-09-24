-- Compatibility for installations which applied the first account-email migration.
-- Only primary and verified secondary addresses establish ownership. The existing
-- deletion trigger revokes the removed pending claim's grants; users can request
-- a fresh challenge without reserving anybody else's address.
DELETE FROM "AccountEmail" AS address
USING "User" AS account
WHERE address."userId" = account.id
  AND address."verifiedAt" IS NULL
  AND address.email <> account.email;
