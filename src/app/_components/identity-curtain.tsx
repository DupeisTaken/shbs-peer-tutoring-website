"use client";

import { createContext, useContext } from "react";

/** Shared privacy-curtain flag so portaled native dialogs conceal alongside the main tree. */
export const IdentityCurtainContext = createContext(false);
export const useIdentityChecking = () => useContext(IdentityCurtainContext);
