/** @vitest-environment jsdom */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import en from '../../../messages/en.json';
import type {RouterOutputs} from '~/trpc/react';
import {TuteeHistoryLinkDialog} from './tutee-history';
import {HistoryClaim} from '../history/claim/history-claim';
const mock=vi.hoisted(()=>({preview:vi.fn(),link:vi.fn(),invite:vi.fn(),claim:vi.fn()}));
vi.mock('./profile-dialog',()=>({ProfileDialog:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>}));
vi.mock('~/trpc/react',()=>({api:{
 useUtils:()=>({tuteeHistory:{preview:{fetch:mock.preview}}}),
 tuteeHistory:{
 candidates:{useQuery:()=>({data:[{id:'account',name:'Alex Verified',email:'alex@example.test'}]})},
 link:{useMutation:()=>({mutate:mock.link})},invite:{useMutation:()=>({mutate:mock.invite})},
 inspectClaim:{useQuery:()=>({data:{name:'Alex Historical',sessions:6}})},
 claim:{useMutation:()=>({mutate:mock.claim})}
 }
}}));
const row={id:'record',englishName:'Alex Historical',updatedAt:new Date('2024-10-01'),user:null,owner:null} as unknown as RouterOutputs['admin']['tutees'][number];
const mount=(head=false)=>render(<NextIntlClientProvider locale="en" messages={en}><TuteeHistoryLinkDialog row={row} isHead={head} onClose={()=>undefined}/></NextIntlClientProvider>);
beforeEach(()=>{
 vi.clearAllMocks();mock.preview.mockResolvedValue({fingerprint:'a'.repeat(64),record:{name:'Alex Historical',sessions:6},account:{name:'Alex Verified',email:'alex@example.test'},conflict:false,currentConflict:false});
});afterEach(cleanup);
async function review(){
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'account'}});
 fireEvent.click(screen.getByRole('button',{name:'Review Link'}));
 await screen.findByRole('checkbox',{name:en.tuteeHistory.confirmIdentity});
}
it('requires a concrete preview, identity acknowledgement and staff evidence, then discards preview on reselection',async()=>{
 mount();
 expect(screen.queryByRole('button',{name:'Confirm Link'})).toBeNull();
 await review();const button=screen.getByRole<HTMLButtonElement>('button',{name:'Confirm Link'});
 expect(button.disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:en.tuteeHistory.confirmIdentity}));expect(button.disabled).toBe(true);
 fireEvent.change(screen.getByRole('textbox',{name:en.tuteeHistory.evidence}),{target:{value:'Checked school archive and verified participant'}});
 fireEvent.click(button);
 expect(mock.link).toHaveBeenCalledWith({tuteeId:'record',userId:'account',fingerprint:'a'.repeat(64),reason:'Checked school archive and verified participant'});
 fireEvent.change(screen.getByRole('combobox'),{target:{value:''}});
 expect(screen.queryByRole('button',{name:'Confirm Link'})).toBeNull();
});
it('blocks an Admin from resolving a retained-owner conflict',async()=>{
 mock.preview.mockResolvedValue({fingerprint:'a'.repeat(64),record:{name:'Alex Historical',sessions:6},account:{name:'Alex Verified'},conflict:true,currentConflict:false});
 mount();fireEvent.change(screen.getByRole('combobox'),{target:{value:'account'}});fireEvent.click(screen.getByRole('button',{name:'Review Link'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe(en.tuteeHistory.HISTORY_HEAD_REQUIRED));
 expect(screen.queryByRole('button',{name:'Confirm Link'})).toBeNull();expect(mock.link).not.toHaveBeenCalled();
});
it('does not claim a historical record on page load or before explicit confirmation',()=>{
 render(<NextIntlClientProvider locale="en" messages={en}><HistoryClaim token={'a'.repeat(64)}/></NextIntlClientProvider>);
 expect(mock.claim).not.toHaveBeenCalled();
 const button=screen.getByRole<HTMLButtonElement>('button',{name:'Link My History'});expect(button.disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:en.tuteeHistory.claimConfirm}));fireEvent.click(button);
 expect(mock.claim).toHaveBeenCalledWith({token:'a'.repeat(64)});
});
