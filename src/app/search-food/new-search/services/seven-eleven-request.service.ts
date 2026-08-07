import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, throwError, defer, of } from 'rxjs';
import { catchError, filter, take, switchMap, map, timeout, retry, tap, finalize, shareReplay } from 'rxjs/operators';
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
  private accessTokenRequest$: Observable<any> | null = null;

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
      timeout(30000), // 超時保護
      map(res => {
        if (res && res.status === 'success' && res.mid_v) {
          return res.mid_v;
        }
        throw new Error('Failed to fetch new mid_v');
      }),
      retry(2) // 遇到 504 或網路錯誤自動重試 2 次
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
      this.loadingService.update('正在更新 7-11 憑證', 44, '其餘查詢會繼續進行');

      return this.fetchNewMidV().pipe(
        switchMap(newMidV => {
          localStorage.setItem('711_mid_v', newMidV);
          const url = this.baseUrl + environment.sevenElevenUrl.endpoint.accessToken;
          return this.requestService.post(url, { mid_v: newMidV });
        }),
        switchMap((tokenRes: any) => {
          this.isRefreshing = false;
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
          this.refreshTokenSubject.error(refreshErr); // 解除其他正在等待的請求
          this.refreshTokenSubject = new BehaviorSubject<string | null>(null); // 重置以供下次使用
          return throwError(() => refreshErr);
        }),
        finalize(() => {
          // 上層 timeout 取消訂閱時不會進入 catchError。若不在這裡解鎖，
          // 後續所有 7-11 請求都會永久等待一個已取消的更新流程。
          if (this.isRefreshing) {
            const cancelledRefreshSubject = this.refreshTokenSubject;
            this.isRefreshing = false;
            this.refreshTokenSubject = new BehaviorSubject<string | null>(null);
            cancelledRefreshSubject.error(new Error('7-11 token refresh was cancelled'));
          }
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

  getAccessToken(forceRefresh = false): Observable<any> {
    const cachedToken = sessionStorage.getItem('711Token');
    if (cachedToken && !forceRefresh) {
      return of({ isSuccess: true, element: cachedToken, fromCache: true });
    }

    if (this.accessTokenRequest$ && !forceRefresh) {
      return this.accessTokenRequest$;
    }

    const request$ = this.executeRequest(() => {
      const url = this.baseUrl + environment.sevenElevenUrl.endpoint.accessToken;
      const params = { mid_v: this.getMidV() };
      return this.requestService.post(url, params);
    }).pipe(
      tap((response: any) => {
        if (response?.element) sessionStorage.setItem('711Token', response.element);
      }),
      finalize(() => {
        if (this.accessTokenRequest$ === request$) this.accessTokenRequest$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.accessTokenRequest$ = request$;
    return request$;
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
