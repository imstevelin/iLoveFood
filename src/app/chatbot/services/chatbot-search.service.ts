import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of, from, BehaviorSubject } from 'rxjs';
import { map, switchMap, catchError, tap } from 'rxjs/operators';
import { SevenElevenRequestService } from '../../search-food/new-search/services/seven-eleven-request.service';
import { FamilyMartRequestService } from '../../search-food/new-search/services/family-mart-request.service';
import { GeolocationService } from '../../services/geolocation.service';
import { LocationData, Location } from '../../search-food/model/seven-eleven.model';
import { pinyin } from 'pinyin-pro';

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
  // 原子化工具 1：按關鍵字找門市 (不拉庫存)
  // ============================================================
  findStoresByKeyword(keyword: string): Observable<any[]> {
    return this.ensureReady().pipe(
      map(() => {
        if (!keyword || keyword.trim().length < 1) return [];

        const cleaned = keyword
          .replace(/[有什麼哪些東西商品食物吃的打折嗎呢啊喔？?，,。.！!]/g, '')
          .replace(/請幫|請問|幫我|我想|查|搜尋/g, '')
          .trim();

        if (cleaned.length < 1) return [];

        // 7-11
        const matched711 = this.all711Stores.filter(item => {
          return this.matchesSearchTerm(item.name || '', item.name_pinyin || '', cleaned) ||
                 this.matchesSearchTerm(item.addr || '', item.addr_pinyin || '', cleaned);
        }).slice(0, 10).map(s => ({
          brand: '7-11',
          store_name: `7-11${s.name}門市`,
          store_id: s.serial,
          lat: parseFloat(s.lat) || 0,
          lng: parseFloat(s.lng) || 0,
          address: s.addr || ''
        }));

        // 全家
        const matchedFm = this.allFmStores.filter(item => {
          const name = (item.Name || '').replace('全家', '');
          return this.matchesSearchTerm(name, item.Name_pinyin || '', cleaned) ||
                 this.matchesSearchTerm(item.addr || '', item.addr_pinyin || '', cleaned);
        }).slice(0, 10).map(s => ({
          brand: 'FamilyMart',
          store_name: s.Name || '',
          store_id: s.pkeynew || s.pkey || '',
          lat: parseFloat(s.py_wgs84) || 0,
          lng: parseFloat(s.px_wgs84) || 0,
          address: s.addr || s.address || ''
        }));

        return [...matched711, ...matchedFm];
      })
    );
  }

  // ============================================================
  // 原子化工具 2：查詢該特定門市庫存
  // ============================================================
  queryStoreInventory(brand: string, storeId: string, lat: number, lng: number): Observable<any> {
    if (brand === '7-11') {
      return this.ensure711Token().pipe(
        switchMap(() => this.sevenService.getItemsByStoreNo(storeId, { Latitude: lat, Longitude: lng })),
        map(res => {
          const cats = res?.element?.StoreStockItem?.CategoryStockItems || [];
          const foodInfo = this.formatCategories(cats);
          if (foodInfo.length === 0) return { message: '該門市目前無友善食光庫存' };
          return {
            brand: '7-11',
            foodInfo
          };
        }),
        catchError(() => of({ error: '查詢失敗' }))
      );
    } else if (brand === 'FamilyMart') {
      const pkeys = storeId ? [storeId] : [];
      // 由於本地 family_mart_stores.json 的 pkeynew (例如大里金瑞店 023987) 可能和 API 實際要的 oldPKey (022391) 脫鉤，
      // 如果帶 pkeynew 去查，回傳會是空的。為了避免這個問題，我們先試著帶 PKey 查，如果是空的，就退回純座標搜尋（跟 Web UI 一致）。
      return this.fmService.getNearByStoreList({ Latitude: lat, Longitude: lng } as Location, pkeys).pipe(
        switchMap((res: any) => {
          if (res?.code === 1 && res.data && res.data.length > 0) {
            return of(res);
          }
          // 退回純座標查詢
          return this.fmService.getNearByStoreList({ Latitude: lat, Longitude: lng } as Location, []);
        }),
        map((res: any) => {
          if (res?.code !== 1 || !res.data || res.data.length === 0) {
            return { message: '該門市目前無友善食光庫存' };
          }
          // 在純座標搜尋的回傳清單中，找出符合原預期門市 (可以用距離最近，或是名稱比對)
          // 這邊簡單點：取第一筆通常是因為座標極近。如果是帶 PKey 成功的也只會有一筆。
          const target = res.data[0];
          const formatted = this.formatFmNearbyResult(target);
          if (!formatted) return { message: '該門市目前無友善食光庫存' };
          return {
            brand: 'FamilyMart',
            foodInfo: formatted.foodInfo
          };
        }),
        catchError(() => of({ error: '查詢失敗' }))
      );
    }
    return of({ error: '不支援的品牌' });
  }

  // ============================================================
  // 拼音校正與模糊比對工具
  // ============================================================
  private pinyinCache = new Map<string, string>();
  convertToPinyin(text: string): string {
    if (!text) return '';
    if (this.pinyinCache.has(text)) return this.pinyinCache.get(text)!;
    try {
      const result = pinyin(text, { toneType: 'none' }) as string;
      const pinyinResult = result.replace(/\s+/g, ' ').trim();
      this.pinyinCache.set(text, pinyinResult);
      return pinyinResult;
    } catch (error) {
      return text;
    }
  }

  matchesSearchTerm(text: string, pinyinText: string, searchTerm: string): boolean {
    if (!searchTerm) return true;
    const lowerSearchTerm = searchTerm.toLowerCase().trim();
    const lowerText = text.toLowerCase();
    const lowerPinyin = pinyinText.toLowerCase();

    if (lowerText.includes(lowerSearchTerm)) return true;
    if (lowerPinyin.includes(lowerSearchTerm)) return true;

    const searchTermPinyin = this.convertToPinyin(searchTerm).toLowerCase();
    if (searchTermPinyin && lowerPinyin.includes(searchTermPinyin)) return true;

    const pinyinNoSpace = lowerPinyin.replace(/\s+/g, '');
    const searchNoSpace = lowerSearchTerm.replace(/\s+/g, '');
    if (pinyinNoSpace.includes(searchNoSpace)) return true;

    return false;
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
              sevenList: this.sevenService.getNearByStoreList(loc711).pipe(catchError(() => of(null))),
              fm: this.fmService.getNearByStoreList(locFm).pipe(catchError(() => of(null)))
            }).pipe(
              switchMap(({ sevenList, fm }) => {
                const fmStores: any[] = [];
                if (fm?.code === 1 && fm.data) {
                  fm.data.slice(0, maxStores).forEach((s: any) => {
                    const formatted = this.formatFmNearbyResult(s);
                    if (formatted) fmStores.push(formatted);
                  });
                }

                const sevenRequests: Observable<any>[] = [];
                if (sevenList?.element?.StoreStockItemList) {
                  const toQuery = sevenList.element.StoreStockItemList
                    .filter((s: any) => s.RemainingQty > 0)
                    .slice(0, maxStores);
                  
                  toQuery.forEach((s: any) => {
                    sevenRequests.push(
                      this.sevenService.getItemsByStoreNo(s.StoreNo, { Latitude: lat, Longitude: lng }).pipe(
                        map(detailRes => {
                          const cats = detailRes?.element?.StoreStockItem?.CategoryStockItems || [];
                          return {
                            storeName: `7-11${s.StoreName}門市`,
                            distance: s.Distance,
                            label: '7-11',
                            foodInfo: this.formatCategories(cats)
                          };
                        }),
                        catchError(() => of(null))
                      )
                    );
                  });
                }

                if (sevenRequests.length === 0) {
                  return of(fmStores);
                }

                return forkJoin(sevenRequests).pipe(
                  map((sevenStores) => {
                    const validSeven = sevenStores.filter(s => s !== null && s.foodInfo && s.foodInfo.length > 0);
                    const stores = [...validSeven, ...fmStores];
                    stores.sort((a, b) => (a.distance || 0) - (b.distance || 0));
                    return stores;
                  })
                );
              })
            );
          })
        );
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
      .map((cat: any) => {
        let itemsList = (cat.categories || []).reduce((acc: string[], subcat: any) => {
          return acc.concat((subcat.products || []).map((p: any) => p.name || ''));
        }, []);

        // API 經常在某些分類（如蔬果）只給 qty 但不給明細陣列，我們必須給個預設名稱否則會被過濾
        if (itemsList.length === 0) {
          itemsList = [`相關品項共 ${cat.qty} 個 (門市未提供明細)`];
        }

        return {
          category: cat.name || '其他',
          remainingQty: cat.qty || 0,
          items: itemsList
        };
      });
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
