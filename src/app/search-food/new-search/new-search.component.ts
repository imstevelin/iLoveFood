import { Component, OnInit, OnDestroy, NgZone, ViewChild, ElementRef, HostListener, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormGroup, FormControl } from '@angular/forms';

import { GeolocationService } from 'src/app/services/geolocation.service';
import { SevenElevenRequestService } from './services/seven-eleven-request.service';
import { FamilyMartRequestService } from './services/family-mart-request.service';
import { LoadingService } from '../../services/loading.service'
import { AuthService } from 'src/app/services/auth.service';

import { MessageDialogComponent } from 'src/app/components/message-dialog/message-dialog.component';
import { LoginPageComponent } from 'src/app/components/login-page/login-page.component';
import { RouteModeDialogComponent } from 'src/app/components/route-mode-dialog/route-mode-dialog.component';
import {
  AdvancedSearchDialogComponent,
  AdvancedSearchDialogResult,
  AdvancedSearchOption
} from 'src/app/components/advanced-search-dialog/advanced-search-dialog.component';
import { DiscountTimeDialogComponent } from 'src/app/components/discount-time-dialog/discount-time-dialog.component';
import {
  DiscountTimeStatus,
  getDiscountTimeSnapshot
} from 'src/app/utils/discount-schedule';
import { FoodCategory, LocationData, StoreStockItem, Store, Location, FoodDetail711 } from '../model/seven-eleven.model'
import { fStore, StoreModel, FoodDetailFamilyMart } from '../model/family-mart.model';
import { StoreDataService } from 'src/app/services/stores-data.service';
import { MapViewComponent } from './map-view/map-view.component';

import { environment } from 'src/environments/environment';

import { switchMap, from, of, catchError, Observable, tap, forkJoin, Subject, map, timeout, mergeMap, toArray, Subscription, shareReplay, take } from 'rxjs';

import { MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatDialog } from '@angular/material/dialog';

import { getDistance } from 'geolib';

import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { firestoreDb } from 'src/app/services/firebase-client';
import { pinyin } from 'pinyin-pro';

@Component({
  standalone: false,
  selector: 'app-new-search',
  templateUrl: './new-search.component.html',
  styleUrls: ['./new-search.component.scss']
})
export class NewSearchComponent implements OnInit, OnDestroy {
  user: any = null;
  showMenu: boolean = false;     // 漢堡選單是否展開
  showLabSection: boolean = false; // 實驗室子選單
  isMapView: boolean = false; // 地圖檢視模式
  mapSheetOpen: boolean = false; // 地圖門市卡片是否展開
  isScrolledDown: boolean = false; // 向下滾動狀態 (用於縮小懸浮膠囊)
  private lastScrollY: number = 0; // 上次滾動位置

  // === 效能優化：分類點擊載入追蹤 ===
  setCategoryLoading(store: any, category: any, isLoading: boolean) {
    const catId = category.ID || category.name || category.Name;
    if (isLoading) {
      store.loadingCategoryName = catId;
      store.loadingCompleteCategoryName = null;
    } else {
      if (store.loadingCategoryName === catId) {
        store.loadingCategoryName = null;
        store.loadingCompleteCategoryName = catId;
        // 加速填滿到 100% 後，200毫秒後撤除 class 以啟動退回動畫
        setTimeout(() => {
          if (store.loadingCompleteCategoryName === catId) {
             store.loadingCompleteCategoryName = null;
          }
        }, 200);
      }
    }
  }

  isCategoryLoading(store: any, category: any): boolean {
    const catId = category.ID || category.name || category.Name;
    return store.loadingCategoryName === catId;
  }

  isCategoryLoadingComplete(store: any, category: any): boolean {
    const catId = category.ID || category.name || category.Name;
    return store.loadingCompleteCategoryName === catId;
  }
  chatEnabled: boolean = false;   // AI Chatbot Beta 預設關閉，由使用者自行開啟
  darkModeEnabled: boolean = true; // 跟隨裝置深淺色主題 (預設為開啟)
  private darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  get isDarkSystemTheme(): boolean { return this.darkModeMediaQuery.matches; }
  storesDataReady: boolean = false; // 商店 JSON 資料是否已載入
  showAboutCard: boolean = false; // 關於卡片是否顯示

  // 搜尋模式: 'location' = 定位搜尋, 'store' = 門市搜尋, 'product' = 商品搜尋, 'route' = 導航路線搜尋
  searchMode: 'location' | 'store' | 'product' | 'route' = 'location';
  isLocationSearchMode: boolean = true; // 是否使用定位搜尋

  // === 效能優化 ===
  favoriteStoreNameSet: Set<string> = new Set();  // O(1) 收藏查詢
  private scrollTicking: boolean = false;          // scroll throttle

  searchForm: FormGroup; // 表單
  searchTerm: string = ''; // Keep for tracking native input logic if needed
  searchSelectedStore: any = null;
  selectedStoreName='';

  foodDetails711: FoodDetail711[] = [];
  foodDetailsFamilyMart: FoodDetailFamilyMart[] = [];

  storeFilter: string = 'all';

  dropDown711List: Store[] = [];
  dropDownFamilyMartList: fStore[] = [];
  all711Stores: any[] = []; // 儲存所有 7-11 商店資料（包含拼音）
  storeNoToCoords = new Map<string, { lat: number; lng: number }>(); // 7-11 StoreNo → 座標快速查表
  unifiedDropDownList: any[] = [];

  // 商品搜尋相關
  productSearchKeyword: string = ''; // 目前搜尋的商品關鍵字
  routeProductKeywords: string[] = []; // 導航路線欲過濾的商品名稱
  routeNoResults: boolean = false; // 導航路線搜尋無結果
  keywordMatchMode: 'any' | 'all' = 'any';
  private lastRouteUrl = '';
  private lastRouteMode: 'DRIVING' | 'TWO_WHEELER' = 'TWO_WHEELER';

  productSearchStores: any[] = []; // 商品搜尋結果的門市列表（所有已找到的）
  productSearchIsCategory: boolean = false; // 是否為種類搜尋

  // 無限滾動相關 (嚴格分頁與記憶體緩衝池)
  allNearbyStores: any[] = []; // 所有附近門市（已存入記憶體的緩衝池，不一定全顯）
  storesPerPage: number = 5;   // 每次加載門市數量嚴格限制 5 間
  private targetDisplayCount: number = 0; // 目標顯示的總數量，避免 API 空載時多塞門市
  isLoadingMore: boolean = false; // 是否正在加載更多
  hasMoreStores: boolean = false; // 是否還有更多門市

  // 搜尋中心點：距離計算的基準點
  // 「使用目前位置」/「商品搜尋」時 = 使用者位置
  // 「門市名稱搜尋」時 = 該門市的位置
  searchCenterLat: number = 0;
  searchCenterLng: number = 0;

  // 商品搜尋漸進式載入
  private all711StoresSortedByDist: any[] = [];     // 全部 7-11 門市按距離排序
  private allFmStoresSortedByDist: any[] = [];      // 全部全家門市按距離排序
  private productSearch711BatchIdx: number = 0;     // 7-11 目前批次索引
  private productSearchFmBatchIdx: number = 0;      // 全家目前批次索引
  private productSearchBatchSize: number = 10;      // 首批每家超商各查 10 間，優先快速回覆附近結果
  private readonly maxInitialNoResultCandidates = 20; // 附近一批仍為零結果時就回覆，不掃完整個全台索引
  public isSearchingMore: boolean = false;          // 是否正在擴搜
  private searchExhausted711: boolean = false;       // 7-11 是否已搜完
  private searchExhaustedFm: boolean = false;        // 全家是否已搜完
  private fmQueriedPKeys: Set<string> = new Set();   // 已查詢過的全家門市 PKey（去重用）
  private sevenQueriedStoreNos: Set<string> = new Set(); // 已查詢過的7-11門市 StoreNo（去重用）
  productSearchRunning: boolean = false;             // 是否正在商品搜尋中
  productSearchScanned: number = 0;                  // 已實際檢查的候選門市數
  productSearchTotalCandidates: number = 0;          // 本次可檢查的候選門市總數
  private productSearchGeneration: number = 0;       // 搜尋世代計數器，用於作廢舊搜尋的 setTimeout
  private storeSearchGeneration: number = 0;         // 店名搜尋世代計數器
  locationDenied: boolean = false;                   // 使用者拒絕定位
  locationFallbackUsed: boolean = false;             // 商品搜尋無定位時使用台北市中心
  private minInitialStores: number = 5;             // 初始要求：嚴格 5 間
  private nearbySearchGeneration = 0;
  private searchDataReady$?: Observable<boolean>;

  // 拼音轉換快取：避免重複轉換相同的文字
  private pinyinCache = new Map<string, string>();
  private searchDebounceTimer: any = null; // 自動完成防抖計時器
  private favoritesSubscription: Subscription | null = null; // 收藏清單的訂閱
  private routeSearchSubscription: Subscription | null = null;
  private readonly maxRouteSamplePoints = 40;
  private readonly maxRouteDistanceMeters = 300_000;
  private readonly firestore = firestoreDb;
  private onSystemThemeChange = () => this.applyTheme();
  private discountTimeTimer: number | null = null;

  discountTimeStatuses: DiscountTimeStatus[] = [];
  currentTaipeiTimeLabel: string = '';

  get inactiveDiscountTimeStatuses(): DiscountTimeStatus[] {
    return this.discountTimeStatuses.filter(status => !status.active);
  }

  get isSearchBlockedByDiscountHours(): boolean {
    return this.discountTimeStatuses.length === 2 && this.inactiveDiscountTimeStatuses.length === 2;
  }

  // 搜尋條件；一般搜尋只會有一個，進階搜尋可同時保留多個。
  keywordCtrl = new FormControl('');
  selectedKeywords: any[] = [];
  advancedSearchActive = false;
  isComposing = false; // IME 組字中標記（注音、拼音輸入法）
  @ViewChild('keywordInput') keywordInput!: ElementRef<HTMLInputElement>;
  @ViewChild(MatAutocompleteTrigger) autocompleteTrigger!: MatAutocompleteTrigger;

  get productKeywordCount(): number {
    return this.selectedKeywords.filter(keyword => keyword.type !== 'store' && keyword.type !== 'route').length;
  }

  get mainSearchPlaceholder(): string {
    if (this.isSearchBlockedByDiscountHours) return '目前非優惠時段，暫停查詢';
    return this.advancedSearchActive
      ? `已套用 ${this.selectedKeywords.length} 個進階條件`
      : '搜尋商品、分類或門市';
  }

  get mapStoreCount(): number {
    return (this.searchMode === 'product' ? this.productSearchStores : this.totalStoresShowList).length;
  }

  get productSearchProgressPercent(): number {
    if (this.productSearchTotalCandidates <= 0) return 0;
    const percentage = Math.min(100, Math.round(
      (this.productSearchScanned / this.productSearchTotalCandidates) * 100
    ));
    return this.productSearchScanned > 0 ? Math.max(1, percentage) : 0;
  }

  get resultModeLabel(): string {
    if (this.searchMode === 'route') return '沿路搜尋';
    if (this.selectedKeywords.some(keyword => keyword.type === 'store')) return '指定門市';
    return '商品搜尋';
  }

  get resultScopeText(): string {
    if (this.searchMode === 'route') {
      return this.routeProductKeywords.length > 0 ? this.routeProductKeywords.join('、') : '沿途所有折扣品';
    }
    const names = this.selectedKeywords.map(keyword => keyword.name || keyword).filter(Boolean);
    if (names.length === 0) return '附近折扣品';
    const joiner = this.keywordMatchMode === 'all' && this.productKeywordCount > 1 ? ' ＋ ' : '、';
    return names.join(joiner);
  }

  get emptyResultTitle(): string {
    return this.isStoreLikeSearch
      ? '查無符合的門市或庫存內容'
      : '附近門市目前沒有符合結果';
  }

  get emptyResultDescription(): string {
    return this.isStoreLikeSearch
      ? '已完成目前門市條件的查詢。可以縮短門市名稱、改用地址搜尋，或查看附近全部門市。'
      : '已檢查附近門市，目前沒有符合的商品。可以縮短關鍵字，或在進階搜尋中改用「符合任一條件」。';
  }

  private get isStoreLikeSearch(): boolean {
    if (this.searchMode === 'store' || this.selectedKeywords.some(keyword => keyword.type === 'store')) return true;
    return this.selectedKeywords.some(keyword => {
      const text = String(keyword?.name || keyword || '');
      return /(?:門市|分店|7\s*[-－]?\s*11|7-eleven|全家)/i.test(text);
    });
  }



  sevenElevenIconUrl = environment.sevenElevenUrl.icon;
  familyMartIconUrl = environment.familyMartUrl.icon;

  zipcodes: any[] = []; // 原始 API 資料
  cities: string[] = []; // 縣市清單
  filteredDistricts: any[] = []; // 篩選後的行政區列表
  zipcodeList: string[] = [];

  selectedCity: string | null = null; // 選擇的縣市
  selectedDistrict: string | null = null; // 選擇的行政區
  selectedZipcode: string | null = null; // 對應的郵遞區號

  latitude!: number;
  longitude!: number;

  foodCategories: FoodCategory[] = [];

  nearby711Stores: StoreStockItem[] = []; // 儲存用現在位置找到的711
  nearbyFamilyMartStores: StoreModel[] = []; // 儲存用現在位置找到的全家
  totalStoresShowList: any[] = []; //為了方便顯示所以統一
  filteredStoresList: any[] = [];  // 用來儲存篩選後的商店列表

  selectedStore?: any;
  mapActiveStore: any = null;
  listFocusStore: any = null;
  latestMapStores: any[] = [];
  private savedScrollPosition: number = 0;
  selectedCategory?: any;

  favoriteStores: any[] = [];

  searchInput$ = new Subject<string>();

  @ViewChild('menuPanel') menuPanel!: ElementRef;
  @ViewChild('menuButton') menuButton!: ElementRef;
  @ViewChild(MapViewComponent) mapViewComponent!: MapViewComponent;

  constructor(
    private http: HttpClient,
    private geolocationService: GeolocationService,
    private sevenElevenService: SevenElevenRequestService,
    private familyMartService: FamilyMartRequestService,
    private authService: AuthService,
    public loadingService: LoadingService,
    public dialog: MatDialog,
    private storeDataService: StoreDataService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.searchForm = new FormGroup({
      selectedStoreName: new FormControl(''), // 控制選中的商店
    });
  }

  ngOnInit(): void {
    this.updateDiscountTimeInfo();
    this.ngZone.runOutsideAngular(() => {
      this.discountTimeTimer = window.setInterval(() => {
        this.ngZone.run(() => this.updateDiscountTimeInfo());
      }, 60_000);
    });

    // 移除自動搜尋，改為手動觸發（Enter 或按鈕）
    this.init();
    
    // 效能優化：在 Angular Zone 外部註冊高頻事件，避免滑動時瘋狂觸發 Change Detection 導致 UI 卡死
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('touchmove', this.onWindowTouchMove, { passive: true });
      window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    });
  }

  ngOnDestroy(): void {
    document.documentElement.classList.remove('map-active-lock');
    document.body.classList.remove('map-active-lock');
    if (this.favoritesSubscription) {
      this.favoritesSubscription.unsubscribe();
    }
    this.routeSearchSubscription?.unsubscribe();
    window.removeEventListener('touchmove', this.onWindowTouchMove);
    window.removeEventListener('scroll', this.onWindowScroll);
    this.darkModeMediaQuery.removeEventListener('change', this.onSystemThemeChange);
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    if (this.discountTimeTimer !== null) window.clearInterval(this.discountTimeTimer);
  }

  updateDiscountTimeInfo(now: Date = new Date()): void {
    const wasBlocked = this.isSearchBlockedByDiscountHours;
    const snapshot = getDiscountTimeSnapshot(now);
    this.currentTaipeiTimeLabel = snapshot.timeLabel;
    this.discountTimeStatuses = snapshot.statuses;

    if (!wasBlocked && this.isSearchBlockedByDiscountHours) {
      this.stopSearchForClosedHours();
    }
  }

  getStoreEmptyMessage(store: any): string {
    const chain = store?.label === '全家' ? '全家' : '7-11';
    const status = this.discountTimeStatuses.find(item => item.chain === chain);
    const baseMessage = '該門市暫時沒有即期商品。';
    if (!status) return baseMessage;

    if (status.active) {
      return `${baseMessage}目前是${status.programName}優惠時段，實際品項與庫存以門市現場為準。`;
    }
    return `${baseMessage}下一個${status.programName}時段為 ${status.nextPeriod.timeLabel}。`;
  }

  private stopSearchForClosedHours(): void {
    this.stopProductSearch();
    this.storeSearchGeneration++;
    this.nearbySearchGeneration++;
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.productSearchStores = [];
    this.hasMoreStores = false;
    this.isMapView = false;
    this.mapSheetOpen = false;
    this.routeNoResults = false;
    this.locationDenied = false;
    this.loadingService.hide();
    document.documentElement.classList.remove('map-active-lock');
    document.body.classList.remove('map-active-lock');
  }

  private canStartDiscountSearch(): boolean {
    if (!this.isSearchBlockedByDiscountHours) return true;
    this.stopSearchForClosedHours();
    return false;
  }

  getCityName(): Observable<any[]> {
    const apiUrl = 'https://demeter.5fpro.com/tw/zipcodes.json'; // API URL
    return this.http.get<any[]>(apiUrl).pipe(
      tap((data) => {
        this.zipcodes = data;
        this.cities = [...new Set(data.map((item) => item.city_name))];
        this.zipcodeList = [...new Set(data.map((item) => item.zipcode))];
      })
    );
  }

  // 當縣市選擇改變時
  onCityChange(city: string): void {
    // 根據選擇的縣市篩選行政區
    this.filteredDistricts = this.zipcodes.filter((item) => item.city_name === city);
    this.selectedDistrict = null; // 清空選中的行政區
    this.selectedZipcode = null; // 清空郵遞區號
  }

  // 當行政區選擇改變時
  onDistrictChange(zipcode: string): void {
    // 更新選擇的郵遞區號
    this.selectedZipcode = zipcode;
  }

  handleError(error: GeolocationPositionError): string {
    switch (error.code) {
      case 1:
        return '使用者拒絕位置存取';
      case 2:
        return '無法取得位置資訊';
      case 3:
        return '位置請求逾時';
      default:
        return '未知錯誤';
    }
  }

  init() {
    // 從 localStorage 讀取聊天室開關
    const savedChat = localStorage.getItem('chatEnabled');
    if (savedChat) {
      this.chatEnabled = JSON.parse(savedChat);
    }

    // 從 localStorage 讀取深色模式開關
    const savedDarkMode = localStorage.getItem('darkModeEnabled');
    if (savedDarkMode !== null) {
      this.darkModeEnabled = JSON.parse(savedDarkMode);
    }
    this.applyTheme();

    // 監聽裝置主題變更
    this.darkModeMediaQuery.addEventListener('change', this.onSystemThemeChange);

    // 訂閱 getUser 方法來獲取用戶資料
    this.authService.getUser().subscribe(user => {
      this.user = user;
      if (user) {
        this.loadFavoriteStores();
      } else {
        this.favoritesSubscription?.unsubscribe();
        this.favoriteStores = [];
        this.favoriteStoreNameSet.clear();
      }
    });

    // // 使用 from 將 Promise 轉換為 Observable

    if (!this.isSearchBlockedByDiscountHours) {
      this.loadingService.begin(
        '正在取得你的位置',
        8,
        '定位與商店資料同步準備中'
      );
    }

    // 四份本機 JSON 一次平行載入，並提供可重播的 ready 訊號，移除 200ms 輪詢。
    this.searchDataReady$ = forkJoin({
      food711: this.sevenElevenService.getFoodDetails().pipe(catchError(() => of([]))),
      foodFamilyMart: this.familyMartService.getFoodDetails().pipe(catchError(() => of([]))),
      stores711: this.sevenElevenService.getStores().pipe(catchError(() => of([]))),
      storesFamilyMart: this.familyMartService.getStores().pipe(catchError(() => of([])))
    }).pipe(
      tap(({ food711, foodFamilyMart, stores711, storesFamilyMart }) => {
        this.foodDetails711 = food711 || [];
        this.foodDetailsFamilyMart = foodFamilyMart || [];
        this.applySevenElevenStores(stores711 || []);
        this.applyFamilyMartStores(storesFamilyMart || []);
        this.storesDataReady = this.all711Stores.length > 0 && this.dropDownFamilyMartList.length > 0;

        if (this.allNearbyStores.length > 0) {
          this.prepareAllStoresByDistance();
        }
      }),
      map(() => true),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.searchDataReady$.subscribe();

    // 分類只影響卡片展開內容，不再阻塞「附近結果」首屏。
    this.loadSevenElevenCategoriesInBackground();
    if (this.isSearchBlockedByDiscountHours) {
      this.loadingService.hide();
    } else {
      this.locateAndSearchNearby(false);
    }
  }

  private applyFamilyMartStores(data: any[]): void {
    this.dropDownFamilyMartList = data;
    this.storeDataService.setAllFmStores(data);
  }

  private applySevenElevenStores(data: any[]): void {
    this.all711Stores = data;
    this.storeDataService.setAll711Stores(data);
    this.storeNoToCoords.clear();
    data.forEach((store: any) => {
      const storeNo = this.normalize711StoreNo(store.serial);
      const lat = Number(store.lat);
      const lng = Number(store.lng);
      if (storeNo && Number.isFinite(lat) && Number.isFinite(lng)) {
        this.storeNoToCoords.set(storeNo, { lat, lng });
      }
    });
  }

  private loadSevenElevenCategoriesInBackground(): void {
    this.sevenElevenService.ensureGatewayReady().pipe(
      switchMap((token: any) => token?.element
        ? this.sevenElevenService.getFoodCategory()
        : of(null)),
      catchError((error) => {
        console.warn('7-11 分類暫時無法更新，附近門市仍會繼續顯示。', error);
        return of(null);
      })
    ).subscribe((response: any) => {
      if (response?.element) this.foodCategories = response.element;
    });
  }

  getFamilyMartAllStore() {
    this.familyMartService.getStores().subscribe((data) => {
      if(data.length > 0) {
        this.applyFamilyMartStores(data);
      }
      this.checkStoresDataReady();
    })
  }

  getSevenElevenAllStore() {
    this.sevenElevenService.getStores().subscribe((data) => {
      if(data && data.length > 0) {
        this.applySevenElevenStores(data);
      }
      this.checkStoresDataReady();
    })
  }

  // 檢查兩個商店資料源是否都已載入
  private checkStoresDataReady(): void {
    if (this.all711Stores && this.all711Stores.length > 0 &&
        this.dropDownFamilyMartList && this.dropDownFamilyMartList.length > 0) {
      this.storesDataReady = true;
    }
  }

  // 計算 7-11 門市與搜尋中心的真實距離（永遠從座標計算，不依賴 API 的 Distance）
  // 使用場景中心點（searchCenterLat/Lng）：
  //   - 使用者定位搜尋時 = 使用者 GPS
  //   - 門市名稱搜尋時 = 該門市的座標
  //   - 商品搜尋時 = 使用者 GPS
  private normalize711StoreNo(storeNo: unknown): string {
    const rawStoreNo = String(storeNo ?? '').trim();
    if (!rawStoreNo) return '';
    return /^\d+$/.test(rawStoreNo) ? rawStoreNo.padStart(6, '0') : rawStoreNo;
  }

  private get711StoreCoords(storeNo: unknown): { lat: number; lng: number } | undefined {
    return this.storeNoToCoords.get(this.normalize711StoreNo(storeNo));
  }

  private calc711DistFromUser(storeNo: unknown): number {
    const coords = this.get711StoreCoords(storeNo);
    if (coords && this.searchCenterLat && this.searchCenterLng) {
      return Math.round(getDistance(
        { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
        { latitude: coords.lat, longitude: coords.lng }
      ));
    }
    return 999999; // 找不到座標時排最後
  }

  private get711QueryLocation(storeNo: unknown): { Latitude: number; Longitude: number } {
    const coords = this.get711StoreCoords(storeNo);
    return {
      Latitude: coords?.lat || this.searchCenterLat || this.latitude || 25.0375197,
      Longitude: coords?.lng || this.searchCenterLng || this.longitude || 121.5636704
    };
  }

  private normalizeNearbyDistance(store: any, centerLat: number, centerLng: number): any {
    if (store.label === '7-11') {
      const coords = this.get711StoreCoords(store.StoreNo);
      const distance = coords
        ? Math.round(getDistance(
            { latitude: centerLat, longitude: centerLng },
            { latitude: coords.lat, longitude: coords.lng }
          ))
        : 999999;
      return { ...store, distance, showDistance: distance !== 999999 };
    }

    const lat = Number(store.latitude);
    const lng = Number(store.longitude);
    const distance = Number.isFinite(lat) && Number.isFinite(lng)
      ? Math.round(getDistance(
          { latitude: centerLat, longitude: centerLng },
          { latitude: lat, longitude: lng }
        ))
      : 999999;
    return { ...store, distance, showDistance: distance !== 999999 };
  }

  private sortStoresByDistance<T extends { distance?: unknown }>(stores: T[]): T[] {
    return stores.sort((a, b) => {
      const rawDistanceA = Number(a.distance);
      const rawDistanceB = Number(b.distance);
      const distanceA = Number.isFinite(rawDistanceA) && rawDistanceA >= 0
        ? rawDistanceA
        : Number.MAX_SAFE_INTEGER;
      const distanceB = Number.isFinite(rawDistanceB) && rawDistanceB >= 0
        ? rawDistanceB
        : Number.MAX_SAFE_INTEGER;
      return distanceA - distanceB;
    });
  }

  getFoodSubCategoryImage(nodeID: number): string | null {
    // 查找匹配的子分類
    for (let category of this.foodCategories) {
      const subCategory = category.Children.find(child => child.ID === nodeID);
      if (subCategory) {
        // 找到對應的子分類並返回其對應的分類圖片 URL
        return category.ImageUrl;
      }
    }
    // 如果沒有找到對應的子分類，返回 null
    return null;
  }

  getSubCategoryTotalQty(store: any, category: any): number {
    // 使用預算快取（如果有）
    const cacheKey = category.ID || category.name;
    if (store._categoryQtyCache && store._categoryQtyCache[cacheKey] !== undefined) {
      return store._categoryQtyCache[cacheKey];
    }

    let totalQty = 0;
    if (store.CategoryStockItems) {
      for (const stockItem of store.CategoryStockItems) {
        for (const child of category.Children) {
          if (stockItem.NodeID === child.ID) {
            totalQty += stockItem.RemainingQty;
          }
        }
      }
    }
    return totalQty;
  }

  // 預算所有分類數量到 store._categoryQtyCache
  private precomputeCategoryQty(store: any): void {
    if (!store._categoryQtyCache) {
      store._categoryQtyCache = {};
    }
    if (store.label === '7-11' && store.CategoryStockItems && this.foodCategories) {
      for (const category of this.foodCategories) {
        let totalQty = 0;
        for (const stockItem of store.CategoryStockItems) {
          for (const child of category.Children) {
            if (stockItem.NodeID === child.ID) {
              totalQty += stockItem.RemainingQty;
            }
          }
        }
        store._categoryQtyCache[category.ID] = totalQty;
      }
    }
    if (store.label === '全家' && store.info) {
      for (const cat of store.info) {
        store._categoryQtyCache[cat.name] = cat.qty;
      }
    }
  }

  // 當用戶點擊某個分類時，切換選中的分類與店鋪
  toggleSubCategoryDetails(store: any, category: any): void {
    if (store.selectedCategory === category) {
      store.selectedCategory = undefined;
    } else {
      // 在 Angular change detection 啟動 `<app-display>` 前，
      // 先同步強制設定預設為載入中（除非已經載入完畢），避免 CSS grid 的 `expanded` 狀態提早一瞬間觸發而產生閃爍/卡頓展開
      const catId = category.ID || category.name;
      if (!store._categoryLoadingState) {
        store._categoryLoadingState = {};
      }
      if (store._categoryLoadingState[catId] !== 'complete') {
        store._categoryLoadingState[catId] = 'loading';
      }

      store.selectedCategory = category;
    }
  }

  trackByStore(index: number, store: any): string {
    return store.storeName || store.StoreName || index.toString();
  }

  trackByCategory(index: number, category: any): string {
    return category.ID || category.name || index.toString();
  }

  trackByDropdownItem(index: number, item: any): string {
    return (item.type || '') + ':' + (item.name || index.toString());
  }

  trackByMsg(_index: number, msg: string): string {
    return msg;
  }

  // mat-autocomplete 顯示函式：防止 [object Object]
  displayFn(item: any): string {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.name || '';
  }

  // 切換漢堡選單
  toggleMenu(): void {
    this.showMenu = !this.showMenu;
  }

  // 切換關於卡片
  toggleAboutCard(): void {
    this.showAboutCard = true;
    this.showMenu = false;
  }

  // 清除搜尋框內的文字
  clearSearch(event: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.searchTerm = '';
    this.selectedKeywords = [];
    this.advancedSearchActive = false;
    this.keywordCtrl.setValue('');
    if (this.keywordInput) {
      this.keywordInput.nativeElement.value = '';
    }
    this.searchSelectedStore = null;
    this.selectedStoreName = '';
    this.autocompleteTrigger?.closePanel();
    this.searchInput$.next('');
  }

  focusSearchInput(): void {
    this.keywordInput?.nativeElement.focus();
  }

  clearSearchAndLocate(): void {
    this.selectedKeywords = [];
    this.advancedSearchActive = false;
    this.keywordCtrl.setValue('');
    this.searchTerm = '';
    this.onUseCurrentLocation();
  }

  setKeywordMatchMode(mode: 'any' | 'all'): void {
    if (this.keywordMatchMode === mode) return;
    this.keywordMatchMode = mode;
    if (this.selectedKeywords.length > 0) this.performSearch();
  }

  openRouteSearch(): void {
    this.showMenu = false;
    if (!this.canStartDiscountSearch()) return;
    this.handleRouteSelection('');
  }

  openAdvancedSearch(): void {
    this.showMenu = false;
    if (!this.canStartDiscountSearch()) return;

    const allOptions: AdvancedSearchOption[] = [];
    this.foodCategories.forEach(category => {
      allOptions.push({
        name: category.Name,
        type: 'category',
        addr: '7-11 食物分類',
        label: '種類',
        imageUrl: category.ImageUrl
      });
      (category.Children || []).forEach(child => allOptions.push({
        name: child.Name,
        type: 'category',
        addr: `${category.Name} → ${child.Name}`,
        label: '種類',
        imageUrl: category.ImageUrl
      }));
    });

    this.foodDetails711.forEach(item => {
      if (item.name) allOptions.push({
        name: item.name,
        type: 'product',
        addr: '7-ELEVEN 商品',
        label: '商品',
        source: '7-11',
        image: item.image
      });
    });
    this.foodDetailsFamilyMart.forEach(item => {
      if (item.title) allOptions.push({
        name: item.title,
        type: 'product',
        addr: '全家 商品',
        label: '商品',
        source: '全家',
        image: item.picture_url
      });
    });

    this.all711Stores.forEach(item => allOptions.push({
      name: item.name,
      rawName: item.name,
      type: 'store',
      addr: item.addr,
      label: '7-11',
      storeNo: String(item.serial || ''),
      longitude: Number(item.lng),
      latitude: Number(item.lat)
    }));
    this.dropDownFamilyMartList.forEach(item => allOptions.push({
      name: item.Name.replace('全家', ''),
      rawName: item.Name,
      type: 'store',
      addr: item.addr,
      label: '全家',
      pkeynew: String(item.pkeynew || ''),
      longitude: Number(item.px_wgs84),
      latitude: Number(item.py_wgs84)
    }));

    const dialogRef = this.dialog.open(AdvancedSearchDialogComponent, {
      width: 'calc(100vw - 24px)',
      maxWidth: '480px',
      panelClass: 'glass-dialog',
      data: {
        allOptions,
        initialKeywords: this.selectedKeywords,
        matchMode: this.keywordMatchMode
      },
      autoFocus: false
    });

    dialogRef.afterClosed().subscribe((result: AdvancedSearchDialogResult | undefined) => {
      if (!result) return;

      this.selectedKeywords = result.keywords.map(keyword => this.toDisplayKeyword(keyword));
      this.keywordMatchMode = result.matchMode;
      this.advancedSearchActive = true;
      this.keywordCtrl.setValue('', { emitEvent: false });
      if (this.keywordInput) this.keywordInput.nativeElement.value = '';
      this.searchTerm = '';
      this.unifiedDropDownList = [];
      this.performSearch();
    });
  }

  openDiscountTimeDialog(): void {
    this.showMenu = false;
    this.updateDiscountTimeInfo();
    this.dialog.open(DiscountTimeDialogComponent, {
      width: 'calc(100vw - 24px)',
      maxWidth: '520px',
      panelClass: 'glass-dialog',
      autoFocus: false
    });
  }

  refreshCurrentSearch(): void {
    this.showMenu = false;
    if (!this.canStartDiscountSearch()) return;
    if (this.searchMode === 'route' && this.lastRouteUrl) {
      this.beginRouteAnalysis(this.lastRouteUrl, this.lastRouteMode, this.routeProductKeywords);
      return;
    }
    if (this.selectedKeywords.length > 0) {
      this.performSearch();
      return;
    }
    this.onUseCurrentLocation();
  }

  // 回首頁：清空搜尋、回到定位搜尋
  goHome(): void {
    // 先作廢各種舊查詢，避免稍晚回來的非同步結果覆蓋首頁定位結果。
    this.stopProductSearch();
    this.storeSearchGeneration++;
    this.nearbySearchGeneration++;
    this.searchTerm = '';
    this.selectedKeywords = [];
    this.advancedSearchActive = false;
    this.keywordCtrl.setValue('');
    if (this.keywordInput) {
      this.keywordInput.nativeElement.value = '';
    }
    this.unifiedDropDownList = [];
    this.showMenu = false;
    this.showAboutCard = false;
    this.showLabSection = false;
    this.isMapView = false;
    this.mapSheetOpen = false;
    this.isScrolledDown = false;
    this.lastScrollY = 0;
    this.routeNoResults = false;
    this.routeProductKeywords = [];
    this.lastRouteUrl = '';
    this.searchSelectedStore = null;
    this.selectedStoreName = '';
    document.documentElement.classList.remove('map-active-lock');
    document.body.classList.remove('map-active-lock');
    window.scrollTo({ top: 0, behavior: 'auto' });
    this.onUseCurrentLocation();
  }

  // 切換實驗室子選單
  toggleLabSection(): void {
    this.showLabSection = !this.showLabSection;
  }

  // 聊天室開關
  onToggleChat(event: any): void {
    this.chatEnabled = event.target.checked;
    localStorage.setItem('chatEnabled', JSON.stringify(this.chatEnabled));
    // 通知同頁面的 chatbot 組件
    window.dispatchEvent(new CustomEvent('chatEnabledChanged', { detail: this.chatEnabled }));
  }

  // 觸發開啟聊天室
  openChatbot(): void {
    if (!this.chatEnabled) {
      this.chatEnabled = true;
      localStorage.setItem('chatEnabled', JSON.stringify(this.chatEnabled));
      window.dispatchEvent(new CustomEvent('chatEnabledChanged', { detail: this.chatEnabled }));
    }
    window.dispatchEvent(new CustomEvent('openChatbot'));
  }

  // 切換地圖檢視
  toggleMapView(target?: 'list' | 'map'): void {
    if (this.isSearchBlockedByDiscountHours) {
      this.isMapView = false;
      return;
    }
    // Prevent re-toggling to the same view
    if (target === 'list' && !this.isMapView) return;
    if (target === 'map' && this.isMapView) return;

    if (!this.isMapView || target === 'map') {
      // We are in List view, about to switch to Map View.
      // Calculate focus BEFORE flipping the view to ensure bounding boxes are perfectly intact
      this.calculateListFocus();
      // 地圖的主要任務是比較位置。切換情境時先收合清單中展開的商品，
      // 避免底部門市面板一出現就被商品詳情佔滿大半畫面。
      const mapSourceStores = this.searchMode === 'product' ? this.productSearchStores : this.totalStoresShowList;
      mapSourceStores.forEach(store => {
        store.selectedCategory = undefined;
      });
      console.log('[toggleMapView] Target list focus stored as:', this.listFocusStore);
    }

    this.isMapView = !this.isMapView;
    this.mapSheetOpen = false;
    
    if (this.isMapView) {
      this.mapActiveStore = null; // 清除上一次的地圖殘留選中狀態
      this.savedScrollPosition = window.pageYOffset || document.documentElement.scrollTop;

      // 關鍵修正：全域 CSS 設有 scroll-behavior: smooth，
      // 若直接呼叫 scrollTo(0,0) 會啟動一段平滑動畫而非瞬間跳轉。
      // 緊接著加上的 map-active-lock (overflow: hidden) 會中斷該動畫，
      // 導致頁面卡在中途的偏移位置，地圖頂部按鈕因此被遮擋。
      const html = document.documentElement;
      html.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo(0, 0);
      html.scrollTop = 0;
      document.body.scrollTop = 0;

      html.classList.add('map-active-lock');
      document.body.classList.add('map-active-lock');

      // 鎖定完成後恢復 scroll-behavior
      html.style.removeProperty('scroll-behavior');
    } else {
      document.documentElement.classList.remove('map-active-lock');
      document.body.classList.remove('map-active-lock');
      // Fix: 從地圖切回清單時，膠囊預設展開
      this.isScrolledDown = false;
      this.lastScrollY = 0;

      // 將該地圖區域搜尋到的所有新門市，排在清單的最前面
      if (this.latestMapStores.length > 0) {
        const existingIds = new Set(this.totalStoresShowList.map(s => s.StoreName || s.storeName));
        const newStoresToPrepend: any[] = [];
        
        // 保留原有的 map 順序加入
        for (const mapStore of this.latestMapStores) {
          const storeId = mapStore.StoreName || mapStore.storeName;
          if (!existingIds.has(storeId)) {
            newStoresToPrepend.push(mapStore);
            existingIds.add(storeId);
          }
        }
        
        if (newStoresToPrepend.length > 0) {
          // 將從地圖新搜尋到的門市，依照距離當前位置的遠近排序，避免散亂
          newStoresToPrepend.sort((a, b) => (a.distance || 0) - (b.distance || 0));
          this.totalStoresShowList = [...newStoresToPrepend, ...this.totalStoresShowList];
          this.cdr.detectChanges();
        }
      }
      
      let targetStoreToScroll = this.mapActiveStore;
      
      // Map -> List Sync: 如果地圖沒有「主動選中」任何門市，則取地圖中心點最近的門市
      if (this.isMapView && !targetStoreToScroll && this.mapViewComponent) {
        targetStoreToScroll = this.mapViewComponent.getClosestStoreToCenter();
      }
      
      if (targetStoreToScroll) {
        const storeId = targetStoreToScroll.StoreName || targetStoreToScroll.storeName;
        
        // If not implicitly in the map stores array for some reason, ensure the actively clicked one is prepended:
        const exists = this.totalStoresShowList.some(s => (s.StoreName || s.storeName) === storeId);
        if (!exists) {
          this.totalStoresShowList.unshift(targetStoreToScroll);
          this.cdr.detectChanges(); 
        }

        setTimeout(() => {
          const el = document.getElementById('store-' + storeId);
          if (el) {
            // 由於全域 CSS (styles.scss) 設定了 scroll-behavior: smooth，
            // 為了達成無動畫的「瞬間定位」，必須暫時強制覆寫 root 行為
            const html = document.documentElement;
            const absoluteY = el.getBoundingClientRect().top + window.pageYOffset;
            
            // 計算將卡片置於畫面整中央的 Y 座標，這能確保與 calculateListFocus() 的「視窗中心點」邏輯完美吻合，解決無窮下跳的問題
            let targetY = absoluteY - (window.innerHeight / 2) + (el.getBoundingClientRect().height / 2);
            if (targetY < 0) targetY = 0; // 防止滾到最上面出界

            html.style.setProperty('scroll-behavior', 'auto', 'important');
            window.scrollTo(0, targetY); // 置中顯示
            
            // 更新 scrollY 避免 onWindowScroll 誤判為向下滾動並再次縮小膠囊
            this.lastScrollY = targetY;
            
            // 定位完成後立刻恢復原預設的動畫效果，並確保膠囊為展開狀態
            setTimeout(() => {
              html.style.removeProperty('scroll-behavior');
              this.isScrolledDown = false;
            }, 50);
          }
        }, 10); // 短暫延遲讓 CSS transform 準備好
      } else {
        // Fallback: Restore previous scroll position if no map store was selected
        setTimeout(() => {
          const html = document.documentElement;
          html.style.setProperty('scroll-behavior', 'auto', 'important');
          window.scrollTo(0, this.savedScrollPosition);
          this.lastScrollY = this.savedScrollPosition;
          
          setTimeout(() => {
            html.style.removeProperty('scroll-behavior');
            this.isScrolledDown = false;
          }, 50);
        }, 10);
      }
    }
  }

  // 接收地圖元件發出的選中門市事件
  onMapStoreSelected(store: any): void {
    if (store && this.isMapView) {
      this.mapActiveStore = { ...store };
      this.cdr.detectChanges(); // Ensures Angular evaluates new object immediately
    } else {
      this.mapActiveStore = null;
    }
  }

  // 接收地圖範圍變更後取得的所有門市
  onMapSearchedStores(stores: any[]): void {
    this.latestMapStores = stores || [];
  }

  // Lazy calculation: 從畫面上擷取最適當的門市焦點傳給地圖
  private calculateListFocus(): void {
    const cards = Array.from(document.querySelectorAll('.store-glass-card'));
    if (!cards || cards.length === 0) return;

    let closestCard: Element | null = null;
    let minDistance = Infinity;
    const viewportCenterY = window.innerHeight / 2;
    let expandedCardInView: Element | null = null;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const cardCenterY = rect.top + rect.height / 2;
      const distance = Math.abs(cardCenterY - viewportCenterY);
      
      // Is this card currently expanded (has app-display component inside it?)
      const isExpanded = card.querySelector('app-display') !== null;
      
      if (distance < minDistance) {
        minDistance = distance;
        closestCard = card;
      }
      
      // Prioritize expanded cards that are visible at all on the screen
      if (isExpanded && rect.top < window.innerHeight && rect.bottom > 68) {
        if (!expandedCardInView) expandedCardInView = card;
      }
    }

    const targetCard = expandedCardInView || closestCard;
    if (targetCard) {
      const storeId = targetCard.id.replace('store-', '');
      const targetStore = this.totalStoresShowList.find(s => (s.StoreName || s.storeName) === storeId);
      if (targetStore) {
        // Create a shallow copy or just pass ref. 
        // Passing ref will automatically trigger ngOnChanges in map-view if we replace the object wrap
        this.listFocusStore = { ...targetStore }; // using copy to trigger change detection cleanly
      }
    } else {
      this.listFocusStore = null;
    }
  }

  // 深色模式開關
  onToggleDarkMode(event: any): void {
    this.darkModeEnabled = event.target.checked;
    localStorage.setItem('darkModeEnabled', JSON.stringify(this.darkModeEnabled));
    this.applyTheme();
  }

  // 套用主題：根據 darkModeEnabled 和 prefers-color-scheme 設定 data-theme
  applyTheme(): void {
    const prefersDark = this.darkModeMediaQuery.matches;
    const shouldBeDark = this.darkModeEnabled && prefersDark;
    const htmlEl = document.documentElement;
    htmlEl.setAttribute('data-theme', shouldBeDark ? 'dark' : 'light');
    // Tailwind 的 dark: 使用 class 策略
    if (shouldBeDark) {
      htmlEl.classList.add('dark');
    } else {
      htmlEl.classList.remove('dark');
    }

    // 讓 iOS Safari 的瀏覽器安全區延續頁面底色，避免底部出現割裂色塊。
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', shouldBeDark ? '#1D1C1A' : '#F5F2ED');
    }
  }

  // 登入/登出
  loginOrlogout(): void {
    if (this.user) {
      this.authService.logout();
      this.user = null;
      this.favoriteStores = [];
    } else {
      const dialogRef = this.dialog.open(LoginPageComponent, {
        width: '500px',
        panelClass: 'glass-dialog',
        data: {},
      });
      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          this.authService.getUser().subscribe(user => {
            this.user = user;
            if (this.user) {
              this.loadFavoriteStores();
            }
          });
        }
      });
    }
  }

  // 監聽全域點擊事件，如果點擊在選單外部則關閉選單
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.showMenu) {
      const clickedInsideMenuButton = this.menuButton?.nativeElement.contains(event.target);
      const clickedInsideMenuPanel = this.menuPanel?.nativeElement.contains(event.target);
      const clickedInsideOverlay = (event.target as HTMLElement).closest('.cdk-overlay-container');
      
      if (!clickedInsideMenuButton && !clickedInsideMenuPanel && !clickedInsideOverlay) {
        this.showMenu = false;
        this.showLabSection = false; // 同時收起實驗室
      }
    }
  }

  // 效能優化：改為 Zone 外部的 passive 監聽器
  onWindowTouchMove = (event: TouchEvent) => {
    const touchTarget = event.target;
    if (touchTarget instanceof Node && this.menuPanel?.nativeElement.contains(touchTarget)) {
      return;
    }

    if (this.showMenu || this.showLabSection) {
      this.ngZone.run(() => {
        this.showMenu = false;
        this.showLabSection = false;
      });
    }
  }

  onInput(event: Event): void {
    const input = (event.target as HTMLInputElement).value;
    if (this.selectedKeywords.length > 0) {
      this.selectedKeywords = [];
      this.advancedSearchActive = false;
      this.keywordMatchMode = 'any';
    }
    this.searchTerm = input;
    // 當輸入超過 1 個字時，延遲 300ms 後才觸發搜尋（避免每次按鍵都執行重量運算凍結 UI）
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    if (input.length >= 1) {
      this.searchDebounceTimer = setTimeout(() => this.handleSearch(input), 300);
    } else {
      this.unifiedDropDownList = [];
      // 僅在完全沒有已選條件時回到定位搜尋，避免刪除輸入文字時清掉既有 chips。
      if (input.length === 0 && this.selectedKeywords.length === 0 && this.searchMode !== 'location') {
        this.onUseCurrentLocation();
      }
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    // IME 組字中（注音/拼音）按 Enter 只是選字，不應觸發搜尋
    if (event.isComposing || this.isComposing) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
      }
      this.unifiedDropDownList = [];
      this.autocompleteTrigger?.closePanel();
      this.performSearch();
    }
  }

  // 將中文轉換為拼音（不帶聲調，空格分隔）
  // 使用快取避免重複轉換相同的文字
  convertToPinyin(text: string): string {
    if (!text) return '';
    
    // 檢查快取
    if (this.pinyinCache.has(text)) {
      return this.pinyinCache.get(text)!;
    }
    
    try {
      // pinyin-pro 預設返回字串，使用 toneType: 'none' 來移除聲調
      const result = pinyin(text, { toneType: 'none' }) as string;
      const pinyinResult = result.replace(/\s+/g, ' ').trim();
      
      // 存入快取
      this.pinyinCache.set(text, pinyinResult);
      
      return pinyinResult;
    } catch (error) {
      console.error('拼音轉換錯誤:', error);
      return text;
    }
  }

  // 檢查文字是否匹配（支援中文、拼音和模糊比對）
  matchesSearchTerm(text: string, pinyinText: string, searchTerm: string): boolean {
    if (!searchTerm) return true;
    
    const lowerSearchTerm = searchTerm.toLowerCase().trim();
    const lowerText = text.toLowerCase();
    const lowerPinyin = pinyinText.toLowerCase();

    if (this.normalizeSearchText(text).includes(this.normalizeSearchText(searchTerm))) {
      return true;
    }
    
    // 1. 直接文字比對（包含）
    if (lowerText.includes(lowerSearchTerm)) {
      return true;
    }
    
    // 2. 拼音比對（包含）
    if (lowerPinyin.includes(lowerSearchTerm)) {
      return true;
    }
    
    // 3. 如果搜尋詞是中文，轉換為拼音後比對
    const searchTermPinyin = this.convertToPinyin(searchTerm).toLowerCase();
    if (searchTermPinyin && lowerPinyin.includes(searchTermPinyin)) {
      return true;
    }
    
    // 4. 移除空格後比對（處理拼音中的空格）
    const pinyinNoSpace = lowerPinyin.replace(/\s+/g, '');
    const searchNoSpace = lowerSearchTerm.replace(/\s+/g, '');
    if (pinyinNoSpace.includes(searchNoSpace)) {
      return true;
    }
    
    return false;
  }

  private normalizeSearchText(value: string): string {
    return (value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/^(?:(?:[一二三四五六七八九十\d]\s*配|配(?=[-_.．\s])|(?:北|中|南|東|全)區)[-_.．\s]*)+/, '')
      .replace(/臺/g, '台')
      .replace(/意大利/g, '義大利')
      .replace(/麪/g, '麵')
      .replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  }

  private productNameMatches(productName: string, keyword: string): boolean {
    const normalizedName = this.normalizeSearchText(productName);
    const normalizedKeyword = this.normalizeSearchText(keyword);
    if (!normalizedKeyword) return true;
    if (normalizedName.includes(normalizedKeyword)) return true;

    const tokens = (keyword || '')
      .normalize('NFKC')
      .split(/[\s,，、/]+/)
      .map(token => this.normalizeSearchText(token))
      .filter(token => token.length > 0);
    return tokens.length > 1 && tokens.every(token => normalizedName.includes(token));
  }

  private matchesKeywordSet(matchKeyword: (keyword: { text: string; isCategory: boolean }) => boolean,
    keywords: { text: string; isCategory: boolean }[]): boolean {
    if (keywords.length === 0) return true;
    return this.keywordMatchMode === 'all'
      ? keywords.every(matchKeyword)
      : keywords.some(matchKeyword);
  }

  // 使用本地 JSON 資料和拼音比對進行搜尋（支援門市、商品、種類，也支援 Google Maps 連結）
  handleSearch(input: string): void {
    if (input.length >= 1) {
      this.unifiedDropDownList = [];

      // --- 0. 判斷是否為 Google Maps 連結 ---
      const isMapsLink = /https:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.[^/]+\/maps\/(?:dir|place)|maps\.google\.)/i.test(input);
      if (isMapsLink) {
        this.unifiedDropDownList = [{
          name: '分析 Google Maps 導航路線',
          addr: '自動為您找出沿途順路的門市',
          label: '導航',
          type: 'route' as const,
          originalUrl: input.trim()
        }];
        return; // 找到連結就不顯示其他雜項搜尋結果
      }

      // --- 1. 篩選門市候選 ---
      const filteredFamilyMartStores = this.dropDownFamilyMartList
        .filter(item => {
          return this.matchesSearchTerm(item.Name.replace('全家', ''), item.Name_pinyin || '', input) ||
                 this.matchesSearchTerm(item.addr, item.addr_pinyin || '', input);
        })
        .slice(0, 10);

      const filtered711Stores = this.all711Stores
        .filter(item => {
          return this.matchesSearchTerm(item.name || '', item.name_pinyin || '', input) ||
                 this.matchesSearchTerm(item.addr || '', item.addr_pinyin || '', input);
        })
        .slice(0, 10);

      // 門市候選項目
      const storeCandidates = [
        ...filtered711Stores.map(item => ({
          name: item.name,
          rawName: item.name,
          addr: item.addr,
          label: '7-11',
          type: 'store' as const,
          storeNo: item.serial,
          longitude: parseFloat(item.lng),
          latitude: parseFloat(item.lat)
        })),
        ...filteredFamilyMartStores.map(item => ({
          name: item.Name.replace('全家', ''),
          rawName: item.Name,
          addr: item.addr,
          label: '全家',
          type: 'store' as const,
          pkeynew: item.pkeynew,
          longitude: parseFloat(item.px_wgs84),
          latitude: parseFloat(item.py_wgs84)
        }))
      ];

      // --- 2. 篩選商品候選 ---
      const productSet = new Set<string>();
      const productCandidates: any[] = [];

      // 搜尋 7-11 商品
      this.foodDetails711.forEach(item => {
        const productKey = this.normalizeSearchText(item.name);
        if (item.name && this.productNameMatches(item.name, input) && !productSet.has(productKey)) {
          productSet.add(productKey);
          productCandidates.push({
            name: item.name,
            addr: '7-ELEVEN 商品',
            label: '商品',
            type: 'product' as const,
            source: '7-11',
            image: item.image
          });
        }
      });

      // 搜尋全家商品
      this.foodDetailsFamilyMart.forEach(item => {
        const productKey = this.normalizeSearchText(item.title);
        if (item.title && this.productNameMatches(item.title, input) && !productSet.has(productKey)) {
          productSet.add(productKey);
          productCandidates.push({
            name: item.title,
            addr: '全家 商品',
            label: '商品',
            type: 'product' as const,
            source: '全家',
            image: item.picture_url
          });
        }
      });

      // --- 3. 篩選商品種類候選 ---
      const categoryCandidates: any[] = [];
      const categorySet = new Set<string>();

      // 7-11 食物分類
      this.foodCategories.forEach(cat => {
        if (cat.Name && this.productNameMatches(cat.Name, input) && !categorySet.has(cat.Name)) {
          categorySet.add(cat.Name);
          categoryCandidates.push({
            name: cat.Name,
            addr: '7-11 食物分類',
            label: '種類',
            type: 'category' as const,
            imageUrl: cat.ImageUrl
          });
        }
        // 也搜尋子分類
        cat.Children.forEach(child => {
          if (child.Name && this.productNameMatches(child.Name, input) && !categorySet.has(child.Name)) {
            categorySet.add(child.Name);
            categoryCandidates.push({
              name: child.Name,
              addr: `${cat.Name} → ${child.Name}`,
              label: '種類',
              type: 'category' as const,
              imageUrl: cat.ImageUrl
            });
          }
        });
      });

      // 全家商品分類（從 foodDetailsFamilyMart 取得不重複的 category）
      const fmCategories = [...new Set(this.foodDetailsFamilyMart.map(item => item.category).filter(c => c))];
      fmCategories.forEach(catName => {
        if (this.productNameMatches(catName, input) && !categorySet.has(catName)) {
          categorySet.add(catName);
          categoryCandidates.push({
            name: catName,
            addr: '全家 食物分類',
            label: '種類',
            type: 'category' as const
          });
        }
      });

      // --- 4. 合併結果（門市優先，商品次之，種類最後）---
      // 如果有位置資訊，門市按距離排序
      if (this.latitude && this.longitude) {
        storeCandidates.sort((a, b) => {
          const distA = getDistance(
            { latitude: this.latitude, longitude: this.longitude },
            { latitude: a.latitude, longitude: a.longitude }
          );
          const distB = getDistance(
            { latitude: this.latitude, longitude: this.longitude },
            { latitude: b.latitude, longitude: b.longitude }
          );
          return distA - distB;
        });
      }

      // 合併：種類 > 商品 > 門市，每類最多顯示數量有限
      const combinedList = [
        ...categoryCandidates.slice(0, 5),
        ...productCandidates.slice(0, 10),
        ...storeCandidates.slice(0, 15)
      ];

      // 檢查是否已經有完全相符的商品名稱
      const normalizedInput = this.normalizeSearchText(input);
      const hasExactProductMatch = productCandidates.some(p => this.normalizeSearchText(p.name) === normalizedInput);

      // 如果沒有找到精確相符，且輸入值有意義，也推入一個手動新增的選項
      if (!hasExactProductMatch && input.trim().length > 0) {
        combinedList.push({
          name: input.trim(),
          addr: '自訂關鍵字搜尋',
          label: '自訂搜尋',
          type: 'product' as const,
          source: '自訂'
        });
      }

      this.unifiedDropDownList = combinedList;

      this.loadingService.hide();
    } else {
      this.unifiedDropDownList = [];
    }
  }

  onOptionSelect(event: MatAutocompleteSelectedEvent | null): void {
    if (!this.canStartDiscountSearch()) return;
    const selectedValue = event?.option?.value;

    if (selectedValue) {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
      }
      if (selectedValue.type === 'route') {
        this.stopProductSearch();
        this.handleRouteSelection(selectedValue.originalUrl);
        this.keywordCtrl.setValue(''); // Reset input value since it was handled
        if (this.keywordInput) this.keywordInput.nativeElement.value = '';
        return;
      }

      // 一般搜尋一次只保留一個條件；多條件搜尋由進階搜尋視窗負責。
      const selectedKeyword = this.toDisplayKeyword(selectedValue);
      this.selectedKeywords = [selectedKeyword];
      this.advancedSearchActive = false;
      this.keywordMatchMode = 'any';
      this.keywordCtrl.setValue(selectedKeyword.name, { emitEvent: false });
      if (this.keywordInput) this.keywordInput.nativeElement.value = selectedKeyword.name;
      this.searchTerm = selectedKeyword.name;
      this.unifiedDropDownList = [];
      this.autocompleteTrigger?.closePanel();

      // Trigger search
      this.performSearch();
    }
  }


  // ==========================================
  // Google Maps 路徑分析
  // ==========================================
  private handleRouteSelection(originalUrl: string): void {
    if (!this.canStartDiscountSearch()) return;
    // 收集自動完成選單資料
    const allOptions: { name: string, type: 'category' | 'product', addr?: string }[] = [];
    
    // 1. 種類
    this.foodCategories.forEach(cat => {
      allOptions.push({ name: cat.Name, type: 'category', addr: '7-11 食物分類' });
      cat.Children.forEach(child => allOptions.push({ name: child.Name, type: 'category', addr: `${cat.Name} → ${child.Name}` }));
    });
    
    // 2. 7-11 商品
    this.foodDetails711.forEach(item => {
      if (item.name) allOptions.push({ name: item.name, type: 'product', addr: '7-ELEVEN 商品' });
    });
    
    // 3. 全家商品
    this.foodDetailsFamilyMart.forEach(item => {
      if (item.title) allOptions.push({ name: item.title, type: 'product', addr: '全家 商品' });
    });

    const dialogRef = this.dialog.open(RouteModeDialogComponent, {
      width: 'calc(100vw - 24px)',
      maxWidth: '440px',
      panelClass: 'glass-dialog',
      data: { originalUrl, allOptions },
      autoFocus: false
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (!result || result === 'CANCEL') {
        return;
      }
      
      const selectedMode = result.mode as 'DRIVING' | 'TWO_WHEELER';
      this.beginRouteAnalysis(result.originalUrl, selectedMode, result.productKeywords || []);
    });
  }

  private beginRouteAnalysis(
    originalUrl: string,
    selectedMode: 'DRIVING' | 'TWO_WHEELER',
    productKeywords: string[]
  ): void {
    if (!this.canStartDiscountSearch()) return;
    this.lastRouteUrl = originalUrl;
    this.lastRouteMode = selectedMode;
    this.routeProductKeywords = productKeywords;
    this.routeSearchSubscription?.unsubscribe();

    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;
    this.searchMode = 'route';
    this.routeNoResults = false;
    this.storeSearchGeneration++;
    this.productSearchGeneration++;
    this.loadingService.begin('正在解析 Google Maps 路線', 8, '讀取起點、終點與交通方式');

    try {
      const urlObj = new URL(originalUrl);
      if (urlObj.hostname.includes('goo.gl')) {
        this.resolveMapsUrlAndFetchRoute(originalUrl, selectedMode);
      } else {
        this.parseAndFetchDirections(originalUrl, selectedMode);
      }
    } catch {
      this.showRouteErrorDialog();
    }
  }

  private resolveMapsUrlAndFetchRoute(shortUrl: string, travelMode: 'DRIVING' | 'TWO_WHEELER'): void {
    // 與前端共用同一支 Cloudflare Worker，避免額外跨網域請求。
    const proxyUrl = `/api/maps/resolve?url=${encodeURIComponent(shortUrl)}`;
    
    this.loadingService.update('正在展開 Maps 短網址', 18, '確認完整路線資訊');
    this.http.get<any>(proxyUrl).subscribe({
      next: (res) => {
        let expandedUrl = shortUrl;
        if (res && res.resolvedUrl) {
          expandedUrl = res.resolvedUrl;
        } else if (res && res.url) {
          expandedUrl = res.url;
        }

        if (Array.isArray(res?.coordinates)) {
          const coords = res.coordinates;
          if (coords.length >= 2) {
            this.fetchDirectionsWithCoords(coords[0], coords[coords.length - 1], travelMode);
            return;
          }
        }

        this.parseAndFetchDirections(expandedUrl, travelMode);
      },
      error: (error) => {
        console.error('Maps 連結解析服務失敗', error);
        this.showRouteErrorDialog();
      }
    });
  }

  // 給 Codetabs 抓出經緯度後直接使用的入口
  private fetchDirectionsWithCoords(origin: any, destination: any, travelMode: 'DRIVING' | 'TWO_WHEELER'): void {
    this.loadingService.update('正在規劃路線', 34, 'Google Maps 正在計算可行路徑');
    
    const directionsService = new (window as any).google.maps.DirectionsService();
    directionsService.route({
      origin: origin as any,
      destination: destination as any,
      travelMode: (window as any).google.maps.TravelMode[travelMode],
      region: 'tw'
    }, (result: any, status: any) => {
      if (status === (window as any).google.maps.DirectionsStatus.OK && result) {
        this.processDirectionsResult(result, travelMode);
      } else {
        console.error('Directions API 錯誤', status);
        this.loadingService.hide();
        alert('Google Maps 路線規劃失敗：' + status);
      }
    });
  }

  private parseAndFetchDirections(url: string, travelMode: 'DRIVING' | 'TWO_WHEELER'): void {
    // Google Maps URL 通常長這樣：
    // https://www.google.com/maps/dir/起點/終點/...
    // 或 https://maps.google.com/?geocode=...&daddr=終點&saddr=起點
    let origin: string | any = '';
    let destination: string | any = '';
    let waypoints: any[] = [];

    try {
      const urlObj = new URL(url);
      
      // 解析 /dir/ 格式
      if (urlObj.pathname.includes('/dir/')) {
        const pathParts = urlObj.pathname.split('/dir/')[1].split('/');
        const locations = [];
        
        for (const part of pathParts) {
          if (!part) continue;
          if (part.startsWith('@') || part.startsWith('data=') || part.startsWith('am=t')) break; // 忽略畫面座標與設定
          locations.push(decodeURIComponent(part).replace(/\+/g, ' ')); // 替換掉可能殘留的加號
        }
        
        if (locations.length >= 2) {
          origin = locations[0];
          destination = locations[locations.length - 1]; // 最後一個是終點
          for (let i = 1; i < locations.length - 1; i++) {
            waypoints.push({ location: locations[i], stopover: true });
          }
        }
      } else if (urlObj.searchParams.has('saddr') && urlObj.searchParams.has('daddr')) {
        origin = decodeURIComponent(urlObj.searchParams.get('saddr') || '');
        let rawDaddr = decodeURIComponent(urlObj.searchParams.get('daddr') || '');
        
        // 處理包含中繼點的格式 (例如 A +to:B +to:C)
        // 注意 URL 解碼後 + 可能是空格或保留 +
        const partsList = rawDaddr.split(/\s?\+?to:\s?/i);
        if (partsList.length > 1) {
          destination = partsList[partsList.length - 1]; // 最後一個是終點
          for (let i = 0; i < partsList.length - 1; i++) {
             waypoints.push({ location: partsList[i], stopover: true });
          }
        } else {
          destination = rawDaddr;
        }
      } else if (urlObj.searchParams.has('destination')) {
        origin = decodeURIComponent(urlObj.searchParams.get('origin') || '');
        let rawDest = decodeURIComponent(urlObj.searchParams.get('destination') || '');
        
        // 處理 intent url 的 waypoints
        if (urlObj.searchParams.has('waypoints')) {
          const wpts = decodeURIComponent(urlObj.searchParams.get('waypoints') || '').split('|');
          wpts.forEach(w => {
            if (w) waypoints.push({ location: w, stopover: true });
          });
        }
        destination = rawDest;
      } else {
        throw new Error('無法識別起終點格式');
      }

      // 嘗試取出字串中的經緯度 (例如 24.123,120.456)
      const parseLatLng = (str: string) => {
        if (!str) return str;
        const match = str.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
        return match ? { lat: parseFloat(match[1]), lng: parseFloat(match[2]) } : str;
      };

      origin = parseLatLng(origin as string);
      destination = parseLatLng(destination as string);

    } catch (e) {
      console.error('URL 解析錯誤:', e);
      this.showRouteErrorDialog();
      return;
    }

    if (!origin || !destination) {
      this.showRouteErrorDialog();
      return;
    }

    const requestOpts: any = {
      origin: origin as any,
      destination: destination as any,
      travelMode: (window as any).google.maps.TravelMode[travelMode],
      region: 'tw'
    };

    if (waypoints.length > 0) {
      requestOpts.waypoints = waypoints;
    }

    this.loadingService.update('正在規劃路線', 34, 'Google Maps 正在計算可行路徑');
    const directionsService = new (window as any).google.maps.DirectionsService();
    directionsService.route(requestOpts, (result: any, status: any) => {
      if (status === (window as any).google.maps.DirectionsStatus.OK && result) {
        this.processDirectionsResult(result, travelMode);
      } else {
        console.error('Directions API 錯誤', status);
        this.loadingService.hide();
        alert('Google Maps 路線規劃失敗：' + status);
      }
    });
  }

  private showRouteErrorDialog(): void {
    this.loadingService.hide();
    this.dialog.open(MessageDialogComponent, {
      width: '400px',
      panelClass: 'glass-dialog',
      data: {
        title: '路線解析失敗',
        message: '解析失敗，請貼上正確的導航路線連結。',
        type: 'error'
      }
    });
  }

  private processDirectionsResult(result: any, travelMode?: string): void {
    this.loadingService.update('正在取樣沿路位置', 50, '排除高架路段並建立查詢點');
    
    let sampledPoints: {lat: number, lng: number}[] = [];
    let lastSampledPoint: any = null;

    const legs = result.routes[0].legs;
    const totalDistance = legs.reduce(
      (sum: number, leg: any) => sum + Number(leg?.distance?.value || 0),
      0
    );
    if (totalDistance > this.maxRouteDistanceMeters) {
      this.loadingService.fail('路線超過 300 公里。請縮短路線後分段查詢，以免即時庫存服務過載。');
      return;
    }
    const isDriving = travelMode === 'DRIVING';

    for (const leg of legs) {
      for (const step of leg.steps) {
        // 高架/國道過濾邏輯
        let skipStep = false;
        if (isDriving) {
          const text = (step.instructions || '') + ' ' + (step.html_instructions || '');
          // 檢查是否包含封閉型道路關鍵字（國道、快速道路、高架、交流道等）
          const highSpeedKeywords = [
            '國道', '快速道路', '快速公路', '高架', '交流道', 
            '國1', '國2', '國3', '國4', '國5', '國6', '國8', '國10',
            '環道', '台61', '台62', '台64', '台66', '台68', '台72', '台74', '台76', '台78', '台82', '台84', '台86',
            '建國高架', '市民大道', '環東'
          ];
          
          if (highSpeedKeywords.some(key => text.includes(key))) {
            skipStep = true;
          }
        }

        if (skipStep) {
          // 偵測到高架路段，跳過取樣，避免要求使用者下交流道去超商
          continue;
        }

        const stepPath = step.path;
        if (!stepPath || stepPath.length === 0) continue;

        for (const point of stepPath) {
          if (!lastSampledPoint) {
            sampledPoints.push({ lat: point.lat(), lng: point.lng() });
            lastSampledPoint = point;
          } else {
            const dist = (window as any).google.maps.geometry.spherical.computeDistanceBetween(lastSampledPoint, point);
            if (dist >= 2000) { // 每 2 公里取樣
              sampledPoints.push({ lat: point.lat(), lng: point.lng() });
              lastSampledPoint = point;
            }
          }
        }
      }
    }

    // 確保終點有被包含
    if (legs.length > 0) {
      const finalLeg = legs[legs.length - 1];
      const finalPoint = finalLeg.end_location;
      if (lastSampledPoint) {
        const distToLast = (window as any).google.maps.geometry.spherical.computeDistanceBetween(lastSampledPoint, finalPoint);
        if (distToLast > 2000) {
          sampledPoints.push({ lat: finalPoint.lat(), lng: finalPoint.lng() });
        }
      } else {
        sampledPoints.push({ lat: finalPoint.lat(), lng: finalPoint.lng() });
      }
    }

    sampledPoints = this.limitRouteSamplePoints(sampledPoints, this.maxRouteSamplePoints);

    this.searchMode = 'route';
    this.isLocationSearchMode = false;
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;
    this.searchCenterLat = sampledPoints[0]?.lat || this.latitude;
    this.searchCenterLng = sampledPoints[0]?.lng || this.longitude;

    // 清空追踪 state
    this.fmQueriedPKeys.clear();
    this.sevenQueriedStoreNos.clear();

    this.loadingService.update('正在查詢沿路門市', 62, `共 ${sampledPoints.length} 個路線查詢點`);
    this.routeSearchSubscription = from(sampledPoints).pipe(
      mergeMap(point => {
        const location: LocationData = {
          CurrentLocation: { Latitude: point.lat, Longitude: point.lng },
          SearchLocation: { Latitude: point.lat, Longitude: point.lng }
        };
        return forkJoin({
          sevenResult: this.sevenElevenService.getNearByStoreList(location).pipe(
            timeout(6000),
            catchError(() => of(null))
          ),
          familyMartResult: this.familyMartService.getNearByStoreList(
            { Latitude: point.lat, Longitude: point.lng },
            []
          ).pipe(
            timeout(6000),
            catchError((err) => {
              console.error('[RouteSearch] FM api request err:', err);
              return of(null);
            })
          )
        });
      }, 4),
      toArray()
    ).subscribe(results => {
      const sevenResults = results.map(result => result.sevenResult);
      const fmResults = results.map(result => result.familyMartResult);
      const sevenHealthy = sevenResults.some(
        (response: any) => Array.isArray(response?.element?.StoreStockItemList)
      );
      const familyMartHealthy = fmResults.some(
        (response: any) => response?.code === 1 && Array.isArray(response?.data)
      );
      if (!sevenHealthy && !familyMartHealthy) {
        this.loadingService.fail('沿路查詢暫時失敗，請稍後再試一次。');
        return;
      }
      this.loadingService.update('正在整理沿路庫存', 78, '兩家超商路線資料已回傳');
      console.log(`[RouteSearch] forkJoin completes. sevenLen=${sevenResults.length}, fmLen=${fmResults.length}`);
      const allStores: any[] = [];

      // 7-11 解析
      sevenResults.forEach((res: any) => {
        if (!res || !res.element || !res.element.StoreStockItemList) return;
        res.element.StoreStockItemList.forEach((store: any) => {
          if (!store.RemainingQty || store.RemainingQty <= 0) return;
          const storeNo = store.StoreNo || '';
          if (this.sevenQueriedStoreNos.has(storeNo)) return;
          this.sevenQueriedStoreNos.add(storeNo);

          // 計算該店距離這條「路線」的最佳最短距離 (選用路徑上最近的點代表)
          // 但簡化起見，算距離起點的距離排序
          const dist = this.calc711DistFromUser(storeNo);

          allStores.push({
            ...store,
            storeName: `7-11${store.StoreName}門市`,
            label: '7-11',
            distance: dist,
            remainingQty: store.RemainingQty,
            showDistance: true,
            CategoryStockItems: store.CategoryStockItems
          });
        });
      });

      // 全家解析
      fmResults.forEach((res: any) => {
        if (!res || res.code !== 1 || !res.data) return;
        res.data.forEach((store: any) => {
          const pkey = store.oldPKey || store.name;
          if (this.fmQueriedPKeys.has(pkey)) return;
          this.fmQueriedPKeys.add(pkey);

          // 計算總庫存量，若為 0 則過濾掉
          let totalQty = 0;
          let hasKeywordMatch = false;

          if (store.info && Array.isArray(store.info)) {
            store.info.forEach((cat: any) => {
              totalQty += (cat.qty || 0);
              if (this.routeProductKeywords.length > 0 && cat.categories) {
                cat.categories.forEach((subCat: any) => {
                  if (subCat.products) {
                    subCat.products.forEach((product: any) => {
                      // 名稱吻合且數量 > 0
                      if (product.name && product.qty > 0) {
                        if (this.routeProductKeywords.some(keyword => this.productNameMatches(product.name, keyword))) {
                          hasKeywordMatch = true;
                        }
                      }
                    });
                  }
                });
              }
            });
          }
          if (totalQty === 0) return;
          
          if (this.routeProductKeywords.length > 0 && !hasKeywordMatch) return; // 全家關鍵字比對

          const lat = parseFloat(store.latitude);
          const lng = parseFloat(store.longitude);

          const dist = !isNaN(lat) && !isNaN(lng)
            ? getDistance(
                { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
                { latitude: lat, longitude: lng }
              )
            : (store.distance || 0);

          allStores.push({
            ...store,
            storeName: store.name,
            label: '全家',
            distance: dist,
            remainingQty: totalQty,
            showDistance: true
          });
        });
      });

      // 如果沒有需要過濾 7-11 關鍵字，直接渲染
      if (this.routeProductKeywords.length === 0) {
        this.finalizeRouteStores(allStores);
      } else {
        // 需過濾 7-11：找出 allStores 中的 7-11 門市，用 API 驗證，全家與已驗證成功的 7-11 再合併
        this.loadingService.update('正在核對 7-11 商品', 88, '逐店確認商品名稱與即時庫存');
        const sevenStores = allStores.filter(s => s.label === '7-11');
        const fmStores = allStores.filter(s => s.label === '全家');
        
        from(sevenStores).pipe(
          mergeMap(store => 
            this.sevenElevenService.getItemsByStoreNo(
              store.StoreNo,
              this.get711QueryLocation(store.StoreNo)
            ).pipe(
              map((detailRes: any) => {
                const detail = detailRes?.element?.StoreStockItem?.CategoryStockItems || [];
                store.CategoryStockItems = detail; // 更新詳細庫存
                const hasMatch = detail.some((cat: any) =>
                  cat.ItemList && cat.ItemList.some((item: any) => {
                    if (!item.ItemName || item.RemainingQty <= 0) return false;
                    return this.routeProductKeywords.some(keyword => this.productNameMatches(item.ItemName, keyword));
                  })
                );
                return hasMatch ? store : null;
              }),
              catchError(() => of(null)) // 驗證失敗則忽略該店
            )
          , 5), // 限制最多 5 個併發請求
          toArray()
        ).subscribe((verifiedSevenStores: any[]) => {
          const validSevenStores = verifiedSevenStores.filter(s => s !== null);
          console.log(`[RouteSearch] 7-11 keyword filter: kept ${validSevenStores.length} of ${sevenStores.length}`);
          this.finalizeRouteStores([...fmStores, ...validSevenStores]);
        });
      }
    });
  }

  private limitRouteSamplePoints(
    points: { lat: number; lng: number }[],
    maximum: number
  ): { lat: number; lng: number }[] {
    if (points.length <= maximum) return points;
    const selected = new Set<number>();
    for (let index = 0; index < maximum; index += 1) {
      selected.add(Math.round(index * (points.length - 1) / (maximum - 1)));
    }
    return [...selected].map(index => points[index]);
  }

  private finalizeRouteStores(allStores: any[]): void {
      // 最終排序與顯示
      allStores.sort((a, b) => (a.distance || 0) - (b.distance || 0));
      console.log(`[RouteSearch] Total valid stores found: ${allStores.length}`);

      // 設定「找不到結果」標記
      this.routeNoResults = (allStores.length === 0 && this.routeProductKeywords.length > 0);

      this.allNearbyStores = allStores;
      this.targetDisplayCount = this.minInitialStores;
      this.totalStoresShowList = this.allNearbyStores.slice(0, this.targetDisplayCount); 
      this.hasMoreStores = this.allNearbyStores.length > this.targetDisplayCount;
      this.storeDataService.setStores(this.allNearbyStores);
      this.storeDataService.setIsUserLocationSearch(false);
      
      this.loadingService.hide();
  }

  // ==========================================
  // 商品或種類搜尋模式（漸進式批次搜尋）
  // ==========================================
  // 統一初始化進階批次搜尋狀態
  private initPacedSearch(): void {
    this.searchMode = 'product'; // 將其視為商品(進階過濾)搜尋模式
    this.isLocationSearchMode = false;
    this.locationDenied = false;
    this.routeNoResults = false;
    this.totalStoresShowList = [];
    this.productSearchStores = [];
    this.unifiedDropDownList = [];

    // 重置漸進式搜尋狀態
    this.all711StoresSortedByDist = [];
    this.allFmStoresSortedByDist = [];
    this.productSearch711BatchIdx = 0;
    this.productSearchFmBatchIdx = 0;
    this.productSearchScanned = 0;
    this.productSearchTotalCandidates = 0;
    this.isSearchingMore = false;
    this.searchExhausted711 = false;
    this.searchExhaustedFm = false;
    this.fmQueriedPKeys = new Set();
    this.sevenQueriedStoreNos = new Set();
    this.hasMoreStores = true;
    this.productSearchRunning = true;
    this.targetDisplayCount = this.minInitialStores;
    this.productSearchGeneration++;  // 遞增世代，作廢舊搜尋的 setTimeout

    // 每一個外部請求本身都有 timeout 與來源健康檢查。不能用整體搜尋時間
    // 判斷網路失敗，因為「正常逐批掃完但沒有商品」本來就可能花較久。
  }

  // 等待商店資料載入後開始批次搜尋
  private waitForStoresDataAndSearch(): void {
    const beginSearch = (): void => {
      // 本機商品目錄已完整載入時，可先排除「目錄中根本不存在」的關鍵字。
      // 這是正常的零結果，不應啟動全門市掃描，更不應被誤報為網路逾時。
      if (!this.hasCatalogCandidateForCurrentSearch()) {
        this.completeProductSearchWithoutMatches();
        return;
      }
      this.prepareAllStoresByDistance();
      this.fetchProductSearchBatch(true);
    };

    if (this.storesDataReady && this.foodDetails711.length > 0) {
      beginSearch();
      return;
    }

    if (!this.searchDataReady$) {
      console.error('[商品搜尋] 本機門市資料尚未初始化');
      this.productSearchRunning = false;
      this.loadingService.fail('商品資料載入失敗，請重新整理後再試。');
      return;
    }

    this.loadingService.update('正在讀取商品索引', 46, '本機資料載入完成後立即開始');
    this.searchDataReady$.pipe(take(1)).subscribe(() => beginSearch());
  }

  private hasCatalogCandidateForCurrentSearch(): boolean {
    const productKeywords = this.selectedKeywords
      .filter(keyword => keyword.type !== 'store' && keyword.type !== 'route');
    if (productKeywords.length === 0) return true;

    const keywordExists = (keyword: any): boolean => {
      if (keyword.type === 'category') return true;
      const text = typeof keyword === 'string' ? keyword : keyword.name;
      return this.foodDetails711.some(item => !!item.name && this.productNameMatches(item.name, text)) ||
        this.foodDetailsFamilyMart.some(item => !!item.title && this.productNameMatches(item.title, text));
    };

    return this.keywordMatchMode === 'all'
      ? productKeywords.every(keywordExists)
      : productKeywords.some(keywordExists);
  }

  private completeProductSearchWithoutMatches(): void {
    this.searchExhausted711 = true;
    this.searchExhaustedFm = true;
    this.productSearchStores = [];
    this.totalStoresShowList = [];
    this.productSearchRunning = false;
    this.isSearchingMore = false;
    this.isLoadingMore = false;
    this.hasMoreStores = false;
    this.storeDataService.setStores([]);
    this.storeDataService.setIsUserLocationSearch(true);
    this.loadingService.hide();
  }

  private isLocalSearchIndexReady(): boolean {
    return this.storesDataReady &&
      (this.foodDetails711.length > 0 || this.foodDetailsFamilyMart.length > 0);
  }

  private beginProductSearchAfterPreflight(searchGeneration: number): void {
    if (searchGeneration !== this.productSearchGeneration) return;

    // 本機索引已能確定關鍵字不存在時，立即回覆零結果，不等待定位或外部憑證。
    if (!this.hasCatalogCandidateForCurrentSearch()) {
      this.completeProductSearchWithoutMatches();
      return;
    }

    this.loadingService.update('正在取得搜尋位置', 28, '確認附近門市範圍');
    forkJoin({
      position: from(this.geolocationService.getCurrentPosition({
        maximumAge: 5 * 60_000,
        timeout: 5000,
        enableHighAccuracy: false
      })).pipe(catchError((error) => {
        console.warn('無法取得定位，改用台北市中心作為搜尋起點。', error);
        return of(null);
      })),
      token: this.sevenElevenService.ensureGatewayReady().pipe(
        timeout(4000),
        catchError(() => of(null))
      )
    }).subscribe(({ position }) => {
      if (searchGeneration !== this.productSearchGeneration) return;
      if (position) {
        this.latitude = position.coords.latitude;
        this.longitude = position.coords.longitude;
        this.searchCenterLat = this.latitude;
        this.searchCenterLng = this.longitude;
        this.locationFallbackUsed = false;
      } else {
        this.searchCenterLat = 25.0330;
        this.searchCenterLng = 121.5654;
        this.locationFallbackUsed = true;
      }
      this.locationDenied = false;
      this.loadingService.update('正在比對附近門市', 42, '商品索引已確認，開始查詢附近庫存');
      this.waitForStoresDataAndSearch();
    });
  }

  // 將所有門市按距離排序（利用已載入的 JSON）
  // 使用 searchCenterLat/Lng 作為距離計算基準
  private prepareAllStoresByDistance(): void {
    const centerLat = this.searchCenterLat;
    const centerLng = this.searchCenterLng;

    // 7-11：all711Stores 在 init() 時已載入
    // JSON 欄位: name, addr, serial, lat, lng
    if (this.all711Stores && this.all711Stores.length > 0) {
      this.all711StoresSortedByDist = this.all711Stores
        .filter((s: any) => s.lat && s.lng)
        .map((s: any) => ({
          ...s,
          StoreNo: s.serial,
          StoreName: s.name,
          distance: getDistance(
            { latitude: centerLat, longitude: centerLng },
            { latitude: s.lat, longitude: s.lng }
          )
        }))
        .sort((a: any, b: any) => a.distance - b.distance);
      console.log(`[擴展搜尋] 7-11 門市按距離排序完成: ${this.all711StoresSortedByDist.length} 間，最近: ${this.all711StoresSortedByDist[0]?.StoreName} (${this.all711StoresSortedByDist[0]?.distance}m)`);
    }

    // 全家：dropDownFamilyMartList 在 init() 時已載入
    if (this.dropDownFamilyMartList && this.dropDownFamilyMartList.length > 0) {
      this.allFmStoresSortedByDist = this.dropDownFamilyMartList
        .filter((s: any) => s.py_wgs84 && s.px_wgs84)
        .map((s: any) => ({
          ...s,
          latitude: Number(s.py_wgs84),
          longitude: Number(s.px_wgs84),
          distance: getDistance(
            { latitude: centerLat, longitude: centerLng },
            { latitude: Number(s.py_wgs84), longitude: Number(s.px_wgs84) }
          )
        }))
        .sort((a: any, b: any) => a.distance - b.distance);
      console.log(`[擴展搜尋] 全家門市按距離排序完成: ${this.allFmStoresSortedByDist.length} 間`);
    }

    this.productSearchTotalCandidates =
      this.all711StoresSortedByDist.length + this.allFmStoresSortedByDist.length;
  }

  private matches711CategoryKeyword(detail: any[], keyword: string): boolean {
    return detail.some((stockCategory: any) => {
      if (!stockCategory || stockCategory.RemainingQty <= 0) return false;
      return this.foodCategories.some(foodCategory => {
        const parentMatches = this.productNameMatches(foodCategory.Name, keyword);
        const childMatches = foodCategory.Children.some(child =>
          child.ID === stockCategory.NodeID && this.productNameMatches(child.Name, keyword)
        );
        return childMatches ||
          (parentMatches && foodCategory.Children.some(child => child.ID === stockCategory.NodeID));
      });
    });
  }

  private matches711DetailKeyword(
    detail: any[],
    keyword: { text: string; isCategory: boolean }
  ): boolean {
    if (keyword.isCategory) return this.matches711CategoryKeyword(detail, keyword.text);
    return detail.some((category: any) =>
      (category.ItemList || []).some((item: any) =>
        item.RemainingQty > 0 && this.productNameMatches(item.ItemName, keyword.text)
      )
    );
  }

  private matchesFamilyMartKeyword(
    store: any,
    keyword: { text: string; isCategory: boolean }
  ): boolean {
    return (store.info || []).some((category: any) => {
      if (keyword.isCategory) {
        if (category.qty <= 0) return false;
        if (this.productNameMatches(category.name || '', keyword.text)) return true;
        return (category.categories || []).some((subCategory: any) =>
          subCategory.qty > 0 && this.productNameMatches(subCategory.name || '', keyword.text)
        );
      }
      return (category.categories || []).some((subCategory: any) =>
        (subCategory.products || []).some((product: any) =>
          product.qty > 0 && this.productNameMatches(product.name || '', keyword.text)
        )
      );
    });
  }

  // 批次搜尋：同時查 7-11 和全家；首批有任何結果就先呈現
  private fetchProductSearchBatch(isInitial: boolean): void {
    const currentGen = this.productSearchGeneration;
    // 上一次搜尋仍在進行——等它完成後自己會繼續，不重試以避免重複鏈
    if (this.isSearchingMore) return;
    this.isSearchingMore = true;

    // 支援多關鍵字搜尋 (取自 selectedKeywords)
    const productChips = this.selectedKeywords.filter(k => k.type !== 'store' && k.type !== 'route');
    const productKeywords = productChips.map(k => ({
      text: typeof k === 'string' ? k : k.name,
      isCategory: typeof k !== 'string' && k.type === 'category'
    }));

    // 若沒有任何商品關鍵字，預設不擋
    const noProductFilter = productKeywords.length === 0;

    const batchSize = this.productSearchBatchSize;

    // 準備 7-11 批次
    const sevenBatchStart = this.productSearch711BatchIdx * batchSize;
    const sevenBatch = this.all711StoresSortedByDist.slice(sevenBatchStart, sevenBatchStart + batchSize);
    this.productSearch711BatchIdx++;
    this.searchExhausted711 = sevenBatchStart + sevenBatch.length >= this.all711StoresSortedByDist.length;

    // 準備全家批次：取得一組尚未查過的全家門市，用它們的座標呼叫 API
    const fmBatchStart = this.productSearchFmBatchIdx * batchSize;
    const fmBatch = this.allFmStoresSortedByDist.slice(fmBatchStart, fmBatchStart + batchSize);
    this.productSearchFmBatchIdx++;
    this.searchExhaustedFm = fmBatchStart + fmBatch.length >= this.allFmStoresSortedByDist.length;
    this.productSearchScanned = Math.min(
      this.productSearchTotalCandidates,
      Math.min(this.productSearch711BatchIdx * batchSize, this.all711StoresSortedByDist.length) +
      Math.min(this.productSearchFmBatchIdx * batchSize, this.allFmStoresSortedByDist.length)
    );
    const nearbyScanGoal = Math.max(1, Math.min(
      this.maxInitialNoResultCandidates,
      this.productSearchTotalCandidates
    ));
    const nearbyScanRatio = Math.min(1, this.productSearchScanned / nearbyScanGoal);
    this.loadingService.update(
      isInitial ? '正在比對商品庫存' : '正在擴展搜尋範圍',
      isInitial ? 50 + Math.round(nearbyScanRatio * 20) : 72,
      `正在檢查附近 ${Math.min(this.productSearchScanned, nearbyScanGoal)} / ${nearbyScanGoal} 間候選門市`
    );

    // 第一批次：永遠包含使用者的 GPS 座標作為首要查詢點，確保最近的門市優先被搜尋
    const sevenQueryPoints: any[] = [];
    if (this.productSearch711BatchIdx === 1 && this.searchCenterLat && this.searchCenterLng) {
      sevenQueryPoints.push({ latitude: this.searchCenterLat, longitude: this.searchCenterLng });
    }
    // 使用 800 公尺半徑，幾何覆蓋算法保證這批次的每一間 7-11 都落在查詢範圍內，達成 100% 無盲區
    const batchPoints = this.getCoveringPoints(
      sevenBatch.map((s: any) => ({ latitude: s.lat, longitude: s.lng })), 
      800
    );
    sevenQueryPoints.push(...batchPoints);

    const sevenRegionalRequests = sevenQueryPoints.length > 0
      ? sevenQueryPoints.map((point: any) => {
          const locData: LocationData = {
            CurrentLocation: { Latitude: point.latitude, Longitude: point.longitude },
            SearchLocation: { Latitude: point.latitude, Longitude: point.longitude }
          };
          return this.sevenElevenService.getNearByStoreList(locData).pipe(
            timeout(4500),
            catchError(() => of(null))
          );
        })
      : [of(null)];

    // === 全家: 使用空間覆蓋半徑查詢 ===
    // 全家 API (MapProductInfo) 嚴格限制搜尋半徑，傳送距離過遠的 OldPKeys 會被 API 直接丟棄
    // 因此必須使用 getCoveringPoints 產生多個中心點進行多次區域搜尋
    const fmQueryPoints: any[] = [];
    if (this.productSearchFmBatchIdx === 1 && this.searchCenterLat && this.searchCenterLng) {
      fmQueryPoints.push({ latitude: this.searchCenterLat, longitude: this.searchCenterLng });
    }
    const fmBatchPoints = this.getCoveringPoints(
      fmBatch.map((s: any) => ({ latitude: s.latitude, longitude: s.longitude })),
      800 // 800公尺半徑
    );
    fmQueryPoints.push(...fmBatchPoints);

    const fmRegionalRequests = fmQueryPoints.length > 0
      ? fmQueryPoints.map((point: any) =>
          this.familyMartService.getNearByStoreList({
            Latitude: point.latitude,
            Longitude: point.longitude
          }).pipe(
            timeout(4500),
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    // 同時查詢 7-11 區域 + 全家區域

    forkJoin({
      sevenResults: forkJoin(sevenRegionalRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }) => {
      this.loadingService.update('正在確認商品明細', 70, '區域門市查詢完成，核對商品名稱中');
      const sevenHealthy = (sevenResults || []).some(
        (response: any) => Array.isArray(response?.element?.StoreStockItemList)
      );
      const familyMartHealthy = (fmResults || []).some(
        (response: any) => response?.code === 1 && Array.isArray(response?.data)
      );
      if (!sevenHealthy && !familyMartHealthy) {
        this.isSearchingMore = false;
        this.isLoadingMore = false;
        this.productSearchRunning = false;
        this.loadingService.fail('查詢服務暫時沒有回應，請稍後再試一次。');
        return;
      }
      const newMatches: any[] = [];
      let isPhase2Running = false;

      // === 處理 7-11 結果 ===
      // getNearByStoreList 不含 ItemList → 無法精確比對商品名稱
      // 策略：先從 getNearByStoreList 收集候選門市，再用 getItemsByStoreNo 驗證
      if (sevenResults) {
        // 收集候選門市（有庫存且未查詢過的）
        const candidateStores: any[] = [];
        sevenResults.forEach((res: any) => {
          if (!res || !res.element || !res.element.StoreStockItemList) return;
          res.element.StoreStockItemList.forEach((store: any) => {
            if (!store.RemainingQty || store.RemainingQty <= 0) return;
            const storeNo = store.StoreNo || '';
            if (this.sevenQueriedStoreNos.has(storeNo)) return;
            this.sevenQueriedStoreNos.add(storeNo);

            if (noProductFilter) {
              newMatches.push({
                ...store,
                storeName: `7-11${store.StoreName}門市`,
                label: '7-11',
                distance: this.calc711DistFromUser(store.StoreNo),
                remainingQty: store.RemainingQty,
                showDistance: true,
                CategoryStockItems: store.CategoryStockItems || []
              });
            } else {
              const detail = store.CategoryStockItems || [];
              const categoryKeywords = productKeywords.filter(keyword => keyword.isCategory);
              const hasTextKeywords = productKeywords.some(keyword => !keyword.isCategory);
              const categorySummaryMatches = categoryKeywords.length > 0 &&
                this.matchesKeywordSet(
                  keyword => this.matches711CategoryKeyword(detail, keyword.text),
                  categoryKeywords
                );
              const summaryIsConclusive = this.keywordMatchMode === 'any'
                ? categorySummaryMatches
                : !hasTextKeywords && categorySummaryMatches;

              if (summaryIsConclusive) {
                newMatches.push({
                  ...store,
                  storeName: `7-11${store.StoreName}門市`,
                  label: '7-11',
                  distance: this.calc711DistFromUser(store.StoreNo),
                  remainingQty: store.RemainingQty,
                  showDistance: true,
                  CategoryStockItems: detail
                });
              } else if (hasTextKeywords) {
                candidateStores.push(store);
              }
            }
          });
        });

        // === Phase 2: 商品名稱搜尋 — 用 getItemsByStoreNo 精確驗證 ===
        const hasTextKwsGlobal = productKeywords.some(kw => !kw.isCategory);
        if (hasTextKwsGlobal && candidateStores.length > 0) {
          isPhase2Running = true;
          // 將所有候選門市按距離排序後全部驗證，不任意丟棄
          candidateStores.sort((a, b) => {
            return this.calc711DistFromUser(a.StoreNo) - this.calc711DistFromUser(b.StoreNo);
          });
          console.log(`[商品搜尋] 7-11 候選 ${candidateStores.length} 間，全部將加入驗證隊列 (併發上限 5)`);

          from(candidateStores).pipe(
            mergeMap(store =>
              this.sevenElevenService.getItemsByStoreNo(
                store.StoreNo,
                this.get711QueryLocation(store.StoreNo)
              ).pipe(
                timeout(4500),
                map((res: any) => {
                  const detail = res?.element?.StoreStockItem?.CategoryStockItems || [];
                  const hasMatch = this.matchesKeywordSet(
                    keyword => this.matches711DetailKeyword(detail, keyword),
                    productKeywords
                  );
                  if (hasMatch) {
                    return {
                      ...store,
                      storeName: `7-11${store.StoreName}門市`,
                      label: '7-11',
                      distance: this.calc711DistFromUser(store.StoreNo),
                      remainingQty: store.RemainingQty,
                      showDistance: true,
                      CategoryStockItems: detail
                    };
                  }
                  return null;
                }),
                catchError(() => of(null))
              )
            , 10), // 首批最多 10 間，一次完成明細核對，避免多輪等待
            toArray()
          ).subscribe((verifiedResults: any[]) => {
            const verifiedMatches = verifiedResults.filter(match => match !== null);

            console.log(`[商品搜尋] 7-11 驗證結果: ${verifiedMatches.length}/${candidateStores.length} 間符合條件`);

            // 交給 finishProductSearchBatch 處理合併與狀態更新
            this.finishProductSearchBatch(currentGen, isInitial, verifiedMatches);
          });
          // 7-11 phase 2 是 async，但全家結果可以先處理
        }
      }

      // === 處理全家結果 ===
      if (fmResults) {
        fmResults.forEach((fmRes: any) => {
          if (!fmRes || fmRes.code !== 1 || !fmRes.data) return;
          fmRes.data.forEach((store: any) => {
            // 去重：同一間店只加一次
            const pkey = store.oldPKey || store.name;
            if (this.fmQueriedPKeys.has(pkey)) return;
            this.fmQueriedPKeys.add(pkey);

            let hasMatch = false;
            
            if (noProductFilter) {
              hasMatch = true;
            } else if (store.info) {
              hasMatch = this.matchesKeywordSet(
                keyword => this.matchesFamilyMartKeyword(store, keyword),
                productKeywords
              );
            }

            if (hasMatch) {
              // 用 geolib 從使用者位置計算真實距離
              const dist = getDistance(
                { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
                { latitude: store.latitude, longitude: store.longitude }
              );
              newMatches.push({
                ...store,
                storeName: store.name,
                label: '全家',
                distance: dist,
                showDistance: true
              });
            }
          });
        });
      }

      // 決定何時結束此批次
      if (!isPhase2Running) {
        // 如果 7-11 Phase 2 沒有執行，立刻結束此批次
        this.finishProductSearchBatch(currentGen, isInitial, newMatches);
      } else {
        // 先收集較快的來源，等較慢的 7-11 明細一起完成後再一次呈現，
        // 避免使用者開始瀏覽後卡片又持續重排。
        this.productSearchStores = [...this.productSearchStores, ...newMatches];
        this.productSearchStores.sort((a, b) => a.distance - b.distance);
        this.loadingService.update('正在整理結果', 82, '等待所有來源完成');
      }
    });
  }

  // 結束單次商品搜尋批次，處理 UI 更新與自動加載下一批
  private finishProductSearchBatch(currentGen: number, isInitial: boolean, newMatches: any[]): void {
    // 加入已有結果緩衝池並排序
    this.productSearchStores = [...this.productSearchStores, ...newMatches];
    this.productSearchStores.sort((a, b) => a.distance - b.distance);

    this.isSearchingMore = false;

    // 檢查搜尋世代是否已過期（使用者已開始新搜尋）
    if (currentGen !== this.productSearchGeneration) return;

    // 判斷是否已經搜完所有門市
    const allExhausted = this.searchExhausted711 && this.searchExhaustedFm;
    this.hasMoreStores = !allExhausted;

    // 初次搜尋已完成一批附近門市且仍是零結果時，立即向使用者回覆。
    // 不再為了證明「全台都沒有」而讓進度條長時間停在畫面上。
    const reachedNearbyNoResultLimit = isInitial &&
      this.productSearchStores.length === 0 &&
      this.productSearchScanned >= Math.min(
        this.maxInitialNoResultCandidates,
        this.productSearchTotalCandidates
      );
    if (reachedNearbyNoResultLimit) {
      this.completeProductSearchWithoutMatches();
      return;
    }

    // 初始搜尋不渲染部分門市。若數量不足，先完成下一批，最後再一次顯示穩定排序。
    if (isInitial && this.productSearchStores.length < this.targetDisplayCount &&
        !allExhausted) {
      this.loadingService.update('正在擴大搜尋範圍', 86, '尚未找到足夠結果');
      setTimeout(() => {
        if (this.productSearchGeneration === currentGen) {
          this.fetchProductSearchBatch(true);
        }
      }, 0);
      return;
    }

    // 不論是 isInitial 還是 scroll load，統一從緩衝池中切割至目標數量
    this.totalStoresShowList = this.productSearchStores.slice(0, this.targetDisplayCount);

    this.storeDataService.setStores(this.productSearchStores);
    if (isInitial) {
      this.storeDataService.setIsUserLocationSearch(true);
    }

    // 首批只要找到任何門市就立刻呈現，不為了湊滿 5 間而繼續阻塞畫面。
    // 尚未查詢的門市保留給使用者向下瀏覽時再載入。
    if (isInitial && this.productSearchStores.length > 0) {
      this.isLoadingMore = false;
      this.productSearchRunning = false;
      this.loadingService.hide();
      return;
    }

    // 若顯示數量未達目標且仍有候選門市，自動發送下一批。
    // 地圖模式下，找到足夠門市後停止自動擴展，讓使用者手動「搜尋這個區域」
    if (this.totalStoresShowList.length < this.targetDisplayCount && !allExhausted) {
      if (this.isMapView && this.productSearchStores.length >= this.minInitialStores) {
        // 地圖模式已找到足夠門市，停止搜尋
        this.isLoadingMore = false;
        this.productSearchRunning = false;
        this.loadingService.hide();
      } else if (!isInitial) {
        this.isLoadingMore = true;
        this.fetchProductSearchBatch(false);
      }
    } else {
      // 數量達標（或全台灣庫存已抽乾），切斷連線，進入休眠
      this.isLoadingMore = false;
      this.productSearchRunning = false;
      this.loadingService.hide();

    }
  }

  // 【幾何覆蓋算法 - 7-11 專用】
  // 給定一組座標點與半徑 (預設 800m)，計算出最少的中心點數量，確保所有傳入座標都在這些中心點的半徑覆蓋範圍內。
  // 解決 7-11 區域查詢 1km 上限導致距離過遠之門市被遺漏（盲區）的問題。
  private getCoveringPoints(points: any[], radiusMeters: number = 800): any[] {
    if (points.length === 0) return [];
    
    const unvisited = [...points];
    const centers: any[] = [];

    while (unvisited.length > 0) {
      // 隨機（或順序）取一個未覆蓋的點作為新的中心
      const center = unvisited.shift();
      centers.push(center);

      // 把所有落在這個 center 覆蓋半徑內的點移除（即標記為已覆蓋）
      for (let i = unvisited.length - 1; i >= 0; i--) {
        const pt = unvisited[i];
        const dist = getDistance(
          { latitude: center.latitude, longitude: center.longitude },
          { latitude: pt.latitude, longitude: pt.longitude }
        );
        if (dist <= radiusMeters) {
          unvisited.splice(i, 1);
        }
      }
    }
    return centers;
  }

  // 顯示更多商品搜尋結果（無限滾動用）
  private showMoreProductResults(): void {
    this.totalStoresShowList = this.productSearchStores.slice(0, this.targetDisplayCount);
    this.isLoadingMore = false;
  }

  // 商品搜尋的無限滾動觸發
  private loadMoreProductResults(): void {
    if (this.isLoadingMore || this.isSearchingMore || !this.hasMoreStores) return;
    this.isLoadingMore = true;

    // 將目標顯示數量往上加 5
    this.targetDisplayCount += this.storesPerPage;

    if (this.productSearchStores.length >= this.targetDisplayCount) {
      // 緩衝池數量充足：直接切割顯示並休眠 API
      this.showMoreProductResults();
      return;
    } else {
      // 緩衝池不足：先把池裡剩下的全推上畫面
      this.totalStoresShowList = this.productSearchStores.slice(0, this.productSearchStores.length);

      // 如果還有門市可以搜尋，就繼續查下一批
      if (!this.searchExhausted711 || !this.searchExhaustedFm) {
        this.fetchProductSearchBatch(false);
      } else {
        this.hasMoreStores = false;
        this.isLoadingMore = false;
      }
    }
  }

  onSubmit(): void {
    // 表單提交時觸發搜尋
    this.performSearch();
  }

  // 執行搜尋（統一入口）
  performSearch(): void {
    if (!this.canStartDiscountSearch()) return;
    // 一般搜尋框採單一條件；進階搜尋送出時輸入框會保持空白。
    const val = String(this.keywordCtrl.value || '').trim();
    if (val) {
      const currentName = this.selectedKeywords.length === 1
        ? String(this.selectedKeywords[0]?.name || '')
        : '';
      if (currentName !== val) {
        this.selectedKeywords = [{ name: val, rawName: val, type: 'text' }];
        this.advancedSearchActive = false;
        this.keywordMatchMode = 'any';
      }
      this.searchTerm = val;
    }

    this.unifiedDropDownList = [];

    if (this.selectedKeywords.length === 0) {
      this.onUseCurrentLocation();
      return;
    }

    // Process route chip
    const routeChip = this.selectedKeywords.find(c => c.type === 'route');
    if (routeChip) {
      this.selectedKeywords = this.selectedKeywords.filter(c => c !== routeChip);
      this.handleRouteSelection(routeChip.originalUrl);
      return;
    }

    this.stopProductSearch();

    const storeChips = this.selectedKeywords.filter(c => c.type === 'store');
    if (storeChips.length > 0) {
      this.searchSelectedStores(storeChips);
      return;
    }

    this.initPacedSearch();
    const searchGeneration = this.productSearchGeneration;
    this.loadingService.begin('正在確認搜尋內容', 12, '比對本機商品與門市索引');

    if (this.isLocalSearchIndexReady()) {
      this.beginProductSearchAfterPreflight(searchGeneration);
      return;
    }

    if (!this.searchDataReady$) {
      this.productSearchRunning = false;
      this.loadingService.fail('商品資料載入失敗，請重新整理後再試。');
      return;
    }

    this.searchDataReady$.pipe(take(1)).subscribe({
      next: () => this.beginProductSearchAfterPreflight(searchGeneration),
      error: () => {
        if (searchGeneration !== this.productSearchGeneration) return;
        this.productSearchRunning = false;
        this.loadingService.fail('商品資料載入失敗，請重新整理後再試。');
      }
    });
  }

  private searchSelectedStores(storeChips: any[]): void {
    const searchGeneration = ++this.storeSearchGeneration;
    const productKeywords = this.selectedKeywords
      .filter(keyword => keyword.type !== 'store' && keyword.type !== 'route')
      .map(keyword => ({
        text: typeof keyword === 'string' ? keyword : keyword.name,
        isCategory: typeof keyword !== 'string' && keyword.type === 'category'
      }));

    this.searchMode = 'store';
    this.isLocationSearchMode = false;
    this.locationDenied = false;
    this.routeNoResults = false;
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;
    this.productSearchRunning = false;
    this.searchCenterLat = Number(storeChips[0]?.latitude) || this.latitude || 0;
    this.searchCenterLng = Number(storeChips[0]?.longitude) || this.longitude || 0;
    this.loadingService.begin(
      `正在更新 ${storeChips.length} 間門市`,
      18,
      '即時庫存同步查詢中'
    );

    const tokenReady$ = storeChips.some(chip => chip.label === '7-11')
      ? this.sevenElevenService.ensureGatewayReady().pipe(
          timeout(3000),
          catchError(() => of(null))
        )
      : of(null);

    tokenReady$.pipe(
      switchMap(() => {
        this.loadingService.update('正在比對指定門市', 48, '憑證與門市資料已就緒');
        const requests = storeChips.map(chip => this.fetchSelectedStore(chip, productKeywords));
        return forkJoin(requests.length > 0 ? requests : [of(null)]);
      })
    ).subscribe({
      next: (stores: any[]) => {
        if (searchGeneration !== this.storeSearchGeneration) return;
        const results = stores
          .filter(Boolean)
          .sort((a, b) => (a.distance || 0) - (b.distance || 0));
        results.forEach(store => this.precomputeCategoryQty(store));
        this.allNearbyStores = results;
        this.totalStoresShowList = results;
        this.storeDataService.setStores(results);
        this.storeDataService.setIsUserLocationSearch(false);
        this.loadingService.hide();
      },
      error: (error) => {
        if (searchGeneration !== this.storeSearchGeneration) return;
        console.error('指定門市查詢失敗:', error);
        this.loadingService.fail('指定門市查詢失敗，請稍後再試。');
      }
    });
  }

  private fetchSelectedStore(
    chip: any,
    productKeywords: { text: string; isCategory: boolean }[]
  ): Observable<any | null> {
    if (chip.label === '7-11') {
      const localStore = this.all711Stores.find(store =>
        store.serial === chip.storeNo ||
        this.normalizeSearchText(store.name) === this.normalizeSearchText(chip.rawName || chip.name)
      );
      const storeNo = chip.storeNo || localStore?.serial;
      if (!storeNo) return of(null);

      return this.sevenElevenService.getItemsByStoreNo(
        storeNo,
        this.get711QueryLocation(storeNo)
      ).pipe(
        timeout(4500),
        map((response: any) => {
          const stock = response?.element?.StoreStockItem || {};
          const detail = stock.CategoryStockItems || [];
          const hasMatch = this.matchesKeywordSet(
            keyword => this.matches711DetailKeyword(detail, keyword),
            productKeywords
          );
          if (productKeywords.length > 0 && !hasMatch) return null;

          const remainingQty = stock.RemainingQty ?? detail.reduce(
            (sum: number, category: any) => sum + (category.RemainingQty || 0),
            0
          );
          const coords = this.get711StoreCoords(storeNo);
          return {
            ...stock,
            StoreNo: storeNo,
            StoreName: stock.StoreName || localStore?.name || chip.rawName || chip.name,
            storeName: `7-11 ${stock.StoreName || localStore?.name || chip.rawName || chip.name}門市`,
            label: '7-11',
            RemainingQty: remainingQty,
            remainingQty,
            CategoryStockItems: detail,
            distance: this.distanceFromUser(coords?.lat, coords?.lng),
            showDistance: true
          };
        }),
        catchError(error => {
          console.error(`7-11 ${chip.rawName || chip.name} 庫存查詢失敗:`, error);
          return of(this.createUnavailableSelectedStore(chip));
        })
      );
    }

    const location = {
      Latitude: Number(chip.latitude),
      Longitude: Number(chip.longitude)
    };
    return this.familyMartService.getNearByStoreList(location).pipe(
      timeout(4500),
      map((response: any) => {
        const stores = response?.code === 1 && Array.isArray(response.data) ? response.data : [];
        const targetName = this.normalizeSearchText(chip.rawName || chip.name);
        const store = stores.find((candidate: any) =>
          candidate.oldPKey === chip.pkeynew ||
          this.normalizeSearchText(candidate.name) === targetName
        );
        if (!store) {
          return productKeywords.length === 0 ? this.createUnavailableSelectedStore(chip) : null;
        }
        const hasMatch = this.matchesKeywordSet(
          keyword => this.matchesFamilyMartKeyword(store, keyword),
          productKeywords
        );
        if (productKeywords.length > 0 && !hasMatch) return null;
        return {
          ...store,
          storeName: store.name,
          label: '全家',
          distance: this.distanceFromUser(Number(store.latitude), Number(store.longitude)),
          showDistance: true
        };
      }),
      catchError(error => {
        console.error(`全家 ${chip.rawName || chip.name} 庫存查詢失敗:`, error);
        return of(this.createUnavailableSelectedStore(chip));
      })
    );
  }

  private createUnavailableSelectedStore(chip: any): any {
    if (chip.label === '7-11') {
      const rawName = (chip.rawName || chip.name || '').replace(/^7-11\s*/, '').replace(/門市$/, '');
      return {
        StoreNo: chip.storeNo,
        StoreName: rawName,
        storeName: `7-11 ${rawName}門市`,
        label: '7-11',
        RemainingQty: 0,
        remainingQty: 0,
        CategoryStockItems: [],
        inventoryUnavailable: true,
        distance: this.distanceFromUser(Number(chip.latitude), Number(chip.longitude)),
        showDistance: true
      };
    }
    const rawName = chip.rawName || chip.name;
    return {
      name: rawName,
      storeName: rawName,
      label: '全家',
      info: [],
      inventoryUnavailable: true,
      latitude: Number(chip.latitude),
      longitude: Number(chip.longitude),
      distance: this.distanceFromUser(Number(chip.latitude), Number(chip.longitude)),
      showDistance: true
    };
  }

  private distanceFromUser(lat?: number, lng?: number): number {
    if (!lat || !lng || !this.latitude || !this.longitude) return 0;
    return getDistance(
      { latitude: this.latitude, longitude: this.longitude },
      { latitude: lat, longitude: lng }
    );
  }

  // 強制終止並作廢目前進行中的商品/種類搜尋
  private stopProductSearch(): void {
    if (this.productSearchRunning || this.isSearchingMore || this.isLoadingMore) {
      this.productSearchGeneration++; // 作廢進行中的 fetchProductSearchBatch 回呼
      this.productSearchRunning = false;
      this.isSearchingMore = false;
      this.isLoadingMore = false;
    }
  }

  private locateAndSearchNearby(forceFresh: boolean): void {
    if (!this.canStartDiscountSearch()) return;
    this.loadingService.update('正在取得你的位置', 16, '定位完成後會同時查詢 7-11 與全家');
    from(this.geolocationService.getCurrentPosition({
      maximumAge: forceFresh ? 60_000 : 5 * 60_000,
      timeout: 5000,
      enableHighAccuracy: false
    })).subscribe({
      next: (position) => {
        if (!this.canStartDiscountSearch()) return;
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        this.latitude = lat;
        this.longitude = lng;
        this.searchCenterLat = lat;
        this.searchCenterLng = lng;
        this.locationDenied = false;
        this.locationFallbackUsed = false;
        this.loadingService.update('正在查詢附近庫存', 34, '兩家超商同步查詢中');
        this.searchCombineAndTransformStoresExpanded();
      },
      error: (error) => {
        console.warn('定位未授權或暫時無法取得。', error);
        // 若已有快取結果就保留畫面，不讓暫時性的 GPS 問題把可用內容清空。
        if (this.totalStoresShowList.length > 0) {
          this.locationFallbackUsed = true;
          this.loadingService.hide();
          return;
        }
        this.locationDenied = true;
        this.locationFallbackUsed = false;
        this.loadingService.hide();
      }
    });
  }

  onUseCurrentLocation(): void {
    if (!this.canStartDiscountSearch()) return;
    // 變更搜尋模式
    this.searchMode = 'location';
    this.isLocationSearchMode = true;

    // 清除商店列表
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;

    // 強制停止並作廢仍在進行的商品搜尋
    this.stopProductSearch();

    // 重置漸進式搜尋狀態
    this.all711StoresSortedByDist = [];
    this.allFmStoresSortedByDist = [];
    this.productSearch711BatchIdx = 0;
    this.productSearchFmBatchIdx = 0;
    this.searchExhausted711 = false;
    this.searchExhaustedFm = false;
    this.fmQueriedPKeys = new Set();
    this.sevenQueriedStoreNos = new Set();

    // 清除輸入的搜尋條件
    this.unifiedDropDownList = [];
    this.searchTerm = '';
    this.advancedSearchActive = false;

    this.loadingService.begin('正在取得你的位置', 8, '重新定位並更新附近庫存');
    this.locateAndSearchNearby(true);
  }

  private toDisplayKeyword(keyword: any): any {
    const displayKeyword = { ...keyword, rawName: keyword.rawName || keyword.name };
    if (displayKeyword.type !== 'store') return displayKeyword;

    const rawName = String(displayKeyword.rawName || displayKeyword.name || '');
    displayKeyword.name = displayKeyword.label === '全家'
      ? (rawName.includes('全家') ? rawName : `全家${rawName}`).replace(/店$/, '門市')
      : `7-11 ${rawName.replace(/^7-11\s*/, '').replace(/門市$/, '')}門市`;
    return displayKeyword;
  }

  useFallbackLocation(): void {
    if (!this.canStartDiscountSearch()) return;
    const fallbackLatitude = 25.0330;
    const fallbackLongitude = 121.5654;

    this.searchMode = 'location';
    this.isLocationSearchMode = false;
    this.locationDenied = false;
    this.locationFallbackUsed = true;
    this.routeNoResults = false;
    this.isMapView = false;
    this.mapSheetOpen = false;

    this.latitude = fallbackLatitude;
    this.longitude = fallbackLongitude;
    this.searchCenterLat = fallbackLatitude;
    this.searchCenterLng = fallbackLongitude;

    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;
    this.stopProductSearch();
    this.sevenQueriedStoreNos = new Set();
    this.fmQueriedPKeys = new Set();
    this.loadingService.begin('正在搜尋台北 101 附近門市', 34, '兩家超商同步查詢中');

    this.searchCombineAndTransformStoresExpanded(fallbackLatitude, fallbackLongitude);
  }

  combineStoreList(storeLatitude?: number, storeLongitude?: number): void {
    // 清空統一列表，避免重複累加
    this.totalStoresShowList = [];

    // 處理7-11商店（過濾掉沒有折扣商品的門市）
    this.nearby711Stores.forEach((store) => {
      if (!store.RemainingQty || store.RemainingQty <= 0) return;
      const transformedStore = {
        ...store,
        storeName: `7-11${store.StoreName}門市`,
        label: '7-11',
        distance: this.calc711DistFromUser(store.StoreNo),
        remainingQty: store.RemainingQty,
        showDistance: true,
        CategoryStockItems: store.CategoryStockItems
      };
      this.precomputeCategoryQty(transformedStore);
      this.totalStoresShowList.push(transformedStore);
    });

    // 處理全家商店
    this.nearbyFamilyMartStores.forEach((store) => {
      const transformedStore = {
        ...store,
        storeName: store.name,
        label: '全家',
        distance: store.distance,
        showDistance: true
      };
      this.totalStoresShowList.push(transformedStore);  // 推入統一列表
    });

    if (storeLatitude && storeLongitude) {
      this.totalStoresShowList.sort((a, b) => a.distance - b.distance);
    }
    else{
      // 根據距離排序
      this.totalStoresShowList.sort((a, b) => a.distance - b.distance);
    }
  }

  searchCombineAndTransformStores(storeLatitude?: number, storeLongitude?: number): void {
    if (!this.canStartDiscountSearch()) return;
    // 如果没有參數就用默認的定位值
    const finalLatitude = storeLatitude || this.latitude;
    const finalLongitude = storeLongitude || this.longitude;

    const locationData711: LocationData = {
      CurrentLocation: {
        Latitude: finalLatitude,
        Longitude: finalLongitude
      },
      SearchLocation: {
        Latitude: finalLatitude,
        Longitude: finalLongitude
      }
    };

    const locationFamilyMart: Location = {
      Latitude: finalLatitude,
      Longitude: finalLongitude
    };



    // 結合兩個 API 請求
    forkJoin({
      sevenEleven: this.sevenElevenService.getNearByStoreList(locationData711),
      familyMart: this.familyMartService.getNearByStoreList(locationFamilyMart)
    }).subscribe(
      ({ sevenEleven, familyMart }) => {
        // 處理 7-11 資料
        if (sevenEleven && sevenEleven.element && sevenEleven.element.StoreStockItemList) {
          this.nearby711Stores = sevenEleven.element.StoreStockItemList.sort(
            (a: StoreStockItem, b: StoreStockItem) => a.Distance - b.Distance
          );
        }

        // 處理全家資料
        if (familyMart && familyMart.code === 1) {
          this.nearbyFamilyMartStores = familyMart.data.sort(
            (a: StoreModel, b: StoreModel) => a.distance - b.distance
          );
        }

        // 等兩者完成後合併資料
        if (storeLatitude && storeLongitude) {
          this.combineStoreList(storeLatitude, storeLongitude);
          this.storeDataService.setStores(this.totalStoresShowList);
          this.storeDataService.setIsUserLocationSearch(false);
          this.checkAndAutoLoadMore();
        }
        else{
          this.combineStoreList();
          this.storeDataService.setStores(this.totalStoresShowList);
          this.storeDataService.setIsUserLocationSearch(true);
          this.checkAndAutoLoadMore();
        }
      },
      (error) => {
        console.error('Error fetching store data:', error);
      }
    );
  }

  private fetchNearby711WithRecovery(locationData: LocationData): Observable<any | null> {
    const attempt = (forceTokenRefresh: boolean): Observable<any> =>
      this.sevenElevenService.ensureGatewayReady(forceTokenRefresh).pipe(
        switchMap((token: any) => {
          if (!token?.element) throw new Error('7-11 access token is unavailable');
          return this.sevenElevenService.getNearByStoreList(locationData);
        }),
        map((response: any) => {
          if (!Array.isArray(response?.element?.StoreStockItemList)) {
            throw new Error('7-11 nearby response is incomplete');
          }
          return response;
        }),
        timeout(5500)
      );

    return attempt(false).pipe(
      catchError((firstError) => {
        console.warn('7-11 附近庫存首次查詢失敗，重新取得憑證後再試。', firstError);
        return attempt(true).pipe(
          catchError((retryError) => {
            console.warn('7-11 附近庫存重試失敗。', retryError);
            return of(null);
          })
        );
      })
    );
  }

  private fetchNearbyFamilyMartWithRecovery(location: Location): Observable<any> {
    const attempt = (): Observable<any> => this.familyMartService.getNearByStoreList(location).pipe(
      map((response: any) => {
        if (response?.code !== 1 || !Array.isArray(response?.data)) {
          throw new Error('全家附近門市回應不完整');
        }
        return response;
      }),
      timeout(5500)
    );

    return attempt().pipe(
      catchError((firstError) => {
        console.warn('全家附近庫存首次查詢失敗，正在重試。', firstError);
        return attempt().pipe(
          catchError((retryError) => {
            console.warn('全家附近庫存重試失敗。', retryError);
            return of({ code: 0, data: [] });
          })
        );
      })
    );
  }

  // 通用的漸進式門市搜尋（支援「使用目前位置」和「門市搜尋」）
  // 先用 API 取得近距離門市，再用全部門市 JSON 逐批載入超出 1km 的門市
  searchCombineAndTransformStoresExpanded(storeLatitude?: number, storeLongitude?: number): void {
    if (!this.canStartDiscountSearch()) return;
    const finalLatitude = storeLatitude || this.latitude;
    const finalLongitude = storeLongitude || this.longitude;
    const searchGeneration = ++this.nearbySearchGeneration;

    const locationData711: LocationData = {
      CurrentLocation: { Latitude: finalLatitude, Longitude: finalLongitude },
      SearchLocation: { Latitude: finalLatitude, Longitude: finalLongitude }
    };

    const locationFamilyMart: Location = {
      Latitude: finalLatitude,
      Longitude: finalLongitude
    };

    this.loadingService.update('正在同步兩家超商', 42, '完成後一次呈現穩定排序');

    forkJoin({
      sevenEleven: this.fetchNearby711WithRecovery(locationData711),
      familyMart: this.fetchNearbyFamilyMartWithRecovery(locationFamilyMart)
    }).subscribe(({ sevenEleven, familyMart }) => {
      if (searchGeneration !== this.nearbySearchGeneration) return;

      const sevenHealthy = Array.isArray(sevenEleven?.element?.StoreStockItemList);
      const familyMartHealthy = familyMart?.code === 1 && Array.isArray(familyMart?.data);
      if (!sevenHealthy || !familyMartHealthy) {
        this.hasMoreStores = false;
        const unavailableSource = !sevenHealthy && !familyMartHealthy
          ? '兩家超商'
          : (!sevenHealthy ? '7-11' : '全家');
        this.loadingService.fail(`${unavailableSource}資料暫時無法取得，請再試一次。`);
        return;
      }

      const sevenStores = (sevenEleven.element.StoreStockItemList || [])
        .filter((store: StoreStockItem) => !!store.RemainingQty && store.RemainingQty > 0)
        .map((store: StoreStockItem) => {
          const storeNo = this.normalize711StoreNo(store.StoreNo);
          if (storeNo) this.sevenQueriedStoreNos.add(storeNo);
          return {
            ...store,
            StoreNo: storeNo,
            storeName: `7-11${store.StoreName}門市`,
            label: '7-11',
            distance: this.calc711DistFromUser(storeNo),
            remainingQty: store.RemainingQty,
            showDistance: true,
            CategoryStockItems: store.CategoryStockItems
          };
        });

      const familyMartStores = (familyMart.data || []).map((store: StoreModel) => {
        const pkey = store.oldPKey || store.name;
        this.fmQueriedPKeys.add(pkey);
        return {
          ...store,
          storeName: store.name,
          label: '全家',
          distance: 999999,
          showDistance: true
        };
      });

      // 門市 JSON 與 API 並行載入，但排序前必須等座標表完成，
      // 才能保證 7-11 與全家全部使用同一個公尺單位。
      const readiness$ = this.searchDataReady$ || of(false);
      readiness$.pipe(
        take(1),
        timeout(2500),
        catchError(() => of(false))
      ).subscribe(() => {
        if (searchGeneration !== this.nearbySearchGeneration) return;
        if (!this.storesDataReady || this.storeNoToCoords.size === 0) {
          this.hasMoreStores = false;
          this.loadingService.fail('門市座標資料載入失敗，請重新整理後再試。');
          return;
        }

        const deduplicatedStores = new Map<string, any>();
        [...sevenStores, ...familyMartStores]
          .map(store => this.normalizeNearbyDistance(store, finalLatitude, finalLongitude))
          .forEach(store => {
            const key = store.label === '7-11'
              ? `711:${store.StoreNo || store.storeName}`
              : `fm:${store.oldPKey || store.storeName}`;
            deduplicatedStores.set(key, store);
          });

        const allStores = this.sortStoresByDistance(Array.from(deduplicatedStores.values()));
        allStores.forEach(store => this.precomputeCategoryQty(store));
        this.prepareAllStoresByDistance();

        if (allStores.length > 0) {
          this.allNearbyStores = allStores;
          this.targetDisplayCount = this.minInitialStores;
          this.totalStoresShowList = allStores.slice(0, this.targetDisplayCount);
          this.hasMoreStores = true;
          this.storeDataService.setStores(allStores);
          this.storeDataService.setIsUserLocationSearch(!(storeLatitude && storeLongitude));
          this.loadingService.hide();
          this.checkAndAutoLoadMore();
          return;
        }

        this.loadingService.update('正在擴展搜尋範圍', 92, '附近暫無結果，改查更遠的門市');
        this.checkAndAutoLoadMore();
      });
    });
  }

  // 載入更多門市（無限滾動 — 嚴格防封鎖緩衝池機制）
  loadMoreStores(): void {
    if (this.isLoadingMore || !this.hasMoreStores) return;
    this.isLoadingMore = true;

    // 將目標顯示數量往上加 5
    this.targetDisplayCount += this.storesPerPage;

    if (this.allNearbyStores.length >= this.targetDisplayCount) {
      // 緩衝池內數量充足：直接切割，絕對禁止觸發新 API
      this.totalStoresShowList = this.allNearbyStores.slice(0, this.targetDisplayCount);
      this.isLoadingMore = false;
      return;
    } else {
      // 緩衝池不足：先把池中剩下所有的全推至畫面
      this.totalStoresShowList = this.allNearbyStores.slice(0, this.allNearbyStores.length);

      // 若為路線搜尋模式，不應從 JSON 載入全台灣門市
      if (this.searchMode === 'route') {
        this.hasMoreStores = false;
        this.isLoadingMore = false;
        return;
      }

      // 保持 isLoadingMore = true 狀態，繼續向 API 索要剩下不足的份額
      this.loadMoreStoresFromJSON();
    }
  }

  // 從全部門市 JSON 載入超出 API 範圍的門市
  // 7-11 與全家都使用相同策略：從排序好的門市列表中取代表座標，呼叫區域 API
  private loadMoreStoresFromJSON(): void {
    const batchSize = this.productSearchBatchSize;

    // 7-11 批次：從排序好的門市列表中取出下一批
    const sevenBatchStart = this.productSearch711BatchIdx * batchSize;
    const sevenBatch = this.all711StoresSortedByDist.slice(sevenBatchStart, sevenBatchStart + batchSize);
    this.productSearch711BatchIdx++;
    if (this.all711StoresSortedByDist.length > 0 && sevenBatchStart + batchSize >= this.all711StoresSortedByDist.length) {
      this.searchExhausted711 = true;
    }

    // 全家批次
    const fmBatchStart = this.productSearchFmBatchIdx * batchSize;
    const fmBatch = this.allFmStoresSortedByDist.slice(fmBatchStart, fmBatchStart + batchSize);
    this.productSearchFmBatchIdx++;
    if (this.allFmStoresSortedByDist.length > 0 && fmBatchStart + batchSize >= this.allFmStoresSortedByDist.length) {
      this.searchExhaustedFm = true;
    }

    const allExhausted = sevenBatch.length === 0 && fmBatch.length === 0;
    if (allExhausted) {
      console.log('[擴展搜尋] 7-11 和全家門市都已搜完');
      this.hasMoreStores = false;
      this.isLoadingMore = false;
      this.loadingService.hide(); // 終止全域 loading
      return;
    }
    console.log(`[擴展搜尋] 載入更多: 7-11=${sevenBatch.length}間, 全家=${fmBatch.length}間`);

    // === 7-11: 使用覆蓋半徑查詢 ===
    // 確保本批次每一間門市都落在 API 查詢半徑 (1km) 內
    const sevenQueryPoints = this.getCoveringPoints(
      sevenBatch.map((s: any) => ({ latitude: s.lat, longitude: s.lng })),
      800
    );
    const sevenRegionalRequests = sevenQueryPoints.length > 0
      ? sevenQueryPoints.map((point: any) => {
          const locData: LocationData = {
            CurrentLocation: { Latitude: point.latitude, Longitude: point.longitude },
            SearchLocation: { Latitude: point.latitude, Longitude: point.longitude }
          };
          return this.sevenElevenService.getNearByStoreList(locData).pipe(
            timeout(6000),
            catchError(() => of(null))
          );
        })
      : [of(null)];

    // === 全家: 使用空間覆蓋半徑查詢 ===
    const fmQueryPoints = this.getCoveringPoints(
      fmBatch.map((s: any) => ({ latitude: s.latitude, longitude: s.longitude })),
      800
    );
    const fmRegionalRequests = fmQueryPoints.length > 0
      ? fmQueryPoints.map((point: any) =>
          this.familyMartService.getNearByStoreList({
            Latitude: point.latitude,
            Longitude: point.longitude
          }).pipe(
            timeout(6000),
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    forkJoin({
      sevenResults: forkJoin(sevenRegionalRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }: { sevenResults: any[], fmResults: any[] }) => {
      const sevenHealthy = sevenResults.some(
        response => Array.isArray(response?.element?.StoreStockItemList)
      );
      const familyMartHealthy = fmResults.some(
        response => response?.code === 1 && Array.isArray(response?.data)
      );
      if (!sevenHealthy && !familyMartHealthy) {
        this.isLoadingMore = false;
        this.hasMoreStores = false;
        this.loadingService.fail('查詢服務暫時沒有回應，請稍後再試一次。');
        return;
      }
      const newStores: any[] = [];

      // === 7-11 結果：處理 getNearByStoreList 回傳 ===
      sevenResults.forEach((res: any) => {
        if (!res || !res.element || !res.element.StoreStockItemList) return;
        res.element.StoreStockItemList.forEach((store: any) => {
          if (!store.RemainingQty || store.RemainingQty <= 0) return;
          const storeNo = this.normalize711StoreNo(store.StoreNo);
          if (this.sevenQueriedStoreNos.has(storeNo)) return;
          this.sevenQueriedStoreNos.add(storeNo);

          const dist = this.calc711DistFromUser(storeNo);
          newStores.push({
            ...store,
            StoreNo: storeNo,
            storeName: `7-11${store.StoreName}門市`,
            label: '7-11',
            distance: dist,
            remainingQty: store.RemainingQty,
            showDistance: true,
            CategoryStockItems: store.CategoryStockItems
          });
        });
      });

      // === 全家結果 ===
      fmResults.forEach((fmRes: any) => {
        if (!fmRes || fmRes.code !== 1 || !fmRes.data) return;
        fmRes.data.forEach((store: any) => {
          const pkey = store.oldPKey || store.name;
          if (this.fmQueriedPKeys.has(pkey)) return;
          this.fmQueriedPKeys.add(pkey);

          const dist = getDistance(
            { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
            { latitude: store.latitude, longitude: store.longitude }
          );
          newStores.push({
            ...store,
            storeName: store.name,
            label: '全家',
            distance: dist,
            showDistance: true
          });
        });
      });

      // 每次擴展後重新對「全部結果」排序。不可直接追加批次，
      // 否則後批回來的近距離全家會被放在前批較遠的 7-11 後面。
      this.sortStoresByDistance(newStores);
      newStores.forEach(s => this.precomputeCategoryQty(s));
      const mergedStores = new Map<string, any>();
      [...this.allNearbyStores, ...newStores].forEach(store => {
        const key = store.label === '7-11'
          ? `711:${this.normalize711StoreNo(store.StoreNo) || store.storeName}`
          : `fm:${store.oldPKey || store.storeName}`;
        mergedStores.set(key, store);
      });
      this.allNearbyStores = this.sortStoresByDistance(Array.from(mergedStores.values()));

      // 嘗試達到目標顯示數量
      this.totalStoresShowList = this.allNearbyStores.slice(0, this.targetDisplayCount);
      this.storeDataService.setStores(this.allNearbyStores);

      this.hasMoreStores = !(this.searchExhausted711 && this.searchExhaustedFm);

      // 自動擴展：僅當「總累計結果」不足 minInitialStores 間時才繼續搜尋
      // 使用 allNearbyStores.length（總結果）而非 totalStoresShowList.length（當次顯示切片）
      // 地圖模式下不自動擴展搜尋，由使用者手動「搜尋此區域」
      if (!this.isMapView && this.allNearbyStores.length < this.minInitialStores && this.hasMoreStores) {
        this.isLoadingMore = true;
        this.loadMoreStoresFromJSON();
      } else {
        this.isLoadingMore = false;
        this.loadingService.hide();
      }
    });
  }

  // 效能優化：改為 Zone 外部的 passive 監聽器
  onWindowScroll = (): void => {
    // 選單在行動版是獨立滾動的浮層。不可在 window scroll 時關閉，
    // 否則 Sticky Header 或 iOS 瀏覽器列產生的輕微位移會讓選單剛打開就消失。
    if (this.scrollTicking) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      this.scrollTicking = false;
      const currentScrollY = window.scrollY;

      // 偵測滾動方向：直接操作 DOM class，避免 ngZone.run 觸發變更偵測導致動畫卡頓
      // 僅在清單模式下啟用膠囊收縮效果
      const delta = currentScrollY - this.lastScrollY;
      if (!this.isMapView && delta > 8 && currentScrollY > 80) {
        // 向下滾動：縮小膠囊
        if (!this.isScrolledDown) {
          this.ngZone.run(() => this.isScrolledDown = true);
        }
      } else if (delta < -3 || currentScrollY <= 10) {
        // 向上滾動（極低門檻）或回到頂部：展開膠囊
        if (this.isScrolledDown) {
          this.ngZone.run(() => this.isScrolledDown = false);
        }
      }
      this.lastScrollY = currentScrollY;

      if (!this.hasMoreStores || this.isLoadingMore) return;

      const scrollPosition = window.innerHeight + window.scrollY;
      const documentHeight = document.documentElement.scrollHeight;

      if (scrollPosition >= documentHeight - 200) {
        this.ngZone.run(() => {
          if (this.searchMode === 'product') {
            this.loadMoreProductResults();
          } else if (this.searchMode === 'store' || this.searchMode === 'location' || this.searchMode === 'route') {
            this.loadMoreStores();
          }
        });
      }
    });
  }

  // 確保至少載入 minInitialStores 間門市
  private checkAndAutoLoadMore(): void {
    this.ensureMinimumStores();
  }

  // 確保至少顯示 minInitialStores 間門市（僅清單模式，基於總累計結果）
  private ensureMinimumStores(): void {
    if (this.isMapView) return;
    if (this.allNearbyStores.length < this.minInitialStores && this.hasMoreStores && !this.isLoadingMore) {
      setTimeout(() => {
        if (this.isMapView) return;
        if (this.allNearbyStores.length < this.minInitialStores && this.hasMoreStores && !this.isLoadingMore) {
          this.loadMoreStores();
        }
      }, 100);
    }
  }

  getFStoreQty(store: StoreModel): number {
    var totalQty: number = 0;
    store.info.forEach((cat) => {
      totalQty += cat.qty;
    })
    return totalQty;
  }

  getFUrl(cat: any): string {
    return cat.iconURL;
  }

  getFCatName(cat: any): string {
    return cat.name;
  }

  getFSubCategoryQty(cat: any): number {
    return cat.qty;
  }

  getStoreTotalQtyList(store: any): number {
    if (store.label === '7-11') return store.RemainingQty || store.remainingQty || 0;
    if (store.label === '全家' && store.info && Array.isArray(store.info)) {
      return store.info.reduce((sum: number, cat: any) => sum + (cat.qty || 0), 0);
    }
    return 0;
  }

  fStoreName(storeName: string): string {
    return storeName ? storeName.replace('全家', '') : ''
  }

  loadFavoriteStores() {
    if (this.user) {
      if (this.favoritesSubscription) {
        this.favoritesSubscription.unsubscribe();
      }
      const favoritesRef = collection(this.firestore, 'users', this.user.uid, 'favorites');
      this.favoritesSubscription = new Subscription(onSnapshot(
        favoritesRef,
        snapshot => {
          const favorites = snapshot.docs.map(document => document.data());
          this.favoriteStores = favorites;
          this.favoriteStoreNameSet = new Set(favorites.map((favorite: any) => favorite.storeName));
        },
        error => console.error('收藏資料同步失敗', error)
      ));
    }
  }

  toggleFavorite(store: any) {
    if (this.user) {
      const favoriteRef = doc(
        this.firestore,
        'users',
        this.user.uid,
        'favorites',
        encodeURIComponent(store.storeName)
      );

      // 如果商店已經在喜愛清單內，刪除它
      if (this.isFavorite(store)) {
        void deleteDoc(favoriteRef);
      } else {
        const favoriteData: any = {
          storeName: store.storeName
        };
        // 依照商店設定選擇性的資料
        if (store.StoreName) {
          favoriteData.store711Name = store.StoreName;
          favoriteData.label = '7-11';
        }
        if (store.longitude && store.latitude) {
          favoriteData.storeFLongitude = store.longitude;
          favoriteData.storeFLatitude = store.latitude;
          favoriteData.label = '全家';
        }

        void setDoc(favoriteRef, favoriteData);
      }
    } else {
    }
  }

  isFavorite(store: any): boolean {
    return this.favoriteStoreNameSet.has(store.storeName);
  }

  onUserUpdated(user: any) {
    this.user = user; // 更新用戶狀態
    if (user) {
      this.loadFavoriteStores(); // 加載收藏店家
    }
  }

  onFavoriteStoresUpdated(favoriteStores: any) {
    this.favoriteStores = favoriteStores; // 更新用戶狀態
  }

  onFavoriteStoreSearch(store: any) {
    if (!this.canStartDiscountSearch()) {
      this.showMenu = false;
      return;
    }
    this.loadingService.show("幫你找看看唷");
    // 從本地 JSON 資料找出店家的經緯度
    var lat = 0;
    var lng = 0;
    if (store.label === "全家") {
      lat = store.storeFLatitude;
      lng = store.storeFLongitude;
      
      const fakeEvent = {
        option: {
          value: {
            name: store.storeName.replace('全家', ''),
            addr: '',
            label: '全家',
            type: 'store',
            longitude: lng,
            latitude: lat
          }
        }
      } as unknown as MatAutocompleteSelectedEvent;

      this.onOptionSelect(fakeEvent);
      this.searchTerm = '';
    }
    else {
      // 從本地 7-11 商店資料中尋找
      const foundStore = this.all711Stores.find(s => 
        s.name === store.store711Name || 
        (store.store711Name && s.name.includes(store.store711Name.replace('711', '').trim()))
      );
      
      if (foundStore) {
        lat = parseFloat(foundStore.lat);
        lng = parseFloat(foundStore.lng);

        const fakeEvent = {
          option: {
            value: {
              name: store.store711Name,
              addr: '',
              label: '7-11',
              type: 'store',
              longitude: lng,
              latitude: lat
            }
          }
        } as unknown as MatAutocompleteSelectedEvent;

        this.onOptionSelect(fakeEvent);
        this.searchTerm = '';
      } else {
        // 如果找不到，嘗試取得位置後再搜尋
        from(this.geolocationService.getCurrentPosition())
          .pipe(
            switchMap((position) => {
              this.latitude = position.coords.latitude;
              this.longitude = position.coords.longitude;
              return of(null);
            })
          ).subscribe(() => {
            // 使用拼音比對再次搜尋
            const searchTerm = store.store711Name?.replace('711', '').trim() || '';
            const matchedStore = this.all711Stores.find(s => 
              this.matchesSearchTerm(s.name, s.name_pinyin || '', searchTerm)
            );
            
            if (matchedStore) {
              lat = parseFloat(matchedStore.lat);
              lng = parseFloat(matchedStore.lng);

              const fakeEvent = {
                option: {
                  value: {
                    name: store.store711Name,
                    addr: '',
                    label: '7-11',
                    type: 'store',
                    longitude: lng,
                    latitude: lat
                  }
                }
              } as unknown as MatAutocompleteSelectedEvent;

              this.onOptionSelect(fakeEvent);
              this.searchTerm = '';
            } else {
              console.error('找不到 7-11 商店:', store.store711Name);
              this.loadingService.hide();
            }
          });
      }
    }
  }

  // 處理食物搜尋結果
  onFoodSearchResult(result: any) {
    this.loadingService.show("正在跳轉到商店...");
    
    // 設定搜尋詞
    this.searchTerm = result.storeName;
    
    // 變更搜尋模式
    this.isLocationSearchMode = false;
    
    // 清除商店列表
    this.totalStoresShowList = [];
    
    // 確保商店資料有正確的屬性，避免觸發「無折扣商品」訊息
    const storeData = {
      ...result.store,
      distance: 0, // 設為 0 表示這是目標商店
      remainingQty: result.remainingQty || 1 // 確保有庫存
    };
    
    // 直接設定商店資料
    this.totalStoresShowList = [storeData];
    
    // 更新 StoreDataService
    this.storeDataService.setStores(this.totalStoresShowList);
    this.storeDataService.setIsUserLocationSearch(false);
    
    this.loadingService.hide();
  }
}
