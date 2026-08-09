import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { RequestService } from 'src/app/services/request.service';
import { LocationData } from '../../model/seven-eleven.model';

@Injectable({ providedIn: 'root' })
export class SevenElevenRequestService {
  private readonly gatewayBaseUrl = '/api/7eleven';

  constructor(
    private requestService: RequestService,
    private http: HttpClient
  ) {}

  /**
   * 保留原介面供既有搜尋流程等待；憑證只存在 Worker，瀏覽器不再取得 access token。
   */
  ensureGatewayReady(_forceRefresh = false): Observable<{ isSuccess: true; element: 'worker-managed' }> {
    return of({ isSuccess: true, element: 'worker-managed' });
  }

  getStoreByAddress(keyword: string): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/stores/search`, { keyword }).pipe(timeout(10_000));
  }

  getNearByStoreList(location: LocationData): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/stores/nearby`, location).pipe(timeout(10_000));
  }

  getFoodCategory(): Observable<any> {
    return this.http.get(`${this.gatewayBaseUrl}/categories`).pipe(timeout(10_000));
  }

  getItemsByStoreNo(
    storeNo: string,
    currentLocation?: { Latitude: number; Longitude: number }
  ): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/stores/${encodeURIComponent(storeNo)}/inventory`, {
      CurrentLocation: currentLocation || {
        Latitude: 25.0375197,
        Longitude: 121.5636704
      }
    }).pipe(timeout(10_000));
  }

  getFoodDetails(): Observable<any> {
    return this.requestService.get('assets/seven_eleven_products.json');
  }

  getStores(): Observable<any> {
    return this.requestService.get('assets/seven_eleven_stores.json');
  }
}
