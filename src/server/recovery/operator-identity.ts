/** Exact current identity authority; permanent retirement never supplies a reader fallback. */
import {operatorAssert} from "./operator-cli";
import {planHash} from "./operator-plan";
import type {OperatorSql} from "./operator-site";
import type {OverlaySnapshot} from "./operator-reconcile";

export const IDENTITY_EVIDENCE_TABLES=["PersonCombineReceipt","PersonPartitionReceipt","PersonHistoryCorrectionReceipt","PersonParticipationTransferReceipt"] as const;
export const IDENTITY_AUTHORITY_TABLES=["RetiredHistoryOwnership","HistoryRowOwnership","ParticipantConsolidation","PairingExecutionSuccessor","SessionPlanExecution","SessionParticipantExecution","SessionResponseExecution","QualificationTransferGrant","StudentRequestExecutionAssignment"] as const;
export const IDENTITY_REFERENCE_TABLES=["Notification","StudentQuarterBlock","Pairing","SessionPlan","SessionPlanParticipant","SessionPlanningResponse","Subject","StudentSurvey"] as const;
const keys:Record<string,string[]>={RetiredHistoryOwnership:["sourceUserId"],HistoryRowOwnership:["entity","recordId"],ParticipantConsolidation:["kind","sourceId"],PairingExecutionSuccessor:["sourcePairingId"],SessionPlanExecution:["planId"],SessionParticipantExecution:["participantId"],SessionResponseExecution:["responseId"],QualificationTransferGrant:["targetTutorId","sourceTutorId","sourceSubjectId","subjectId"],StudentRequestExecutionAssignment:["surveyId","pairingId"]};
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
const rowKey=(table:string,row:Record<string,unknown>)=>planHash((keys[table]??["id"]).map(field=>row[field]));
const rows=(state:OverlaySnapshot,table:string)=>state.tables[table]??[];

export function credentialRetirementOrder(accounts:Record<string,unknown>[]) {
  const users=new Map(accounts.map(row=>[String(row.id),row]));
  const depth=new Map<string,number>();
  for(const account of accounts) {
    let id=String(account.id);const path:string[]=[];const active=new Set<string>();
    while(!depth.has(id)) {
      operatorAssert(!active.has(id),"CYCLIC_CREDENTIAL_RETIREMENT");active.add(id);path.push(id);
      const row=users.get(id);operatorAssert(row,"MISSING_CREDENTIAL_RETIREMENT_TERMINAL");
      if(row.mergedIntoId===null){depth.set(id,0);break;}
      id=String(row.mergedIntoId);
    }
    let value=depth.get(id)??0;
    for(const item of path.reverse()){if(!depth.has(item))depth.set(item,++value);}
  }
  return [...accounts].sort((left,right)=>(depth.get(String(right.id))??0)-(depth.get(String(left.id))??0)||String(left.id).localeCompare(String(right.id)));
}

export function assertIdentityAuthorityClosure(current:OverlaySnapshot,restored:OverlaySnapshot) {
  if(current.identityVersion!==1)return;
  operatorAssert(restored.identityVersion===1,"RECOVERY_SCHEMA_MISMATCH");
  const currentUsers=new Map(current.accounts.map(row=>[String(row.id),row]));
  const allUsers=new Set([...current.accounts,...restored.accounts].map(row=>String(row.id)));
  const ids=(entity:string)=>entity==="User"?allUsers:new Set([...(restored.tables[entity]??[]).map(row=>String(row.id)),...(["Person","EmailDelivery"].includes(entity)?rows(current,entity).map(row=>String(row.id)):[]),...(restored.referenceIdentities[entity]??[]),...(entity==="StudentQuarterBlock"?rows(current,entity).map(row=>String(row.id)):[])]);
  const requireRef=(entity:string,id:unknown)=>operatorAssert(typeof id==="string"&&ids(entity).has(id),"IDENTITY_AUTHORITY_CLOSURE_MISSING");
  const reader=(id:unknown)=>{if(id===null)return;const user=currentUsers.get(String(id));operatorAssert(user&&!user.mergedIntoId&&!user.recoveryVoidedAt,"IDENTITY_READER_NOT_CURRENTLY_AUTHORIZED");};
  credentialRetirementOrder(current.accounts);
  for(const row of rows(current,"RetiredHistoryOwnership")) {
    const original=currentUsers.get(String(row.sourceUserId));operatorAssert(original?.mergedIntoId,"HISTORY_SOURCE_NOT_PERMANENTLY_RETIRED");
    operatorAssert((row.state==="ASSIGNED"&&typeof row.readerUserId==="string")||(row.state==="QUARANTINED"&&row.readerUserId===null),"INVALID_EXPLICIT_HISTORY_STATE");reader(row.readerUserId);
  }
  for(const row of rows(current,"HistoryRowOwnership")) {
    operatorAssert(["Tutor","Tutee","Notification","EmailDelivery","StudentQuarterBlock"].includes(String(row.entity)),"UNKNOWN_PRIVATE_HISTORY_ENTITY");
    requireRef(String(row.entity),row.recordId);reader(row.readerUserId);
    for(const field of ["quarantineUserIds","sourceUserIds"]) {
      operatorAssert(Array.isArray(row[field]),"INVALID_HISTORY_RESTRICTION_PROVENANCE");
      for(const id of row[field] as unknown[])requireRef("User",id);
    }
  }
  for(const row of rows(current,"ParticipantConsolidation")){const entity=row.kind==="TUTOR"?"Tutor":row.kind==="TUTEE"?"Tutee":null;operatorAssert(entity,"UNKNOWN_PARTICIPATION_PROFILE_KIND");requireRef(entity,row.sourceId);requireRef(entity,row.targetId);}
  for(const row of rows(current,"PairingExecutionSuccessor")){requireRef("Pairing",row.sourcePairingId);requireRef("Pairing",row.targetPairingId);}
  for(const row of rows(current,"SessionPlanExecution")) {
    requireRef("SessionPlan",row.planId);requireRef("Tutor",row.tutorId);operatorAssert(Array.isArray(row.assignments),"INVALID_EXECUTION_ASSIGNMENTS");
    for(const assignment of row.assignments as Record<string,unknown>[]) {operatorAssert(assignment&&typeof assignment==="object","INVALID_EXECUTION_ASSIGNMENTS");if(assignment.sourcePairingId!==undefined)requireRef("Pairing",assignment.sourcePairingId);if(assignment.targetPairingId!==undefined)requireRef("Pairing",assignment.targetPairingId);}
  }
  for(const row of rows(current,"SessionParticipantExecution")){requireRef("SessionPlanParticipant",row.participantId);requireRef("Tutee",row.tuteeId);operatorAssert(Array.isArray(row.sourceSurveyIds),"INVALID_EXECUTION_SOURCE_REQUESTS");for(const id of row.sourceSurveyIds as unknown[])requireRef("StudentSurvey",id);}
  for(const row of rows(current,"SessionResponseExecution")){requireRef("SessionPlanningResponse",row.responseId);requireRef("User",row.userId);const kind=row.profileKind==="TUTOR"?"Tutor":row.profileKind==="TUTEE"?"Tutee":null;operatorAssert(kind,"UNKNOWN_PARTICIPATION_PROFILE_KIND");requireRef(kind,row.profileId);}
  for(const row of rows(current,"QualificationTransferGrant")){requireRef("Tutor",row.sourceTutorId);requireRef("Tutor",row.targetTutorId);}
  for(const row of rows(current,"StudentRequestExecutionAssignment")){requireRef("StudentSurvey",row.surveyId);requireRef("Pairing",row.pairingId);requireRef("Tutee",row.tuteeId);requireRef("Tutee",row.sourceTuteeId);}
  for(const table of IDENTITY_EVIDENCE_TABLES)for(const row of rows(current,table)) {
    for(const field of ["personId","newPersonId","destinationPersonId"])if(typeof row[field]==="string")requireRef("Person",row[field]);
    if(typeof row.retainedUserId==="string")requireRef("User",row.retainedUserId);
    if(Array.isArray(row.subjects))for(const subject of row.subjects as Record<string,unknown>[]) {
      if(["Person","User","Tutor","Tutee","Pairing","SessionPlan","SessionPlanParticipant","SessionPlanningResponse","Notification","EmailDelivery","StudentQuarterBlock"].includes(String(subject.entity)))requireRef(String(subject.entity),subject.recordId);
      else operatorAssert(false,"UNKNOWN_IDENTITY_EVIDENCE_SUBJECT");
    }
  }
}

async function upsertVersioned(db:OperatorSql,table:string,source:Record<string,unknown>,known:Record<string,unknown>|undefined) {
  if(!known){const revision=Number(source.revision)+1;operatorAssert(Number.isSafeInteger(revision)&&revision<=2147483647,"RECOVERY_IDENTITY_REVISION_EXHAUSTED");await db.query(`INSERT INTO public.${quote(table)} SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb)`,[JSON.stringify({...source,revision})]);return;}
  const revision=Math.max(Number(source.revision),Number(known.revision))+1;
  operatorAssert(Number.isSafeInteger(revision)&&revision<=2147483647,"RECOVERY_IDENTITY_REVISION_EXHAUSTED");
  const immutable=new Set([...(keys[table]??[]),...(table==="StudentRequestExecutionAssignment"?["sourceTuteeId"]:[])]);
  for(const field of immutable)operatorAssert(source[field]===known[field],"CONTRADICTORY_EXECUTION_SOURCE_KEY");
  const data={...source,revision};
  const fields=Object.keys(data).filter(field=>!immutable.has(field));
  await db.query(`UPDATE public.${quote(table)} t SET ${fields.map(field=>`${quote(field)}=s.${quote(field)}`).join(",")} FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb) s WHERE ${(keys[table]??[]).map(field=>`t.${quote(field)}=s.${quote(field)}`).join(" AND ")}`,[JSON.stringify(data)]);
}

export async function appendIdentityEvidence(db:OperatorSql,current:OverlaySnapshot,restored:OverlaySnapshot) {
  if(current.identityVersion!==1)return;
  for(const table of IDENTITY_EVIDENCE_TABLES) {
    const existing=new Map(rows(restored,table).map(row=>[String(row.id),row]));
    for(const row of rows(current,table)) {
      const old=existing.get(String(row.id));operatorAssert(!old||planHash(old)===planHash(row),"CONTRADICTORY_IMMUTABLE_IDENTITY_RECEIPT");
      if(!old)await db.query(`INSERT INTO public.${quote(table)} SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb)`,[JSON.stringify(row)]);
    }
  }
}

export async function reconcileIdentityAuthority(db:OperatorSql,current:OverlaySnapshot,tables:readonly string[]) {
  if(current.identityVersion!==1)return;
  for(const table of tables) {
    const actual=(await db.query(`SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text LIMIT 10001`)).rows.map(row=>row.row as Record<string,unknown>);
    operatorAssert(actual.length<=10000,"SECURITY_MANIFEST_TOO_LARGE");
    const source=new Map(rows(current,table).map(row=>[rowKey(table,row),row]));
    const existing=new Map(actual.map(row=>[rowKey(table,row),row]));
    for(const row of rows(current,table))await upsertVersioned(db,table,row,existing.get(rowKey(table,row)));
    for(const old of actual)if(!source.has(rowKey(table,old))) {
      if(table==="RetiredHistoryOwnership")await upsertVersioned(db,table,{...old,readerUserId:null,state:"QUARANTINED"},old);
      else if(table==="HistoryRowOwnership")await upsertVersioned(db,table,{...old,readerUserId:null,quarantineUserIds:old.entity==="StudentQuarterBlock"?[...new Set([...(old.quarantineUserIds as string[]),...(typeof old.readerUserId==="string"?[old.readerUserId]:[])])]:old.quarantineUserIds},old);
      else if(table==="ParticipantConsolidation"||table==="QualificationTransferGrant")await upsertVersioned(db,table,{...old,active:false},old);
      else if(table==="StudentRequestExecutionAssignment")await upsertVersioned(db,table,{...old,releasedAt:old.releasedAt??new Date().toISOString()},old);
      else operatorAssert(false,"CURRENT_EXECUTION_AUTHORITY_MISSING");
    }
    const updated=(await db.query(`SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text LIMIT 10001`)).rows.map(row=>row.row as Record<string,unknown>);
    const actualRows=new Map(updated.map(row=>[rowKey(table,row),row]));
    for(const row of rows(current,table)) {
      const applied=actualRows.get(rowKey(table,row));
      operatorAssert(applied&&Number(applied.revision)>Math.max(Number(row.revision),Number(existing.get(rowKey(table,row))?.revision??-1)),"IDENTITY_AUTHORITY_REVISION_NOT_ADVANCED");
      const semantic=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([field])=>!["revision","updatedAt"].includes(field)));
      operatorAssert(planHash(semantic(applied))===planHash(semantic(row)),"IDENTITY_AUTHORITY_SEMANTICS_MISMATCH");
    }
  }
}
