import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  ConfirmationResult,
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut
} from 'firebase/auth';
import { firebaseAuth } from './firebase-client';

export interface LocalUser {
  uid: string;
  displayName: string;
  phoneNumber: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<LocalUser | null>(null);
  private confirmationResult: ConfirmationResult | null = null;
  private pendingPhoneNumber = '';
  private recaptchaVerifier: RecaptchaVerifier | null = null;
  private recaptchaSolved = false;

  private readonly auth = firebaseAuth;

  constructor() {
    this.auth.languageCode = 'zh-TW';
    onAuthStateChanged(this.auth, firebaseUser => {
      if (!firebaseUser?.phoneNumber) {
        this.userSubject.next(null);
        return;
      }
      this.userSubject.next(this.toLocalUser(firebaseUser.uid, firebaseUser.phoneNumber));
    });
  }

  // Observable for components to subscribe to
  get user(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  // Same implementation as user but named differently for backward compatibility
  getUser(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  async prepareRecaptcha(
    recaptchaContainerId: string,
    onStateChange?: (solved: boolean) => void
  ): Promise<void> {
    if (this.recaptchaVerifier) return;
    this.recaptchaSolved = false;
    this.recaptchaVerifier = new RecaptchaVerifier(this.auth, recaptchaContainerId, {
      size: 'normal',
      callback: () => {
        this.recaptchaSolved = true;
        onStateChange?.(true);
      },
      'expired-callback': () => {
        this.recaptchaSolved = false;
        onStateChange?.(false);
      }
    });

    try {
      await this.recaptchaVerifier.render();
    } catch (error) {
      this.clearRecaptcha();
      throw error;
    }
  }

  async sendVerificationCode(phone: string, recaptchaContainerId: string): Promise<void> {
    const e164Phone = this.toTaiwanE164(phone);
    await this.prepareRecaptcha(recaptchaContainerId);
    const verifier = this.recaptchaVerifier;
    if (!verifier) throw new Error('安全驗證尚未就緒');
    if (!this.recaptchaSolved) {
      const error = new Error('請先完成機器人驗證') as Error & { code?: string };
      error.code = 'auth/captcha-check-failed';
      throw error;
    }

    try {
      this.confirmationResult = await signInWithPhoneNumber(
        this.auth,
        e164Phone,
        verifier
      );
      this.pendingPhoneNumber = phone;
      this.recaptchaSolved = false;
    } catch (error) {
      this.clearRecaptcha();
      throw error;
    }
  }

  async verifyCode(code: string): Promise<LocalUser> {
    if (!this.confirmationResult) {
      throw new Error('尚未發送簡訊驗證碼');
    }
    const credential = await this.confirmationResult.confirm(code);
    const phoneNumber = credential.user.phoneNumber || this.toTaiwanE164(this.pendingPhoneNumber);
    const user = this.toLocalUser(credential.user.uid, phoneNumber);
    this.userSubject.next(user);
    this.confirmationResult = null;
    this.pendingPhoneNumber = '';
    this.clearRecaptcha();
    return user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.userSubject.next(null);
  }

  // Check if logged in
  isLoggedIn(): Observable<boolean> {
    return this.userSubject.pipe(
      map(user => user !== null)
    );
  }

  resetVerification(): void {
    this.confirmationResult = null;
    this.pendingPhoneNumber = '';
    this.clearRecaptcha();
  }

  private toTaiwanE164(phone: string): string {
    const normalized = phone.replace(/\s+/g, '');
    if (!/^09\d{8}$/.test(normalized)) {
      throw new Error('手機號碼格式不正確');
    }
    return `+886${normalized.slice(1)}`;
  }

  private toLocalUser(uid: string, e164Phone: string): LocalUser {
    const localPhone = e164Phone.startsWith('+886') ? `0${e164Phone.slice(4)}` : e164Phone;
    const maskedPhone = localPhone.replace(/^(09\d{2})\d{4}(\d{2})$/, '$1••••$2');
    return { uid, displayName: maskedPhone, phoneNumber: localPhone };
  }

  private clearRecaptcha(): void {
    this.recaptchaVerifier?.clear();
    this.recaptchaVerifier = null;
    this.recaptchaSolved = false;
  }
}
