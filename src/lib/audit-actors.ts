type Account = {id:string;name:string|null;username:string|null};
export type AuditActor = {id:string;label:string|null;username:string|null;former:boolean};
const text = (value:string|null|undefined) => {const trimmed=value?.trim() ?? '';return trimmed.length === 0 ? null : trimmed;};
/** Current account profiles win over historical snapshots. Deleted identities retain their
 * last known human name; internal IDs are filter values and never display fallbacks. */
export function auditActors(users:Account[], history:{userId:string|null;userName:string|null}[]):AuditActor[] {
  const actors=new Map<string,AuditActor>(users.map(u=>[u.id,{id:u.id,label:text(u.name)===u.id?null:text(u.name),username:text(u.username),former:false}]));
  for(const row of history) {
    if(!row.userId || actors.has(row.userId)) continue;
    actors.set(row.userId,{id:row.userId,label:text(row.userName)===row.userId?null:text(row.userName),username:null,former:true});
  }
  return [...actors.values()].sort((a,b)=>(a.label??a.username??'').localeCompare(b.label??b.username??''));
}
export function auditActorLabel(actor:AuditActor, labels:{unnamed:string;former:string}):string {
  const handle=actor.username ? '@'+actor.username.replace(/^@/,'') : null;
  const name=actor.label ?? handle ?? labels.unnamed;
  return [name,handle && handle!==name?handle:null,actor.former?labels.former:null].filter(Boolean).join(' · ');
}
