import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getDatabase, ref, get } from 'firebase/database';

export interface LocalUser {
  uid: string; // The phone number acts as the UID
  displayName: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<LocalUser | null>(null);

  constructor() {
    this.restoreSession();
  }

  // Check localStorage on init
  private restoreSession() {
    const storedPhone = localStorage.getItem('iLoveFood_phone_user');
    if (storedPhone) {
      this.userSubject.next({
        uid: storedPhone,
        displayName: storedPhone
      });
    }
  }

  // Observable for components to subscribe to
  get user(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  // Same implementation as user but named differently for backward compatibility
  getUser(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  // Login simply saves the phone number
  login(phone: string): Promise<LocalUser> {
    return new Promise((resolve) => {
      localStorage.setItem('iLoveFood_phone_user', phone);
      const user = { uid: phone, displayName: phone };
      this.userSubject.next(user);
      resolve(user);
    });
  }

  logout(): void {
    localStorage.removeItem('iLoveFood_phone_user');
    this.userSubject.next(null);
  }

  // Check if logged in
  isLoggedIn(): Observable<boolean> {
    return this.userSubject.pipe(
      map(user => user !== null)
    );
  }

  // Keeping this for backward compatibility if used elsewhere, though currently unused for favorites
  getUserData(uid: string): Promise<any> {
    const db = getDatabase();
    const userRef = ref(db, `users/${uid}`);
    return get(userRef).then((snapshot) => snapshot.val());
  }
}
