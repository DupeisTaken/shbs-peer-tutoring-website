"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type ProgramWriteAdmission = {
  allowed: boolean;
  isAllowed: () => boolean;
};

// Other callers retain their feature's own permission checks. This context only
// adds the Program page's shared account prerequisite; it never grants access.
const ProgramWriteContext = createContext<ProgramWriteAdmission>({
  allowed: true,
  isAllowed: () => true,
});

export function ProgramWriteAdmissionProvider({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  const parent = useContext(ProgramWriteContext);
  const allowedNow = useRef(allowed);
  useLayoutEffect(() => {
    allowedNow.current = allowed;
    return () => {
      allowedNow.current = false;
    };
  }, [allowed]);
  const parentIsAllowed = parent.isAllowed;
  const isAllowed = useCallback(
    () => parentIsAllowed() && allowedNow.current,
    [parentIsAllowed],
  );
  const effectiveAllowed = parent.allowed && allowed;
  const value = useMemo(
    () => ({ allowed: effectiveAllowed, isAllowed }),
    [effectiveAllowed, isAllowed],
  );
  return (
    <ProgramWriteContext.Provider value={value}>
      {children}
    </ProgramWriteContext.Provider>
  );
}

/** Keep cached editors alive while separately gating new writes. Stored review
 * callbacks consult committed admission rather than the permission at opening. */
export function useProgramWriteAdmission(localAllowed = true) {
  const parent = useContext(ProgramWriteContext);
  const localAllowedNow = useRef(localAllowed);
  useLayoutEffect(() => {
    localAllowedNow.current = localAllowed;
    return () => {
      localAllowedNow.current = false;
    };
  }, [localAllowed]);
  const parentIsAllowed = parent.isAllowed;
  const isAllowed = useCallback(
    () => parentIsAllowed() && localAllowedNow.current,
    [parentIsAllowed],
  );
  return { allowed: parent.allowed && localAllowed, isAllowed };
}
