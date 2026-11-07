import { describe, expect, it } from 'vitest';
import { ancestorsOf, focusState, indexTree, matchesQuery, type OrgNode } from './model';

function person(id: string, reports: OrgNode[] = [], over: Partial<OrgNode> = {}): OrgNode {
  return {
    id,
    employeeCode: id.toUpperCase(),
    firstName: id,
    lastName: 'Test',
    designation: null,
    photoUrl: null,
    phone: null,
    workEmail: null,
    workLocation: null,
    lifecycleState: 'CONFIRMED',
    dateOfJoining: null,
    department: null,
    manager: null,
    directReportCount: reports.length,
    totalReportCount: reports.length,
    directReports: reports,
    ...over,
  };
}

// ceo -> vp -> (a, b); ceo -> cfo
const a = person('a');
const b = person('b');
const vp = person('vp', [a, b]);
const cfo = person('cfo');
const ceo = person('ceo', [vp, cfo]);
const roots = [ceo];
const index = indexTree(roots);

describe('indexTree / ancestorsOf', () => {
  it('indexes every node with its parent and depth', () => {
    expect(index.all.map((n) => n.id)).toEqual(['ceo', 'vp', 'a', 'b', 'cfo']);
    expect(index.parentOf.get('a')).toBe('vp');
    expect(index.parentOf.has('ceo')).toBe(false);
    expect(index.depthOf.get('b')).toBe(2);
  });

  it('lists ancestors top-down, excluding the node itself', () => {
    expect(ancestorsOf(index, 'a').map((n) => n.id)).toEqual(['ceo', 'vp']);
    expect(ancestorsOf(index, 'ceo')).toEqual([]);
  });
});

describe('focusState (phone Focus view)', () => {
  it('null focus = the top level: the roots, no person, no trail', () => {
    const s = focusState(index, roots, null);
    expect(s.node).toBeNull();
    expect(s.parent).toBeNull();
    expect(s.trail).toEqual([]);
    expect(s.items).toBe(roots);
  });

  it('a manager lists their direct reports and links to their own manager', () => {
    const s = focusState(index, roots, 'vp');
    expect(s.node?.id).toBe('vp');
    expect(s.parent?.id).toBe('ceo');
    expect(s.trail.map((n) => n.id)).toEqual(['ceo', 'vp']);
    expect(s.items.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('a root has no parent link', () => {
    const s = focusState(index, roots, 'ceo');
    expect(s.parent).toBeNull();
    expect(s.trail.map((n) => n.id)).toEqual(['ceo']);
  });

  it('a person with no reports has an empty list', () => {
    expect(focusState(index, roots, 'cfo').items).toEqual([]);
  });

  it("falls back to the top level for an id that isn't in the tree", () => {
    const s = focusState(index, roots, 'gone');
    expect(s.node).toBeNull();
    expect(s.items).toBe(roots);
  });

  it("a scoped chart's root keeps a null parent even though its real manager is outside the tree", () => {
    const mine = person('me', [person('r1')], { manager: { id: 'outside', firstName: 'Out', lastName: 'Side' } });
    const scoped = [mine];
    const s = focusState(indexTree(scoped), scoped, 'me');
    expect(s.parent).toBeNull();
  });
});

describe('matchesQuery', () => {
  it('matches name, title, code, email and department, case-insensitively', () => {
    const p = person('x', [], {
      firstName: 'Priya',
      lastName: 'Nair',
      designation: 'Staff Nurse',
      workEmail: 'priya@acme.example',
      department: { id: 'd1', name: 'Clinical Services' },
    });
    for (const q of ['priya', 'NAIR', 'nurse', 'X', 'acme', 'clinical']) expect(matchesQuery(p, q)).toBe(true);
    expect(matchesQuery(p, 'finance')).toBe(false);
  });

  it('an empty query matches nobody', () => {
    expect(matchesQuery(person('x'), '  ')).toBe(false);
  });
});
