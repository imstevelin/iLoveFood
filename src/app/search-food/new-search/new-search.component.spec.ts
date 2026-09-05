import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { SearchFoodModule } from '../search-food.module';

import { NewSearchComponent } from './new-search.component';
import { resolveDiscountTimeStatus } from 'src/app/utils/discount-schedule';

describe('NewSearchComponent', () => {
  let component: NewSearchComponent;
  let fixture: ComponentFixture<NewSearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchFoodModule, HttpClientTestingModule, MatDialogModule],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NewSearchComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('caps route samples while preserving both endpoints', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ lat: index, lng: index }));
    const limited = (component as any).limitRouteSamplePoints(points, 40);

    expect(limited.length).toBe(40);
    expect(limited[0]).toEqual(points[0]);
    expect(limited[limited.length - 1]).toEqual(points[99]);
  });

  it('keeps the mobile menu open while the user scrolls inside it', () => {
    const menu = document.createElement('nav');
    const menuItem = document.createElement('button');
    const outside = document.createElement('main');
    menu.appendChild(menuItem);
    component.menuPanel = { nativeElement: menu } as any;
    component.showMenu = true;

    component.onWindowTouchMove({ target: menuItem } as any);
    expect(component.showMenu).toBeTrue();

    component.onWindowTouchMove({ target: outside } as any);
    expect(component.showMenu).toBeFalse();
  });

  it('does not close the mobile menu when the page scroll position changes', () => {
    component.showMenu = true;
    component.hasMoreStores = false;

    component.onWindowScroll();

    expect(component.showMenu).toBeTrue();
  });

  it('updates autocomplete suggestions on the current input event without debounce lag', () => {
    const searchSpy = spyOn(component, 'handleSearch');
    const input = document.createElement('input');
    input.value = '飯';

    component.onInput({ target: input } as any);

    expect(searchSpy).toHaveBeenCalledOnceWith('飯');
  });

  it('uses ten stores for the initial page and every subsequent page', () => {
    expect(component.storesPerPage).toBe(10);
    expect((component as any).minInitialStores).toBe(10);

    component.searchMode = 'location';
    component.hasMoreStores = true;
    component.allNearbyStores = Array.from({ length: 20 }, (_, index) => ({ storeName: `store-${index}` }));
    component.totalStoresShowList = component.allNearbyStores.slice(0, 10);
    (component as any).targetDisplayCount = 10;

    component.loadMoreStores();

    expect(component.totalStoresShowList.length).toBe(20);
  });

  it('keeps the global overlay blurred in dark mode', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cdk-overlay-backdrop-showing';
    document.body.appendChild(backdrop);
    document.documentElement.setAttribute('data-theme', 'dark');

    expect(getComputedStyle(backdrop).backdropFilter).toContain('blur(9px)');

    backdrop.remove();
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('normalizes common Traditional Chinese product variants', () => {
    const normalize = (component as any).normalizeSearchText.bind(component);
    expect(normalize('配．意大利麪')).toBe(normalize('義大利麵'));
    expect(normalize('臺式 飯糰')).toBe(normalize('台式飯糰'));
  });

  it('supports any and all keyword matching', () => {
    const matches = (component as any).matchesKeywordSet.bind(component);
    const keywords = [
      { text: '義大利麵', isCategory: false },
      { text: '便當', isCategory: false }
    ];

    component.keywordMatchMode = 'any';
    expect(matches((keyword: any) => '奶油培根義大利麵'.includes(keyword.text), keywords)).toBeTrue();

    component.keywordMatchMode = 'all';
    expect(matches((keyword: any) => '奶油培根義大利麵'.includes(keyword.text), keywords)).toBeFalse();
    expect(matches((keyword: any) => '義大利麵便當'.includes(keyword.text), keywords)).toBeTrue();
  });

  it('keeps the main field single-search and exposes advanced state separately', () => {
    expect(component.mainSearchPlaceholder).toBe('搜尋商品、分類或門市');

    component.selectedKeywords = [
      { name: '便當', type: 'text' },
      { name: '飯糰', type: 'text' }
    ];
    component.advancedSearchActive = true;

    expect(component.mainSearchPlaceholder).toBe('已套用 2 個進階條件');
  });

  it('replaces the prior condition when selecting from the regular search field', () => {
    spyOn(component, 'performSearch');
    component.selectedKeywords = [{ name: '便當', type: 'text' }];
    component.advancedSearchActive = true;

    component.onOptionSelect({
      option: { value: { name: '鮪魚飯糰', type: 'product', label: '商品' } }
    } as any);

    expect(component.selectedKeywords).toEqual([
      jasmine.objectContaining({ name: '鮪魚飯糰', type: 'product' })
    ]);
    expect(component.advancedSearchActive).toBeFalse();
    expect(component.keywordCtrl.value).toBe('鮪魚飯糰');
    expect(component.performSearch).toHaveBeenCalled();
  });

  it('uses the active result source for the map store count', () => {
    component.totalStoresShowList = [{}, {}, {}];
    component.productSearchStores = [{}, {}];

    component.searchMode = 'location';
    expect(component.mapStoreCount).toBe(3);

    component.searchMode = 'product';
    expect(component.mapStoreCount).toBe(2);
  });

  it('recognizes discount periods that cross midnight and their exact boundaries', () => {
    expect(resolveDiscountTimeStatus('7-11', 2 * 60 + 30).active).toBeTrue();
    expect(resolveDiscountTimeStatus('7-11', 3 * 60).active).toBeFalse();
    expect(resolveDiscountTimeStatus('7-11', 19 * 60 + 30).activePeriod?.discountLabel).toBe('8 折');
    expect(resolveDiscountTimeStatus('7-11', 20 * 60).activePeriod?.discountLabel).toBe('65 折');
    expect(resolveDiscountTimeStatus('全家', 16 * 60 + 59).activePeriod?.productLabel).toContain('飯糰');
    expect(resolveDiscountTimeStatus('全家', 17 * 60).activePeriod?.productLabel).toContain('生鮮蔬果');
    expect(resolveDiscountTimeStatus('全家', 0).active).toBeFalse();
  });

  it('shows only the closed chain when one convenience store is outside discount hours', () => {
    component.updateDiscountTimeInfo(new Date('2026-08-07T10:00:00.000Z')); // 台灣時間 18:00

    expect(component.isSearchBlockedByDiscountHours).toBeFalse();
    expect(component.inactiveDiscountTimeStatuses.length).toBe(1);
    expect(component.inactiveDiscountTimeStatuses[0].chain).toBe('7-11');
    expect(component.inactiveDiscountTimeStatuses[0].nextPeriod.timeLabel).toBe('19:00–19:59');
  });

  it('stops active searches and clears results when both stores leave discount hours', () => {
    const stopSpy = spyOn<any>(component, 'stopProductSearch').and.callThrough();
    component.totalStoresShowList = [{ label: '7-11' }];
    component.allNearbyStores = [{ label: '全家' }];
    component.productSearchStores = [{ label: '7-11' }];
    component.isMapView = true;

    component.updateDiscountTimeInfo(new Date('2026-08-06T20:00:00.000Z')); // 台灣時間 04:00

    expect(component.isSearchBlockedByDiscountHours).toBeTrue();
    expect(stopSpy).toHaveBeenCalled();
    expect(component.totalStoresShowList).toEqual([]);
    expect(component.allNearbyStores).toEqual([]);
    expect(component.productSearchStores).toEqual([]);
    expect(component.isMapView).toBeFalse();
  });

  it('does not start a query while both convenience stores are outside discount hours', () => {
    component.updateDiscountTimeInfo(new Date('2026-08-06T20:00:00.000Z')); // 台灣時間 04:00
    const locateSpy = spyOn(component, 'onUseCurrentLocation');
    const dialogSpy = spyOn(component.dialog, 'open');

    component.performSearch();
    component.openAdvancedSearch();
    component.openRouteSearch();

    expect(locateSpy).not.toHaveBeenCalled();
    expect(dialogSpy).not.toHaveBeenCalled();
  });

  it('uses a clear no-product message instead of describing zero stock as a reload error', () => {
    component.discountTimeStatuses = [];

    expect(component.getStoreEmptyMessage({ label: '全家', inventoryUnavailable: true }))
      .toBe('該門市暫時沒有即期商品。');
  });

  it('normalizes numeric 7-11 store numbers before coordinate lookup', () => {
    component.searchCenterLat = 25.033;
    component.searchCenterLng = 121.5654;
    (component as any).applySevenElevenStores([
      { serial: '012345', lat: 25.0334, lng: 121.5654 }
    ]);

    const distance = (component as any).calc711DistFromUser(12345);

    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(100);
  });

  it('sorts mixed convenience-store results globally by meter distance', () => {
    const stores = [
      { label: '7-11', storeName: '7-11 較遠', distance: 920 },
      { label: '全家', storeName: '全家 最近', distance: 180 },
      { label: '7-11', storeName: '7-11 次近', distance: 360 },
      { label: '全家', storeName: '全家 較遠', distance: 740 }
    ];

    const sorted = (component as any).sortStoresByDistance(stores);

    expect(sorted.map((store: any) => store.storeName)).toEqual([
      '全家 最近',
      '7-11 次近',
      '全家 較遠',
      '7-11 較遠'
    ]);
  });

  it('can continue with the Taipei 101 fallback when location is unavailable', () => {
    const searchSpy = spyOn(component, 'searchCombineAndTransformStoresExpanded');
    component.locationDenied = true;
    component.isMapView = true;

    component.useFallbackLocation();

    expect(component.locationDenied).toBeFalse();
    expect(component.locationFallbackUsed).toBeTrue();
    expect(component.isMapView).toBeFalse();
    expect(component.searchCenterLat).toBe(25.0330);
    expect(component.searchCenterLng).toBe(121.5654);
    expect(searchSpy).toHaveBeenCalledWith(25.0330, 121.5654);
  });

  it('treats an exhausted product search with no matches as a valid empty result', () => {
    const hideSpy = spyOn(component.loadingService, 'hide');
    const failSpy = spyOn(component.loadingService, 'fail');
    component.selectedKeywords = [{ name: '不存在的商品', type: 'text' }];
    component.productSearchStores = [];
    component.totalStoresShowList = [];
    component.productSearchRunning = true;
    (component as any).targetDisplayCount = 5;
    (component as any).productSearchGeneration = 3;
    (component as any).searchExhausted711 = true;
    (component as any).searchExhaustedFm = true;

    (component as any).finishProductSearchBatch(3, true, []);

    expect(component.totalStoresShowList).toEqual([]);
    expect(component.hasMoreStores).toBeFalse();
    expect(component.productSearchRunning).toBeFalse();
    expect(hideSpy).toHaveBeenCalled();
    expect(failSpy).not.toHaveBeenCalled();
  });

  it('uses the local catalog to distinguish impossible product keywords before querying stores', () => {
    component.foodDetails711 = [{ name: '鮪魚飯糰' } as any];
    component.foodDetailsFamilyMart = [{ title: '奶油培根義大利麵' } as any];
    component.selectedKeywords = [
      { name: '鮪魚', type: 'text' },
      { name: '宇宙龍蝦', type: 'text' }
    ];

    component.keywordMatchMode = 'any';
    expect((component as any).hasCatalogCandidateForCurrentSearch()).toBeTrue();

    component.keywordMatchMode = 'all';
    expect((component as any).hasCatalogCandidateForCurrentSearch()).toBeFalse();
  });

  it('returns an impossible local keyword before requesting location or credentials', () => {
    const locationSpy = spyOn((component as any).geolocationService, 'getCurrentPosition');
    const tokenSpy = spyOn((component as any).sevenElevenService, 'ensureGatewayReady');
    const hideSpy = spyOn(component.loadingService, 'hide');
    component.storesDataReady = true;
    component.locationDenied = true;
    component.foodDetails711 = [{ name: '鮪魚飯糰' } as any];
    component.foodDetailsFamilyMart = [{ title: '奶油培根義大利麵' } as any];
    component.keywordCtrl.setValue('宇宙龍蝦');

    component.performSearch();

    expect(locationSpy).not.toHaveBeenCalled();
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(component.productSearchRunning).toBeFalse();
    expect(component.locationDenied).toBeFalse();
    expect(component.totalStoresShowList).toEqual([]);
    expect(hideSpy).toHaveBeenCalled();
  });

  it('stops after the nearby no-result scan instead of searching the full national index', () => {
    const hideSpy = spyOn(component.loadingService, 'hide');
    component.selectedKeywords = [{ name: '限量商品', type: 'text' }];
    component.productSearchStores = [];
    component.totalStoresShowList = [];
    component.productSearchRunning = true;
    component.productSearchScanned = 20;
    component.productSearchTotalCandidates = 4000;
    (component as any).productSearchGeneration = 7;
    (component as any).searchExhausted711 = false;
    (component as any).searchExhaustedFm = false;

    (component as any).finishProductSearchBatch(7, true, []);

    expect(component.productSearchRunning).toBeFalse();
    expect(component.hasMoreStores).toBeFalse();
    expect(component.totalStoresShowList).toEqual([]);
    expect(hideSpy).toHaveBeenCalled();
  });
});
