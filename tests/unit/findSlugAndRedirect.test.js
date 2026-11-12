import { getDoc } from '@/backend/firestore';
import findSlugAndRedirect from '../../src/util/findSlugAndRedirect';

jest.mock('@/backend/firestore', () => ({ getDoc: jest.fn() }), { virtual: true });

const snapshot = (data) => ({ data: () => data });

describe('findSlugAndRedirect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getDoc.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('redirects as soon as the slug exists', async () => {
    getDoc
      .mockResolvedValueOnce(snapshot({ name: 'Finance' }))
      .mockResolvedValueOnce(snapshot({ name: 'Finance', slug: 'finance' }));
    const router = { push: jest.fn() };

    const done = findSlugAndRedirect({ path: 'departments/x' }, router);
    await jest.advanceTimersByTimeAsync(250);
    await done;

    expect(router.push).toHaveBeenCalledWith({
      name: 'ItemHome',
      params: { slug: 'finance' },
    });
    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  test('redirects at once when the slug is already there', async () => {
    getDoc.mockResolvedValue(snapshot({ slug: 'sushibar' }));
    const router = { push: jest.fn() };

    await findSlugAndRedirect({ path: 'products/y' }, router);

    expect(router.push).toHaveBeenCalledWith({
      name: 'ItemHome',
      params: { slug: 'sushibar' },
    });
  });

  test('goes to the front page if no slug appears within 10 seconds', async () => {
    getDoc.mockResolvedValue(snapshot({ name: 'No slug' }));
    const router = { push: jest.fn() };

    const done = findSlugAndRedirect({ path: 'departments/z' }, router);
    await jest.advanceTimersByTimeAsync(10500);
    await done;

    expect(router.push).toHaveBeenCalledWith({ name: 'Home' });
  });
});
