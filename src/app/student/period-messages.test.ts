import { expect, it } from "vitest";
import { semesterWorkflowKeys, tuteePeriodMessages } from "./period-messages";
import en from "../../../messages/en.json";

import zh from "../../../messages/zh.json";

it("preserves the original quarter catalog without copying or modifying it",()=>{
  expect(tuteePeriodMessages(en,true)).toBe(en);
});
it.each([en,zh])("uses all locale-specific semester variants without mutating shared messages",messages=>{
  const before=JSON.stringify(messages);
  const result=tuteePeriodMessages(messages,false);
  expect(result).not.toBe(messages);
  expect(JSON.stringify(messages)).toBe(before);
  expect(result.tuteePortal).toBe(messages.tuteePortal);
  if (typeof result.workflow !== "object") throw new Error("Workflow messages missing");
  for(const key of semesterWorkflowKeys){
    expect(result.workflow[key]).toBe(messages.workflow.semesterCopy[key]);
  }
});
it("respects configured semester overrides and leaves unrelated custom workflow messages intact",()=>{
  const workflow=Object.freeze({noActive:"Custom quarter",unrelated:"Custom support",semesterCopy:Object.freeze({noActive:"Custom semester",unrelated:"Must not override"})});
  const messages=Object.freeze({workflow,other:"Other area"});
  expect(tuteePeriodMessages(messages,false)).toEqual({workflow:{...workflow,noActive:"Custom semester"},other:"Other area"});
  expect(messages.workflow.noActive).toBe("Custom quarter");
});
it("does not substitute malformed or missing semester variants",()=>{
  const missing={workflow:{noActive:"Existing copy"}};
  expect(tuteePeriodMessages(missing,false)).toBe(missing);
  const malformed={workflow:{noActive:"Existing copy",semesterCopy:{noActive:{nested:"Not a message"}}}};
  expect(tuteePeriodMessages(malformed,false)).toEqual(malformed);
});
