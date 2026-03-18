import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { SearchFoodModule } from '../search-food/search-food.module';
import { ChatbotSearchService } from './services/chatbot-search.service';
import { LlmRequestService } from './services/llm-request.service';
import { forkJoin, of, Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [FormsModule, CommonModule, SearchFoodModule],
})
export class ChatbotComponent implements OnInit, OnDestroy {
  @ViewChild('chatBody') chatBody!: ElementRef;

  isLogin = false;
  isOpen = false;
  chatEnabled = false; // 預設關閉，由實驗室開關控制
  userInput = '';
  userName = '';
  messages: { text: string; safeHtml?: SafeHtml; sender: string; isLoading?: boolean }[] = [];
  showScrollBottom = false;
  suggestedReplies: string[] = [];
  private conversationHistory: any[] = [];
  private readonly MAX_HISTORY = 10;
  private lastVvH = 0;

  constructor(
    private authService: AuthService,
    private searchService: ChatbotSearchService,
    private llmService: LlmRequestService,
    private sanitizer: DomSanitizer
  ) { }

  ngOnInit() {
    // 讀取實驗室開關
    const saved = localStorage.getItem('chatEnabled');
    this.chatEnabled = saved ? JSON.parse(saved) : false;

    // 監聽其他組件透過 localStorage 改變此設定（跨分頁）
    window.addEventListener('storage', (e) => {
      if (e.key === 'chatEnabled') {
        this.chatEnabled = e.newValue ? JSON.parse(e.newValue) : false;
        if (!this.chatEnabled) this.isOpen = false;
      }
    });

    // 監聽同頁面的自訂事件（同分頁內由 new-search 觸發）
    window.addEventListener('chatEnabledChanged', ((e: CustomEvent) => {
      this.chatEnabled = e.detail;
      if (!this.chatEnabled) this.isOpen = false;
    }) as EventListener);

    this.authService.isLoggedIn().subscribe(res => this.isLogin = res);
    this.authService.getUser().subscribe(user => {
      if (!user) {
        this.isLogin = false;
        this.putMessage('嗨～！我是友善小精靈 ✨ 想找什麼好吃的嗎？', 'bot');
        this.setInitialPresets();
        return;
      }
      this.userName = user.displayName;
      this.putMessage(`歡迎回來～${this.userName}！想找什麼好吃的嗎？`, 'bot');
      this.setInitialPresets();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onVisualViewportChange);
      window.visualViewport.addEventListener('scroll', this.onVisualViewportChange);
    }
  }

  ngOnDestroy() {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onVisualViewportChange);
      window.visualViewport.removeEventListener('scroll', this.onVisualViewportChange);
    }
  }

  private onVisualViewportChange = () => {
    if (!this.isOpen || !window.visualViewport) return;

    const vv = window.visualViewport;
    requestAnimationFrame(() => {
        // Gyroscope tracking: Counteract browser's layout viewport push
        document.documentElement.style.setProperty('--vvTop', `${vv.offsetTop}px`);
        document.documentElement.style.setProperty('--vvH', `${vv.height}px`);

        // Compensate scroll inside chat container when keyboard opens (height shrinks)
        if (this.lastVvH > 0 && vv.height < this.lastVvH) {
            const delta = this.lastVvH - vv.height;
            if (this.chatBody && this.chatBody.nativeElement) {
               this.chatBody.nativeElement.scrollTop += delta;
            }
        }
        this.lastVvH = vv.height;
    });
  };

  private setInitialPresets() {
    const allPresets = [
      '逢甲附近現在有什麼吃的？',
      '這附近有義大利麵嗎？',
      '7-11權美門市現在有什麼商品？',
      '離我最近的手捲在哪？'
    ];
    this.suggestedReplies = allPresets.sort(() => 0.5 - Math.random()).slice(0, 3);
  }

  toggleChat(event?: Event) {
    if (event) event.stopPropagation();
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      if (window.innerWidth < 768) {
        // Start from a clean slate to prevent weird offset behaviors
        window.scrollTo(0, 0);
        document.body.style.overflow = 'hidden';
      }
      setTimeout(() => {
        if (window.innerWidth < 768 && window.visualViewport) {
           this.lastVvH = window.visualViewport.height;
           this.onVisualViewportChange(); // Force initial calculation
        }
        this.scrollToBottom();
      }, 100);
    } else {
      if (window.innerWidth < 768) {
        document.body.style.overflow = '';
      }
    }
  }

  onChatScroll() {
    const el = this.chatBody.nativeElement;
    this.showScrollBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) > 50;
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
    this.suggestedReplies = [];
    this.putMessage(input, 'user');

    if (this.messages.some(msg => msg.isLoading)) {
      this.putMessage('我還在處理上一個問題，請稍等！', 'bot', false);
      return;
    }

    this.putMessage('思考中...', 'bot', true);

    // 加入 user message
    this.addToHistory({ role: 'user', content: input });
    this.runAgentLoop();
  }

  private runAgentLoop() {
    this.llmService.chatWithTools(this.conversationHistory).subscribe({
      next: res => {
        const choice = res?.choices?.[0];
        const message = choice?.message;

        if (!message) {
          this.clearLoading();
          this.putMessage('抱歉，我現在大腦有點卡卡的，請稍後再試！', 'bot');
          return;
        }

        // 1. 判斷是否有 tool_calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // 將 assistant 的 tool_calls 加入紀錄
          this.conversationHistory.push(message);

          // 計算動態讀取文字 (根據 Tool 組合精確判斷)
          const toolCalls = message.tool_calls;
          const inventoryCalls = toolCalls.filter((tc: any) => tc.function.name === 'query_store_inventory');
          const hasStoreSearch = toolCalls.some((tc: any) => tc.function.name === 'search_stores_by_keyword');
          const hasNearbySearch = toolCalls.some((tc: any) => tc.function.name === 'get_nearby_stores_inventory');
          
          let loadingMsg = '正在為您處理中...';
          
          if (hasNearbySearch) {
            loadingMsg = '正在掃描您周邊的所有門市...';
          } else if (inventoryCalls.length > 0) {
            const brands = Array.from(new Set(inventoryCalls.map((tc: any) => JSON.parse(tc.function.arguments).brand)));
            if (brands.length > 1) {
              loadingMsg = '正在同步查詢各大品牌門市庫存...';
            } else {
              loadingMsg = `正在查詢 ${brands[0]} 門市庫存...`;
            }
          } else if (hasStoreSearch) {
            const firstSearch = toolCalls.find((tc: any) => tc.function.name === 'search_stores_by_keyword');
            const keyword = JSON.parse(firstSearch.function.arguments || '{}').keyword || '';
            loadingMsg = keyword ? `正在搜尋「${keyword}」相關門市...` : '正在搜尋門市...';
          }

          // 更新讀取狀態
          this.putMessage(loadingMsg, 'bot', true);

          // 解析並執行 tools
          this.handleToolCalls(message.tool_calls);
        } else {
          // 2. 純文字回覆
          this.clearLoading();
          let content = message.content?.trim() || '';
          if (!content) content = '你好！想找什麼好吃的嗎？ 😊';
          this.putMessage(content, 'bot');
          this.addToHistory({ role: 'assistant', content: content });
        }
      },
      error: () => {
        this.clearLoading();
        this.putMessage('暫時無法連線，請稍後再試！', 'bot');
      }
    });

  }

  private handleToolCalls(toolCalls: any[]) {
    const toolsObs = toolCalls.map(toolCall => {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const toolName = toolCall.function.name;

      console.log(`[友善小精靈] 呼叫工具: ${toolName}`, args);
      let search$: Observable<any>;

      if (toolName === 'search_stores_by_keyword') {
        search$ = this.searchService.findStoresByKeyword(args.keyword || '');
      } else if (toolName === 'query_store_inventory') {
        search$ = this.searchService.queryStoreInventory(args.brand, args.store_id, args.lat, args.lng);
      } else if (toolName === 'get_nearby_stores_inventory') {
        search$ = this.searchService.searchNearby();
      } else {
        search$ = of([]); // Fallback
      }

      return search$.pipe(
         map(result => {
           console.log(`[友善小精靈] 工具 ${toolName} 執行完畢，取得結果：`, result);
           return {
             tool_call_id: toolCall.id,
             role: 'tool',
             name: toolName,
             content: JSON.stringify(result)
           };
         }),
         catchError(err => {
           console.error(`[友善小精靈] 工具 ${toolName} 執行失敗`, err);
           return of({
             tool_call_id: toolCall.id,
             role: 'tool',
             name: toolName,
             content: "[]" // Error is treated as no result
           });
         })
      );
    });

    forkJoin(toolsObs).subscribe(toolMessages => {
      // 把 tool 結果加回 conversationHistory
      toolMessages.forEach(msg => this.conversationHistory.push(msg));
      
      // 再次呼叫 LLM 進行總結
      this.runAgentLoop();
    });
  }

  // ==========================================
  // 輔助
  // ==========================================
  private addToHistory(message: any): void {
    this.conversationHistory.push(message);
    if (this.conversationHistory.length > this.MAX_HISTORY * 3) {
      this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY * 3);
    }
  }

  private clearLoading(): void {
    this.messages = this.messages.filter(msg => !msg.isLoading);
  }

  putMessage(message: string, sender: string, isLoading?: boolean) {
    if (sender === 'bot') {
      // 1. 徹底移除 LLM 可能輸出的所有 XML 標籤（如 <thinking>, <response_format> 等）
      message = message.replace(/<[^>]*>/g, '').trim();

      // 優化：如果是讀取狀態且最後一筆也是讀取中，直接更新文字，不進入 300ms 延遲
      if (isLoading) {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.isLoading) {
          lastMsg.text = message;
          setTimeout(() => this.scrollToBottom(), 50);
          return;
        }
      }

      let mainText = message;
      this.suggestedReplies = [];

      // 支援大小寫不敏感的分隔符
      const presetDelimiter = /---PRESETS---/i;
      if (presetDelimiter.test(mainText)) {
        const parts = mainText.split(presetDelimiter);
        mainText = parts[0].trim();
        const presetPart = parts[1] ? parts[1].trim() : '';
        
        this.suggestedReplies = presetPart.split('\n')
          .map(line => line.trim())
          .filter(line => /^\d+\./.test(line))
          .map(line => line.replace(/^\d+\.\s*/, '').replace(/^-/, '').trim())
          // 額外清理可能殘留的 Markdown 括號 []
          .map(line => line.replace(/\[|\]/g, ''))
          .filter(line => line.length > 0);
      }

      const formatted = this.formatStoreMessage(mainText);
      const parsedHtml = marked.parse(formatted, { breaks: true }) as string;
      const parsedWithNewTabs = parsedHtml.replace(/<a href=/g, '<a target="_blank" href=');
      const safeHtml = this.sanitizer.bypassSecurityTrustHtml(parsedWithNewTabs);

      setTimeout(() => {
        this.messages.push({ text: mainText, safeHtml, sender, isLoading });
        setTimeout(() => this.scrollToBottom(), 50);
      }, 300);
    } else {
      this.messages.push({ text: message, sender });
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  sendPreset(reply: string) {
    this.userInput = reply;
    this.suggestedReplies = [];
    this.sendMessage();
  }

  scrollToBottom(): void {
    const el = this.chatBody.nativeElement;
    el.scrollTop = el.scrollHeight;
    this.showScrollBottom = false;
  }

  isStoreMessage(text: string): boolean { return text.includes('🏪'); }

  formatStoreMessage(text: string): string {
    return text.split('\n').map(line => {
      if (line.startsWith('🏪')) {
        let name = line.replace('🏪', '')
                       .replace(/\*\*/g, '')
                       .replace(/\s*(約|距離)?\s*\d+(\.\d+)?\s*(公尺|m|km|公里).*$/ig, '')
                       .trim();
        let enc = '';
        try { enc = encodeURIComponent(name); } catch { enc = ''; }
        return `${line} <a href="https://www.google.com/maps/search/${enc}" target="_blank" class="map-link"><img src="assets/GoogleMap_icon.png" alt="地圖" class="map-icon"></a>`;
      }
      return line;
    }).join('\n');
  }
}
