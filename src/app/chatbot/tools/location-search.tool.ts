import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { BaseTool, ToolDefinition } from './base.tool';
import { ChatbotSearchService } from '../services/chatbot-search.service';

@Injectable({
  providedIn: 'root'
})
export class LocationSearchTool extends BaseTool {
  private lastLandmark = '';

  constructor(private searchService: ChatbotSearchService) {
    super();
  }

  get definition(): ToolDefinition {
    return {
      name: 'search_stores_near_landmark',
      description: '當使用者詢問「特定地點/地標名稱」附近有哪些店有特定食物時（例如：「台北車站附近有...」、「101附近有...」、「信義區」），使用此工具。它會透過 Google Maps 將地標轉換為經緯度，並尋找該地標周遭的門市庫存。',
      parameters: {
        type: 'object',
        properties: {
          landmark: { type: 'string', description: '地標名稱或地址（例如：台北車站、大安森林公園、信義區）' }
        },
        required: ['landmark']
      }
    };
  }

  get loadingMessage(): string {
    return this.lastLandmark ? `正在掃描「${this.lastLandmark}」周邊的門市庫存...` : '正在掃描指定地點周邊的門市...';
  }

  execute(args: any): Observable<any> {
    this.lastLandmark = args.landmark || '';
    return this.searchService.geocodeLocation(args.landmark).pipe(
      switchMap(coords => {
         if (!coords) {
           return of([{ message: `找不到「${args.landmark}」的座標，請嘗試更精確的地址或地標名稱。` }]);
         }
         // 增加搜尋範圍，帶回較多的周遭店面，讓 LLM 有更多過濾空間
         return this.searchService.searchNearby(coords.lat, coords.lng, 10);
      })
    );
  }
}
