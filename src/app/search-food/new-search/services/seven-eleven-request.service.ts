import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, throwError, defer } from 'rxjs';
import { catchError, filter, take, switchMap, map } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';

import { environment } from 'src/environments/environment';
import { RequestService } from 'src/app/services/request.service';
import { LoadingService } from 'src/app/services/loading.service';
import { LocationData } from '../../model/seven-eleven.model';

@Injectable({
  providedIn: 'root'
})
export class SevenElevenRequestService {

  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);

  constructor(
    private requestService: RequestService,
    private http: HttpClient,
    private loadingService: LoadingService
  ) { }

  baseUrl = environment.sevenElevenUrl.base;

  private getMidV(): string {
    return localStorage.getItem('711_mid_v') || environment.sevenElevenUrl.params.mid_v;
  }

  private fetchNewMidV(): Observable<string> {
    return this.http.post<any>('https://ilovefood-api.imstevelin.com/get_token', {}).pipe(
      map(res => {
        if (res && res.status === 'success' && res.mid_v) {
          return res.mid_v;
        }
        throw new Error('Failed to fetch new mid_v');
      })
    );
  }

  private executeRequest(requestFn: () => Observable<any>): Observable<any> {
    return defer(() => requestFn()).pipe(
      map(res => {
        // 7-11 APIs return data inside the 'element' property and mark 'isSuccess' as true on valid completion.
        // If either element is missing or isSuccess explicitly flags false, it's a logical API failure (usually token expiry).
        if (!res || !res.element || res.isSuccess === false) {
          throw new Error('API response missing element or isSuccess is false, likely token expired');
        }
        return res;
      }),
      catchError((error: any) => {
        return this.handleTokenError(error, requestFn);
      })
    );
  }

  private handleTokenError(error: any, requestFn: () => Observable<any>): Observable<any> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);
      this.loadingService.show("正在獲取7-11查詢憑證...");

      return this.fetchNewMidV().pipe(
        switchMap(newMidV => {
          localStorage.setItem('711_mid_v', newMidV);
          const url = this.baseUrl + environment.sevenElevenUrl.endpoint.accessToken;
          return this.requestService.post(url, { mid_v: newMidV });
        }),
        switchMap((tokenRes: any) => {
          this.isRefreshing = false;
          this.loadingService.hide();
          if (tokenRes && tokenRes.element) {
            sessionStorage.setItem('711Token', tokenRes.element);
            this.refreshTokenSubject.next(tokenRes.element);
            return requestFn();
          } else {
            return throwError(() => new Error('Failed to refresh 711Token'));
          }
        }),
        catchError(refreshErr => {
          this.isRefreshing = false;
          this.loadingService.hide();
          return throwError(() => refreshErr);
        })
      );
    } else {
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(() => requestFn())
      );
    }
  }

  getAccessToken(): Observable<any> {
    return this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.accessToken;
      const params = { mid_v: this.getMidV() };
      return this.requestService.post(url, params);
    });
  }

  getStoreByAddress(keyword: string): Observable<any> {
    return this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.getStoreByAddress;
      const params = {
        'token': sessionStorage.getItem('711Token'),
        'keyword': keyword
      };
      return this.requestService.post(url, params);
    });
  }

  getNearByStoreList(location: LocationData): Observable<any> {
    return this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.getNearbyStoreList;
      const params = {
        'token': sessionStorage.getItem('711Token')
      };
      return this.requestService.post(url, params, location);
    });
  }

  getFoodCategory(): Observable<any> {
    return this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.getList;
      const params = {
        'token': sessionStorage.getItem('711Token')
      };
      return this.requestService.post(url, params);
    });
  }

  getItemsByStoreNo(storeNo: string, currentLocation?: { Latitude: number; Longitude: number }): Observable<any> {
    return this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.getStoreDetail;
      const params = {
        'token': sessionStorage.getItem('711Token'),
      };
      const body = {
        storeNo: storeNo,
        CurrentLocation: currentLocation || {
          Latitude: 25.0375197,
          Longitude: 121.5636704
        }
      };
      return this.requestService.post(url, params, body);
    });
  }

  getFoodDetails(): Observable<any> {
    // 使用本地端資源
    const url = 'assets/seven_eleven_products.json';
    return this.requestService.get(url);
  }

  getStores(): Observable<any> {
    const url = 'assets/seven_eleven_stores.json';
    return this.requestService.get(url);
  }
}
