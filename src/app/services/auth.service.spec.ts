import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: jasmine.SpyObj<HttpClient>;

  beforeEach(() => {
    http = jasmine.createSpyObj('HttpClient', ['get', 'post']);
    http.get.and.returnValue(of({ user: null }));
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(AuthService);
  });

  it('restores the Worker session when created', () => {
    expect(http.get).toHaveBeenCalledWith('/api/auth/session', { withCredentials: true });
  });

  it('publishes the logged-in Worker user', async () => {
    const user = { uid: 'u1', username: 'friendly', displayName: 'friendly' };
    http.post.and.returnValue(of({ user }));

    await service.login('friendly', 'a-safe-password-1');

    expect(await firstValueFrom(service.getUser())).toEqual(user);
  });
});
