import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ViewChild, ElementRef, OnInit } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { SearchFoodModule } from '../search-food/search-food.module';
import { ChatbotSearchService } from './services/chatbot-search.service';
import { LlmRequestService } from './services/llm-request.service';

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [FormsModule, CommonModule, SearchFoodModule],
})
export class ChatbotComponent implements OnInit {
  @ViewChild('chatBody') chatBody!: ElementRef;

  isLogin = false;
  isOpen = false;
  userInput = '';
  userName = '';
  messages: { text: string; sender: string; isLoading?: boolean }[] = [];
  private conversationHistory: { role: string; content: string }[] = [];
  private readonly MAX_HISTORY = 10;

  constructor(
    private authService: AuthService,
    private searchService: ChatbotSearchService,
    private llmService: LlmRequestService
  ) { }

  ngOnInit() {
    this.authService.isLoggedIn().subscribe(res => this.isLogin = res);
    this.authService.getUser().subscribe(user => {
      if (!user) {
        this.isLogin = false;
        this.putMessage('嗨～！我是友善小精靈 ✨ 想找什麼好吃的嗎？', 'bot');
        return;
      }
      this.userName = user.displayName;
      this.putMessage(`歡迎回來～${this.userName}！想找什麼好吃的嗎？`, 'bot');
    });
  }

  toggleChat(event?: Event) {
    if (event) event.stopPropagation();
    this.isOpen = !this.isOpen;
  }

  handleEnter(event: Event) {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.isComposing) { event.preventDefault(); return; }
    this.sendMessage();
  }

  // ==========================================
  // 主流程
  // ==========================================
  sendMessage() {
    if (!this.userInput.trim()) return;
    const input = this.userInput;
    this.userInput = '';
    this.putMessage(input, 'user');

    if (this.messages.some(msg => msg.isLoading)) {
      this.putMessage('我還在處理上一個問題，請稍等！', 'bot', false);
      return;
    }

    this.putMessage('思考中...', 'bot', true);

    // 解析意圖並執行
    const intent = this.parseIntent(input);
    console.log('[友善小精靈] 意圖:', intent);

    switch (intent.type) {
      case 'store':
        this.doSearchStore(input, intent.query!);
        break;
      case 'area':
        this.doSearchArea(input, intent.area!, intent.keyword);
        break;
      case 'nearby':
        this.doSearchNearby(input, intent.keyword);
        break;
      case 'chat':
        this.doChat(input);
        break;
    }
  }

  // ==========================================
  // 意圖解析
  // ==========================================
  private parseIntent(input: string): { type: string; query?: string; area?: string; keyword?: string } {
    // 提取地區
    const area = this.extractArea(input);
    // 提取食品關鍵字
    const keyword = this.extractFood(input);

    // 優先順序 1: 有地區 → 搜尋該地區
    if (area) {
      return { type: 'area', area, keyword };
    }

    // 優先順序 2: 包含可能的店名關鍵字（至少 2 個中文字，排除常見詞）
    const storeName = this.extractStoreName(input);
    if (storeName) {
      return { type: 'store', query: storeName };
    }

    // 優先順序 3: 有食品關鍵字或搜尋意圖
    if (keyword || /附近|這裡|這邊|旁邊|有什麼|有哪些|打折|優惠|便利商店|有沒有/.test(input)) {
      return { type: 'nearby', keyword: keyword || '' };
    }

    // 預設：聊天
    return { type: 'chat' };
  }

  private extractArea(input: string): string {
    const patterns = [
      /在([\u4e00-\u9fa5]{2,5})[，,\s]/,
      /在([\u4e00-\u9fa5]{2,5})(?:那邊|那裡|附近|這邊|地區|一帶)/,
      /([\u4e00-\u9fa5]{2,5})(?:那邊|那裡|附近|這邊|地區|一帶)/,
      /([\u4e00-\u9fa5]{2,4}(?:區|市|鎮|鄉|路|街|大道|夜市|商圈|車站|大學))/,
      /([\u4e00-\u9fa5]{2,5})(?:有什麼|有哪些|有沒有)/,
    ];
    for (const p of patterns) {
      const m = input.match(p);
      if (m?.[1]) {
        const area = m[1].replace(/[那邊裡附近這地區一帶]/g, '').trim();
        if (area.length >= 2) return area;
      }
    }
    return '';
  }

  private extractFood(input: string): string {
    const foods = [
      '義大利麵', '御飯糰', '關東煮', '茶葉蛋', '三明治',
      '巧克力', '便當', '飯糰', '沙拉', '麵包', '蛋糕', '甜點',
      '壽司', '手卷', '咖啡', '牛奶', '豆漿', '熱狗', '包子',
      '饅頭', '粥', '湯', '水果', '蔬菜', '鮮食', '零食', '點心',
      '飲料', '茶', '麵', '飯'
    ];
    for (const f of foods) {
      if (input.includes(f)) return f;
    }
    return '';
  }

  private extractStoreName(input: string): string {
    const cleaned = input
      .replace(/[有什麼哪些東西商品食物吃的打折嗎呢啊喔？?，,。.！!]/g, '')
      .replace(/7-?11|七十一|統一超商|全家/gi, '')
      .replace(/門市|分店|店家|店|便利商店/g, '')
      .replace(/我在|我想|請問|幫我|查|搜尋|什麼/g, '')
      .trim();
    return cleaned.length >= 2 ? cleaned : '';
  }

  // ==========================================
  // 搜尋執行
  // ==========================================
  private doSearchStore(userInput: string, query: string): void {
    this.searchService.searchByStoreName(query).subscribe({
      next: results => {
        console.log('[友善小精靈] 店名搜尋結果:', results.length, '間');
        if (results.length > 0) {
          this.respondWithResults(userInput, results, `使用者搜尋門市「${query}」的商品`);
        } else {
          // 店名搜尋無結果，嘗試當作地區搜尋
          this.searchService.searchByArea(query).subscribe({
            next: areaResults => {
              if (areaResults.length > 0) {
                this.respondWithResults(userInput, areaResults, `使用者搜尋「${query}」地區的門市`);
              } else {
                // 最後嘗試附近搜尋
                this.searchService.searchNearby().subscribe({
                  next: nearbyResults => {
                    if (nearbyResults.length > 0) {
                      this.respondWithResults(userInput, nearbyResults,
                        `使用者搜尋「${query}」但未找到匹配門市，以下是附近門市結果`);
                    } else {
                      this.clearLoading();
                      this.putMessage('目前沒有找到結果，請確認是否已允許定位權限。', 'bot');
                    }
                  },
                  error: () => { this.clearLoading(); this.putMessage('搜尋失敗，請稍後再試！', 'bot'); }
                });
              }
            },
            error: () => { this.clearLoading(); this.putMessage('搜尋失敗，請稍後再試！', 'bot'); }
          });
        }
      },
      error: () => { this.clearLoading(); this.putMessage('搜尋失敗，請稍後再試！', 'bot'); }
    });
  }

  private doSearchArea(userInput: string, area: string, keyword?: string): void {
    this.searchService.searchByArea(area).subscribe({
      next: results => {
        console.log('[友善小精靈] 地區搜尋結果:', results.length, '間');
        const context = `使用者搜尋「${area}」地區的便利商店${keyword ? '，特別想找：' + keyword : ''}`;
        if (results.length > 0) {
          this.respondWithResults(userInput, results, context);
        } else {
          this.clearLoading();
          this.putMessage(`在「${area}」附近沒有找到有折扣商品的便利商店。`, 'bot');
        }
      },
      error: () => { this.clearLoading(); this.putMessage('搜尋失敗，請稍後再試！', 'bot'); }
    });
  }

  private doSearchNearby(userInput: string, keyword?: string): void {
    this.searchService.searchNearby().subscribe({
      next: results => {
        console.log('[友善小精靈] 附近搜尋結果:', results.length, '間');
        const context = `使用者搜尋附近的便利商店${keyword ? '，想找：' + keyword : ''}`;
        if (results.length > 0) {
          this.respondWithResults(userInput, results, context);
        } else {
          this.clearLoading();
          this.putMessage('附近暫時沒有找到折扣商品，請確認是否已允許定位權限。', 'bot');
        }
      },
      error: () => { this.clearLoading(); this.putMessage('無法取得位置，請先允許定位權限。', 'bot'); }
    });
  }

  private doChat(userInput: string): void {
    this.llmService.chat(userInput, this.conversationHistory).subscribe({
      next: res => {
        this.clearLoading();
        let content = res?.choices?.[0]?.message?.content?.trim() || '';
        content = content.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        content = content.replace(/<invoke[\s\S]*?<\/invoke>/g, '').trim();
        if (!content) content = '你好！想找什麼好吃的嗎？ 😊';
        this.putMessage(content, 'bot');
        this.addToHistory('user', userInput);
        this.addToHistory('assistant', content);
      },
      error: () => { this.clearLoading(); this.putMessage('暫時無法連線，請稍後再試！', 'bot'); }
    });
  }

  // ==========================================
  // 將搜尋結果交給 LLM 生成回覆
  // ==========================================
  private respondWithResults(userInput: string, results: any[], context: string): void {
    this.llmService.generateResponse(userInput, results, context).subscribe({
      next: res => {
        this.clearLoading();
        let content = res?.choices?.[0]?.message?.content?.trim() || '';
        content = content.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '').trim();
        content = content.replace(/<invoke[\s\S]*?<\/invoke>/g, '').trim();
        if (content) {
          this.putMessage(content, 'bot');
          this.addToHistory('user', userInput);
          this.addToHistory('assistant', content);
        } else {
          this.showFallback(results);
        }
      },
      error: () => {
        this.clearLoading();
        this.showFallback(results);
      }
    });
  }

  private showFallback(results: any[]): void {
    let msg = '';
    results.forEach((store: any) => {
      msg += `🏪 ${store.storeName}\n`;
      if (store.distance > 0) msg += `（📍 ${store.distance.toFixed(0)} 公尺）\n`;
      store.foodInfo?.forEach((cat: any) => {
        if (cat.items?.length > 0) msg += `【${cat.category}】${cat.items.slice(0, 5).join('、')}\n`;
      });
      msg += '\n';
    });
    this.putMessage(msg.trim(), 'bot');
  }

  // ==========================================
  // 輔助
  // ==========================================
  private addToHistory(role: string, content: string): void {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > this.MAX_HISTORY * 2)
      this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY * 2);
  }

  private clearLoading(): void {
    this.messages = this.messages.filter(msg => !msg.isLoading);
  }

  putMessage(message: string, sender: string, isLoading?: boolean) {
    if (sender === 'bot') {
      setTimeout(() => this.messages.push({ text: message, sender, isLoading }), 300);
    } else {
      this.messages.push({ text: message, sender });
    }
  }

  ngAfterViewChecked() {
    if (this.isOpen && this.chatBody) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const el = this.chatBody.nativeElement;
    el.scrollTop = el.scrollHeight;
  }

  isStoreMessage(text: string): boolean { return text.includes('🏪'); }

  formatStoreMessage(text: string): string {
    return text.split('\n').map(line => {
      if (line.startsWith('🏪')) {
        const name = line.substring(1).trim();
        let enc = '';
        try { enc = encodeURIComponent(name); } catch { enc = ''; }
        return `${line} <a href="https://www.google.com/maps/search/${enc}" target="_blank" style="display:inline-block;margin-left:4px;"><img src="assets/GoogleMap_icon.png" alt="地圖" style="width:16px;height:16px;vertical-align:middle;"></a><br>`;
      }
      return line.trim() ? `${line}<br>` : '<br>';
    }).join('');
  }
}
