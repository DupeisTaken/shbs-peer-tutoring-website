/** @vitest-environment jsdom */
import { useLayoutEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  ProgramWriteAdmissionProvider,
  useProgramWriteAdmission,
} from "./program-write-admission";

afterEach(cleanup);

type Admission = ReturnType<typeof useProgramWriteAdmission>;
function Reader({
  capture,
  localAllowed = true,
}: {
  capture: (value: Admission) => void;
  localAllowed?: boolean;
}) {
  const { allowed, isAllowed } = useProgramWriteAdmission(localAllowed);
  useLayoutEffect(() => {
    capture({ allowed, isAllowed });
  }, [capture, allowed, isAllowed]);
  return <output>{String(allowed)}</output>;
}

it("preserves the feature's local admission outside the Program page", () => {
  let latest!: Admission;
  const capture = (value: Admission) => {
    latest = value;
  };
  const view = render(<Reader capture={capture} />);
  expect(latest.isAllowed()).toBe(true);
  view.rerender(<Reader capture={capture} localAllowed={false} />);
  expect(latest.allowed).toBe(false);
  expect(latest.isAllowed()).toBe(false);
});

it("makes a captured callback observe recovery of all current prerequisites", () => {
  let latest!: Admission;
  const capture = (value: Admission) => {
    latest = value;
  };
  const tree = (account: boolean, period: boolean, local: boolean) => (
    <ProgramWriteAdmissionProvider allowed={account}>
      <ProgramWriteAdmissionProvider allowed={period}>
        <Reader capture={capture} localAllowed={local} />
      </ProgramWriteAdmissionProvider>
    </ProgramWriteAdmissionProvider>
  );
  const view = render(tree(true, true, true));
  const captured = latest.isAllowed;
  expect(captured()).toBe(true);
  view.rerender(tree(false, true, true));
  expect(screen.getByRole("status").textContent).toBe("false");
  expect(captured()).toBe(false);
  view.rerender(tree(true, false, true));
  expect(captured()).toBe(false);
  view.rerender(tree(true, true, false));
  expect(captured()).toBe(false);
  view.rerender(tree(true, true, true));
  expect(latest.isAllowed).toBe(captured);
  expect(captured()).toBe(true);
});

it("permanently revokes callbacks owned by a replaced identity or unmounted editor", () => {
  let latest!: Admission;
  const capture = (value: Admission) => {
    latest = value;
  };
  const tree = (identity: string) => (
    <ProgramWriteAdmissionProvider key={identity} allowed>
      <Reader capture={capture} />
    </ProgramWriteAdmissionProvider>
  );
  const view = render(tree("synthetic-first"));
  const previousIdentity = latest.isAllowed;
  view.rerender(tree("synthetic-second"));
  const currentIdentity = latest.isAllowed;
  expect(previousIdentity()).toBe(false);
  expect(currentIdentity()).toBe(true);
  view.unmount();
  expect(previousIdentity()).toBe(false);
  expect(currentIdentity()).toBe(false);
});
