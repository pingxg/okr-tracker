import { displayOrder, jobPositions, positionGroup } from '../../src/config/jobPositions';

describe('positionGroup', () => {
  test('new roles have their own group', () => {
    expect(positionGroup('projectManager')).toBe('projectManager');
    expect(positionGroup('projectCoordinator')).toBe('projectCoordinator');
    expect(positionGroup('specialist')).toBe('specialist');
    expect(positionGroup('administration')).toBe('administration');
  });

  test('roles saved from the original list still land in a shown group', () => {
    expect(positionGroup('hr')).toBe('administration');
    expect(positionGroup('frontendDeveloper')).toBe('others');
    expect(positionGroup('businessAnalyst')).toBe('others');
    expect(positionGroup(undefined)).toBe('others');
    expect(positionGroup('other')).toBe('others');
  });

  test('every role maps to a group that the About page shows', () => {
    [...jobPositions, 'hr', 'legalAdvisor', undefined].forEach((position) => {
      expect(displayOrder).toContain(positionGroup(position));
    });
  });
});
