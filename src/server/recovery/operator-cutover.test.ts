import {describe,expect,it} from "vitest";
import {acceptanceAccountAllowed,assertIsolatedRehearsalIdentity} from "./operator-cutover";
import {databaseIdentity} from "./operator-plan";

describe("isolated operator cutover endpoint gate",()=>{
  it("accepts only explicitly synthetic loopback databases",()=>{
    expect(()=>assertIsolatedRehearsalIdentity(databaseIdentity("postgresql://app:synthetic@127.0.0.1:55432/shbs_recovery_stage_test"))).not.toThrow();
    for(const url of [
      "postgresql://app:synthetic@production.example.test:5432/shbs_recovery_test",
      "postgresql://app:synthetic@127.0.0.1:5432/shbs_program",
      "postgresql://app:synthetic@127.0.0.1:5432/postgres",
    ])expect(()=>assertIsolatedRehearsalIdentity(databaseIdentity(url))).toThrow("CUTOVER_REQUIRES_ISOLATED_TEST_DATABASE");
  });
});

describe("live isolated acceptance restrictions",()=>{
  it("rechecks a newly suspended, retired, voided or credential-challenged identity",()=>{
    const account={role:"ADMIN",suspendedAt:null,mergedIntoId:null,recoveryVoidedAt:null,twoFactorEnabled:false};
    expect(acceptanceAccountAllowed(account)).toBe(true);
    for(const revoked of [{suspendedAt:new Date()},{mergedIntoId:"survivor"},{recoveryVoidedAt:new Date()},{twoFactorEnabled:true}])expect(acceptanceAccountAllowed({...account,...revoked})).toBe(false);
  });
  it("rejects revoked participation while preserving independent management access",()=>{
    const account={role:"TUTOR",tutorStatus:"ACTIVE",tutorAccessRevoked:false,departurePresent:false};
    expect(acceptanceAccountAllowed(account)).toBe(true);
    expect(acceptanceAccountAllowed({...account,tutorAccessRevoked:true})).toBe(false);
    expect(acceptanceAccountAllowed({...account,departurePresent:true})).toBe(false);
    expect(acceptanceAccountAllowed({...account,tutorStatus:"ARCHIVED"})).toBe(false);
    expect(acceptanceAccountAllowed({...account,role:"ADMIN",tutorAccessRevoked:true})).toBe(true);
  });
});
