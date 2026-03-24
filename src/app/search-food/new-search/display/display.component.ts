import { Component, Input, OnChanges, SimpleChanges, OnInit, ElementRef, ViewChild, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { Item, CategoryStockItem, FoodDetail711  } from '../../model/seven-eleven.model';
import { ProductModel, FoodDetailFamilyMart } from '../../model/family-mart.model'

import { ImageDialogComponent } from '../image-dialog/image-dialog.component';

import { SevenElevenRequestService } from '../services/seven-eleven-request.service';

import Fuse from 'fuse.js';
import { HapticService } from 'src/app/services/haptic.service';

@Component({
  selector: 'app-display',
  templateUrl: './display.component.html',
  styleUrls: ['./display.component.scss']
})
export class DisplayComponent implements OnChanges, OnInit {
  @Input() store!: any;
  @Input() category!: any;
  @Input() foodDetails!: any[];

  @Output() loadingChange = new EventEmitter<boolean>();

  subCategories: any[] = [];
  subCategoriesName: string = '';
  itemsBySubCategory: { [key: string]: Item[] } = {};
  isLoading: boolean = false;

  // === 效能優化：快取 Fuse 實例與食物詳情查詢結果 ===
  private fuse711: Fuse<any> | null = null;
  private fuseFamilyMart: Fuse<any> | null = null;
  private exactDict711: Map<string, any> = new Map();
  private exactDictFamilyMart: Map<string, any> = new Map();

  foodDetailCache: { [itemName: string]: any } = {};  // 模板直接讀取此快取

  constructor(
    private sevenElevenRequestService: SevenElevenRequestService,
    private dialog: MatDialog,
    private haptic: HapticService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {}

  ngOnChanges(changes: SimpleChanges): void {
    // foodDetails 變化時，重建 Fuse 實例（僅建立一次）
    if (changes['foodDetails'] && this.foodDetails && this.foodDetails.length > 0) {
      this.buildFuseInstances();
    }
    if (changes['category'] || changes['store']) {
      this.foodDetailCache = {};  // 清空快取，因為門市/分類變了
      this.loadSubCategories();
    }
  }

  // 建立 Fuse 實例（只在 foodDetails 變化時呼叫一次）
  private buildFuseInstances(): void {
    if (!this.foodDetails || this.foodDetails.length === 0) return;

    this.exactDict711.clear();
    this.exactDictFamilyMart.clear();

    // 判斷是 7-11 還是全家的 foodDetails（7-11 用 'name'，全家用 'title'）
    const sample = this.foodDetails[0];
    if (sample.name !== undefined) {
      this.foodDetails.forEach(f => {
        if (f.name) this.exactDict711.set(f.name, f);
      });
      this.fuse711 = new Fuse(this.foodDetails, {
        includeScore: true,
        threshold: 0.3,
        keys: ['name']
      });
    }
    if (sample.title !== undefined) {
      this.foodDetails.forEach(f => {
        if (f.title) this.exactDictFamilyMart.set(f.title, f);
      });
      this.fuseFamilyMart = new Fuse(this.foodDetails, {
        includeScore: true,
        threshold: 0.3,
        keys: ['title']
      });
    }
  }

  // 批次預算所有商品的食物詳情，存入 foodDetailCache
  private precomputeFoodDetails(): void {
    if (!this.foodDetails || this.foodDetails.length === 0) return;

    const is711 = this.store.StoreName != null;
    const tasks: Item[] = [];

    // 扁平化需要查詢的工作
    for (const subCatName of Object.keys(this.itemsBySubCategory)) {
      const items = this.itemsBySubCategory[subCatName];
      if (!items) continue;
      for (const item of items) {
        if (!this.foodDetailCache[item.ItemName]) {
          tasks.push(item);
        }
      }
    }

    if (tasks.length === 0) return;

    // 非同步分批處理以避免手機端卡頓
    const processBatch = (startIndex: number) => {
      const batchSize = 15; // 每次只處理 15 個商品（確保 Frame < 16ms）
      const endIndex = Math.min(startIndex + batchSize, tasks.length);

      for (let i = startIndex; i < endIndex; i++) {
        const item = tasks[i];
        if (is711) {
          this.foodDetailCache[item.ItemName] = this._lookupFoodDetail711(item);
        } else {
          this.foodDetailCache[item.ItemName] = this._lookupFoodDetailFamilyMart(item);
        }
      }

      this.cdr.detectChanges(); // 手動更新 UI 解析結果

      if (endIndex < tasks.length) {
        setTimeout(() => processBatch(endIndex), 0);
      }
    };

    processBatch(0);
  }

  loadSubCategories() {
    if (this.store && this.category) {
      if (this.store.StoreName) {
        this.subCategories = this.category.Children;
        this.subCategoriesName = this.category.Name;
        this.loadItemsBySubCategory();
      }
      else if (this.store.name) {
        this.subCategories = this.category.categories;
        var items: Item[] = [];
        this.subCategories.forEach((cat) => {
          items.push(
            ...cat.products.map((product: ProductModel) => ({
              ItemName: product.name,
              RemainingQty: product.qty,
            }))
          );
          this.itemsBySubCategory[cat.name] = items || [];
          items = [];
        });
        // 全家：資料已就緒，立即預算食物詳情
        this.precomputeFoodDetails();
        this.isLoading = false;
        this.cdr.detectChanges(); // 強制更新畫面
        setTimeout(() => this.loadingChange.emit(false));
      }
    }
  }

  loadItemsBySubCategory() {
    if (this.store) {
      this.isLoading = true;
      setTimeout(() => this.loadingChange.emit(true));
      this.sevenElevenRequestService.getItemsByStoreNo(this.store.StoreNo).subscribe(response => {
        if (response.isSuccess && response.element.StoreStockItem) {
          let categoryStockItems: CategoryStockItem[] = response.element.StoreStockItem.CategoryStockItems;

          if (this.subCategoriesName == "甜點") {
            let sweetCakeId = "";
            this.subCategories = this.subCategories.map((subCategory) => {
              if (subCategory.Name === "蛋糕") {
                sweetCakeId = subCategory.ID;
                return { ...subCategory, Name: "冷藏蛋糕" };
              }
              return subCategory;
            });
            categoryStockItems = categoryStockItems.map((categoryStockItem) => {
              if (categoryStockItem.Name === "蛋糕" && categoryStockItem.NodeID.toString() == sweetCakeId) {
                return { ...categoryStockItem, Name: "冷藏蛋糕" };
              }
              return categoryStockItem;
            })
          }
          if (this.subCategoriesName == "麵包蛋糕") {
            let sweetCakeId = "";
            this.subCategories = this.subCategories.map((subCategory) => {
              if (subCategory.Name === "蛋糕") {
                sweetCakeId = subCategory.ID;
                return { ...subCategory, Name: "麵包蛋糕" };
              }
              return subCategory;
            });
            categoryStockItems = categoryStockItems.map((categoryStockItem) => {
              if (categoryStockItem.Name === "蛋糕" && categoryStockItem.NodeID.toString() == sweetCakeId) {
                return { ...categoryStockItem, Name: "麵包蛋糕" };
              }
              return categoryStockItem;
            })
          }

          this.subCategories.forEach(subCategory => {
            const items: Item[] = [];
            categoryStockItems.forEach(category => {
              if (category.Name === subCategory.Name) {
                items.push(...category.ItemList);
              }
            });
            this.itemsBySubCategory[subCategory.Name] = items || [];
          });

          // 7-11：API 回傳後觸發非同步預算食物詳情
          this.precomputeFoodDetails();
        }
        this.isLoading = false;
        this.cdr.detectChanges(); // 強制更新畫面
        setTimeout(() => this.loadingChange.emit(false));
      }, error => {
        console.error('Error loading items:', error);
        this.isLoading = false;
        this.cdr.detectChanges(); // 強制更新畫面
        setTimeout(() => this.loadingChange.emit(false));
      });
    }
  }

  getDiscountedPrice(originalPrice: string): string {
    const price = parseFloat(originalPrice.replace('NT$', '').trim());
    const currentTime = new Date();
    const currentHour = currentTime.getHours();

    let discountedPrice = price;

    if (currentHour >= 19 && currentHour < 20) {
      discountedPrice *= 0.8;
    } else if ((currentHour >= 10 && currentHour < 18) || (currentHour >= 20 || currentHour < 3)) {
      discountedPrice *= 0.65;
    }
    else {
      discountedPrice *= 0.8;
    }
    return discountedPrice.toString();
  }

  // 內部查詢方法（僅在 precomputeFoodDetails 中呼叫，不再從模板呼叫）
  private _lookupFoodDetail711(item: Item): any {
    if (!this.fuse711) {
      // Fuse 尚未建立時 fallback：直接建立（應該很少發生）
      this.buildFuseInstances();
    }

    let foodDetail: any = null;

    // 1. O(1) 字典精確匹配 (效能最快)
    if (this.exactDict711.has(item.ItemName)) {
      foodDetail = { ...this.exactDict711.get(item.ItemName) };
    } 
    // 2. O(N) 模糊搜尋 (作為備案)
    else {
      const result = this.fuse711 ? this.fuse711.search(item.ItemName) : [];
      if (result.length > 0) {
        foodDetail = { ...result[0].item };
      }
    }

    if (!foodDetail) {
      foodDetail = {
        category: '',
        content: '',
        image: 'assets/no-image.jpeg',
        kcal: '',
        name: '',
        new: 'False',
        price: 'NT$ 0',
        special_sale: 'False'
      };
    }

    const discountedPrice = this.getDiscountedPrice(foodDetail.price);
    foodDetail['discountedPrice'] = discountedPrice;
    foodDetail['originalPrice'] = foodDetail.price;

    return foodDetail;
  }

  private _lookupFoodDetailFamilyMart(item: Item): any {
    if (!this.fuseFamilyMart) {
      this.buildFuseInstances();
    }

    let foodDetail: any = null;

    if (this.exactDictFamilyMart.has(item.ItemName)) {
      foodDetail = { ...this.exactDictFamilyMart.get(item.ItemName) };
    } else {
      const result = this.fuseFamilyMart ? this.fuseFamilyMart.search(item.ItemName) : [];
      if (result.length > 0) {
        foodDetail = { ...result[0].item };
      }
    }

    if (!foodDetail) {
      foodDetail = {
        "category": "",
        "title": "",
        "picture_url": "assets/no-image.jpeg",
        "Protein (g)": '',
        "Carb (g)": '',
        "Calories (kcal)": '',
        "Fat (g)": '',
        "Description": ""
      };
    }
    return foodDetail;
  }

  // 保留公開方法供向後相容（但模板不再使用）
  getFoodDetail711(item: Item): any {
    return this.foodDetailCache[item.ItemName] || this._lookupFoodDetail711(item);
  }

  getFoodDetailFamilyMart(item: Item): any {
    return this.foodDetailCache[item.ItemName] || this._lookupFoodDetailFamilyMart(item);
  }

  openImageDialog(imageUrl: string): void {
    this.haptic.light();
    this.dialog.open(ImageDialogComponent, {
      data: { image: imageUrl },
      panelClass: 'white-image-dialog',
      width: '90vw', /* 強制要求視窗展開至 90% 寬度，避免因圖片本身解析度小而自動縮在中間 */
      maxWidth: '500px', /* 在電腦版上則限制最大 500px 避免過度放大 */
      maxHeight: '85vh'
    });
  }
}
