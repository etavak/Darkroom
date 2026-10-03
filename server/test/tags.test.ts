import { describe, expect, it } from 'vitest';
import { searchTags } from '../src/tags/dictionary.js';

const names = (q: string) => searchTags({ q, familyId: 'illustrious', limit: 5 }).suggestions.map((s) => s.name);

describe('tag autocomplete', () => {
  it('prefix first', () => expect(names('light')[0]).toBe('light_smile'));
  it('then word starts (light → dramatic_lighting)', () => expect(names('light')).toContain('dramatic_lighting'));
  it('aliases (smiling → smile)', () => {
    const r = searchTags({ q: 'smiling', familyId: 'illustrious' }).suggestions;
    expect(r[0]).toMatchObject({ name: 'smile', matchedAlias: 'smiling' });
  });
  it('words in any order', () => expect(names('hair long')).toContain('long_hair'));
  it('typos only when nothing else matches', () => {
    expect(names('sittng')).toEqual(['sitting']);
    expect(names('drmtc')).toContain('drumsticks'); // dramatic_lighting is a fair loose match too
    expect(names('smile')).not.toContain('sitting'); // with a real match, no loose ones
  });
  it('formats with spaces for families that use them', () => {
    const r = searchTags({ q: 'long', familyId: 'anima' }).suggestions;
    expect(r[0]?.displayName).toBe('long hair');
  });
});
