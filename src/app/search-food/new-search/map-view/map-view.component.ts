import {
  Component, Input, Output, EventEmitter,
  ViewChild, ElementRef, OnInit, OnDestroy, OnChanges, SimpleChanges,
  ChangeDetectorRef, NgZone
} from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { SevenElevenRequestService } from '../services/seven-eleven-request.service';
import { FamilyMartRequestService } from '../services/family-mart-request.service';
import { LocationData, StoreStockItem } from '../../model/seven-eleven.model';
import { StoreModel } from '../../model/family-mart.model';
import { getDistance } from 'geolib';

declare var google: any;

@Component({
  selector: 'app-map-view',
  templateUrl: './map-view.component.html',
  styleUrls: ['./map-view.component.scss']
})
export class MapViewComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;
  @ViewChild('detailInner') detailInner?: ElementRef;

  @Input() stores: any[] = [];
  @Input() userLat: number = 25.033;
  @Input() userLng: number = 121.565;
  @Input() isDarkMode: boolean = false;
  @Input() foodCategories: any[] = [];
  @Input() foodDetails711: any[] = [];
  @Input() foodDetailsFamilyMart: any[] = [];
  @Input() sevenElevenIconUrl: string = '';
  @Input() familyMartIconUrl: string = '';
  @Input() storeNoToCoords: Map<string, { lat: number; lng: number }> = new Map();
  // Fix 1: Search context from parent
  @Input() searchMode: string = 'location';
  @Input() searchCenterLat: number = 0;
  @Input() searchCenterLng: number = 0;

  // Allow parent to pass loading state & completely clear stores
  @Input() isParentSearching: boolean = false;
  @Input() focusStoreFromList: any = null;

  // Favorite support
  @Input() user: any = null;
  @Input() favoriteStoreNameSet: Set<string> = new Set();

  @Output() storeSelected = new EventEmitter<any>();
  @Output() sheetStateChange = new EventEmitter<boolean>();
  @Output() favoriteToggle = new EventEmitter<any>();
  @Output() parsedStoresChange = new EventEmitter<any[]>();

  map: any;
  markers: any[] = [];
  userMarker: any;
  selectedStore: any = null;
  selectedStoreCategory: any = null;

  showSearchAreaBtn: boolean = false;
  showAreaTooLargeMsg: boolean = false;
  isSearchingArea: boolean = false;
  searchProgress: number = 0;
  private lastSearchCenter: { lat: number; lng: number } | null = null;
  allMapStores: any[] = [];
  private searchedStoreKeys = new Set<string>();
  private mapIdleListener: any;
  sheetOpen: boolean = false;
  private initialFitDone: boolean = false; // Only auto-zoom once

  // Fix 5: Track expanded detail height to prevent jumping
  sheetDetailMinHeight: number = 0;

  // Fix 4: Continuous progress animation
  private progressTimer: any = null;

  // Fix 6: Suppress initial idle check when doing fitBounds from route search
  private suppressIdleCount: number = 0;

  private readonly MAX_VIEWPORT_DIAMETER = 10000;
  private readonly SEARCH_STEP_KM = 1.5;

  // Swipe-to-close gesture tracking
  private sheetTouchStartY: number = 0;
  private sheetTranslateY: number = 0;
  private isSheetSwiping: boolean = false;
  private sheetEl: HTMLElement | null = null;

  private readonly DARK_MAP_STYLES = [
    { elementType: 'geometry', stylers: [{ color: '#1d1d1d' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8e8e8e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1d1d' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c2c' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#3a3a3a' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c3c' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
    // Hide all irrelevant landmarks to make stores stand out
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }
  ];

  private readonly LIGHT_MAP_STYLES = [
    // Hide all irrelevant landmarks to make stores stand out
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }
  ];

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private sevenElevenService: SevenElevenRequestService,
    private familyMartService: FamilyMartRequestService
  ) {}

  ngOnInit(): void { this.initMap(); }

  ngOnDestroy(): void {
    this.clearMarkers();
    this.stopProgressTimer();
    if (this.mapIdleListener) google.maps.event.removeListener(this.mapIdleListener);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Sync the parent's external loading state with the internal progress bar
    if (changes['isParentSearching']) {
      if (this.isParentSearching) {
        this.searchProgress = 5;
        this.startProgressTimer();
      } else if (changes['isParentSearching'].previousValue) {
        // Parent finished searching
        this.stopProgressTimer();
        this.searchProgress = 100;
        setTimeout(() => { this.searchProgress = 0; this.cdr.detectChanges(); }, 600);
      }
    }

    if (changes['stores'] && this.stores) {
      if (this.stores.length === 0) {
        // Parent explicitly cleared stores (e.g. starting a completely new target search)
        // We must drop all our accumulative map stores from previous contexts too.
        this.allMapStores = [];
        this.searchedStoreKeys.clear();
        this.initialFitDone = false; // Reset fitBounds logic for the new context
        if (this.map) this.updateMarkers();
      } else if (this.stores.length > 0) {
        this.mergeInputStores();
        if (this.map) {
          this.updateMarkers();
          // Only auto-fit bounds ONCE per search context 
          if (!this.initialFitDone && this.allMapStores.length > 0) {
            this.initialFitDone = true;
            this.suppressIdleCount = 2;
            this.fitBoundsToMarkers();
          }
        }
      }
    }

    if (changes['isDarkMode'] && this.map) {
      this.map.setOptions({ styles: this.isDarkMode ? this.DARK_MAP_STYLES : this.LIGHT_MAP_STYLES });
    }

    if (changes['focusStoreFromList'] && this.focusStoreFromList && this.map) {
      const coords = this.getStoreCoords(this.focusStoreFromList);
      console.log('[MapView] FocusStore updated in OnChanges!', this.focusStoreFromList, 'Coords:', coords);
      if (coords) {
        if (this.focusStoreFromList.selectedCategory) {
          this.onMarkerClick(this.focusStoreFromList, coords);
        } else {
          this.map.panTo(coords);
          if (this.map.getZoom() < 16) {
            this.map.setZoom(16);
          }
        }
      } else {
        console.warn('[MapView] getStoreCoords returned null for', this.focusStoreFromList);
      }
    }
  }

  private mergeInputStores(): void {
    for (const store of this.stores) {
      const key = store.storeName;
      if (!this.searchedStoreKeys.has(key)) {
        this.searchedStoreKeys.add(key);
        this.allMapStores.push(store);
      }
    }
  }

  private initMap(): void {
    // Fix 1: Determine initial map center based on search context
    let centerLat = this.userLat;
    let centerLng = this.userLng;
    let initialZoom = 15;
    let hasFocusStoreCenter = false;

    if (this.focusStoreFromList) {
      const coords = this.getStoreCoords(this.focusStoreFromList);
      console.log('[initMap] FocusStore in initMap!', this.focusStoreFromList, 'Coords:', coords);
      if (coords) {
        centerLat = coords.lat;
        centerLng = coords.lng;
        initialZoom = 16;
        hasFocusStoreCenter = true;
      }
    }

    if (!hasFocusStoreCenter) {
      if (this.searchMode === 'store' && this.searchCenterLat && this.searchCenterLng) {
        centerLat = this.searchCenterLat;
        centerLng = this.searchCenterLng;
        initialZoom = 17; // Closer zoom for store search so user can see which store
      } else if (this.searchMode === 'route') {
        // Route: will be set by fitBoundsToMarkers, start at user
        centerLat = this.userLat;
        centerLng = this.userLng;
        initialZoom = 13;
        this.suppressIdleCount = 2; // Suppress initial idle
      }
    }

    this.map = new google.maps.Map(this.mapContainer.nativeElement, {
      center: { lat: centerLat, lng: centerLng },
      zoom: initialZoom,
      disableDefaultUI: true, zoomControl: false,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      gestureHandling: 'greedy',
      styles: this.isDarkMode ? this.DARK_MAP_STYLES : this.LIGHT_MAP_STYLES,
      clickableIcons: false
    });

    this.lastSearchCenter = { lat: centerLat, lng: centerLng };
    if (this.stores && this.stores.length > 0) this.mergeInputStores();

    // User marker
    this.userMarker = new google.maps.Marker({
      position: { lat: this.userLat, lng: this.userLng },
      map: this.map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE, scale: 8,
        fillColor: '#4285F4', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3
      },
      zIndex: 999, title: '我的位置'
    });

    new google.maps.Circle({
      strokeColor: '#4285F4', strokeOpacity: 0.3, strokeWeight: 1,
      fillColor: '#4285F4', fillOpacity: 0.08,
      map: this.map, center: { lat: this.userLat, lng: this.userLng }, radius: 120
    });

    this.map.addListener('click', () => {
      this.ngZone.run(() => { this.closeBottomSheet(); });
    });

    // Fix 2: Close sheet on drag — setTimeout(0) so map gesture proceeds immediately
    this.map.addListener('dragstart', () => {
      if (this.selectedStore) {
        setTimeout(() => { this.ngZone.run(() => { this.closeBottomSheet(); }); }, 0);
      }
    });

    this.mapIdleListener = this.map.addListener('idle', () => {
      this.ngZone.run(() => { this.onMapIdle(); });
    });

    this.updateMarkers();

    // For store mode, keep the tight zoom on the searched store — no fitBounds
    if (this.focusStoreFromList) {
      this.initialFitDone = true;
      const coords = this.getStoreCoords(this.focusStoreFromList);
      if (coords) {
         if (this.focusStoreFromList.selectedCategory) {
            setTimeout(() => {
               this.onMarkerClick(this.focusStoreFromList, coords);
            }, 100);
         }
      }
    } else if (this.searchMode === 'store' && this.allMapStores.length > 0) {
      this.initialFitDone = true; // Don't auto-zoom again
    } else if (this.allMapStores.length > 0) {
      this.initialFitDone = true;
      this.suppressIdleCount = 2;
      this.fitBoundsToMarkers();
    }
  }

  zoomIn(): void { if (this.map) this.map.setZoom(this.map.getZoom() + 1); }
  zoomOut(): void { if (this.map) this.map.setZoom(this.map.getZoom() - 1); }

  private onMapIdle(): void {
    if (this.suppressIdleCount > 0) {
      this.suppressIdleCount--;
      return;
    }

    if (this.isSearchingArea) return;

    // Fix 6: Skip idle check if suppressed (e.g. after fitBounds from route search)
    if (this.suppressIdleCount > 0) {
      this.suppressIdleCount--;
      return;
    }

    const center = this.map.getCenter();
    const newCenter = { lat: center.lat(), lng: center.lng() };
    if (!this.lastSearchCenter) { this.lastSearchCenter = newCenter; return; }

    const distFromLast = getDistance(
      { latitude: this.lastSearchCenter.lat, longitude: this.lastSearchCenter.lng },
      { latitude: newCenter.lat, longitude: newCenter.lng }
    );
    const diameter = this.getViewportDiameter();

    if (distFromLast > 500) {
      if (diameter <= this.MAX_VIEWPORT_DIAMETER) {
        this.showSearchAreaBtn = true;
        this.showAreaTooLargeMsg = false;
      } else {
        this.showSearchAreaBtn = false;
        this.showAreaTooLargeMsg = true;
        setTimeout(() => { this.showAreaTooLargeMsg = false; this.cdr.detectChanges(); }, 3000);
      }
    } else {
      this.showSearchAreaBtn = false;
      this.showAreaTooLargeMsg = false;
    }
    this.cdr.detectChanges();
  }

  private getViewportDiameter(): number {
    const bounds = this.map.getBounds();
    if (!bounds) return Infinity;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    return getDistance(
      { latitude: ne.lat(), longitude: ne.lng() },
      { latitude: sw.lat(), longitude: sw.lng() }
    );
  }

  // Fix 4: Start continuous progress timer
  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = setInterval(() => {
      // Slowly increment but never exceed 90% (actual completion sets 100%)
      if (this.searchProgress < 90) {
        this.searchProgress += Math.random() * 3 + 1; // +1~4% each tick
        if (this.searchProgress > 90) this.searchProgress = 90;
        this.cdr.detectChanges();
      }
    }, 400);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  searchThisArea(): void {
    if (this.isSearchingArea) return;
    if (this.getViewportDiameter() > this.MAX_VIEWPORT_DIAMETER) {
      this.showSearchAreaBtn = false;
      this.showAreaTooLargeMsg = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.showAreaTooLargeMsg = false; this.cdr.detectChanges(); }, 3000);
      return;
    }

    const bounds = this.map.getBounds();
    if (!bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const searchPoints = this.generateSearchGrid(sw.lat(), ne.lat(), sw.lng(), ne.lng());

    this.showSearchAreaBtn = false;
    this.isSearchingArea = true;
    this.searchProgress = 5;
    this.cdr.detectChanges();

    // Fix 4: Start continuous progress animation
    this.startProgressTimer();

    const center = this.map.getCenter();
    this.lastSearchCenter = { lat: center.lat(), lng: center.lng() };

    const sevenRequests = searchPoints.map(p => {
      const loc: LocationData = {
        CurrentLocation: { Latitude: p.lat, Longitude: p.lng },
        SearchLocation: { Latitude: p.lat, Longitude: p.lng }
      };
      return this.sevenElevenService.getNearByStoreList(loc).pipe(timeout(10000), catchError(() => of(null)));
    });
    const fmRequests = searchPoints.map(p => {
      return this.familyMartService.getNearByStoreList({ Latitude: p.lat, Longitude: p.lng }, [])
        .pipe(timeout(10000), catchError(() => of(null)));
    });

    forkJoin({
      sevenResults: forkJoin(sevenRequests.length > 0 ? sevenRequests : [of(null)]),
      fmResults: forkJoin(fmRequests.length > 0 ? fmRequests : [of(null)])
    }).subscribe({
      next: ({ sevenResults, fmResults }) => {
        this.stopProgressTimer();

        (sevenResults as any[]).forEach((res: any) => {
          if (!res?.element?.StoreStockItemList) return;
          res.element.StoreStockItemList.forEach((store: StoreStockItem) => {
            if (!store.RemainingQty || store.RemainingQty <= 0) return;
            const storeName = `7-11${store.StoreName}門市`;
            if (this.searchedStoreKeys.has(storeName)) return;
            this.searchedStoreKeys.add(storeName);
            const coords = this.storeNoToCoords.get(store.StoreNo);
            const dist = coords
              ? Math.round(getDistance({ latitude: this.userLat, longitude: this.userLng }, { latitude: coords.lat, longitude: coords.lng }))
              : 999999;
            this.allMapStores.push({
              ...store, storeName, label: '7-11', distance: dist,
              remainingQty: store.RemainingQty, showDistance: true,
              CategoryStockItems: store.CategoryStockItems
            });
          });
        });

        (fmResults as any[]).forEach((res: any) => {
          if (!res || res.code !== 1 || !res.data) return;
          res.data.forEach((store: StoreModel) => {
            if (this.searchedStoreKeys.has(store.name)) return;
            this.searchedStoreKeys.add(store.name);
            const dist = store.latitude && store.longitude
              ? getDistance({ latitude: this.userLat, longitude: this.userLng }, { latitude: store.latitude, longitude: store.longitude })
              : store.distance;
            this.allMapStores.push({
              ...store, storeName: store.name, label: '全家', distance: dist, showDistance: true
            });
          });
        });

        this.searchProgress = 100;
        this.cdr.detectChanges();
        this.parsedStoresChange.emit([...this.allMapStores]);
        this.updateMarkers();
        setTimeout(() => { this.isSearchingArea = false; this.searchProgress = 0; this.cdr.detectChanges(); }, 600);
      },
      error: () => {
        this.stopProgressTimer();
        this.isSearchingArea = false; this.searchProgress = 0; this.cdr.detectChanges();
      }
    });
  }

  private generateSearchGrid(latS: number, latN: number, lngW: number, lngE: number): { lat: number; lng: number }[] {
    const points: { lat: number; lng: number }[] = [];
    const stepLat = this.SEARCH_STEP_KM / 111;
    const midLat = (latS + latN) / 2;
    const stepLng = this.SEARCH_STEP_KM / (111 * Math.cos(midLat * Math.PI / 180));
    for (let lat = latS; lat <= latN + stepLat * 0.5; lat += stepLat) {
      for (let lng = lngW; lng <= lngE + stepLng * 0.5; lng += stepLng) {
        points.push({ lat, lng });
      }
    }
    const cLat = midLat, cLng = (lngW + lngE) / 2;
    if (!points.some(p => Math.abs(p.lat - cLat) < stepLat * 0.3 && Math.abs(p.lng - cLng) < stepLng * 0.3)) {
      points.unshift({ lat: cLat, lng: cLng });
    }
    return points;
  }

  recenterMap(): void {
    if (!this.map) return;
    
    const coords = { lat: this.userLat, lng: this.userLng };
    this.map.panTo(coords);
    
    // If the sheet is open, we need to apply the same vertical offset as marker click
    // to keep the user's location visible above the card.
    if (this.sheetOpen) {
      setTimeout(() => {
        if (!this.map) return;
        const containerH = this.mapContainer.nativeElement.offsetHeight;
        const offsetPx = containerH * 0.22;
        this.map.panBy(0, offsetPx);
      }, 50);
    }

    // Optionally set a standard zoom if very far out, but do it gracefully
    if (this.map.getZoom() < 12) {
      this.map.setZoom(15);
    }
  }

  private clearMarkers(): void { this.markers.forEach(m => m.setMap(null)); this.markers = []; }

  private updateMarkers(): void {
    this.clearMarkers();
    if (!this.allMapStores || this.allMapStores.length === 0) return;
    this.allMapStores.forEach(store => {
      const coords = this.getStoreCoords(store);
      if (!coords) return;
      const is711 = store.label === '7-11';
      const qty = this.getStoreTotalQty(store);
      if (qty <= 0) return;
      const marker = new google.maps.Marker({
        position: coords, map: this.map,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
          fillColor: is711 ? '#FF6B00' : '#00B386',
          fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.8,
          anchor: new google.maps.Point(12, 22), labelOrigin: new google.maps.Point(12, 9)
        },
        label: { text: String(qty), color: '#fff', fontSize: '10px', fontWeight: '700', fontFamily: 'Inter, sans-serif' },
        title: store.storeName, zIndex: 10
      });
      marker.addListener('click', () => { this.ngZone.run(() => { this.onMarkerClick(store, coords); }); });
      this.markers.push(marker);
    });
  }

  private fitBoundsToMarkers(): void {
    if (this.markers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: this.userLat, lng: this.userLng });
    this.markers.forEach(m => bounds.extend(m.getPosition()));
    this.map.fitBounds(bounds, { top: 60, bottom: 200, left: 40, right: 40 });
    const listener = google.maps.event.addListener(this.map, 'idle', () => {
      if (this.map.getZoom() > 17) this.map.setZoom(17);
      google.maps.event.removeListener(listener);
    });
  }

  getClosestStoreToCenter(): any {
    if (!this.map || (!this.allMapStores || this.allMapStores.length === 0)) return null;
    const center = this.map.getCenter();
    if (!center) return null;
    
    // getDistance takes {latitude, longitude} obj
    const centerCoords = { latitude: center.lat(), longitude: center.lng() };

    let closestStore = null;
    let minDistance = Infinity;

    for (const store of this.allMapStores) {
      const coords = this.getStoreCoords(store);
      if (!coords) continue;
      
      const d = getDistance(centerCoords, { latitude: coords.lat, longitude: coords.lng });
      if (d < minDistance) {
        minDistance = d;
        closestStore = store;
      }
    }
    return closestStore;
  }

  private onMarkerClick(store: any, coords: { lat: number; lng: number }): void {
    // Clear any stale inline styles from previous swipe-close
    const sheetDiv = this.mapContainer?.nativeElement?.parentElement?.querySelector('.bottom-sheet') as HTMLElement;
    if (sheetDiv) {
      sheetDiv.style.transform = '';
      sheetDiv.style.transition = '';
    }

    this.selectedStore = store;
    this.selectedStoreCategory = null;
    this.sheetDetailMinHeight = 0; // Reset for new store
    this.sheetOpen = true;
    this.sheetStateChange.emit(true);
    this.storeSelected.emit(this.selectedStore);
    document.body.classList.add('map-sheet-open');

    // Pan so the marker is centered in the VISIBLE portion above the bottom sheet
    this.map.panTo(coords);
    setTimeout(() => {
      const containerH = this.mapContainer.nativeElement.offsetHeight;
      const offsetPx = containerH * 0.22;
      this.map.panBy(0, offsetPx);
    }, 50);

    this.cdr.detectChanges();

    // Attach swipe-to-close listeners after sheet renders
    setTimeout(() => this.attachSheetSwipeListeners(), 100);
  }

  closeBottomSheet(): void {
    if (!this.selectedStore && !this.sheetOpen) return;
    this.detachSheetSwipeListeners();
    // Clear any inline styles left by swipe gesture so next open works properly
    const sheetDiv = this.mapContainer?.nativeElement?.parentElement?.querySelector('.bottom-sheet') as HTMLElement;
    if (sheetDiv) {
      sheetDiv.style.transform = '';
      sheetDiv.style.transition = '';
    }
    this.selectedStore = null;
    this.selectedStoreCategory = null;
    this.sheetDetailMinHeight = 0;
    this.sheetOpen = false;
    this.sheetStateChange.emit(false);
    document.body.classList.remove('map-sheet-open', 'map-sheet-expanded');
    this.cdr.detectChanges();
  }

  // ===== Swipe-to-close gesture =====
  private attachSheetSwipeListeners(): void {
    this.sheetEl = document.querySelector('.bottom-sheet.open') as HTMLElement;
    if (!this.sheetEl) return;
    this.sheetEl.addEventListener('touchstart', this.onSheetTouchStart, { passive: true });
    this.sheetEl.addEventListener('touchmove', this.onSheetTouchMove, { passive: false });
    this.sheetEl.addEventListener('touchend', this.onSheetTouchEnd, { passive: true });
  }
  private detachSheetSwipeListeners(): void {
    if (!this.sheetEl) return;
    this.sheetEl.removeEventListener('touchstart', this.onSheetTouchStart);
    this.sheetEl.removeEventListener('touchmove', this.onSheetTouchMove);
    this.sheetEl.removeEventListener('touchend', this.onSheetTouchEnd);
    this.sheetEl = null;
  }

  private onSheetTouchStart = (e: TouchEvent): void => {
    this.sheetTouchStartY = e.touches[0].clientY;
    this.sheetTranslateY = 0;
    this.isSheetSwiping = false;
  }

  private onSheetTouchMove = (e: TouchEvent): void => {
    if (!this.sheetEl) return;
    const deltaY = e.touches[0].clientY - this.sheetTouchStartY;

    // Only swipe down when sheet is scrolled to top
    if (deltaY > 0 && this.sheetEl.scrollTop <= 0) {
      e.preventDefault(); // Prevent page scroll
      this.isSheetSwiping = true;
      // Apply dampened translateY for rubber-band feel
      this.sheetTranslateY = deltaY * 0.6;
      this.sheetEl.style.transform = `translateY(${this.sheetTranslateY}px)`;
      this.sheetEl.style.transition = 'none';
    }
  }

  private onSheetTouchEnd = (): void => {
    if (!this.isSheetSwiping || !this.sheetEl) return;

    if (this.sheetTranslateY > 80) {
      // Swipe far enough — animate close
      this.sheetEl.style.transform = 'translateY(100%)';
      this.sheetEl.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
      setTimeout(() => {
        this.ngZone.run(() => this.closeBottomSheet());
      }, 300);
    } else {
      // Snap back
      this.sheetEl.style.transform = '';
      this.sheetEl.style.transition = '';
    }
    this.isSheetSwiping = false;
    this.sheetTranslateY = 0;
  }

  setCategoryLoading(store: any, category: any, isLoading: boolean): void {
    const catId = category.ID || category.name || category.Name;
    if (isLoading) {
      store.loadingCategoryName = catId;
      store.loadingCompleteCategoryName = null;
    } else {
      if (store.loadingCategoryName === catId) {
        store.loadingCategoryName = null;
        store.loadingCompleteCategoryName = catId;

        // NEW: Once loading is finished, update the stable min-height to the new content's height
        setTimeout(() => {
          if (this.detailInner && this.detailInner.nativeElement) {
            this.sheetDetailMinHeight = this.detailInner.nativeElement.scrollHeight;
          }
          if (store.loadingCompleteCategoryName === catId) {
            store.loadingCompleteCategoryName = null;
          }
          this.cdr.detectChanges();
        }, 200);
      }
    }
    this.cdr.detectChanges();
  }

  isCategoryLoading(store: any, category: any): boolean {
    const catId = category.ID || category.name || category.Name;
    return store.loadingCategoryName === catId;
  }

  isCategoryLoadingComplete(store: any, category: any): boolean {
    const catId = category.ID || category.name || category.Name;
    return store.loadingCompleteCategoryName === catId;
  }

  toggleCategory(category: any): void {
    if (!this.selectedStore) return;

    // Fix: Before switching content, lock the current height as min-height to prevent shrinking
    if (this.detailInner && this.detailInner.nativeElement) {
      this.sheetDetailMinHeight = this.detailInner.nativeElement.scrollHeight;
    }

    if (this.selectedStore.selectedCategory === category) {
      this.selectedStore.selectedCategory = null;
      this.selectedStoreCategory = null;
      this.sheetDetailMinHeight = 0; // Reset when closing
      document.body.classList.remove('map-sheet-expanded');
    } else {
      this.selectedStore.selectedCategory = category;
      this.selectedStoreCategory = category;
      document.body.classList.add('map-sheet-expanded');
    }
    this.cdr.detectChanges();
  }

  // Fix 5: Called from template to capture max height of detail section
  onDetailRendered(el: HTMLElement): void {
    if (el && el.scrollHeight > this.sheetDetailMinHeight) {
      this.sheetDetailMinHeight = el.scrollHeight;
    }
  }

  openNavigation(store: any): void {
    const is711 = store.label === '7-11';
    const query = is711
      ? `7-ELEVEN${store.StoreName}門市`
      : `全家便利商店${this.fStoreName(store.storeName)}`;
    window.open(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, '_blank');
  }

  getStoreDistance(store: any): string {
    const coords = this.getStoreCoords(store);
    if (!coords) {
      const d = store.distance;
      if (!d) return '';
      return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    }
    const d = getDistance(
      { latitude: this.userLat, longitude: this.userLng },
      { latitude: coords.lat, longitude: coords.lng }
    );
    return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
  }

  private getStoreCoords(store: any): { lat: number; lng: number } | null {
    if (store.label === '7-11') {
      if (store.StoreNo && this.storeNoToCoords.has(store.StoreNo)) {
        const c = this.storeNoToCoords.get(store.StoreNo)!;
        return { lat: c.lat, lng: c.lng };
      }
      const lat = store.Latitude || store.latitude;
      const lng = store.Longitude || store.longitude;
      if (lat && lng) return { lat: Number(lat), lng: Number(lng) };
      return null;
    } else if (store.label === '全家') {
      const lat = store.latitude || store.py_wgs84;
      const lng = store.longitude || store.px_wgs84;
      if (lat && lng) return { lat: Number(lat), lng: Number(lng) };
      return null;
    }
    return null;
  }

  getStoreTotalQty(store: any): number {
    if (store.label === '7-11') return store.RemainingQty || store.remainingQty || 0;
    if (store.label === '全家' && store.info && Array.isArray(store.info)) {
      return store.info.reduce((sum: number, cat: any) => sum + (cat.qty || 0), 0);
    }
    return 0;
  }

  getStoreCategories(store: any): any[] {
    if (store.label === '7-11' && store.CategoryStockItems) {
      return this.foodCategories.filter(cat => this.getSubCategoryTotalQty(store, cat) > 0).slice(0, 8);
    } else if (store.label === '全家' && store.info) {
      return store.info.filter((cat: any) => cat.qty > 0).slice(0, 8);
    }
    return [];
  }

  getCategoryIcon(store: any, cat: any): string {
    return store.label === '7-11' ? (cat.ImageUrl || '') : (cat.iconURL || '');
  }
  getCategoryName(store: any, cat: any): string {
    return store.label === '7-11' ? (cat.Name || '') : (cat.name || '');
  }
  getCategoryQty(store: any, cat: any): number {
    return store.label === '7-11' ? this.getSubCategoryTotalQty(store, cat) : (cat.qty || 0);
  }

  private getSubCategoryTotalQty(store: any, category: any): number {
    let totalQty = 0;
    if (store.CategoryStockItems) {
      for (const stockItem of store.CategoryStockItems) {
        for (const child of category.Children) {
          if (stockItem.NodeID === child.ID) totalQty += stockItem.RemainingQty;
        }
      }
    }
    return totalQty;
  }

  fStoreName(storeName: string): string {
    return storeName ? storeName.replace('全家', '') : '';
  }
}
