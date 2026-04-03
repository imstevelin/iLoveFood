import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseTool, ToolDefinition } from './base.tool';
import { ChatbotSearchService } from '../services/chatbot-search.service';

@Injectable({
  providedIn: 'root'
})
export class InventoryQueryTool extends BaseTool {
  private lastBrand = '';

  constructor(private searchService: ChatbotSearchService) {
    super();
  }

  get definition(): ToolDefinition {
    return {
      name: 'query_store_inventory',
      description: '呼叫此工具來獲取「指定門市」的詳細打折商品庫存資訊。必須傳入前面步驟獲得的 brand、store_id、以及經緯度。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', enum: ['7-11', 'FamilyMart'], description: '便利商店品牌名稱' },
          store_id: { type: 'string', description: '門市的唯一代碼 (StoreNo 或 pkeynew)' },
          lat: { type: 'number', description: '該門市的緯度' },
          lng: { type: 'number', description: '該門市的經度' }
        },
        required: ['brand', 'store_id', 'lat', 'lng']
      }
    };
  }

  get loadingMessage(): string {
    return this.lastBrand ? `正在查詢 ${this.lastBrand} 門市庫存...` : '正在查詢門市庫存...';
  }

  execute(args: any): Observable<any> {
    this.lastBrand = args.brand || '';
    return this.searchService.queryStoreInventory(args.brand, args.store_id, args.lat, args.lng);
  }
}
