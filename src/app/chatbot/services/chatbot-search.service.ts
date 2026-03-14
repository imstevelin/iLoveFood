import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of, from, BehaviorSubject } from 'rxjs';
import { map, switchMap, catchError, tap } from 'rxjs/operators';
import { SevenElevenRequestService } from '../../search-food/new-search/services/seven-eleven-request.service';
import { FamilyMartRequestService } from '../../search-food/new-search/services/family-mart-request.service';
import { GeolocationService } from '../../services/geolocation.service';
import { LocationData, Location } from '../../search-food/model/seven-eleven.model';

/**
 * ChatbotSearchService — 聊天機器人的搜尋引擎
 *
 * 職責：
 * 1. 獨立載入全台便利商店資料（不依賴主頁面）
 * 2. 提供三種搜尋能力：按店名、按地區、按附近
 * 3. 自動取得 7-11 API token
 * 4. 回傳格式化的搜尋結果
 */
@Injectable({
  providedIn: 'root'
})
export class ChatbotSearchService {

  // 全台門市資料
  private all711Stores: any[] = [];
  private allFmStores: any[] = [];
  private dataReady$ = new BehaviorSubject<boolean>(false);

  // 7-11 分類名稱對照
  private categoryMap = new Map<string, number[]>([
    ['便當粥品', [137, 139, 140, 142, 143, 185, 187, 192]],
    ['麵食', [144, 146, 149, 151, 153, 155]],
    ['生鮮蔬果', [157, 158]],
    ['沙拉', [160, 159, 189]],
    ['配菜湯品', [161, 162]],
    ['飯糰手卷', [163, 164, 165, 166, 167]],
    ['麵包蛋糕', [168, 169, 170, 171]],
    ['三明治堡類', [172, 178, 174, 175, 176, 177, 190, 191]],
    ['甜點', [179, 180, 181, 182, 183]]
  ]);

  constructor(
    private http: HttpClient,
    private sevenService: SevenElevenRequestService,
    private fmService: FamilyMartRequestService,
    private geoService: GeolocationService
  ) {
    this.loadAllStores();
  }

  // ============================================================
  // 資料載入
  // ============================================================
  private loadAllStores(): void {
    const url711 = 'https://alan-cheng.github.io/Friendly-Cat/assets/seven_eleven_stores.json';
    const urlFm = 'https://alan-cheng.github.io/Friendly-Cat/assets/family_mart_stores.json';

    forkJoin({
      seven: this.http.get<any[]>(url711).pipe(catchError(() => of([]))),
      fm: this.http.get<any[]>(urlFm).pipe(catchError(() => of([])))
    }).subscribe(({ seven, fm }) => {
      this.all711Stores = seven || [];
      this.allFmStores = fm || [];
      this.dataReady$.next(true);
      console.log(`[ChatbotSearch] 資料載入完成: 7-11=${this.all711Stores.length}, 全家=${this.allFmStores.length}`);
    });
  }

  isReady(): boolean {
    return this.dataReady$.value;
  }

  onReady(): Observable<boolean> {
    return this.dataReady$.asObservable();
  }

  // ============================================================
  // 搜尋：按店名
  // ============================================================
  searchByStoreName(query: string): Observable<any[]> {
    return this.ensureReady().pipe(
      switchMap(() => {
        // 清理查詢詞
        const cleaned = query
          .replace(/[有什麼哪些東西商品食物吃的打折嗎呢啊喔？?，,。.！!]/g, '')
          .replace(/7-?11|七十一|統一超商|全家/gi, '')
          .replace(/門市|分店|店家|店|便利商店/g, '')
          .replace(/我在|我想|請問|幫我|查|搜尋/g, '')
          .trim();

        if (cleaned.length < 2) return of([]);

        // 在 7-11 中搜尋
        const matched711 = this.all711Stores.filter(s => {
          const name = s.name || '';
          return name.includes(cleaned) || cleaned.includes(name);
        });

        // 在全家中搜尋
        const matchedFm = this.allFmStores.filter(s => {
          const name = (s.Name || '').replace(/全家/g, '').replace(/店$/g, '').trim();
          return name.length >= 2 && (name.includes(cleaned) || cleaned.includes(name));
        });

        if (matched711.length === 0 && matchedFm.length === 0) return of([]);

        // 取第一個匹配的門市，查詢商品明細
        const requests: Observable<any>[] = [];

        if (matched711.length > 0) {
          const store = matched711[0];
          requests.push(
            this.ensure711Token().pipe(
              switchMap(() => this.sevenService.getItemsByStoreNo(store.serial)),
              map(res => this.format711StoreResult(store, res)),
              catchError(() => of(null))
            )
          );
        }

        if (matchedFm.length > 0) {
          const store = matchedFm[0];
          const lat = parseFloat(store.py_wgs84) || 0;
          const lng = parseFloat(store.px_wgs84) || 0;
          if (lat && lng) {
            requests.push(
              this.fmService.getNearByStoreList({ Latitude: lat, Longitude: lng } as Location).pipe(
                map(res => this.formatFmStoreResult(store, res)),
                catchError(() => of(null))
              )
            );
          }
        }

        return forkJoin(requests).pipe(
          map(results => results.filter(r => r !== null))
        );
      })
    );
  }

  // ============================================================
  // 搜尋：按地區
  // ============================================================
  searchByArea(area: string, maxStores: number = 5): Observable<any[]> {
    return this.ensureReady().pipe(
      switchMap(() => {
        // 找出地址含有該地區的門市
        const stores711 = this.all711Stores
          .filter(s => (s.addr || '').includes(area))
          .slice(0, maxStores);

        const storesFm = this.allFmStores
          .filter(s => (s.addr || '').includes(area) || (s.Name || '').includes(area))
          .slice(0, maxStores);

        if (stores711.length === 0 && storesFm.length === 0) return of([]);

        const requests: Observable<any>[] = [];

        // 7-11 門市：每間都查商品明細
        if (stores711.length > 0) {
          const sevenReqs = this.ensure711Token().pipe(
            switchMap(() => {
              return forkJoin(
                stores711.map(store =>
                  this.sevenService.getItemsByStoreNo(store.serial).pipe(
                    map(res => this.format711StoreResult(store, res)),
                    catchError(() => of(null))
                  )
                )
              );
            })
          );
          requests.push(sevenReqs.pipe(map(arr => arr.filter((x: any) => x !== null))));
        }

        // 全家門市：用第一間的座標查附近（API 會回傳附近多間）
        if (storesFm.length > 0) {
          const firstFm = storesFm[0];
          const lat = parseFloat(firstFm.py_wgs84) || 0;
          const lng = parseFloat(firstFm.px_wgs84) || 0;
          if (lat && lng) {
            requests.push(
              this.fmService.getNearByStoreList({ Latitude: lat, Longitude: lng } as Location).pipe(
                map((res: any) => {
                  if (res?.code === 1 && res.data) {
                    // 只保留地址包含目標地區的門市
                    return res.data
                      .filter((s: any) => (s.addr || s.address || '').includes(area) || (s.name || '').includes(area))
                      .slice(0, maxStores)
                      .map((s: any) => this.formatFmNearbyResult(s))
                      .filter((r: any) => r !== null);
                  }
                  return [];
                }),
                catchError(() => of([]))
              )
            );
          }
        }

        return forkJoin(requests).pipe(
          map(arrays => arrays.flat().filter((x: any) => x !== null))
        );
      })
    );
  }

  // ============================================================
  // 搜尋：附近門市
  // ============================================================
  searchNearby(maxStores: number = 5): Observable<any[]> {
    return from(this.geoService.getCurrentPosition()).pipe(
      switchMap(position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        return this.ensure711Token().pipe(
          switchMap(() => {
            const loc711: LocationData = {
              CurrentLocation: { Latitude: lat, Longitude: lng },
              SearchLocation: { Latitude: lat, Longitude: lng }
            };
            const locFm: Location = { Latitude: lat, Longitude: lng };

            return forkJoin({
              seven: this.sevenService.getNearByStoreList(loc711).pipe(catchError(() => of(null))),
              fm: this.fmService.getNearByStoreList(locFm).pipe(catchError(() => of(null)))
            });
          })
        );
      }),
      map(result => {
        const stores: any[] = [];
        if (result.seven?.element?.StoreStockItemList) {
          result.seven.element.StoreStockItemList
            .filter((s: any) => s.RemainingQty > 0)
            .slice(0, maxStores)
            .forEach((s: any) => {
              stores.push({
                storeName: `7-11${s.StoreName}門市`,
                distance: s.Distance,
                label: '7-11',
                foodInfo: this.formatCategories(s.CategoryStockItems || [])
              });
            });
        }
        if (result.fm?.code === 1 && result.fm.data) {
          result.fm.data.slice(0, maxStores).forEach((s: any) => {
            const formatted = this.formatFmNearbyResult(s);
            if (formatted) stores.push(formatted);
          });
        }
        stores.sort((a, b) => (a.distance || 0) - (b.distance || 0));
        return stores;
      }),
      catchError(() => of([]))
    );
  }

  // ============================================================
  // 格式化工具
  // ============================================================
  private format711StoreResult(store: any, apiRes: any): any | null {
    try {
      const cats = apiRes?.element?.StoreStockItem?.CategoryStockItems || [];
      const foodInfo = this.formatCategories(cats);
      if (foodInfo.length === 0) return null;
      return {
        storeName: `7-11${store.name}門市`,
        address: store.addr,
        distance: 0,
        label: '7-11',
        foodInfo
      };
    } catch {
      return null;
    }
  }

  private formatFmStoreResult(store: any, apiRes: any): any | null {
    if (apiRes?.code !== 1 || !apiRes.data) return null;
    const target = apiRes.data.find((s: any) => s.name === store.Name) || apiRes.data[0];
    return target ? this.formatFmNearbyResult(target) : null;
  }

  private formatFmNearbyResult(store: any): any | null {
    const info = store.info || [];
    if (!Array.isArray(info) || info.length === 0) return null;
    const foodInfo = info
      .filter((cat: any) => (cat.qty || 0) > 0)
      .map((cat: any) => ({
        category: cat.name || '其他',
        remainingQty: cat.qty || 0,
        items: (cat.items || []).map((item: any) =>
          typeof item === 'string' ? item : (item.title || item.name || ''))
      }))
      .filter((c: any) => c.items.length > 0);
    if (foodInfo.length === 0) return null;
    return {
      storeName: store.name || '全家',
      address: store.addr || store.address || '',
      distance: store.distance || 0,
      label: '全家',
      foodInfo
    };
  }

  private formatCategories(cats: any[]): any[] {
    return cats
      .filter((c: any) => c.RemainingQty > 0)
      .map((c: any) => ({
        category: this.getCategoryName(c.NodeID),
        remainingQty: c.RemainingQty,
        items: (c.ItemList || []).map((item: any) => item.ItemName || item.Name || '')
      }))
      .filter((c: any) => c.items.length > 0);
  }

  private getCategoryName(nodeID: number): string {
    for (const [name, ids] of this.categoryMap.entries()) {
      if (ids.includes(nodeID)) return name;
    }
    return '其他';
  }

  private ensure711Token(): Observable<any> {
    if (sessionStorage.getItem('711Token')) return of(null);
    return this.sevenService.getAccessToken().pipe(
      tap((t: any) => { if (t?.element) sessionStorage.setItem('711Token', t.element); }),
      catchError(() => of(null))
    );
  }

  private ensureReady(): Observable<boolean> {
    if (this.dataReady$.value) return of(true);
    return this.dataReady$.pipe(
      switchMap(ready => ready ? of(true) : this.dataReady$)
    );
  }
}
