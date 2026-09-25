-- CreateTable
CREATE TABLE "UsernameNamespaceGuard" (
    "id" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "UsernameNamespaceGuard_pkey" PRIMARY KEY ("id")
);

-- One shared tuple turns stale MVCC snapshots into a serialization failure before allocation.
ALTER TABLE "UsernameNamespaceGuard" ADD CONSTRAINT "UsernameNamespaceGuard_singleton" CHECK (id = 1);
INSERT INTO "UsernameNamespaceGuard" (id, revision) VALUES (1, 0);
