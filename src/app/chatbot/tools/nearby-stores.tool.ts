import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseTool, ToolDefinition } from './base.tool';
import { ChatbotSearchService } from '../services/chatbot-search.service';

@Injectable({
  providedIn: 'root'
})
export class NearbyStoresTool extends BaseTool {
  constructor(private searchService: ChatbotSearchService) {
    super();
  }

  get definition(): ToolDefinition {
    return {
      name: 'get_nearby_stores_inventory',
      description: '取得使用者當下GPS定位位置附近的便利商店及打折商品庫存。當使用者問「這附近」、「周遭」或單純說肚子餓想找吃的，未提供區域或店名時直接使用此工具。',
      parameters: {
        type: 'object',
        properties: {}
      }
    };
  }

  get loadingMessage(): string {
    return '正在掃描您周邊的所有門市...';
  }

  execute(_args: any): Observable<any> {
    return this.searchService.searchNearby();
  }
}
