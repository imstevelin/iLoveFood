import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseTool, ToolDefinition } from './base.tool';
import { ChatbotSearchService } from '../services/chatbot-search.service';

@Injectable({
  providedIn: 'root'
})
export class StoreSearchTool extends BaseTool {
  private lastKeyword = '';

  constructor(private searchService: ChatbotSearchService) {
    super();
  }

  get definition(): ToolDefinition {
    return {
      name: 'search_stores_by_keyword',
      description: '根據關鍵字（如「大里金瑞」、「逢甲」、「信義」）搜尋所有匹配的便利商店清單並獲得門市的 store_id 和座標。使用於使用者提及特定門市或概略地點時。此工具回傳門市列表，但不含庫存資訊。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '店名、路名、或區域關鍵字' }
        },
        required: ['keyword']
      }
    };
  }

  get loadingMessage(): string {
    return this.lastKeyword ? `正在搜尋「${this.lastKeyword}」相關門市...` : '正在搜尋門市...';
  }

  execute(args: any): Observable<any> {
    this.lastKeyword = args.keyword || '';
    return this.searchService.findStoresByKeyword(this.lastKeyword);
  }
}
