-- Advance reviewed transplanted authority beyond the older checkpoint while
-- preserving every live-reader, immutable-identity and explicit-quarantine guard.
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_history_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'History ownership requires an explicit versioned quarantine' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."sourceUserId" AND "mergedIntoId" IS NOT NULL) THEN
   RAISE EXCEPTION 'History source must be a retired original account' USING ERRCODE='23514';
 END IF;
 IF NEW."readerUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."readerUserId" AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL) THEN
   RAISE EXCEPTION 'History recipient must be a live account' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."sourceUserId" IS DISTINCT FROM OLD."sourceUserId" THEN RAISE EXCEPTION 'Original history source is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.revision=2147483647 THEN RAISE EXCEPTION 'History authority revision exhausted' USING ERRCODE='22003'; END IF;
  NEW.revision:=GREATEST(OLD.revision+1,NEW.revision);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_history_row_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exact row ownership requires a versioned replacement' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.entity IS DISTINCT FROM OLD.entity OR NEW."recordId" IS DISTINCT FROM OLD."recordId" THEN RAISE EXCEPTION 'Original history row identity is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.revision=2147483647 THEN RAISE EXCEPTION 'History authority revision exhausted' USING ERRCODE='22003'; END IF;
  NEW.revision:=GREATEST(OLD.revision+1,NEW.revision);
 END IF;
 IF NEW."readerUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."readerUserId" AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL) THEN
  RAISE EXCEPTION 'History recipient must be a live account' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
