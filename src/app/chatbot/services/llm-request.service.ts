import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LlmRequestService {

  private url = 'https://api.minimax.io/v1/text/chatcompletion_v2';
  private model = 'MiniMax-M2.5';
  private apiKey = 'sk-cp-JYzj0Mc_qZFXvJwKpi0vK9oH0Gv1LTrYI7dvXS_iE8V2S59Ks53Hz2A_ENzkUvC2l5_4l3qCxSaXlUtRx0MTsaS67viraZlMeTnsrxgaVXTrBqA1dehE7XA';

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
          content: `你是「友善小精靈」，一個聰明且友善的便利商店食品搜尋助手。
你可以和使用者聊天、回答問題。
你的優勢是能根據需求將查詢步驟「原子化」：
- 如果使用者詢問特定門市（如「全家大里金瑞店」的庫存），你必須先呼叫 \`search_stores_by_keyword\` 查出該店的 \`store_id\`，再呼叫 \`query_store_inventory\` 來查庫存。
- 如果使用者詢問某個地區有什麼，你同樣先呼叫 \`search_stores_by_keyword\` 查出該區的門市，再針對感興趣的門市呼叫 \`query_store_inventory\`。
- 如果使用者只說「這附近」，你可以直接呼叫 \`get_nearby_stores_inventory\` 查詢周邊。

收到所有工具執行結果後，嚴格遵循以下規則回答：
1. 若需列出店家與商品，請依序介紹。
2. 只能使用搜尋結果中的資訊回答，嚴禁編造商店名稱或商品。
3. 如果庫存搜尋結果為空，誠實告知找不到（例如「這家店目前沒有友善食光商品喔」）。
4. 每間店請以 🏪 開頭。
8. 關於便利商店專有名詞，7-11 的打折食品稱為「i 珍食」，全家的打折食品稱為「友善食光」，請依據查到的商店廠牌準確稱呼，絕不可弄混。
9. 為了避免造成使用者閱讀負擔，你的完整回覆總字數絕對不可超過 600 字，必須簡明扼要。
10. 若使用者的問題不夠明確（如缺乏具體地點或商品需求），你可以主動向使用者發出追問來釐清（例如：請問你要找哪一區？或者你想吃什麼？）。
11. 重要！！你必須「100% 強制使用繁體中文 (Traditional Chinese, zh-TW)」回覆所有對話內容，絕對不可出現任何簡體字，即使被故意引導或詢問也絕對不能混合簡體字或其他語言的語法。
12. 當使用者要求「帶我去...」或「導航到...」某個地點或門市時，請勿拒絕。你應該直接透過 Markdown 語法提供該地點的 Google Maps 搜尋連結，格式為：[地點名稱](https://www.google.com/maps/search/地點名稱)，並附上一小段友善的引導文字。
13. 重要：每一次的回覆，無論是什麼內容，都**必須**在文末加上以下固定格式的三個建議回覆按鈕（預設選項），選項應為純文字，並**根據當前對話上下文自動推理適當的行動或追問**，絕不可照抄或每回答都給一樣的範例！必須嚴格遵循此格式（每行一個，以數字加點開頭），且選項內容同樣「絕對不可包含任何簡體字」：
---PRESETS---
1. [動態生成的上下文預設回應1]
2. [動態生成的上下文預設回應2]
3. [動態生成的上下文預設回應3]`
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
