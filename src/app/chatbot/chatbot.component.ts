import { Component, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { SearchFoodModule } from '../search-food/search-food.module';
import { AgentCoreService } from './core/agent-core.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { MotionDirective } from '../directives/motion.directive';
import { GestureDirective } from '../directives/gesture.directive';
import { HapticService } from '../services/haptic.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [FormsModule, CommonModule, SearchFoodModule, MotionDirective, GestureDirective],
})
export class ChatbotComponent implements OnInit, OnDestroy {
  @ViewChild('chatBody') chatBody!: ElementRef;

  isLogin = false;
  isOpen = false;
  isMounted = false;
  chatEnabled = false; // 預設關閉，由實驗室開關控制
  userInput = '';
  userName = '';
  messages: { text: string; safeHtml?: SafeHtml; sender: string; isLoading?: boolean }[] = [];
  showScrollBottom = false;
  suggestedReplies: string[] = [];
  private lastVvH = 0;
  private stateSub?: Subscription;

  constructor(
    private authService: AuthService,
    private agentCore: AgentCoreService,
    private sanitizer: DomSanitizer,
    private haptic: HapticService
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

    // 監聽開啟聊天室事件
    window.addEventListener('openChatbot', () => {
      if (this.chatEnabled && !this.isOpen) {
        this.toggleChat();
      }
    });

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

    this.stateSub = this.agentCore.state$.subscribe(state => {
      if (state.sender === 'user') return; // User messages are handled locally in sendMessage
      if (!state.isLoading) {
        this.clearLoading();
      }
      this.putMessage(state.text, 'bot', state.isLoading);
    });
  }

  ngOnDestroy() {
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onVisualViewportChange);
      window.visualViewport.removeEventListener('scroll', this.onVisualViewportChange);
    }
    if (this.stateSub) {
      this.stateSub.unsubscribe();
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
        // AND call scrollToBottom for better mobile UX
        if (this.lastVvH > 0 && vv.height < this.lastVvH) {
            const delta = this.lastVvH - vv.height;
            if (this.chatBody && this.chatBody.nativeElement) {
               this.chatBody.nativeElement.scrollTop += delta;
            }
            // Keyboard popped up -> Scroll to bottom after a short delay
            setTimeout(() => this.scrollToBottom(), 300);
        }
        this.lastVvH = vv.height;
    });
  };

  onInputFocus() {
    if (window.innerWidth < 768) {
      // Give browser time to start keyboard animation
      setTimeout(() => this.scrollToBottom(), 300);
    }
  }

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
    this.haptic.light();

    if (!this.isOpen) {
      // 延後開啟：為了展示按鈕被「按下」後的縮放回饋，增加 120ms 延遲
      setTimeout(() => {
        this.isMounted = true;
        this.isOpen = true;
        if (window.innerWidth < 768) {
          // 在手機版上隱藏捲軸，確保全螢幕體驗
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
      }, 120);
    } else {
      // 關閉則是立即執行，保持俐落感
      this.isOpen = false;
      if (window.innerWidth < 768) {
        document.body.style.overflow = '';
      }
      setTimeout(() => {
        this.isMounted = false;
      }, 400); // Wait for the close animation to finish before truly unmounting
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
    this.haptic.medium();

    if (this.messages.some(msg => msg.isLoading)) {
      this.putMessage('我還在處理上一個問題，請稍等！', 'bot', false);
      return;
    }

    this.agentCore.sendMessage(input);
  }

  // ==========================================
  // 輔助
  // ==========================================

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
