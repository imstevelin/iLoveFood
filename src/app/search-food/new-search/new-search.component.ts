import { Component, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormGroup, FormControl } from '@angular/forms';

import { GeolocationService } from 'src/app/services/geolocation.service';
import { SevenElevenRequestService } from './services/seven-eleven-request.service';
import { FamilyMartRequestService } from './services/family-mart-request.service';
import { LoadingService } from '../../services/loading.service'
import { AuthService } from 'src/app/services/auth.service';

import { MessageDialogComponent } from 'src/app/components/message-dialog/message-dialog.component';
import { LoginPageComponent } from 'src/app/components/login-page/login-page.component';
import { FoodCategory, LocationData, StoreStockItem, Store, Location, FoodDetail711 } from '../model/seven-eleven.model'
import { fStore, StoreModel, FoodDetailFamilyMart } from '../model/family-mart.model';
import { StoreDataService } from 'src/app/services/stores-data.service';

import { environment } from 'src/environments/environment';

import { switchMap, from, of, catchError, Observable, tap, forkJoin, Subject, debounceTime, distinctUntilChanged, map } from 'rxjs';

import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatDialog } from '@angular/material/dialog';

import { getDistance } from 'geolib';

import { AngularFirestore } from '@angular/fire/compat/firestore';
import { pinyin } from 'pinyin-pro';

@Component({
  selector: 'app-new-search',
  templateUrl: './new-search.component.html',
  styleUrls: ['./new-search.component.scss'],
})
export class NewSearchComponent implements OnInit {
  user: any = null;
  showFavorites: boolean = false; // 收藏面板是否展開
  storesDataReady: boolean = false; // 商店 JSON 資料是否已載入

  // 搜尋模式: 'location' = 定位搜尋, 'store' = 門市搜尋, 'product' = 商品搜尋
  searchMode: 'location' | 'store' | 'product' = 'location';
  isLocationSearchMode: boolean = true; // 是否使用定位搜尋

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
  unifiedDropDownList: any[] = [];

  // 商品搜尋相關
  productSearchKeyword: string = ''; // 目前搜尋的商品關鍵字
  productSearchStores: any[] = []; // 商品搜尋結果的門市列表（所有已找到的）
  productSearchIsCategory: boolean = false; // 是否為種類搜尋

  // 無限滾動相關
  allNearbyStores: any[] = []; // 所有附近門市（尚未顯示的）
  storesPerPage: number = 10; // 每次加載門市數量
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
  private productSearchBatchSize: number = 30;      // 每批查詢門市數
  private productSearchDisplayed: number = 0;       // 已顯示的門市計數
  private isSearchingMore: boolean = false;          // 是否正在擴搜
  private searchExhausted711: boolean = false;       // 7-11 是否已搜完
  private searchExhaustedFm: boolean = false;        // 全家是否已搜完
  private fmQueriedPKeys: Set<string> = new Set();   // 已查詢過的全家門市 PKey（去重用）
  private productSearchTimer: any = null;            // 商品搜尋計時器
  productSearchPaused: boolean = false;              // 是否暫停搜尋（2分鐘後）
  productSearchRunning: boolean = false;             // 是否正在商品搜尋中
  private productSearchGeneration: number = 0;       // 搜尋世代計數器，用於作廢舊搜尋的 setTimeout
  private storeSearchGeneration: number = 0;         // 店名搜尋世代計數器
  locationDenied: boolean = false;                   // 使用者拒絕定位
  private minInitialStores: number = 10;             // 首次載入最少店數

  // 拼音轉換快取：避免重複轉換相同的文字
  private pinyinCache = new Map<string, string>();


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

  constructor(
    private http: HttpClient,
    private geolocationService: GeolocationService,
    private sevenElevenService: SevenElevenRequestService,
    private familyMartService: FamilyMartRequestService,
    private authService: AuthService,
    public loadingService: LoadingService,
    public dialog: MatDialog,
    private firestore: AngularFirestore,
    private storeDataService: StoreDataService
  ) {
    this.searchForm = new FormGroup({
      selectedStoreName: new FormControl(''), // 控制選中的商店
    });
  }

  ngOnInit(): void {
    // 移除自動搜尋，改為手動觸發（Enter 或按鈕）
    // this.searchInput$ 不再自動訂閱
    this.init();
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
    // 訂閱 getUser 方法來獲取用戶資料
    this.authService.getUser().subscribe(user => {
      if (user && user.emailVerified) {
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
          this.loadingService.hide();
          // 自動觸發「使用目前位置」搜尋
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
    let totalQty = 0;

    // 遍歷商店中的所有商品，檢查是否屬於當前分類及子分類
    for (const stockItem of store.CategoryStockItems) {
      // 遍歷每個分類的子項目，檢查是否屬於這個 category
      for (const child of category.Children) {
        if (stockItem.NodeID === child.ID) {
          totalQty += stockItem.RemainingQty;
        }
      }
    }

    return totalQty;
  }

  // 當用戶點擊某個分類時，切換選中的分類與店鋪
  toggleSubCategoryDetails(store: any, category: any): void {
    if (store.selectedCategory === category) {
      store.selectedCategory = undefined;
    } else {
      store.selectedCategory = category;
    }
  }

  trackByStore(index: number, store: any): string {
    return store.storeName || store.StoreName || index.toString();
  }

  trackByCategory(index: number, category: any): string {
    // 7-11 使用 ID，全家使用 name
    return category.ID || category.name || index.toString();
  }

  // mat-autocomplete 顯示函式：防止 [object Object]
  displayFn(item: any): string {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.name || '';
  }

  // 切換收藏面板
  toggleFavoritesPanel(): void {
    this.showFavorites = !this.showFavorites;
  }

  // 登入/登出
  loginOrlogout(): void {
    if (this.user) {
      this.authService.logout();
      this.user = null;
      this.favoriteStores = [];
      const dialogRef = this.dialog.open(MessageDialogComponent, {
        width: '300px',
        data: {
          title: '登出成功',
          message: '已順利登出',
          imgPath: 'assets/S__222224406.jpg'
        }
      });
      dialogRef.afterClosed().subscribe(() => {
        this.favoriteStores = [];
      });
    } else {
      const dialogRef = this.dialog.open(LoginPageComponent, {
        width: '500px',
        data: {},
      });
      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          this.authService.getUser().subscribe(user => {
            if (user && user.emailVerified) {
              this.user = user;
              this.loadFavoriteStores();
            }
          });
        }
      });
    }
  }

  onInput(event: Event): void {
    const input = (event.target as HTMLInputElement).value;
    this.searchTerm = input;
    // 當輸入超過 1 個字時，自動顯示候選框
    if (input.length >= 1) {
      this.handleSearch(input);
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

  // 使用本地 JSON 資料和拼音比對進行搜尋（支援門市、商品、種類）
  handleSearch(input: string): void {
    if (input.length >= 1) {
      this.unifiedDropDownList = [];

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
      this.unifiedDropDownList = [
        ...categoryCandidates.slice(0, 5),
        ...productCandidates.slice(0, 10),
        ...storeCandidates.slice(0, 15)
      ];

      this.loadingService.hide();
    } else {
      this.unifiedDropDownList = [];
    }
  }

  onOptionSelect(event: MatAutocompleteSelectedEvent | null, lat?: number, lng?: number): void {
    const selectedValue = event?.option?.value;

    // 如果選中的是「商品」或「種類」，執行商品搜尋模式
    if (selectedValue && (selectedValue.type === 'product' || selectedValue.type === 'category')) {
      this.onProductOrCategorySelect(selectedValue);
      return;
    }

    // 以下為門市搜尋模式（原有邏輯）
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
            this.loadingService.hide();
          } else {
            this.loadingService.hide();
          }
        }
      );
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
    this.hasMoreStores = true;
    this.productSearchPaused = false;
    this.productSearchRunning = true;
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
    if (this.storesDataReady) {
      this.prepareAllStoresByDistance();
      this.fetchProductSearchBatch(true);
    } else {
      // 每 200ms 檢查一次，最多等 15 秒
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (this.storesDataReady || attempts > 75) {
          clearInterval(interval);
          this.prepareAllStoresByDistance();
          this.fetchProductSearchBatch(true);
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
    if (this.all711Stores && this.all711Stores.length > 0) {
      this.all711StoresSortedByDist = this.all711Stores
        .filter((s: any) => s.Latitude && s.Longitude)
        .map((s: any) => ({
          ...s,
          distance: getDistance(
            { latitude: centerLat, longitude: centerLng },
            { latitude: s.Latitude, longitude: s.Longitude }
          )
        }))
        .sort((a: any, b: any) => a.distance - b.distance);
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
    if (sevenBatchStart + batchSize >= this.all711StoresSortedByDist.length) {
      this.searchExhausted711 = true;
    }

    // 準備全家批次：取得一組尚未查過的全家門市，用它們的座標呼叫 API
    const fmBatchStart = this.productSearchFmBatchIdx * batchSize;
    const fmBatch = this.allFmStoresSortedByDist.slice(fmBatchStart, fmBatchStart + batchSize);
    this.productSearchFmBatchIdx++;
    if (fmBatchStart + batchSize >= this.allFmStoresSortedByDist.length) {
      this.searchExhaustedFm = true;
    }

    // 建立 7-11 門市明細查詢（每間門市呼叫 getItemsByStoreNo）
    const sevenDetailRequests = sevenBatch.length > 0
      ? sevenBatch.map((store: any) =>
          this.sevenElevenService.getItemsByStoreNo(store.StoreNo).pipe(
            map((res: any) => ({
              store: store,
              detail: res?.element?.StoreStockItem?.CategoryStockItems || []
            })),
            catchError(() => of({ store: store, detail: [] }))
          )
        )
      : [of(null)];

    // 建立全家區域查詢：從批次中取幾個代表座標來呼叫 API
    // 每 ~10 間門市取一個代表座標，避免 API 呼叫過多
    const fmQueryPoints = this.pickFmQueryPoints(fmBatch, 3);
    const fmRegionalRequests = fmQueryPoints.length > 0
      ? fmQueryPoints.map((point: any) =>
          this.familyMartService.getNearByStoreList({
            Latitude: point.latitude,
            Longitude: point.longitude
          }).pipe(
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    // 同時查詢 7-11 明細 + 全家區域
    forkJoin({
      sevenResults: forkJoin(sevenDetailRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }) => {
      const newMatches: any[] = [];

      // === 處理 7-11 結果 ===
      if (sevenResults) {
        sevenResults.forEach((result: any) => {
          if (!result) return;
          const { store, detail } = result;
          let hasMatch = false;

          if (isCategory) {
            // 種類搜尋：用 NodeID 比對
            hasMatch = detail.some((cat: any) => {
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
          } else {
            // 商品名稱搜尋
            hasMatch = detail.some((cat: any) =>
              cat.ItemList && cat.ItemList.some((item: any) =>
                item.ItemName && item.ItemName.toLowerCase().includes(keyword) && item.RemainingQty > 0
              )
            );
          }

          if (hasMatch) {
            newMatches.push({
              ...store,
              storeName: `7-11${store.StoreName}門市`,
              label: '7-11',
              distance: store.distance,
              remainingQty: store.RemainingQty || 0,
              showDistance: true,
              CategoryStockItems: detail
            });
          }
        });
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

      // 加入已有結果並排序
      this.productSearchStores = [...this.productSearchStores, ...newMatches];
      this.productSearchStores.sort((a, b) => a.distance - b.distance);

      this.isSearchingMore = false;

      // 檢查搜尋世代是否已過期（使用者已開始新搜尋）
      if (currentGen !== this.productSearchGeneration) return;

      // 判斷是否已經搜完所有門市
      const allExhausted = this.searchExhausted711 && this.searchExhaustedFm;
      this.hasMoreStores = !allExhausted;

      if (isInitial) {
        // 首次搜尋：立即顯示目前找到的結果
        this.totalStoresShowList = this.productSearchStores.slice(0, Math.max(this.productSearchDisplayed, this.productSearchStores.length));
        this.productSearchDisplayed = this.totalStoresShowList.length;

        this.storeDataService.setStores(this.productSearchStores);
        this.storeDataService.setIsUserLocationSearch(true);
        this.loadingService.hide();

        if (this.productSearchStores.length === 0 && allExhausted) {
          // 真正沒有結果
        }

        // 只在結果不到 minInitialStores 時自動繼續搜尋，否則等待使用者滾動
        if (!allExhausted && !this.productSearchPaused && currentGen === this.productSearchGeneration
            && this.productSearchStores.length < this.minInitialStores) {
          setTimeout(() => {
            if (this.productSearchGeneration === currentGen) {
              this.fetchProductSearchBatch(true);
            }
          }, 200);
        } else if (allExhausted) {
          this.productSearchRunning = false;
          this.productSearchPaused = false;
          if (this.productSearchTimer) {
            clearTimeout(this.productSearchTimer);
          }
        }
      } else {
        // 滾動加載：追加顯示
        this.showMoreProductResults();
      }
    });
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

  // 從全家門市批次中挑選代表查詢座標（均勻分佈）
  private pickFmQueryPoints(batch: any[], maxPoints: number): any[] {
    if (batch.length === 0) return [];
    const points: any[] = [];
    const step = Math.max(1, Math.floor(batch.length / maxPoints));
    for (let i = 0; i < batch.length && points.length < maxPoints; i += step) {
      points.push(batch[i]);
    }
    return points;
  }

  // 顯示更多商品搜尋結果（無限滾動用）
  private showMoreProductResults(): void {
    const nextEnd = this.productSearchDisplayed + this.storesPerPage;
    this.totalStoresShowList = this.productSearchStores.slice(0, nextEnd);
    this.productSearchDisplayed = this.totalStoresShowList.length;
    this.isLoadingMore = false;
  }

  // 商品搜尋的無限滾動觸發
  private loadMoreProductResults(): void {
    if (this.isLoadingMore || this.isSearchingMore) return;
    this.isLoadingMore = true;

    // 如果已有但未顯示的結果足夠，直接顯示
    if (this.productSearchDisplayed < this.productSearchStores.length) {
      this.showMoreProductResults();
      return;
    }

    // 否則需要繼續搜尋下一批
    if (!this.searchExhausted711 || !this.searchExhaustedFm) {
      this.fetchProductSearchBatch(false);
    } else {
      this.hasMoreStores = false;
      this.isLoadingMore = false;
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

  onUseCurrentLocation(): void {
    // 變更搜尋模式
    this.searchMode = 'location';
    this.isLocationSearchMode = true;

    // 清除商店列表
    this.totalStoresShowList = [];
    this.allNearbyStores = [];
    this.hasMoreStores = false;

    // 重置漸進式搜尋狀態
    this.all711StoresSortedByDist = [];
    this.allFmStoresSortedByDist = [];
    this.productSearch711BatchIdx = 0;
    this.productSearchFmBatchIdx = 0;
    this.searchExhausted711 = false;
    this.searchExhaustedFm = false;
    this.fmQueriedPKeys = new Set();

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
        distance: store.Distance,
        remainingQty: store.RemainingQty,
        showDistance: true,
        CategoryStockItems: store.CategoryStockItems
      };
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
            const storeAny = store as any;
            const dist = storeAny.Latitude && storeAny.Longitude
              ? getDistance(
                  { latitude: this.searchCenterLat, longitude: this.searchCenterLng },
                  { latitude: storeAny.Latitude, longitude: storeAny.Longitude }
                )
              : store.Distance;
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

        // 儲存 API 回傳的門市
        this.allNearbyStores = allStores;

        // 準備全部門市列表（用於超出 API 範圍的擴展搜尋）
        this.prepareAllStoresByDistance();

        // 顯示所有 API 回傳的門市（通常 ~20 間，足夠填滿頁面）
        this.totalStoresShowList = allStores;
        this.hasMoreStores = true; // 還有更多門市可以從 JSON 載入

        this.storeDataService.setStores(allStores);
        if (storeLatitude && storeLongitude) {
          this.storeDataService.setIsUserLocationSearch(false);
        } else {
          this.storeDataService.setIsUserLocationSearch(true);
        }

        this.loadingService.hide();
        this.checkAndAutoLoadMore();
      },
      (error) => {
        console.error('Error fetching store data:', error);
        this.loadingService.hide();
      }
    );
  }

  // 載入更多門市（無限滾動 — 支援超出 API 範圍）
  loadMoreStores(): void {
    if (this.isLoadingMore || !this.hasMoreStores) return;
    this.isLoadingMore = true;

    const currentLength = this.totalStoresShowList.length;

    // 優先從已載入的 allNearbyStores 中取（API 回傳的範圍）
    if (currentLength < this.allNearbyStores.length) {
      const nextBatch = this.allNearbyStores.slice(currentLength, currentLength + this.storesPerPage);
      this.totalStoresShowList = [...this.totalStoresShowList, ...nextBatch];
      this.hasMoreStores = true;
      this.isLoadingMore = false;
      // 檢查是否達到最少數量
      this.ensureMinimumStores();
      return;
    }

    // 超出 API 範圍：從全部門市 JSON 逐批載入
    this.loadMoreStoresFromJSON();
  }

  // 從全部門市 JSON 載入超出 API 範圍的門市
  private loadMoreStoresFromJSON(): void {
    const batchSize = this.productSearchBatchSize;

    // 7-11 批次
    const sevenBatchStart = this.productSearch711BatchIdx * batchSize;
    const sevenBatch = this.all711StoresSortedByDist
      .filter((s: any) => {
        // 排除已在 allNearbyStores 中的門市
        return !this.allNearbyStores.some(ns => ns.StoreNo === s.StoreNo);
      })
      .slice(sevenBatchStart, sevenBatchStart + batchSize);
    this.productSearch711BatchIdx++;

    // 全家批次（用區域查詢）
    const fmBatchStart = this.productSearchFmBatchIdx * batchSize;
    const fmBatch = this.allFmStoresSortedByDist
      .filter((s: any) => {
        return !this.allNearbyStores.some(ns => (ns.oldPKey && ns.oldPKey === s.pkeynew) || ns.storeName === s.Name);
      })
      .slice(fmBatchStart, fmBatchStart + batchSize);
    this.productSearchFmBatchIdx++;

    const allExhausted = sevenBatch.length === 0 && fmBatch.length === 0;
    if (allExhausted) {
      this.hasMoreStores = false;
      this.isLoadingMore = false;
      return;
    }

    // 7-11 商品明細查詢
    const sevenDetailRequests = sevenBatch.length > 0
      ? sevenBatch.map((store: any) =>
          this.sevenElevenService.getItemsByStoreNo(store.StoreNo).pipe(
            map((res: any) => {
              const detail = res?.element?.StoreStockItem?.CategoryStockItems || [];
              const totalQty = detail.reduce((sum: number, cat: any) => sum + (cat.RemainingQty || 0), 0);
              if (totalQty === 0) return null;
              return {
                ...store,
                storeName: `7-11${store.StoreName}門市`,
                label: '7-11',
                distance: store.distance,
                remainingQty: totalQty,
                showDistance: true,
                CategoryStockItems: detail
              };
            }),
            catchError(() => of(null))
          )
        )
      : [of(null)];

    // 全家區域查詢
    const fmQueryPoints = this.pickFmQueryPoints(fmBatch, 3);
    const fmRegionalRequests = fmQueryPoints.length > 0
      ? fmQueryPoints.map((point: any) =>
          this.familyMartService.getNearByStoreList({
            Latitude: point.latitude,
            Longitude: point.longitude
          }).pipe(
            catchError(() => of({ code: 0, data: [] }))
          )
        )
      : [of({ code: 0, data: [] })];

    forkJoin({
      sevenResults: forkJoin(sevenDetailRequests),
      fmResults: forkJoin(fmRegionalRequests)
    }).subscribe(({ sevenResults, fmResults }) => {
      const newStores: any[] = [];

      // 7-11 結果（過濾掉 null — totalQty===0 的門市）
      sevenResults.forEach((store: any) => {
        if (store) newStores.push(store);
      });

      // 全家結果
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

      // 按距離排序後加入
      newStores.sort((a, b) => a.distance - b.distance);
      this.allNearbyStores = [...this.allNearbyStores, ...newStores];

      // 顯示下一頁
      const nextEnd = this.totalStoresShowList.length + this.storesPerPage;
      this.totalStoresShowList = this.allNearbyStores.slice(0, nextEnd);
      this.storeDataService.setStores(this.allNearbyStores);

      this.isLoadingMore = false;
      // 檢查是否達到最少數量
      this.ensureMinimumStores();
    });
  }

  // 監聽滾動事件，觸發無限滾動
  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    if (!this.hasMoreStores || this.isLoadingMore) return;

    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;

    // 滾動到底部前 200px 時觸發載入
    if (scrollPosition >= documentHeight - 200) {
      if (this.searchMode === 'product') {
        this.loadMoreProductResults();
      } else if (this.searchMode === 'store' || this.searchMode === 'location') {
        this.loadMoreStores();
      }
    }
  }

  // 確保至少載入 minInitialStores 間門市
  private checkAndAutoLoadMore(attempts: number = 0): void {
    this.ensureMinimumStores();
  }

  // 確保至少顯示 minInitialStores 間門市
  private ensureMinimumStores(): void {
    if (this.totalStoresShowList.length < this.minInitialStores && this.hasMoreStores && !this.isLoadingMore) {
      // 延遲一帧确保 DOM 更新
      setTimeout(() => {
        if (this.totalStoresShowList.length < this.minInitialStores && this.hasMoreStores && !this.isLoadingMore) {
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

  fStoreName(storeName: string): string {
    return storeName ? storeName.replace('全家', '') : ''
  }

  loadFavoriteStores() {
    if (this.user.emailVerified) {
      const userRef = this.firestore.collection('users').doc(this.user.uid);
      userRef.collection('favorites').valueChanges().subscribe(favorites => {
        this.favoriteStores = favorites;
      });
    }
  }

  toggleFavorite(store: any) {
    if (this.user.emailVerified) {
      const userRef = this.firestore.collection('users').doc(this.user.uid);
      const favoriteRef = userRef.collection('favorites').doc(store.storeName);

      // 如果商店已經在喜愛清單內，刪除它
      if (this.isFavorite(store)) {
        const dialogRef = this.dialog.open(MessageDialogComponent, {
          data: {
            title: "取消收藏",
            message: `已將『${store.storeName}』從收藏中移除`,
            imgPath: "assets/S__222224406.jpg"
          }
        });
        dialogRef.afterClosed().subscribe(result => {
          favoriteRef.delete();
        });
      } else {
        const dialogRef = this.dialog.open(MessageDialogComponent, {
          data: {
            title: "新增收藏",
            message: `『${store.storeName}』已加入您的收藏店家`,
            imgPath: "assets/S__222224406.jpg"
          }
        });

        dialogRef.afterClosed().subscribe(result => {
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
        });
      }
    } else {
    }
  }

  isFavorite(store: any): boolean {
    return this.favoriteStores.some(favStore => favStore.storeName === store.storeName);
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
