import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

export interface LocalUser {
  uid: string;
  username: string;
  displayName: string;
}

interface AuthResponse {
  user: LocalUser | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSubject = new BehaviorSubject<LocalUser | null>(null);
  private readonly sessionReady: Promise<void>;

  constructor(private http: HttpClient) {
    this.sessionReady = this.restoreSession();
  }

  get user(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  getUser(): Observable<LocalUser | null> {
    return this.userSubject.asObservable();
  }

  async register(username: string, password: string): Promise<LocalUser> {
    await this.sessionReady;
    const response = await firstValueFrom(this.http.post<AuthResponse>(
      '/api/auth/register',
      { username, password },
      { withCredentials: true }
    ));
    if (!response.user) throw new Error('建立帳號失敗');
    this.userSubject.next(response.user);
    return response.user;
  }

  async login(username: string, password: string): Promise<LocalUser> {
    await this.sessionReady;
    const response = await firstValueFrom(this.http.post<AuthResponse>(
      '/api/auth/login',
      { username, password },
      { withCredentials: true }
    ));
    if (!response.user) throw new Error('登入失敗');
    this.userSubject.next(response.user);
    return response.user;
  }

  async logout(): Promise<void> {
    await this.sessionReady;
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}, { withCredentials: true }));
    } catch {
      // 本機狀態仍需立即登出；伺服器工作階段會在期限到達後失效。
    } finally {
      this.userSubject.next(null);
    }
  }

  isLoggedIn(): Observable<boolean> {
    return this.userSubject.pipe(map(user => user !== null));
  }

  private async restoreSession(): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<AuthResponse>(
        '/api/auth/session',
        { withCredentials: true }
      ));
      this.userSubject.next(response.user);
    } catch {
      this.userSubject.next(null);
    }
  }
}
