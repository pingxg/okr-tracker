import { getDoc } from '@/backend/firestore';

const POLL_INTERVAL_MS = 250;
const MAX_WAIT_MS = 10000;

/**
 * Finds the slug for the provided document and redirects to it.
 * The server sets the slug right after the document is created, so check a
 * few times a second and redirect as soon as it is there, instead of always
 * waiting a fixed delay.
 * @param {FirestoreDocumentReference} reference
 * @param {Router} router
 */
export default async function findSlugAndRedirect(reference, router) {
  const started = Date.now();
  // Polling: each check must finish before the next one starts.
  /* eslint-disable no-await-in-loop */
  while (Date.now() - started < MAX_WAIT_MS) {
    try {
      const slug = (await getDoc(reference)).data()?.slug;
      if (slug) {
        return router.push({ name: 'ItemHome', params: { slug } });
      }
    } catch {
      // Not readable yet; try again.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
  /* eslint-enable no-await-in-loop */
  return router.push({ name: 'Home' });
}
