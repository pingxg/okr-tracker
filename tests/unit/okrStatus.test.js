import {
  autoStatus,
  keyResultStatus,
  measurementUpdateDays,
  periodRunning,
  timeElapsed,
  updateDue,
} from '../../common/okr/status';

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-01-11T00:00:00Z');
const half = new Date('2026-01-06T00:00:00Z');

describe('status from progress against time', () => {
  test('time elapsed', () => {
    expect(timeElapsed(start, end, half)).toBeCloseTo(0.5);
    expect(timeElapsed(start, end, new Date('2025-12-01'))).toBe(0);
    expect(timeElapsed(start, end, new Date('2026-02-01'))).toBe(1);
  });

  test('on track, at risk, behind', () => {
    expect(autoStatus(0.45, start, end, half)).toBe('onTrack'); // 5 points behind
    expect(autoStatus(0.35, start, end, half)).toBe('atRisk'); // 15 behind
    expect(autoStatus(0.2, start, end, half)).toBe('behind'); // 30 behind
    expect(autoStatus(1, start, end, half)).toBe('onTrack'); // done
    expect(autoStatus(0, start, end, new Date('2025-12-01'))).toBe('onTrack'); // not started
  });

  test('a status set by hand wins, with its reason', () => {
    const kr = { progression: 0.9, status: 'behind', statusNote: 'supplier' };
    expect(keyResultStatus(kr, start, end, half)).toEqual({
      status: 'behind',
      auto: 'onTrack',
      manual: 'behind',
      note: 'supplier',
    });
    expect(keyResultStatus({ progression: 0.9, status: '' }, start, end, half).manual).toBe(
      null
    );
  });
});

describe('updates due', () => {
  const now = new Date('2026-01-20T00:00:00Z');

  test('after the interval without a value', () => {
    expect(updateDue({ lastUpdate: '2026-01-15', days: 7 }, now).due).toBe(false);
    expect(updateDue({ lastUpdate: '2026-01-10', days: 7 }, now).due).toBe(true);
    expect(updateDue({ lastUpdate: null, since: '2026-01-18', days: 7 }, now).due).toBe(
      false
    );
    expect(updateDue({ lastUpdate: null, since: '2026-01-01', days: 7 }, now).due).toBe(
      true
    );
    expect(updateDue({ lastUpdate: null, since: null, days: null }, now).due).toBe(false);
  });

  test('measurements follow their update frequency', () => {
    expect(measurementUpdateDays({ updateFrequency: 'daily' })).toBe(1);
    expect(measurementUpdateDays({ updateFrequency: 'monthly' })).toBe(31);
    expect(measurementUpdateDays({ updateFrequency: 'irregular' })).toBe(null);
  });

  test('key results only while their objective runs', () => {
    expect(periodRunning(start, end, half)).toBe(true);
    expect(periodRunning(start, end, new Date('2026-03-01'))).toBe(false);
  });
});
