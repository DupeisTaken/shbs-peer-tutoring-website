// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TuteeLayout from "./layout";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), features: vi.fn(), messages: vi.fn() }));
vi.mock("~/server/auth", () => ({auth:mocks.auth}));
vi.mock("~/server/db", () => ({db:{user:{findUnique:mocks.user}}}));
vi.mock("next/navigation", () => ({redirect:(path:string)=>{throw new Error(`redirect:${path}`)}}));
vi.mock("next-intl/server", () => ({getTranslations:async()=> (key:string)=>key,getMessages:mocks.messages}));
vi.mock("next-intl", () => ({NextIntlClientProvider:({children,messages}:{children:ReactNode;messages:unknown})=><div data-testid="period-messages" data-messages={JSON.stringify(messages)}>{children}</div>}));
vi.mock("~/server/program/features", () => ({getFeatures:mocks.features}));
vi.mock("~/app/_components/notification-bell", () => ({NotificationBell:()=>null}));
vi.mock("~/app/_components/language-switcher", () => ({LanguageSwitcher:()=>null}));
vi.mock("~/app/_components/theme-switcher", () => ({ThemeSwitcher:()=>null}));
vi.mock("~/app/_components/user-avatar", () => ({UserAvatar:()=>null}));
vi.mock("./navigation", () => ({TuteeNavigation:()=>null}));
beforeEach(()=>{
  mocks.auth.mockResolvedValue({user:{id:"account"}});
  mocks.features.mockResolvedValue({QUARTER_SYSTEM:true});
  mocks.messages.mockResolvedValue({workflow:{noActive:"Quarter enrollment",semesterCopy:{noActive:"Semester enrollment"}}});
});
afterEach(cleanup);
it.each(["HEAD","ADMIN","COORDINATOR","VIEWER","TUTOR","CREW","STUDENT"])("allows %s accounts without requiring a tutee profile or verification change", async(role)=>{
  mocks.user.mockResolvedValue({name:"Current account name",username:"name",email:"name@example.test",role,suspendedAt:null,tutor:null});
  render(await TuteeLayout({children:<p>My tutoring</p>}));
  expect(screen.getByText("My tutoring")).toBeTruthy();
  expect(screen.getByText("Current account name")).toBeTruthy();
});
it("keeps unauthenticated access behind sign-in",async()=>{
  mocks.auth.mockResolvedValue(null);
  await expect(TuteeLayout({children:null})).rejects.toThrow("redirect:/signin");
});
it("preserves account suspension enforcement",async()=>{
  mocks.user.mockResolvedValue({suspendedAt:new Date()});
  await expect(TuteeLayout({children:null})).rejects.toThrow("redirect:/suspended");
});

it("uses applied semester wording only within the tutee workspace",async()=>{
  mocks.features.mockResolvedValue({QUARTER_SYSTEM:false});
  mocks.user.mockResolvedValue({name:"Sam",username:"sam",email:"sam@example.test",role:"ADMIN",suspendedAt:null,tutor:null});
  render(await TuteeLayout({children:<p>Requests</p>}));
  expect(screen.getByTestId("period-messages").getAttribute("data-messages")).toContain('"noActive":"Semester enrollment"');
});
it("keeps the inherited quarter messages when quarter mode is applied",async()=>{
  mocks.user.mockResolvedValue({name:"Sam",username:"sam",email:"sam@example.test",role:"TUTOR",suspendedAt:null,tutor:null});
  render(await TuteeLayout({children:<p>Requests</p>}));
  expect(screen.queryByTestId("period-messages")).toBeNull();
});
