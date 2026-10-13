/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import { SignupAppeal } from "./signup-appeal";
const mocks=vi.hoisted(()=>({query:vi.fn(),save:vi.fn()}));
vi.mock("~/trpc/react",()=>({api:{studentWorkflow:{inspectSignupAppeal:{useMutation:()=>({mutateAsync:mocks.query,isPending:false})},appealSignup:{useMutation:()=>({mutateAsync:mocks.save,isPending:false})}}}}));
const token="a".repeat(64);
const initial={id:"request",invalidityVersion:1,canAppeal:true,state:"OPEN",submittedAt:new Date("2026-10-01"),appeal:null};
const view=(proof=token)=><NextIntlClientProvider locale="en" messages={en}><SignupAppeal token={proof} /></NextIntlClientProvider>;
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue(initial);mocks.save.mockResolvedValue({ok:true,appealId:"appeal"});});
afterEach(cleanup);
it("refuses a missing or invalid capability without exposing a reason or submitting an appeal",()=>{
  render(view("invalid"));expect(screen.getByText(en.signupAppeal.invalid)).toBeTruthy();expect(screen.queryByRole("textbox")).toBeNull();expect(mocks.query).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it("requires a reason and admits one pending write while retaining a failed reason and retry key",async()=>{
  let reject!: (error:Error)=>void;mocks.save.mockReturnValueOnce(new Promise((_resolve,fail)=>{reject=fail;}));const mounted=render(view());
  await screen.findByRole("textbox");expect(screen.getByRole("button",{name:en.signupAppeal.submit}).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"This request describes my actual support needs."}});
  const form=mounted.container.querySelector("form")!;fireEvent.submit(form);fireEvent.submit(form);expect(mocks.save).toHaveBeenCalledOnce();const posted=mocks.save.mock.calls[0]?.[0];
  await act(async()=>reject(new Error("Offline")));expect(screen.getByDisplayValue("This request describes my actual support needs.")).toBeTruthy();mocks.save.mockRejectedValueOnce(new Error("Retry failed"));fireEvent.submit(form);await screen.findByText("Retry failed");expect(mocks.save.mock.calls[1]?.[0]).toEqual(posted);
});
it("does not replay an accepted appeal after the following read fails",async()=>{
  mocks.query.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("Offline"));render(view());await screen.findByRole("textbox");fireEvent.change(screen.getByRole("textbox"),{target:{value:"Please review the submitted context."}});fireEvent.click(screen.getByRole("button",{name:en.signupAppeal.submit}));await screen.findByText(en.signupAppeal.submitted);
  expect(screen.queryByRole("textbox")).toBeNull();await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());
});
it.each(["PENDING","ACCEPTED","REJECTED"])("shows %s review evidence read-only without reopening matching",async state=>{
  mocks.query.mockResolvedValue({...initial,canAppeal:false,appeal:{id:"appeal",reason:"Immutable submitted explanation",state,createdAt:new Date()}});render(view());await screen.findByText("Immutable submitted explanation");expect(screen.queryByRole("textbox")).toBeNull();expect(mocks.save).not.toHaveBeenCalled();
});
it("extracts and clears an email fragment, sending proof only through read-only POST inspection",async()=>{
  window.history.replaceState(null,"","/tutee-signup/appeal#token="+token);render(view(""));await screen.findByRole("textbox");expect(window.location.hash).toBe("");expect(mocks.query).toHaveBeenCalledWith({token});expect(window.location.search).toBe("");
});
