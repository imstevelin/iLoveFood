#!/usr/bin/env node

import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';

const options = Object.fromEntries(
  process.argv.slice(2).map(argument => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.length ? value.join('=') : true];
  })
);

const isSingleMigration = /^09\d{8}$/.test(String(options.phone || '')) && options.uid;
if (!options.all && !isSingleMigration) {
  console.error('用法：npm run migrate:favorites -- --all [--project=PROJECT_ID] [--service-account=FILE] [--delete-source]');
  console.error('或：npm run migrate:favorites -- --phone=0912345678 --uid=FIREBASE_UID [其他選項]');
  process.exit(1);
}

const credential = options['service-account']
  ? cert(JSON.parse(await readFile(options['service-account'], 'utf8')))
  : applicationDefault();

initializeApp({ credential, projectId: options.project });
const firestore = getFirestore();

async function migrateFavorites(phone, uid) {
  const source = firestore.collection('users').doc(phone).collection('favorites');
  const destination = firestore.collection('users').doc(uid).collection('favorites');
  const snapshot = await source.get();
  if (snapshot.empty) return 0;

  let batch = firestore.batch();
  let operationCount = 0;
  for (const favorite of snapshot.docs) {
    const data = favorite.data();
    const destinationId = encodeURIComponent(data.storeName || favorite.id);
    batch.set(destination.doc(destinationId), data, { merge: true });
    operationCount += 1;
    if (options['delete-source']) {
      batch.delete(favorite.ref);
      operationCount += 1;
    }
    if (operationCount >= 450) {
      await batch.commit();
      batch = firestore.batch();
      operationCount = 0;
    }
  }
  if (operationCount) await batch.commit();
  return snapshot.size;
}

function toTaiwanPhone(e164Phone) {
  return /^\+8869\d{8}$/.test(e164Phone || '') ? `0${e164Phone.slice(4)}` : null;
}

let copied = 0;
let migratedUsers = 0;

if (options.all) {
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      const phone = toTaiwanPhone(user.phoneNumber);
      if (!phone) continue;
      const count = await migrateFavorites(phone, user.uid);
      if (count) {
        copied += count;
        migratedUsers += 1;
        console.log(`${phone} → ${user.uid}: ${count} 筆`);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
} else {
  copied = await migrateFavorites(String(options.phone), String(options.uid));
  migratedUsers = copied ? 1 : 0;
}

console.log(
  `完成：${migratedUsers} 位使用者、${copied} 筆收藏${options['delete-source'] ? '；舊手機路徑已刪除' : '；舊手機路徑保留'}`
);
