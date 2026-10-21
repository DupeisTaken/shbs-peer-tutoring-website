-- Identity grouping is separate from login and participation authority. Backfill
-- only existing explicit links; names and email addresses are never matching keys.
CREATE TYPE "PersonResolutionState" AS ENUM ('GROUPED', 'REVIEW_REQUIRED');
CREATE TABLE "Person" (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  "primaryUserId" TEXT UNIQUE REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolutionState" "PersonResolutionState" NOT NULL DEFAULT 'GROUPED',
  "mergedIntoId" TEXT REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT person_not_self CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> id)
);
ALTER TABLE "User" ADD COLUMN "personId" TEXT REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tutor" ADD COLUMN "personId" TEXT REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tutee" ADD COLUMN "personId" TEXT REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_personId_idx" ON "User"("personId");
CREATE INDEX "Tutor_personId_idx" ON "Tutor"("personId");
CREATE INDEX "Tutee_personId_idx" ON "Tutee"("personId");
CREATE TABLE "PersonCombineReceipt" (
  id TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "personId" TEXT NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  outcome "PersonResolutionState" NOT NULL,
  "retiredUserIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reject contradictory or dangling retained ownership rather than choosing a
-- winner. Such records require the existing reviewed correction before migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "StudentProfileOwnership" o
      LEFT JOIN "User" u ON u.id=o."userId"
      LEFT JOIN "Tutee" t ON t.id=o."tuteeId"
      WHERE u.id IS NULL OR t.id IS NULL) THEN
    RAISE EXCEPTION 'Person backfill requires valid retained student ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM "StudentProfileOwnership" o JOIN "User" u
      ON u."studentId"=o."tuteeId" WHERE u.id<>o."userId") THEN
    RAISE EXCEPTION 'Person backfill requires reviewed current/retained student ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM "TutorProfileOwnership" o JOIN "User" u
      ON u."tutorId"=o."tutorId" WHERE u.id<>o."userId") THEN
    RAISE EXCEPTION 'Person backfill requires reviewed current/retained tutor ownership';
  END IF;
END $$;

-- Label propagation avoids building a quadratic transitive-closure table. Each
-- original source receives one component label across authoritative relationships.
CREATE TEMP TABLE person_nodes (key TEXT PRIMARY KEY, root TEXT NOT NULL);
INSERT INTO person_nodes SELECT 'USER:'||id, 'USER:'||id FROM "User"
  UNION ALL SELECT 'TUTOR:'||id, 'TUTOR:'||id FROM "Tutor"
  UNION ALL SELECT 'TUTEE:'||id, 'TUTEE:'||id FROM "Tutee";
CREATE TEMP TABLE person_edges (a TEXT, b TEXT);
INSERT INTO person_edges SELECT 'USER:'||id, 'USER:'||"mergedIntoId" FROM "User" WHERE "mergedIntoId" IS NOT NULL
  UNION ALL SELECT 'USER:'||id, 'TUTOR:'||"tutorId" FROM "User" WHERE "tutorId" IS NOT NULL
  UNION ALL SELECT 'USER:'||id, 'TUTEE:'||"studentId" FROM "User" WHERE "studentId" IS NOT NULL
  UNION ALL SELECT 'USER:'||"userId", 'TUTOR:'||"tutorId" FROM "TutorProfileOwnership"
  UNION ALL SELECT 'USER:'||"userId", 'TUTEE:'||"tuteeId" FROM "StudentProfileOwnership";
INSERT INTO person_edges SELECT b,a FROM person_edges;
CREATE INDEX ON person_edges(a);
DO $$ DECLARE changed INTEGER; BEGIN
  LOOP
    UPDATE person_nodes n SET root=c.root FROM (
      SELECT e.a, min(other.root) AS root FROM person_edges e
      JOIN person_nodes other ON other.key=e.b GROUP BY e.a
    ) c WHERE n.key=c.a AND c.root<n.root;
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed=0;
  END LOOP;
END $$;
INSERT INTO "Person" (id) SELECT DISTINCT 'person:'||root FROM person_nodes;
UPDATE "User" u SET "personId"='person:'||n.root FROM person_nodes n WHERE n.key='USER:'||u.id;
UPDATE "Tutor" t SET "personId"='person:'||n.root FROM person_nodes n WHERE n.key='TUTOR:'||t.id;
UPDATE "Tutee" t SET "personId"='person:'||n.root FROM person_nodes n WHERE n.key='TUTEE:'||t.id;
UPDATE "Person" p SET "primaryUserId"=x.id FROM (
  SELECT "personId", min(id) AS id FROM "User" WHERE "mergedIntoId" IS NULL GROUP BY "personId" HAVING count(*)=1
) x WHERE p.id=x."personId";
UPDATE "Person" p SET "resolutionState"='REVIEW_REQUIRED' WHERE
  (SELECT count(*) FROM "User" u WHERE u."personId"=p.id AND u."mergedIntoId" IS NULL)>1;
DROP TABLE person_edges;
DROP TABLE person_nodes;
