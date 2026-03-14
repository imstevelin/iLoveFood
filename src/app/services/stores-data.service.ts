import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root' // 全局單例服務
})
export class StoreDataService {
  private storesSubject = new BehaviorSubject<any[]>([]); // 用 BehaviorSubject 儲存商店列表
  public stores$: Observable<any[]> = this.storesSubject.asObservable(); // 提供訂閱的 Observable

  private isLocationSearchSubject = new BehaviorSubject<boolean>(true); // 用於標記是否為位置搜尋
  public isLocationSearch$: Observable<boolean> = this.isLocationSearchSubject.asObservable(); // 提供訂閱的 Observable

  // 全部門市（用於聊天機器人地區搜尋）
  private all711Stores: any[] = [];
  private allFmStores: any[] = [];

  // 更新商店列表
  setStores(stores: any[]) {
    this.storesSubject.next(stores);
  }

  // 獲取當前商店列表（同步方式）
  getStores(): any[] {
    return this.storesSubject.getValue();
  }

  // 更新位置搜尋狀態
  setIsUserLocationSearch(isLocationSearch: boolean) {
    this.isLocationSearchSubject.next(isLocationSearch);
  }

  // 獲取當前位置搜尋狀態（同步方式）
  getIsUserLocationSearch(): boolean {
    return this.isLocationSearchSubject.getValue();
  }

  // 全部門市列表
  setAll711Stores(stores: any[]) { this.all711Stores = stores; }
  getAll711Stores(): any[] { return this.all711Stores; }
  setAllFmStores(stores: any[]) { this.allFmStores = stores; }
  getAllFmStores(): any[] { return this.allFmStores; }
}