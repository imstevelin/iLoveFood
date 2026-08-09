import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

import { environment } from 'src/environments/environment';

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(environment.firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firestoreDb = getFirestore(firebaseApp);
