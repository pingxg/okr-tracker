/**
 * Stand-in for the `firebase-functions/v1` builder API used by the original
 * Cloud Functions. Instead of deploying to Google, it registers:
 *   - Firestore triggers into the local trigger registry (store/hooks.js)
 *   - HTTPS functions as plain Express apps that the server mounts itself.
 *
 *   functions.runWith(opts).region(r).firestore.document(path).onWrite(fn)
 *   functions.runWith(opts).region(r).https.onRequest(app)
 */
import { registerTrigger } from '../store/hooks.js';

function documentBuilder(pattern) {
  const register = (event) => (handler) => {
    registerTrigger(pattern, event, handler, `${event}:${pattern}`);
    return handler;
  };
  return {
    onCreate: register('create'),
    onUpdate: register('update'),
    onDelete: register('delete'),
    onWrite: register('write'),
  };
}

const builder = {
  runWith() {
    return builder;
  },
  region() {
    return builder;
  },
  firestore: {
    document: documentBuilder,
  },
  https: {
    onRequest: (app) => app,
  },
  pubsub: {
    // Scheduled functions (backups) are replaced by scripts/backup.js.
    schedule: () => ({ onRun: (fn) => fn }),
    topic: () => ({ onPublish: (fn) => fn }),
  },
};

export default builder;
