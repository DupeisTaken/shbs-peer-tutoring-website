-- One program-wide IANA zone; existing timestamps and weekly wall-clock slots remain intact.
CREATE TABLE "ProgramSettings" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'program',
  "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "ProgramSettings" ("id") VALUES ('program');
