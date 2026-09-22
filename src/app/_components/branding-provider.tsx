"use client";

import { createContext, useContext } from "react";
import { DEFAULT_BRANDING, type PublicBranding } from "~/lib/branding-config";

const BrandingContext = createContext<PublicBranding>(DEFAULT_BRANDING);

/** Server-selected public values hydrate unchanged; browser code never reads process.env. */
export function BrandingProvider({
  branding,
  children,
}: {
  branding: PublicBranding;
  children: React.ReactNode;
}) {
  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
