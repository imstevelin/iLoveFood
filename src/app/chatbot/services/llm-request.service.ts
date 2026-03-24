import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LlmRequestService {

  // MiniMax Configuration
  // private url = 'https://api.minimax.io/v1/text/chatcompletion_v2';
  // private model = 'MiniMax-M2.5';
  // private apiKey = 'sk-cp-JYzj0Mc_qZFXvJwKpi0vK9oH0Gv1LTrYI7dvXS_iE8V2S59Ks53Hz2A_ENzkUvC2l5_4l3qCxSaXlUtRx0MTsaS67viraZlMeTnsrxgaVXTrBqA1dehE7XA';

  // Google Gemini Configuration
  private url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  private model = 'gemini-2.5-flash';
  private apiKey = 'AIzaSyB01eazvCD50URygZjKWzOi8PmMcx4UjdU';

  constructor(
    private http: HttpClient
  ) { }

  private tools = [
    {
      type: 'function',
      function: {
        name: 'search_stores_by_keyword',
        description: '根據關鍵字（如「大里金瑞」、「逢甲」、「信義」）搜尋所有匹配的便利商店清單並獲得門市的 store_id 和座標。使用於使用者提及特定門市或概略地點時。此工具回傳門市列表，但不含庫存資訊。',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '店名、路名、或區域關鍵字' }
          },
          required: ['keyword']
        }
      }
    },
    {
      type: 'function',
      function: {
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
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_nearby_stores_inventory',
        description: '取得使用者當下GPS定位位置附近的便利商店及打折商品庫存。當使用者問「這附近」、「周遭」或單純說肚子餓想找吃的，未提供區域或店名時直接使用此工具。',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    }
  ];

  /**
   * 包含 Tools 的通用聊天端點
   */
  chatWithTools(conversationHistory: any[]): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `<role_definition>
你是「友善小精靈」，一個聰明且友善的便利商店食品搜尋助手。你的職責是協助使用者查詢 7-11 的「i 珍食」與全家的「友善食光」折扣商品。
</role_definition>

<workflow_guidelines>
在採取行動前，你必須在心中進行思考（不需要輸出 <thinking> 標籤，但要遵循以下邏輯）：
1. 分析意圖：使用者是在找特定店家、某個地區、還是目前的周邊？
2. 原子化分解：
   - 找特定店/區：先呼叫 \`search_stores_by_keyword\`。獲得門市列表後，從中提取 \`brand\`, \`store_id\`, \`lat\`, \`lng\`。
   - 查庫存：拿到上述資料後，再呼叫 \`query_store_inventory\`。
   - 找附近：直接呼叫 \`get_nearby_stores_inventory\`。
3. 容錯處理：若工具回傳空結果，請友善地建議使用者更換關鍵字或檢查拼寫。

範例對話：
使用者：「權美門市還有什麼吃的？」
你的執行邏輯：
Step 1: 呼叫 search_stores_by_keyword(keyword='權美')
Step 2: 假設獲取 StoreID: 15555x1, Brand: 7-11
Step 3: 呼叫 query_store_inventory(brand='7-11', store_id='15555x1', ...)
Step 4: 整合庫存結果回答使用者。
</workflow_guidelines>

<business_rules>
1. 誠實準確：只能使用工具回傳的真實資訊。嚴禁編造庫存。
2. 術語規範：7-11 -> 「i 珍食」；全家 -> 「友善食光」。
3. 繁體中文：100% 強制使用繁體中文 (zh-TW)，絕對禁止簡體字。
4. 長度控制：回覆內容（不含按鈕）控制在 600 字內，簡明扼要。
5. 商店標記：每間門市介紹必須以 🏪 開頭。
</business_rules>

<response_format>
1. 導航連結：僅在推薦店家或應要求導航時使用 [店名](https://www.google.com/maps/search/店名) 格式。
2. 建議回應按鈕 (PRESETS)：
   - 必須位於回覆的最末端，且前面必須加上分隔符「---PRESETS---」。
   - 請使用「純文字」，**絕對不可**使用 Markdown 連結語法，也不要加上方括號。
   - 格式範例：
     ---PRESETS---
     1. [建議回應 1]
     2. [建議回應 2]
     3. [建議回應 3]
</response_format>`
        },
        ...conversationHistory
      ],
      tools: this.tools,
      tool_choice: 'auto',
      max_tokens: 1500,
    };

    return this.http.post(this.url, body, { headers });
  }
}
