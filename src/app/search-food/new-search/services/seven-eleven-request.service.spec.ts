import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { SevenElevenRequestService } from './seven-eleven-request.service';

describe('SevenElevenRequestService', () => {
  let service: SevenElevenRequestService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(SevenElevenRequestService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('never retrieves an access token in the browser', done => {
    service.ensureGatewayReady().subscribe(response => {
      expect(response.element).toBe('worker-managed');
      http.expectNone(request => request.url.includes('AccessToken') || request.url.includes('get_token'));
      done();
    });
  });

  it('sends nearby searches to the protected gateway without a token', () => {
    const location = {
      CurrentLocation: { Latitude: 25.03, Longitude: 121.56 },
      SearchLocation: { Latitude: 25.03, Longitude: 121.56 }
    };
    service.getNearByStoreList(location).subscribe();
    const request = http.expectOne('/api/7eleven/stores/nearby');
    expect(request.request.body).toEqual(location);
    expect(request.request.urlWithParams).not.toContain('token=');
    request.flush({ isSuccess: true, element: { StoreStockItemList: [] } });
  });
});
