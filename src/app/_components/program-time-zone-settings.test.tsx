/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import messages from '../../../messages/en.json';
import {TimeZoneEditor} from './program-time-zone-settings';
const mutate=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('~/trpc/react',()=>({api:{useUtils:()=>({}),program:{setTimeZone:{useMutation:()=>({mutate,isPending:false})}}}}));
const wrapper=({children}:{children:React.ReactNode})=><NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
const props={timeZone:'Asia/Shanghai',canEdit:true,timeZoneOptions:['UTC','Asia/Shanghai','America/New_York']};
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('offers only selection, requires confirmation, and clears confirmation when the selection changes',()=>{
  render(<TimeZoneEditor {...props}/>,{wrapper});
  expect(screen.queryByRole('textbox')).toBeNull();
  const select=screen.getByRole('combobox');
  fireEvent.change(select,{target:{value:'America/New_York'}});
  const save=screen.getByRole<HTMLButtonElement>('button',{name:messages.programTimeZone.save});
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  expect(mutate).toHaveBeenCalledWith({timeZone:'America/New_York',expectedTimeZone:'Asia/Shanghai'});
  fireEvent.change(select,{target:{value:'UTC'}});
  expect(save.disabled).toBe(true);
});
it('keeps the dropdown disabled for a coordinator without permission',()=>{
  render(<TimeZoneEditor {...props} canEdit={false}/>,{wrapper});
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true);
  expect(screen.queryByRole('button')).toBeNull();
});
