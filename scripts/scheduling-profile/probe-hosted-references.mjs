import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { currentCampaign } from "./resume-campaign.mjs";
import { collectInventory, downloadArchives } from "./resume-inventory.mjs";
import { readReceipt } from "./resume-receipt.mjs";
import { selectResumeArtifacts } from "./resume-artifacts.mjs";
import { profileMatrix, loadControlledReferencePaths } from "./aggregate-partitions.mjs";
import { loadContentionReferences, assertContentionReferenceCompatibility, validateFreeContentionReceipt } from "./contention-references.mjs";
const campaign=currentCampaign();
const requiredSlots=profileMatrix().include.filter(s=>["contention-bulk-first","contention-acceptance-first"].includes(s.scenario) ||
 s.scenario==="contention" && s.mode==="latency" && s.partition===0);
assert.equal(requiredSlots.length,3);
const snapshot=await collectInventory(campaign,requiredSlots);
const raw=await mkdtemp(join(process.env.RUNNER_TEMP,"canary-proof-"));
await downloadArchives(snapshot.archives,raw);
const artifacts=[];
for(const a of snapshot.archives)artifacts.push(await readReceipt(join(raw,a.name),a));
const selected=selectResumeArtifacts({campaign,...snapshot,artifacts,requiredSlots});
assert.equal(campaign.campaignAttempt,1);assert.equal(campaign.currentAttempt,2);
const chosen=await mkdtemp(join(process.env.RUNNER_TEMP,"selected-proof-"));
for(const s of selected.selected){
 const dir=join(chosen,s.name);await mkdir(dir);
 for(const name of Object.keys(s.files))await link(join(raw,s.name,name),join(dir,name));
}
const carried=selected.selected.find(s=>s.slot.scenario==="contention-acceptance-first");
const replaced=selected.selected.find(s=>s.slot.scenario==="contention-bulk-first");
const free=selected.selected.find(s=>s.slot.scenario==="contention");
assert.equal(carried.attempt,1);assert.equal(replaced.attempt,2);assert.equal(free.attempt,2);
assert.deepEqual(replaced.history.map(h=>h.outcome),["retryable","success"]);
assert.equal(free.history.length,2);assert.equal(free.history[0].outcome,"not_started");
assert.equal(free.history[1].outcome,"success");
assert.equal(snapshot.audit.carriedExecutions.length,1);
assert.equal(snapshot.audit.carriedExecutions[0].sourceJobId,carried.jobId);
assert.equal(snapshot.audit.carriedExecutions[0].sourceArtifactId,carried.artifactId);
const paths=loadControlledReferencePaths(chosen,new Set(selected.selected.map(s=>s.name)));
const refs=loadContentionReferences(paths,{expectedBaseline:campaign.scenarios.contention.baselineRevision,expectedCandidate:campaign.candidateRevision});
const outcome=selected.selected.find(s=>s.slot.scenario==="contention");
const arms=[];
for(const arm of ["base","head"]){
 const report=JSON.parse(await readFile(join(raw,outcome.name,arm+"-latency.json"),"utf8"));
 assertContentionReferenceCompatibility(report,refs);
 assert.equal(report.receipts.length,4);
 for(const receipt of report.receipts)validateFreeContentionReceipt(report,receipt,refs);
 arms.push({arm,revision:report.revision,runner:report.profileRunner.id,rounds:report.receipts.length,reportSha256:outcome.files[arm+"-latency.json"]});
}
assert.deepEqual(snapshot,await collectInventory(campaign,requiredSlots));
await mkdir("outputs",{recursive:true});
await writeFile("outputs/reference-proof.json",JSON.stringify({status:"HOSTED_PARTIAL_RESUME_AND_MIXED_REFERENCE_VERIFIED",scope:"Two completed controlled diagnostic references and one real paired contention partition. This is a limited infrastructure proof.",campaign,selected,providerAudit:snapshot.audit,arms},null,2)+"\n");
console.log("Verified original references and four paired contention rounds on the hosted worker.");

