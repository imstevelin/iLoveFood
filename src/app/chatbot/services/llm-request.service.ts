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

  /**
   * 純聊天 — 閒聊用，不涉及搜尋
   */
  chat(userMessage: string, conversationHistory: { role: string; content: string }[]): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是「友善小精靈」，一個友善、親切的便利商店食品搜尋助手。
你可以和使用者聊天、回答問題。聊天時請保持友善自然的語氣。
你的專長是幫使用者找附近便利商店的折扣食品。
如果話題適合，可以自然地提到「要不要看看附近有什麼好吃的？」來引導使用者使用搜尋功能。
不要編造任何商店名稱或商品資訊。`
        },
        ...conversationHistory,
        { role: 'user', content: userMessage }
      ],
      max_tokens: 500,
    };

    return this.http.post(this.url, body, { headers });
  }

  /**
   * 根據搜尋結果生成自然語言回覆
   * 嚴禁幻覺 — 只能使用提供的資料
   */
  generateResponse(userMessage: string, searchResults: any[], searchContext: string): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是「友善小精靈」，根據系統搜尋結果回答使用者的問題。

⚠️ 嚴格規則：
1. 你只能使用下方提供的搜尋結果來回答，嚴禁編造任何商店名稱、商品名稱或價格
2. 如果搜尋結果為空或門市沒有商品，誠實告知使用者
3. 用友善自然的語氣回答
4. 每間店用 🏪 開頭
5. 如果有距離資訊且不是 0，顯示距離
6. 商品列表用編號列出

搜尋背景：${searchContext}

搜尋結果：
${JSON.stringify(searchResults, null, 2)}`
        },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 4000,
    };

    return this.http.post(this.url, body, { headers });
  }
}
