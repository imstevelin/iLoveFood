import { Component, OnInit, OnDestroy, NgZone, ViewChild, ElementRef, HostListener } from '@angular/core';
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
import { FoodCategory, LocationData, StoreStockItem, Store, Location, FoodDetail711 } from '../model/seven-eleven.model'
import { fStore, StoreModel, FoodDetailFamilyMart } from '../model/family-mart.model';
import { StoreDataService } from 'src/app/services/stores-data.service';

import { environment } from 'src/environments/environment';

import { switchMap, from, of, catchError, Observable, tap, forkJoin, Subject, debounceTime, distinctUntilChanged, map, timeout, mergeMap, toArray, Subscription } from 'rxjs';

import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatDialog } from '@angular/material/dialog';

import { getDistance } from 'geolib';

import { AngularFirestore } from '@angular/fire/compat/firestore';
import { pinyin } from 'pinyin-pro';

import { trigger, style, animate, transition } from '@angular/animations';

@Component({
  selector: 'app-new-search',
  templateUrl: './new-search.component.html',
  styleUrls: ['./new-search.component.scss'],
  animations: [
    trigger('textCrossfade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('400ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('400ms ease-out', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class NewSearchComponent implements OnInit, OnDestroy {
  user: any = null;
  showFavorites: boolean = false; // 收藏面板是否展開（向下相容）
  showMenu: boolean = false;     // 漢堡選單是否展開
  showLabSection: boolean = false; // 實驗室子選單
  isMapView: boolean = false; // 地圖檢視模式
  mapSheetOpen: boolean = false; // 地圖門市卡片是否展開

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
  chatEnabled: boolean = true;    // 聊天室按鈕開關 (系統預設為開啟)
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
  searchTerm: string = '';
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
  private productSearchBatchSize: number = 15;      // 防封鎖：每批 API 查詢量改為 15 間
  private productSearchDisplayed: number = 0;       // 已顯示的門市計數
  public isSearchingMore: boolean = false;          // 是否正在擴搜
  private searchExhausted711: boolean = false;       // 7-11 是否已搜完
  private searchExhaustedFm: boolean = false;        // 全家是否已搜完
  private fmQueriedPKeys: Set<string> = new Set();   // 已查詢過的全家門市 PKey（去重用）
  private sevenQueriedStoreNos: Set<string> = new Set(); // 已查詢過的7-11門市 StoreNo（去重用）
  private productSearchTimer: any = null;            // 商品搜尋計時器
  productSearchPaused: boolean = false;              // 是否暫停搜尋（2分鐘後）
  productSearchRunning: boolean = false;             // 是否正在商品搜尋中
  private productSearchGeneration: number = 0;       // 搜尋世代計數器，用於作廢舊搜尋的 setTimeout
  private storeSearchGeneration: number = 0;         // 店名搜尋世代計數器
  locationDenied: boolean = false;                   // 使用者拒絕定位
  private minInitialStores: number = 5;             // 初始要求：嚴格 5 間

  // 拼音轉換快取：避免重複轉換相同的文字
  private pinyinCache = new Map<string, string>();
  private searchDebounceTimer: any = null; // 自動完成防抖計時器
  private favoritesSubscription: Subscription | null = null; // 收藏清單的訂閱



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
  selectedCategory?: any;

  favoriteStores: any[] = [];

  searchInput$ = new Subject<string>();

  @ViewChild('menuPanel') menuPanel!: ElementRef;
  @ViewChild('menuButton') menuButton!: ElementRef;

  constructor(
    private http: HttpClient,
    private geolocationService: GeolocationService,
    private sevenElevenService: SevenElevenRequestService,
    private familyMartService: FamilyMartRequestService,
    private authService: AuthService,
    public loadingService: LoadingService,
    public dialog: MatDialog,
    private firestore: AngularFirestore,
    private storeDataService: StoreDataService,
    private ngZone: NgZone
  ) {
    this.searchForm = new FormGroup({
      selectedStoreName: new FormControl(''), // 控制選中的商店
    });
  }

  ngOnInit(): void {
    // 移除自動搜尋，改為手動觸發（Enter 或按鈕）
    // this.searchInput$ 不再自動訂閱
    this.init();
    
    // 效能優化：在 Angular Zone 外部註冊高頻事件，避免滑動時瘋狂觸發 Change Detection 導致 UI 卡死
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('touchmove', this.onWindowTouchMove, { passive: true });
      window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    });
  }

  ngOnDestroy(): void {
    document.body.classList.remove('map-active-lock');
    if (this.favoritesSubscription) {
      this.favoritesSubscription.unsubscribe();
    }
    window.removeEventListener('touchmove', this.onWindowTouchMove);
    window.removeEventListener('scroll', this.onWindowScroll);
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
    this.darkModeMediaQuery.addEventListener('change', () => {
      this.applyTheme();
    });

    // 訂閱 getUser 方法來獲取用戶資料
    this.authService.getUser().subscribe(user => {
      if (user) {
        this.user = user;  // 設定用戶資料
        this.loadFavoriteStores();
      }
    });

    // // 使用 from 將 Promise 轉換為 Observable
    // this.getCityName();

    this.loadingService.show("載入商店資訊中，請稍後");  // 显示加载动画

    // 取得711跟全家的商品詳細資訊
    this.sevenElevenService.getFoodDetails().subscribe((data) => {
      this.foodDetails711 = data;
    });

    this.familyMartService.getFoodDetails().subscribe((data) => {
      this.foodDetailsFamilyMart = data;
    });

    //取得所有全家商店名稱資訊
    this.getFamilyMartAllStore();
    //取得所有 7-11 商店名稱資訊
    this.getSevenElevenAllStore();

    of(true).pipe(
      switchMap(() => {
        return this.sevenElevenService.getAccessToken();
      }),
      switchMap((token: any) => {
        if (token && token.element) {
          sessionStorage.setItem('711Token', token.element);
          // 如果 token 儲存成功，發送 getFoodCategory 請求
          return this.sevenElevenService.getFoodCategory();
        } else {
          // 如果 token 沒有成功返回，返回空陣列
          return of([]);
        }
      }),
      catchError((error) => {
        // 錯誤處理邏輯
        console.error('Error:', error);
        return of([]); // 在出錯時返回空陣列，防止應用崩潰
      })
    ).subscribe(
      (res) => {
        if (res && res.element) {
          this.foodCategories = res.element;
          // 移除 this.loadingService.hide(); 以避免初次載入時動畫圓圈閃爍
          this.onUseCurrentLocation();
        } else {
          console.error('Failed to fetch food categories');
          this.loadingService.hide();
        }
      }
    );
  }

  getFamilyMartAllStore() {
    this.familyMartService.getStores().subscribe((data) => {
      if(data.length > 0) {
        this.dropDownFamilyMartList = data;
        this.storeDataService.setAllFmStores(data);
      }
      this.checkStoresDataReady();
    })
  }

  getSevenElevenAllStore() {
    this.sevenElevenService.getStores().subscribe((data) => {
      if(data && data.length > 0) {
        this.all711Stores = data;
        this.storeDataService.setAll711Stores(data);
        // 建立 StoreNo → 座標 快速查表（serial = StoreNo）
        this.storeNoToCoords.clear();
        data.forEach((s: any) => {
          if (s.serial && s.lat && s.lng) {
            this.storeNoToCoords.set(s.serial, { lat: Number(s.lat), lng: Number(s.lng) });
          }
        });
        console.log(`[7-11] 座標查表建立完成: ${this.storeNoToCoords.size} 間`);
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
  private calc711DistFromUser(storeNo: string): number {
    const coords = this.storeNoToCoords.get(storeNo);
    if (coords && this.searchCenterLat && this.searchCenterLng) {
      return Math.round(getDistance(
        { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
        { latitude: coords.lat, longitude: coords.lng }
      ));
    }
    return 999999; // 找不到座標時排最後
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

  trackByMsg(index: number, msg: string): string {
    return msg;
  }

  // mat-autocomplete 顯示函式：防止 [object Object]
  displayFn(item: any): string {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.name || '';
  }

  // 切換收藏面板（向下相容）
  toggleFavoritesPanel(): void {
    this.showFavorites = !this.showFavorites;
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

  // 回首頁：清空搜尋、回到定位搜尋
  goHome(): void {
    this.searchTerm = '';
    this.unifiedDropDownList = [];
    this.showMenu = false;
    this.showAboutCard = false;
    this.isMapView = false;
    this.mapSheetOpen = false;
    document.body.classList.remove('map-active-lock');
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
  toggleMapView(): void {
    this.isMapView = !this.isMapView;
    this.mapSheetOpen = false;
    if (this.isMapView) {
      // 解決從清單滾動後進入地圖，畫面與標記點擊偏移的問題
      window.scrollTo(0, 0);
      document.body.classList.add('map-active-lock');
    } else {
      document.body.classList.remove('map-active-lock');
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

    // 更新 meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', shouldBeDark ? '#121212' : '#34C759');
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
  onWindowTouchMove = () => {
    if (this.showMenu || this.showLabSection) {
      this.ngZone.run(() => {
        this.showMenu = false;
        this.showLabSection = false;
      });
    }
  }

  onInput(event: Event): void {
    const input = (event.target as HTMLInputElement).value;
    this.searchTerm = input;
    // 當輸入超過 1 個字時，延遲 300ms 後才觸發搜尋（避免每次按鍵都執行重量運算凍結 UI）
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    if (input.length >= 1) {
      this.searchDebounceTimer = setTimeout(() => this.handleSearch(input), 300);
    } else {
      this.unifiedDropDownList = [];
      // 清空搜尋框時自動回到定位搜尋
      if (input.length === 0 && this.searchMode !== 'location') {
        this.onUseCurrentLocation();
      }
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    // 按下 Enter 鍵時觸發搜尋
    if (event.key === 'Enter') {
      event.preventDefault();
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

  // 使用本地 JSON 資料和拼音比對進行搜尋（支援門市、商品、種類，也支援 Google Maps 連結）
  handleSearch(input: string): void {
    if (input.length >= 1) {
      this.unifiedDropDownList = [];

      // --- 0. 判斷是否為 Google Maps 連結 ---
      const isMapsLink = input.includes('maps.app.goo.gl') || input.includes('google.com/maps/dir');
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
          addr: item.addr,
          label: '7-11',
          type: 'store' as const,
          longitude: parseFloat(item.lng),
          latitude: parseFloat(item.lat)
        })),
        ...filteredFamilyMartStores.map(item => ({
          name: item.Name.replace('全家', ''),
          addr: item.addr,
          label: '全家',
          type: 'store' as const,
          longitude: parseFloat(item.px_wgs84),
          latitude: parseFloat(item.py_wgs84)
        }))
      ];

      // --- 2. 篩選商品候選 ---
      const lowerInput = input.toLowerCase();
      const productSet = new Set<string>();
      const productCandidates: any[] = [];

      // 搜尋 7-11 商品
      this.foodDetails711.forEach(item => {
        if (item.name && item.name.toLowerCase().includes(lowerInput) && !productSet.has(item.name)) {
          productSet.add(item.name);
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
        if (item.title && item.title.toLowerCase().includes(lowerInput) && !productSet.has(item.title)) {
          productSet.add(item.title);
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
        if (cat.Name && cat.Name.toLowerCase().includes(lowerInput) && !categorySet.has(cat.Name)) {
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
          if (child.Name && child.Name.toLowerCase().includes(lowerInput) && !categorySet.has(child.Name)) {
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
        if (catName.toLowerCase().includes(lowerInput) && !categorySet.has(catName)) {
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
      const hasExactProductMatch = productCandidates.some(p => p.name.toLowerCase() === lowerInput);

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

  onOptionSelect(event: MatAutocompleteSelectedEvent | null, lat?: number, lng?: number): void {
    const selectedValue = event?.option?.value;

    // 如果選中的是「導航路線」，執行路線解析
    if (selectedValue && selectedValue.type === 'route') {
      this.stopProductSearch();
      this.handleRouteSelection(selectedValue.originalUrl);
      return;
    }

    // 如果選中的是「商品」或「種類」，執行商品搜尋模式
    if (selectedValue && (selectedValue.type === 'product' || selectedValue.type === 'category')) {
      this.onProductOrCategorySelect(selectedValue);
      return;
    }

    // 以下為門市搜尋模式（原有邏輯）
    this.stopProductSearch();
    this.searchMode = 'store';
    this.isLocationSearchMode = false;
    this.storeSearchGeneration++;
    const storeGen = this.storeSearchGeneration;

    // 清除商店列表
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;

    // 從選中的選項中獲取值
    this.searchSelectedStore = selectedValue?.name || event?.option?.value?.name;

    // 只有在 event 不為 null 時才設定 searchTerm
    if (selectedValue) {
      this.searchTerm = selectedValue.label + selectedValue.name.replace('店', '') + '門市';
    }

    const storeLongitude = lng !== undefined ? lng : Number(selectedValue?.longitude);
    const storeLatitude = lat !== undefined ? lat : Number(selectedValue?.latitude);

    // 門市搜尋：以該門市位置為搜尋中心
    this.searchCenterLat = storeLatitude;
    this.searchCenterLng = storeLongitude;

    this.loadingService.show("正在搜尋店家")
    from(this.geolocationService.getCurrentPosition())
      .pipe(
        switchMap((position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          this.latitude = lat;
          this.longitude = lng;

          return of([]);
        }),
        switchMap((res) => {
          if(res) {
            return this.sevenElevenService.getAccessToken();
          }
          else{
            return [];
          }
        }),
        switchMap((token: any) => {
          if (token && token.element) {
            sessionStorage.setItem('711Token', token.element);
            return this.sevenElevenService.getFoodCategory();
          } else {
            return of([]);
          }
        }),
        catchError((error) => {
          console.error('門市搜尋錯誤:', error);
          this.loadingService.hide();
          return of(null);
        })
      ).subscribe(
        (res) => {
          // 檢查世代是否過期
          if (storeGen !== this.storeSearchGeneration) return;
          if (res) {
            this.searchCombineAndTransformStoresExpanded(storeLatitude, storeLongitude);
            // 移除此處的 loadingService.hide()，否則會在擴展搜尋 API 跑完前，提早引發圓圈閃爍或顯示空狀態
          } else {
            this.loadingService.hide();
          }
        }
      );
  }

  // ==========================================
  // Google Maps 路徑分析
  // ==========================================
  private handleRouteSelection(originalUrl: string): void {
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
      width: '400px',
      panelClass: 'glass-dialog',
      data: { originalUrl, allOptions },
      autoFocus: false
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (!result || result === 'CANCEL') {
        this.goHome();
        return;
      }
      
      const selectedMode = typeof result === 'string' ? result : result.mode;
      this.routeProductKeywords = result.productKeywords || [];
      
      // FIX: 立即清空舊的商店卡片，讓 Loading Overlay 能瞬間跳出來，消除卡頓感
      this.totalStoresShowList = [];
      this.allNearbyStores = [];
      this.hasMoreStores = false;
      this.searchMode = 'route';
      this.routeNoResults = false; // 重置無結果狀態
      
      // 廢棄任何還在背景跑的舊搜尋 (避免互相干擾)
      this.storeSearchGeneration++;
      this.productSearchGeneration++;

      this.loadingService.show("正在解析 Google Maps 路線...");
      
      try {
        const urlObj = new URL(originalUrl);
        // 如果是短網址，需要透過 Proxy 展開；否則直接解析
        if (urlObj.hostname.includes('goo.gl')) {
          this.resolveMapsUrlAndFetchRoute(originalUrl, selectedMode);
        } else {
          this.parseAndFetchDirections(originalUrl, selectedMode);
        }
      } catch (e) {
        this.parseAndFetchDirections(originalUrl, selectedMode);
      }
    });
  }

  private resolveMapsUrlAndFetchRoute(shortUrl: string, travelMode: 'DRIVING' | 'BICYCLING'): void {
    // 使用專屬的 Cloudflare Worker 代理伺服器
    const proxyUrl = `https://maps-proxy.imstevelin.workers.dev/?url=${encodeURIComponent(shortUrl)}`;
    
    this.http.get<any>(proxyUrl).subscribe({
      next: (res) => {
        let expandedUrl = shortUrl;
        if (res && res.resolvedUrl) {
          expandedUrl = res.resolvedUrl;
        } else if (res && res.url) {
          expandedUrl = res.url;
        }

        // 檢查是否有 html 內含座標 (如果 Cloudflare worker 沒有正確跳轉而是拿回網頁)
        if (res && res.html && expandedUrl === shortUrl) {
          const regex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g;
          let match;
          const coords = [];
          while ((match = regex.exec(res.html)) !== null) {
            coords.push({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
          }
          if (coords.length >= 2) {
            this.fetchDirectionsWithCoords(coords[0], coords[coords.length - 1], travelMode);
            return;
          }
        }

        this.parseAndFetchDirections(expandedUrl, travelMode);
      },
      error: () => {
        // Fallback proxy: 使用 codetabs 獲取重導向後的 HTML 內容
        this.http.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(shortUrl)}`, { responseType: 'text' }).subscribe({
          next: (htmlStr) => {
            // 直接從回傳的 HTML 中解析 !3d<lat>!4d<lng>
            const regex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g;
            let match;
            const coords = [];
            while ((match = regex.exec(htmlStr)) !== null) {
              coords.push({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
            }

            if (coords.length >= 2) {
              const origin = coords[0];
              const destination = coords[coords.length - 1]; // 通常最後一個是終點
              this.fetchDirectionsWithCoords(origin, destination, travelMode);
            } else {
              // 找不到座標，試著解析其中的 URL
              const matchUrl = htmlStr.match(/URL='([^']+)'/i) || htmlStr.match(/href="([^"]+)"/i);
              const resolvedUrl = matchUrl ? matchUrl[1] : shortUrl;
              this.parseAndFetchDirections(resolvedUrl, travelMode);
            }
          },
          error: (err) => {
            console.error('Proxy 解析失敗，嘗試直接解析', err);
            this.parseAndFetchDirections(shortUrl, travelMode);
          }
        });
      }
    });
  }

  // 給 Codetabs 抓出經緯度後直接使用的入口
  private fetchDirectionsWithCoords(origin: any, destination: any, travelMode: 'DRIVING' | 'BICYCLING'): void {
    this.loadingService.show("路線規劃中...");
    
    const directionsService = new (window as any).google.maps.DirectionsService();
    directionsService.route({
      origin: origin as any,
      destination: destination as any,
      travelMode: (window as any).google.maps.TravelMode[travelMode],
      region: 'tw'
    }, (result: any, status: any) => {
      if (status === (window as any).google.maps.DirectionsStatus.OK && result) {
        this.processDirectionsResult(result);
      } else {
        console.error('Directions API 錯誤', status);
        this.loadingService.hide();
        alert('Google Maps 路線規劃失敗：' + status);
      }
    });
  }

  private parseAndFetchDirections(url: string, travelMode: 'DRIVING' | 'BICYCLING'): void {
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
    this.loadingService.show("正在尋找沿路經過的門市...");
    
    const sampledPoints: {lat: number, lng: number}[] = [];
    let lastSampledPoint: any = null;

    const legs = result.routes[0].legs;
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
        if (distToLast > 500) {
          sampledPoints.push({ lat: finalPoint.lat(), lng: finalPoint.lng() });
        }
      } else {
        sampledPoints.push({ lat: finalPoint.lat(), lng: finalPoint.lng() });
      }
    }

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

    const sevenRequests = sampledPoints.map(p => {
      const loc: LocationData = {
        CurrentLocation: { Latitude: p.lat, Longitude: p.lng },
        SearchLocation: { Latitude: p.lat, Longitude: p.lng }
      };
      return this.sevenElevenService.getNearByStoreList(loc).pipe(
        timeout(8000), catchError(() => of(null))
      );
    });

    const fmRequests = sampledPoints.map(p => {
      // 這裡無需傳遞 OldPKeys，只要傳遞經緯度，MapProductInfo 就會自動返回該座標半徑內的門市
      return this.familyMartService.getNearByStoreList({
        Latitude: p.lat, Longitude: p.lng
      }, []).pipe(
        timeout(8000),
        catchError((err) => {
          console.error('[RouteSearch] FM api request err:', err);
          return of(null);
        })
      );
    });

    console.log(`[RouteSearch] Sent ${sevenRequests.length} 7-11 reqs and ${fmRequests.length} FM reqs`);

    forkJoin({
      sevenResults: forkJoin(sevenRequests.length > 0 ? sevenRequests : [of([])]),
      fmResults: forkJoin(fmRequests.length > 0 ? fmRequests : [of([])])
    }).subscribe(({ sevenResults, fmResults }) => {
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
                        const productNameLower = product.name.toLowerCase();
                        if (this.routeProductKeywords.some(kw => productNameLower.includes(kw.toLowerCase()))) {
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
        this.loadingService.show("正在過濾 7-11 商品...");
        const sevenStores = allStores.filter(s => s.label === '7-11');
        const fmStores = allStores.filter(s => s.label === '全家');
        
        from(sevenStores).pipe(
          mergeMap(store => 
            this.sevenElevenService.getItemsByStoreNo(store.StoreNo, {
              Latitude: this.searchCenterLat, Longitude: this.searchCenterLng
            }).pipe(
              map((detailRes: any) => {
                const detail = detailRes?.element?.StoreStockItem?.CategoryStockItems || [];
                store.CategoryStockItems = detail; // 更新詳細庫存
                const hasMatch = detail.some((cat: any) =>
                  cat.ItemList && cat.ItemList.some((item: any) => {
                    if (!item.ItemName || item.RemainingQty <= 0) return false;
                    const itemNameLower = item.ItemName.toLowerCase();
                    return this.routeProductKeywords.some(kw => itemNameLower.includes(kw.toLowerCase()));
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
  onProductOrCategorySelect(selectedValue: any): void {
    this.searchMode = 'product';
    this.isLocationSearchMode = false;
    this.productSearchKeyword = selectedValue.name;
    this.productSearchIsCategory = selectedValue.type === 'category';
    this.searchTerm = selectedValue.name;
    this.totalStoresShowList = [];
    this.productSearchStores = [];
    this.unifiedDropDownList = [];

    // 重置漸進式搜尋狀態
    this.all711StoresSortedByDist = [];
    this.allFmStoresSortedByDist = [];
    this.productSearch711BatchIdx = 0;
    this.productSearchFmBatchIdx = 0;
    this.productSearchDisplayed = 0;
    this.isSearchingMore = false;
    this.searchExhausted711 = false;
    this.searchExhaustedFm = false;
    this.fmQueriedPKeys = new Set();
    this.sevenQueriedStoreNos = new Set();
    this.hasMoreStores = true;
    this.productSearchPaused = false;
    this.productSearchRunning = true;
    this.targetDisplayCount = this.minInitialStores;
    this.productSearchGeneration++;  // 遞增世代，作廢舊搜尋的 setTimeout

    // 清除舊的計時器
    if (this.productSearchTimer) {
      clearTimeout(this.productSearchTimer);
    }
    // 2 分鐘後自動暫停搜尋
    const gen = this.productSearchGeneration;
    this.productSearchTimer = setTimeout(() => {
      if (this.productSearchGeneration === gen) {
        this.productSearchPaused = true;
        this.productSearchRunning = false;
      }
    }, 120000);

    // 不用 loadingService，HTML 中的 productSearchRunning 指示器已足夠

    // Step 1: 取得使用者定位 + 7-11 token
    from(this.geolocationService.getCurrentPosition())
      .pipe(
        switchMap((position) => {
          this.latitude = position.coords.latitude;
          this.longitude = position.coords.longitude;
          return this.sevenElevenService.getAccessToken();
        }),
        switchMap((token: any) => {
          if (token && token.element) {
            sessionStorage.setItem('711Token', token.element);
            return this.sevenElevenService.getFoodCategory();
          }
          return of([]);
        }),
        catchError((error) => {
          console.error('初始化搜尋錯誤:', error);
          this.loadingService.hide();
          return of(null);
        })
      )
      .subscribe((res) => {
        if (!res) return;

        // 商品搜尋：以使用者位置為搜尋中心
        this.searchCenterLat = this.latitude;
        this.searchCenterLng = this.longitude;

        // 等待商店 JSON 資料載入完成後再開始搜尋
        this.waitForStoresDataAndSearch();
      });
  }

  // 等待商店資料載入後開始批次搜尋
  private waitForStoresDataAndSearch(): void {
    // 必須等待：(1) 商店 JSON 資料 (2) foodDetails711（商品名稱搜尋用）
    const isReady = () => this.storesDataReady && this.foodDetails711 && this.foodDetails711.length > 0;
    if (isReady()) {
      this.prepareAllStoresByDistance();
      this.fetchProductSearchBatch(true);
    } else {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (isReady() || attempts > 75) {
          clearInterval(interval);
          if (isReady()) {
            this.prepareAllStoresByDistance();
            this.fetchProductSearchBatch(true);
          } else {
            console.error('[商品搜尋] 超時：商店資料或 foodDetails 未載入');
            this.productSearchRunning = false;
          }
        }
      }, 200);
    }
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
  }

  // 批次搜尋：同時查 7-11 和全家，直到找到足夠的結果
  private fetchProductSearchBatch(isInitial: boolean): void {
    const currentGen = this.productSearchGeneration;
    // 上一次搜尋仍在進行——等它完成後自己會繼續，不重試以避免重複鏈
    if (this.isSearchingMore) return;
    this.isSearchingMore = true;

    const keyword = this.productSearchKeyword.toLowerCase();
    const isCategory = this.productSearchIsCategory;
    const batchSize = this.productSearchBatchSize;

    // 準備 7-11 批次
    const sevenBatchStart = this.productSearch711BatchIdx * batchSize;
    const sevenBatch = this.all711StoresSortedByDist.slice(sevenBatchStart, sevenBatchStart + batchSize);
    this.productSearch711BatchIdx++;
    if (this.all711StoresSortedByDist.length > 0 && sevenBatchStart + batchSize >= this.all711StoresSortedByDist.length) {
      this.searchExhausted711 = true;
    }

    // 準備全家批次：取得一組尚未查過的全家門市，用它們的座標呼叫 API
    const fmBatchStart = this.productSearchFmBatchIdx * batchSize;
    const fmBatch = this.allFmStoresSortedByDist.slice(fmBatchStart, fmBatchStart + batchSize);
    this.productSearchFmBatchIdx++;
    // 只有在排序陣列非空時才判斷是否已搜完
    if (this.allFmStoresSortedByDist.length > 0 && fmBatchStart + batchSize >= this.allFmStoresSortedByDist.length) {
      this.searchExhaustedFm = true;
    }

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
            timeout(8000),  // 8 秒超時，避免 API 回應過慢卡住整個搜尋
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
            timeout(8000),
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    // 同時查詢 7-11 區域 + 全家區域

    forkJoin({
      sevenResults: forkJoin(sevenRegionalRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }) => {
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

            if (isCategory) {
              // 種類搜尋：直接用 NodeID 比對（不需要 ItemList）
              const detail = store.CategoryStockItems || [];
              const hasMatch = detail.some((cat: any) => {
                for (const fc of this.foodCategories) {
                  if (fc.Name.toLowerCase().includes(keyword)) {
                    return fc.Children.some((child: any) => child.ID === cat.NodeID && cat.RemainingQty > 0);
                  }
                  const matchChild = fc.Children.find((child: any) => child.Name.toLowerCase().includes(keyword));
                  if (matchChild && matchChild.ID === cat.NodeID && cat.RemainingQty > 0) {
                    return true;
                  }
                }
                return false;
              });
              if (hasMatch) {
                newMatches.push({
                  ...store,
                  storeName: `7-11${store.StoreName}門市`,
                  label: '7-11',
                  distance: this.calc711DistFromUser(store.StoreNo),
                  remainingQty: store.RemainingQty,
                  showDistance: true,
                  CategoryStockItems: detail
                });
              }
            } else {
              // 商品名稱搜尋：收集候選，稍後用 getItemsByStoreNo 驗證
              candidateStores.push(store);
            }
          });
        });

        // === Phase 2: 商品名稱搜尋 — 用 getItemsByStoreNo 精確驗證 ===
        if (!isCategory && candidateStores.length > 0) {
          isPhase2Running = true;
          // 將所有候選門市按距離排序後全部驗證，不任意丟棄
          candidateStores.sort((a, b) => {
            return this.calc711DistFromUser(a.StoreNo) - this.calc711DistFromUser(b.StoreNo);
          });
          console.log(`[商品搜尋] 7-11 候選 ${candidateStores.length} 間，全部將加入驗證隊列 (併發上限 5)`);

          from(candidateStores).pipe(
            mergeMap(store =>
              this.sevenElevenService.getItemsByStoreNo(store.StoreNo, {
                Latitude: this.searchCenterLat, Longitude: this.searchCenterLng
              }).pipe(
                timeout(8000),
                map((res: any) => {
                  const detail = res?.element?.StoreStockItem?.CategoryStockItems || [];
                  const hasMatch = detail.some((cat: any) =>
                    cat.ItemList && cat.ItemList.some((item: any) =>
                      item.ItemName && item.ItemName.toLowerCase().includes(keyword) && item.RemainingQty > 0
                    )
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
            , 5), // 限制最多 5 個併發請求，避免癱瘓 API
            toArray()
          ).subscribe((verifiedResults: any[]) => {
            const verifiedMatches = verifiedResults.filter(match => match !== null);

            console.log(`[商品搜尋] 7-11 驗證結果: ${verifiedMatches.length}/${candidateStores.length} 間有「${keyword}」`);

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
            if (store.info) {
              store.info.forEach((category: any) => {
                if (isCategory) {
                  if (category.name && category.name.toLowerCase().includes(keyword) && category.qty > 0) {
                    hasMatch = true;
                  }
                }
                if (category.categories) {
                  category.categories.forEach((subCat: any) => {
                    if (subCat.products) {
                      subCat.products.forEach((product: any) => {
                        if (!isCategory && product.name && product.name.toLowerCase().includes(keyword) && product.qty > 0) {
                          hasMatch = true;
                        }
                      });
                    }
                  });
                }
              });
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
        // 如果 7-11 Phase 2 正在執行，先將全家結果加進去，等 7-11 做完再由它呼叫 finishProductSearchBatch
        this.productSearchStores = [...this.productSearchStores, ...newMatches];
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

    // 不論是 isInitial 還是 scroll load，統一從緩衝池中切割至目標數量
    this.totalStoresShowList = this.productSearchStores.slice(0, this.targetDisplayCount);
    this.productSearchDisplayed = this.totalStoresShowList.length;

    this.storeDataService.setStores(this.productSearchStores);
    if (isInitial) {
      this.storeDataService.setIsUserLocationSearch(true);
    }

    // 遞迴防呆：如果目前顯示的門市數量未達目標（例如只找到 2 間），且資料庫還沒搜完、未強制暫停，自動發送下一批
    // 地圖模式下，找到足夠門市後停止自動擴展，讓使用者手動「搜尋這個區域」
    if (this.totalStoresShowList.length < this.targetDisplayCount && !allExhausted && !this.productSearchPaused) {
      if (this.isMapView && this.productSearchStores.length >= this.minInitialStores) {
        // 地圖模式已找到足夠門市，停止搜尋
        this.isLoadingMore = false;
        this.productSearchRunning = false;
        this.loadingService.hide();
      } else if (isInitial) {
        setTimeout(() => {
          if (this.productSearchGeneration === currentGen) {
            this.fetchProductSearchBatch(true);
          }
        }, 200);
      } else {
        this.isLoadingMore = true;
        this.fetchProductSearchBatch(false);
      }
    } else {
      // 數量達標（或全台灣庫存已抽乾），切斷連線，進入休眠
      this.isLoadingMore = false;
      this.loadingService.hide();

      if (allExhausted) {
        this.productSearchRunning = false;
        this.productSearchPaused = false;
        if (this.productSearchTimer) {
          clearTimeout(this.productSearchTimer);
        }
      }
    }
  }

  // 使用者手動繼續搜尋（2分鐘暫停後）
  resumeProductSearch(): void {
    this.productSearchPaused = false;
    this.productSearchRunning = true;
    if (this.productSearchTimer) {
      clearTimeout(this.productSearchTimer);
    }
    const gen = this.productSearchGeneration;
    this.productSearchTimer = setTimeout(() => {
      if (this.productSearchGeneration === gen) {
        this.productSearchPaused = true;
        this.productSearchRunning = false;
      }
    }, 120000);
    this.fetchProductSearchBatch(true);
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
    this.productSearchDisplayed = this.totalStoresShowList.length;
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
      this.productSearchDisplayed = this.totalStoresShowList.length;

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
    if (this.searchTerm && this.searchTerm.trim().length > 0) {
      this.handleSearch(this.searchTerm.trim());
    } else {
      // 如果搜尋詞為空，清空結果
      this.unifiedDropDownList = [];
    }
  }

  // 強制終止並作廢目前進行中的商品/種類搜尋
  private stopProductSearch(): void {
    if (this.productSearchRunning || this.isSearchingMore || this.isLoadingMore) {
      this.productSearchGeneration++; // 作廢進行中的 fetchProductSearchBatch 回呼
      this.productSearchRunning = false;
      this.productSearchPaused = false;
      this.isSearchingMore = false;
      this.isLoadingMore = false;
    }
    if (this.productSearchTimer) {
      clearTimeout(this.productSearchTimer);
      this.productSearchTimer = null;
    }
  }

  onUseCurrentLocation(): void {
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

    this.loadingService.show("搜尋店家中")

    // 使用目前位置：以使用者位置為搜尋中心
    from(this.geolocationService.getCurrentPosition())
      .pipe(
        switchMap((position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          this.latitude = lat;
          this.longitude = lng;
          this.searchCenterLat = lat;
          this.searchCenterLng = lng;
          this.locationDenied = false;

          console.log('已取得位置');

          return of([]);
        }),
        switchMap((res) => {
          if(res) {
            return this.sevenElevenService.getAccessToken();
          }
          else{
            return [];
          }
        }),
        switchMap((token: any) => {
          if (token && token.element) {
            sessionStorage.setItem('711Token', token.element);
            return this.sevenElevenService.getFoodCategory();
          } else {
            return of([]);
          }
        }),
        catchError((error) => {
          console.error('定位失敗:', error);
          this.locationDenied = true;
          this.loadingService.hide();
          return of(null);
        })
      ).subscribe(
        (res) => {
          if (res) {
            this.searchCombineAndTransformStoresExpanded();
          } else if (!this.locationDenied) {
            console.error('Failed to fetch food categories');
            this.loadingService.hide();
          }
        }
      );
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
      // if(this.totalStoresShowList[0].distance > 1 || this.totalStoresShowList[0].remainingQty === 0){
      //   const dialogRef = this.dialog.open(MessageDialogComponent, {
      //     data: {
      //       message: '該門市無庫存，請重新搜尋。',
      //       imgPath: 'assets/NoResult.jpg',
      //     }
      //   });
      //   dialogRef.afterClosed().subscribe(result => {
      //     this.totalStoresShowList = [];
      //     this.searchTerm = '';
      //   });
      //   this.totalStoresShowList = [];
      //   return;
      // }
      // this.totalStoresShowList = [
      //   {
      //     ...this.totalStoresShowList[0],
      //     showDistance: false
      //   }
      // ];
    }
    else{
      // 根據距離排序
      this.totalStoresShowList.sort((a, b) => a.distance - b.distance);
    }
  }

  searchCombineAndTransformStores(storeLatitude?: number, storeLongitude?: number): void {
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

  // 通用的漸進式門市搜尋（支援「使用目前位置」和「門市搜尋」）
  // 先用 API 取得近距離門市，再用全部門市 JSON 逐批載入超出 1km 的門市
  searchCombineAndTransformStoresExpanded(storeLatitude?: number, storeLongitude?: number): void {
    const finalLatitude = storeLatitude || this.latitude;
    const finalLongitude = storeLongitude || this.longitude;

    const locationData711: LocationData = {
      CurrentLocation: { Latitude: finalLatitude, Longitude: finalLongitude },
      SearchLocation: { Latitude: finalLatitude, Longitude: finalLongitude }
    };

    const locationFamilyMart: Location = {
      Latitude: finalLatitude,
      Longitude: finalLongitude
    };

    forkJoin({
      sevenEleven: this.sevenElevenService.getNearByStoreList(locationData711),
      familyMart: this.familyMartService.getNearByStoreList(locationFamilyMart)
    }).subscribe(
      ({ sevenEleven, familyMart }) => {
        const allStores: any[] = [];

        // 處理 7-11 資料（重新計算距離自搜尋中心）
        if (sevenEleven && sevenEleven.element && sevenEleven.element.StoreStockItemList) {
          sevenEleven.element.StoreStockItemList.forEach((store: StoreStockItem) => {
            // 過濾掉沒有折扣商品的 7-11 門市
            if (!store.RemainingQty || store.RemainingQty <= 0) return;
            // 記錄已載入的 7-11 門市（用於擴展搜尋去重）
            if (store.StoreNo) this.sevenQueriedStoreNos.add(store.StoreNo);
            allStores.push({
              ...store,
              storeName: `7-11${store.StoreName}門市`,
              label: '7-11',
              distance: this.calc711DistFromUser(store.StoreNo),
              remainingQty: store.RemainingQty,
              showDistance: true,
              CategoryStockItems: store.CategoryStockItems
            });
          });
        }

        // 處理全家資料（重新計算距離自搜尋中心，並記錄 PKey 防止重複）
        if (familyMart && familyMart.code === 1) {
          familyMart.data.forEach((store: StoreModel) => {
            const pkey = store.oldPKey || store.name;
            this.fmQueriedPKeys.add(pkey);

            const dist = store.latitude && store.longitude
              ? getDistance(
                  { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
                  { latitude: store.latitude, longitude: store.longitude }
                )
              : store.distance;
            allStores.push({
              ...store,
              storeName: store.name,
              label: '全家',
              distance: dist,
              showDistance: true
            });
          });
        }

        // 按距離排序
        allStores.sort((a, b) => a.distance - b.distance);

        // 預算分類數量快取
        allStores.forEach(s => this.precomputeCategoryQty(s));

        // 儲存 API 回傳的門市至記憶體緩衝池
        this.allNearbyStores = allStores;

        // 準備全部門市列表（用於超出 API 範圍的擴展搜尋）
        this.prepareAllStoresByDistance();

        // 從緩衝池中取出精準數量的門市顯示
        this.targetDisplayCount = this.minInitialStores;
        this.totalStoresShowList = this.allNearbyStores.slice(0, this.targetDisplayCount);
        this.hasMoreStores = true; // 還有更多門市可以從 JSON 載入

        this.storeDataService.setStores(this.allNearbyStores);
        if (storeLatitude && storeLongitude) {
          this.storeDataService.setIsUserLocationSearch(false);
        } else {
          this.storeDataService.setIsUserLocationSearch(true);
        }

        // 預防閃爍終極解法：若搜不到任何門市，代表系統必須進入無限下拉 (JSON 擴充) 搜尋。
        // 此時絕對不允許執行 hide()，否則 loading$ = false 會在 AsyncPipe 刷新時造成圓圈閃爍。
        if (allStores.length === 0) {
          // 直接更新文字，保持 loading$ 為 true，無縫接軌到背景擴充搜尋
          this.loadingService.show("正在擴展搜尋範圍...");
          this.checkAndAutoLoadMore();
        } else {
          // 若有找到門市 (即使不足 5 間)，代表這批資料足以讓主要 loading 畫面退場，讓卡片顯示
          this.loadingService.hide();
          this.checkAndAutoLoadMore();
        }
      },
      (error) => {
        console.error('Error fetching store data:', error);
        this.loadingService.hide();
      }
    );
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
            timeout(8000),
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
            timeout(8000),
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    forkJoin({
      sevenResults: forkJoin(sevenRegionalRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }: { sevenResults: any[], fmResults: any[] }) => {
      const newStores: any[] = [];

      // === 7-11 結果：處理 getNearByStoreList 回傳 ===
      sevenResults.forEach((res: any) => {
        if (!res || !res.element || !res.element.StoreStockItemList) return;
        res.element.StoreStockItemList.forEach((store: any) => {
          if (!store.RemainingQty || store.RemainingQty <= 0) return;
          const storeNo = store.StoreNo || '';
          if (this.sevenQueriedStoreNos.has(storeNo)) return;
          this.sevenQueriedStoreNos.add(storeNo);

          const dist = this.calc711DistFromUser(storeNo);
          newStores.push({
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

      // 按距離排序後加入緩衝池
      newStores.sort((a, b) => a.distance - b.distance);
      newStores.forEach(s => this.precomputeCategoryQty(s));
      this.allNearbyStores = [...this.allNearbyStores, ...newStores];

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
    if (this.showMenu || this.showLabSection) {
      this.ngZone.run(() => {
        this.showMenu = false;
        this.showLabSection = false;
      });
    }
    
    if (this.scrollTicking) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      this.scrollTicking = false;
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
  private checkAndAutoLoadMore(attempts: number = 0): void {
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

  getFSubCategoryQty(store: StoreModel, cat: any): number {
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
      const userRef = this.firestore.collection('users').doc(this.user.uid);
      this.favoritesSubscription = userRef.collection('favorites').valueChanges().subscribe(favorites => {
        this.favoriteStores = favorites;
        // 維護 Set 以供 O(1) 查詢
        this.favoriteStoreNameSet = new Set(favorites.map((f: any) => f.storeName));
      });
    }
  }

  toggleFavorite(store: any) {
    if (this.user) {
      const userRef = this.firestore.collection('users').doc(this.user.uid);
      const favoriteRef = userRef.collection('favorites').doc(store.storeName);

      // 如果商店已經在喜愛清單內，刪除它
      if (this.isFavorite(store)) {
        favoriteRef.delete();
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

        favoriteRef.set(favoriteData);
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
    this.loadingService.show("幫你找看看唷");
    // 從本地 JSON 資料找出店家的經緯度
    var lat = 0;
    var lng = 0;
    if (store.label === "全家") {
      lat = store.storeFLatitude;
      lng = store.storeFLongitude;
      this.onOptionSelect(null, lat, lng);
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
        this.onOptionSelect(null, lat, lng);
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
              this.onOptionSelect(null, lat, lng);
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
