import {expect,it} from 'vitest';
import {auditActors,auditActorLabel} from './audit-actors';
const labels={unnamed:'Unnamed account',former:'Former account'};
it('uses the current profile and actual handle without exposing ID fragments',()=>{
  const [actor]=auditActors([{id:'internal-fake-admin',name:'New Name',username:'admin'}],[{userId:'internal-fake-admin',userName:'Old Name'}]);
  expect(auditActorLabel(actor!,labels)).toBe('New Name · @admin');
  expect(actor?.id).toBe('internal-fake-admin');
});
it('preserves deleted human identities and never falls back to an internal ID',()=>{
  const actors=auditActors([],[{userId:'deleted',userName:'Carol Wang'},{userId:'opaque-token',userName:'opaque-token'},{userId:null,userName:null}]);
  expect(actors.map(a=>auditActorLabel(a,labels))).toEqual(['Unnamed account · Former account','Carol Wang · Former account']);
});
it('disambiguates matching names with handles and avoids repeating a handle-only identity',()=>{
  const rows=auditActors([{id:'1',name:'Alex',username:'achen'},{id:'2',name:'Alex',username:'akim'},{id:'3',name:null,username:'harold'}],[]);
  expect(rows.map(a=>auditActorLabel(a,labels))).toEqual(['Alex · @achen','Alex · @akim','@harold']);
});
