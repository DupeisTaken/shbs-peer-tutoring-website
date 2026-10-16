-- The receipt has no foreign key to Pairing or User: deletion must not turn an old
-- request into permission to create another reservation or repeat shortage notices.
CREATE TABLE "PairingCreationRequest" (
  "actorId" TEXT NOT NULL,
  "clientKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "pairingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PairingCreationRequest_pkey" PRIMARY KEY ("actorId", "clientKey")
);
