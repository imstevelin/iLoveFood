import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { SevenElevenRequestService } from './seven-eleven-request.service';

describe('SevenElevenRequestService', () => {
  let service: SevenElevenRequestService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(SevenElevenRequestService);
    httpTestingController = TestBed.inject(HttpTestingController);
    sessionStorage.removeItem('711Token');
  });

  afterEach(() => {
    sessionStorage.removeItem('711Token');
    httpTestingController.verify({ ignoreCancelled: true });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reuses the session access token without another network round trip', (done) => {
    sessionStorage.setItem('711Token', 'cached-token');

    service.getAccessToken().subscribe(response => {
      expect(response.element).toBe('cached-token');
      expect(response.fromCache).toBeTrue();
      done();
    });
  });

  it('releases the refresh lock when an outer timeout cancels token refresh', () => {
    const refresh$ = (service as any).handleTokenError(
      new Error('expired token'),
      () => of({ isSuccess: true, element: {} })
    );
    const subscription = refresh$.subscribe({ error: () => undefined });
    const request = httpTestingController.expectOne('https://ilovefood-api.imstevelin.com/get_token');

    expect((service as any).isRefreshing).toBeTrue();
    subscription.unsubscribe();

    expect(request.cancelled).toBeTrue();
    expect((service as any).isRefreshing).toBeFalse();
  });
});
