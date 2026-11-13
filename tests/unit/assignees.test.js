import {
  assigneeIds,
  canEditAssigned,
  canManageAssigned,
  userIdOf,
} from '../../src/util/assignees';

const team = { team: ['users/member@x.fi', { id: 'assignee@x.fi' }] };
const open = { name: 'Open' };
const assigned = { name: 'Assigned', assignees: [{ id: 'assignee@x.fi' }] };

const check = (fn, record, userId, isAdmin = false) =>
  fn({ record, parent: team, userId, isAdmin });

describe('assignees', () => {
  test('ids come from paths, references and documents', () => {
    expect(userIdOf('users/a@x.fi')).toBe('a@x.fi');
    expect(userIdOf({ id: 'b@x.fi', path: 'users/b@x.fi' })).toBe('b@x.fi');
    expect(userIdOf(null)).toBe(null);
    expect(assigneeIds({ assignees: ['users/a@x.fi', { id: 'b@x.fi' }] })).toEqual([
      'a@x.fi',
      'b@x.fi',
    ]);
  });

  test('nobody assigned: every team member edits and manages', () => {
    expect(check(canEditAssigned, open, 'member@x.fi')).toBe(true);
    expect(check(canManageAssigned, open, 'member@x.fi')).toBe(true);
    expect(check(canEditAssigned, open, 'outsider@x.fi')).toBe(false);
  });

  test('assigned: only assignees edit, nobody but admins manages', () => {
    expect(check(canEditAssigned, assigned, 'assignee@x.fi')).toBe(true);
    expect(check(canEditAssigned, assigned, 'member@x.fi')).toBe(false);
    expect(check(canManageAssigned, assigned, 'assignee@x.fi')).toBe(false);
    expect(check(canManageAssigned, assigned, 'outsider@x.fi', true)).toBe(true);
    expect(check(canEditAssigned, assigned, 'outsider@x.fi', true)).toBe(true);
  });
});
