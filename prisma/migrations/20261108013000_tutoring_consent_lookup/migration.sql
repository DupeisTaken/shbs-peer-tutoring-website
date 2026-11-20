-- Bound exact-offer consent checks without scanning unrelated delivery history.
-- The additional B-tree costs one index entry per notice and writes on insertion.
CREATE INDEX "SessionNotice_offerId_idx" ON public."SessionNotice"("offerId");
