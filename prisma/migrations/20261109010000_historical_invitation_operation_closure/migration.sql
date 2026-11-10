BEGIN;

-- A stop receipt is not a delivery attempt or a usable invitation. It permanently
-- fences one actor/input-bound operation, including a late original request.
CREATE TABLE "HistoricalInvitationOperationClosure" (
  "operationId" TEXT NOT NULL PRIMARY KEY,
  "issuedById" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION historical_invitation_operation_closure_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical invitation operation closures are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER historical_invitation_operation_closure_immutable
  BEFORE UPDATE OR DELETE ON "HistoricalInvitationOperationClosure"
  FOR EACH ROW EXECUTE FUNCTION historical_invitation_operation_closure_immutable();

COMMIT;
