"use client";

import { createContext, useContext, useState } from "react";

/**
 * Shared state for merging several pairings into one attendance block. The primary pairing is
 * chosen in the attendance form; the merge selection lives under "My pairings" (see TutorPairings)
 * but feeds the same submission. Lifting it to a context lets the two dashboard sections cooperate.
 */
type MergeState = {
  primaryPairingId: string;
  setPrimaryPairingId: (id: string) => void;
  mergeIds: string[];
  setMergeIds: React.Dispatch<React.SetStateAction<string[]>>;
};

const MergeContext = createContext<MergeState | null>(null);

export function MergeProvider({ children }: { children: React.ReactNode }) {
  const [primaryPairingId, setPrimaryPairingId] = useState("");
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  return (
    <MergeContext.Provider
      value={{ primaryPairingId, setPrimaryPairingId, mergeIds, setMergeIds }}
    >
      {children}
    </MergeContext.Provider>
  );
}

export function useMerge(): MergeState {
  const ctx = useContext(MergeContext);
  if (!ctx) throw new Error("useMerge must be used within a MergeProvider");
  return ctx;
}
