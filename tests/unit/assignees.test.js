import {
  assigneeIds,
  canEditAssigned,
  canManageAssigned,
  userIdOf,
} from '../../src/util/assignees';

const team = { team: ['users/pm@x.fi', { id: 'pc@x.fi' }, 'users/norole@x.fi'] };
const open = { name: 'Open' };
const assigned = { name: 'Assigned', assignees: [{ id: 'pc@x.fi' }] };

const check = (fn, record, userId, role = null, isAdmin = false) =>
  fn({ record, parent: team, userId, isAdmin, role });

describe('assignees and roles', () => {
  test('ids come from paths, references and documents', () => {
    expect(userIdOf('users/a@x.fi')).toBe('a@x.fi');
    expect(userIdOf({ id: 'b@x.fi', path: 'users/b@x.fi' })).toBe('b@x.fi');
    expect(userIdOf(null)).toBe(null);
    expect(assigneeIds({ assignees: ['users/a@x.fi', { id: 'b@x.fi' }] })).toEqual([
      'a@x.fi',
      'b@x.fi',
    ]);
  });

  test('project managers edit and manage everything in their team', () => {
    expect(check(canEditAssigned, assigned, 'pm@x.fi', 'projectManager')).toBe(true);
    expect(check(canManageAssigned, assigned, 'pm@x.fi', 'projectManager')).toBe(true);
  });

  test('coordinators edit what is theirs or nobody’s, and manage nothing', () => {
    expect(check(canEditAssigned, assigned, 'pc@x.fi', 'projectCoordinator')).toBe(true);
    expect(check(canEditAssigned, open, 'pc@x.fi', 'projectCoordinator')).toBe(true);
    expect(check(canManageAssigned, open, 'pc@x.fi', 'projectCoordinator')).toBe(false);
    const other = { assignees: ['users/pm@x.fi'] };
    expect(check(canEditAssigned, other, 'pc@x.fi', 'projectCoordinator')).toBe(false);
  });

  test('no role or not on the team: read only; admins: everything', () => {
    expect(check(canEditAssigned, open, 'norole@x.fi', null)).toBe(false);
    expect(check(canEditAssigned, open, 'outsider@x.fi', 'projectManager')).toBe(false);
    expect(check(canManageAssigned, assigned, 'outsider@x.fi', null, true)).toBe(true);
    expect(check(canEditAssigned, assigned, 'outsider@x.fi', null, true)).toBe(true);
  });
});
