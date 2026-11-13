import {
  displayOrder,
  jobPositions,
  organizationIdOf,
  positionGroup,
  roleIn,
} from '../../src/config/jobPositions';

describe('roles', () => {
  test('only project manager and coordinator can be picked', () => {
    expect(jobPositions).toEqual(['projectManager', 'projectCoordinator']);
  });

  test('roles are per organization', () => {
    const user = { roles: { org1: 'projectManager', org2: 'projectCoordinator' } };
    expect(roleIn(user, 'org1')).toBe('projectManager');
    expect(roleIn(user, 'org2')).toBe('projectCoordinator');
    expect(roleIn(user, 'org3')).toBe(null);
    expect(roleIn({ roles: { org1: 'specialist' } }, 'org1')).toBe(null);
    expect(roleIn({}, 'org1')).toBe(null);
  });

  test('administrators are shown as such, whatever their role', () => {
    expect(
      positionGroup({ admin: ['org1'], roles: { org1: 'projectManager' } }, 'org1')
    ).toBe('admin');
    expect(positionGroup({ superAdmin: true }, 'org1')).toBe('admin');
    expect(positionGroup({ admin: ['org2'] }, 'org1')).toBe('others');
  });

  test('every member lands in a group the About page shows', () => {
    [
      { roles: { org1: 'projectManager' } },
      { roles: { org1: 'projectCoordinator' } },
      { position: 'hr' },
      {},
    ].forEach((user) => {
      expect(displayOrder).toContain(positionGroup(user, 'org1'));
    });
  });

  test('organization of an item', () => {
    expect(organizationIdOf({ id: 'org1' })).toBe('org1');
    expect(organizationIdOf({ id: 'dep1', organization: { id: 'org1' } })).toBe('org1');
    expect(organizationIdOf({ id: 'dep1', organization: 'organizations/org1' })).toBe(
      'org1'
    );
  });
});
