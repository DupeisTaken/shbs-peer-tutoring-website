/** @vitest-environment jsdom */
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {AdminMobileNavigation} from './admin-mobile-navigation';
vi.mock('next/navigation',()=>({usePathname:()=>'/admin'}));
beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
  localStorage.clear();
});
afterEach(cleanup);
it('opens an accessible drawer and closes it when navigating to the last item',()=>{
  render(<AdminMobileNavigation sections={[{key:'admin',title:'Administration',items:[{href:'/admin/audit',label:'Audit log'},{href:'/admin/users',label:'Users & roles'}]}]} labels={{title:'Admin navigation',open:'Menu',close:'Close',collapse:'Collapse all',expand:'Expand all'}}/>);
  const button=screen.getByRole('button',{name:'Menu'});
  fireEvent.click(button);
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Admin navigation');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('link',{name:'Users & roles'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(button.getAttribute('aria-expanded')).toBe('false');
});
it('retains the close control while sections collapse and closes explicitly',()=>{
  render(<AdminMobileNavigation sections={[{key:'admin',title:'Administration',items:[{href:'/admin/users',label:'Users & roles'}]}]} labels={{title:'Admin navigation',open:'Menu',close:'Close',collapse:'Collapse all',expand:'Expand all'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Menu'}));
  fireEvent.click(screen.getByRole('button',{name:'Collapse all'}));
  expect(screen.queryByRole('link',{name:'Users & roles'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(screen.queryByRole('dialog')).toBeNull();
});
