import { describe, expect, it } from 'vitest';
import { sessionSocketUrl } from './useBedsideSession';

const loc = { protocol: 'http:', host: 'h:3001' };
describe('sessionSocketUrl', () => {
  it('has no director flag by default', () => {
    expect(sessionSocketUrl('demo', loc)).toBe('ws://h:3001/ws?session=demo&device=phone');
  });
  it('adds director=1 and the optional key', () => {
    expect(sessionSocketUrl('demo', loc, { director: true })).toBe('ws://h:3001/ws?session=demo&device=phone&director=1');
    expect(sessionSocketUrl('demo', loc, { director: true, key: 'a b' })).toBe('ws://h:3001/ws?session=demo&device=phone&director=1&key=a%20b');
  });
});
