// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";
vi.mock("next-intl/server", () => ({getTranslations:async()=>Object.assign((key:string)=>key === "admin.users.roles.STUDENT" ? "Tutee" : key,{has:(key:string)=>key === "admin.users.roles.STUDENT"})}));
vi.mock("./sign-out-button", () => ({SignOutButton:()=>null}));
vi.mock("./details-auto-close", () => ({DetailsAutoClose:()=>null}));
afterEach(cleanup);
it("renders the visible Tutee label while retaining the existing role identifier",async()=>{
  render(await UserAvatar({name:"Alex",role:"STUDENT"}));
  expect(screen.getByText("Tutee")).toBeTruthy();
  expect(screen.queryByText("STUDENT")).toBeNull();
});
