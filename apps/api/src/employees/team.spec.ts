import { teamRelations } from './team';

const person = (id: string, reportingManagerId: string | null = null) => ({
  id,
  reportingManagerId,
});

//   ceo
//   ├── vp
//   │   ├── me
//   │   │   ├── r1
//   │   │   │   └── r1a
//   │   │   └── r2
//   │   └── peer
//   └── other-vp
//       └── cousin
const org = [
  person('ceo'),
  person('vp', 'ceo'),
  person('me', 'vp'),
  person('peer', 'vp'),
  person('r1', 'me'),
  person('r1a', 'r1'),
  person('r2', 'me'),
  person('other-vp', 'ceo'),
  person('cousin', 'other-vp'),
];

describe('teamRelations', () => {
  it('finds the boss, teammates, and direct and indirect reports — and nobody else', () => {
    const rel = teamRelations(org, 'me');

    expect(Object.fromEntries(rel)).toEqual({
      me: 'SELF',
      vp: 'BOSS',
      peer: 'TEAMMATE',
      r1: 'REPORT',
      r2: 'REPORT',
      r1a: 'REPORT',
    });
  });

  it('only counts the direct manager as the boss, not the whole chain above', () => {
    const rel = teamRelations(org, 'me');

    expect(rel.has('ceo')).toBe(false);
    expect(rel.has('other-vp')).toBe(false);
    expect(rel.has('cousin')).toBe(false);
  });

  it('gives someone with no manager no teammates, only their reports', () => {
    const rel = teamRelations(org, 'ceo');

    expect(rel.get('ceo')).toBe('SELF');
    expect([...rel.values()].includes('BOSS')).toBe(false);
    expect([...rel.values()].includes('TEAMMATE')).toBe(false);
    expect(rel.get('r1a')).toBe('REPORT');
    expect(rel.size).toBe(org.length);
  });

  it('gives a leaf employee a boss and teammates but no reports', () => {
    const rel = teamRelations(org, 'peer');

    expect(Object.fromEntries(rel)).toEqual({ peer: 'SELF', vp: 'BOSS', me: 'TEAMMATE' });
  });

  it('survives a reporting loop without hanging, keeping the boss a boss', () => {
    const loop = [person('a', 'c'), person('b', 'a'), person('c', 'b')];

    const rel = teamRelations(loop, 'a');

    expect(rel.get('a')).toBe('SELF');
    expect(rel.get('c')).toBe('BOSS');
    expect(rel.get('b')).toBe('REPORT');
  });

  it('returns only the employee themself when their id is not in the list', () => {
    expect(Object.fromEntries(teamRelations(org, 'ghost'))).toEqual({ ghost: 'SELF' });
  });

  it('ignores a manager id that points at nobody', () => {
    const rel = teamRelations([person('me', 'missing'), person('x', 'missing')], 'me');

    expect(Object.fromEntries(rel)).toEqual({ me: 'SELF' });
  });
});
