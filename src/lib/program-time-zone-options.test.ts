import {expect,it,vi} from 'vitest';
import {programTimeZoneOptions} from './program-time-zone-options';
it('lists valid zones without duplicates and retains UTC and a saved alias',()=>{
  const values=programTimeZoneOptions('Asia/Calcutta');
  expect(values).toContain('UTC');
  expect(values).toContain('Asia/Calcutta');
  expect(values).toContain('Asia/Shanghai');
  expect(new Set(values).size).toBe(values.length);
  expect(programTimeZoneOptions('Invalid/Zone')).not.toContain('Invalid/Zone');
});
it('keeps usable choices if the host cannot enumerate timezones',()=>{
  const spy=vi.spyOn(Intl,'supportedValuesOf').mockImplementation(()=>{throw Error('unsupported')});
  try {expect(programTimeZoneOptions('Europe/Berlin')).toEqual(expect.arrayContaining(['UTC','Europe/Berlin','Asia/Shanghai']));}
  finally {spy.mockRestore();}
});
