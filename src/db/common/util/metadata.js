import { doc, serverTimestamp } from '@/backend/firestore';
import { db, auth } from '@/config/backend';

const created = () => ({
  archived: false,
  created: serverTimestamp(),
  createdBy: doc(db, 'users', auth.currentUser.email),
});

const edited = () => ({
  edited: serverTimestamp(),
  editedBy: doc(db, 'users', auth.currentUser.email),
});

export default { created, edited };
