import { Injectable } from '@angular/core';
import { Subject, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ContextManagerService } from './context-manager.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { LlmRequestService } from '../services/llm-request.service';

import { buildSystemPrompt } from './system-prompts';

export interface ChatState {
  text: string;
  sender: 'user' | 'bot';
  isLoading?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AgentCoreService {
  private stateSubject = new Subject<ChatState>();
  state$ = this.stateSubject.asObservable();

  constructor(
    private contextManager: ContextManagerService,
    private toolRegistry: ToolRegistryService,
    private llmService: LlmRequestService
  ) {}

  sendMessage(text: string) {
    if (!text.trim()) return;

    // 發送使用者訊息
    this.stateSubject.next({ text, sender: 'user' });
    // 發送機器人思考中狀態
    this.stateSubject.next({ text: '思考中...', sender: 'bot', isLoading: true });

    this.contextManager.addMessage({ role: 'user', content: text });
    this.runAgentLoop();
  }

  private runAgentLoop() {
    const dynamicSystemPrompt = buildSystemPrompt(this.contextManager.getState());

    this.llmService.chatWithTools(
      this.contextManager.getHistory(),
      this.toolRegistry.getAllDefinitions(),
      dynamicSystemPrompt
    ).subscribe({
      next: (res) => {
        const choice = res?.choices?.[0];
        const message = choice?.message;

        if (!message) {
          this.stateSubject.next({ text: '抱歉，我現在大腦有點卡卡的，請稍後再試！', sender: 'bot', isLoading: false });
          return;
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          this.contextManager.addMessage(message);

          // 計算顯示的 loading 訊息
          const firstToolCall = message.tool_calls[0];
          const tool = this.toolRegistry.getTool(firstToolCall.function.name);
          let args: any = {};
          try {
            args = JSON.parse(firstToolCall.function.arguments || '{}');
          } catch(e) {}
          
          let loadingMsg = '正在為您處理中...';
          
          // 如果是搜尋或取得庫存，有機會用到工具自帶的動態 loadingMessage
          // 但工具可能需要先把 args 傳入，這裡簡單使用 tool.execute 時儲存的狀態，
          // 不過最好是由 tool 提供一個輔助方法解析 args 產生 loadingMessage
          // 這裡簡化為：如果是特定 tool 就取預設文字
          if (tool) {
            if (tool.definition.name === 'search_stores_by_keyword') {
              loadingMsg = args['keyword'] ? `正在搜尋「${args['keyword']}」相關門市...` : tool.loadingMessage;
            } else if (tool.definition.name === 'query_store_inventory') {
               const b = args['brand'];
               loadingMsg = b ? `正在查詢 ${b} 門市庫存...` : tool.loadingMessage;
            } else if (tool.definition.name === 'search_stores_near_landmark') {
               const lm = args['landmark'];
               loadingMsg = lm ? `正在將「${lm}」轉換經緯度以掃描門市庫存...` : tool.loadingMessage;
            } else {
               loadingMsg = tool.loadingMessage;
            }
          }

          this.stateSubject.next({ text: loadingMsg, sender: 'bot', isLoading: true });

          this.handleToolCalls(message.tool_calls);
        } else {
          let content = message.content?.trim() || '你好！想找什麼好吃的嗎？ 😊';
          this.contextManager.addMessage({ role: 'assistant', content });
          this.stateSubject.next({ text: content, sender: 'bot', isLoading: false });
        }
      },
      error: () => {
        this.stateSubject.next({ text: '暫時無法連線，請稍後再試！', sender: 'bot', isLoading: false });
      }
    });
  }

  private handleToolCalls(toolCalls: any[]) {
    const toolsObs = toolCalls.map(toolCall => {
      const toolName = toolCall.function.name;
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch(e) {}
      
      const tool = this.toolRegistry.getTool(toolName);

      // --- Intercept parameters to update focus state ---
      if (toolName === 'search_stores_near_landmark' && args['landmark']) {
        this.contextManager.updateState({ focusedLandmark: args['landmark'] });
      } else if (toolName === 'search_stores_by_keyword' && args['keyword']) {
        this.contextManager.updateState({ focusedKeyword: args['keyword'] });
      }

      if (!tool) {
        console.warn(`[AgentCore] 未知的工具 ${toolName}`);
        return of({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolName,
          content: "[]"
        });
      }

      console.log(`[AgentCore] 呼叫工具: ${toolName}`, args);
      return tool.execute(args).pipe(
        map(result => ({
           tool_call_id: toolCall.id,
           role: 'tool',
           name: toolName,
           content: JSON.stringify(result)
        })),
        catchError(err => {
           console.error(`[AgentCore] 工具執行失敗: ${toolName}`, err);
           return of({
             tool_call_id: toolCall.id,
             role: 'tool',
             name: toolName,
             content: "[]"
           });
        })
      );
    });

    forkJoin(toolsObs).subscribe(toolMessages => {
      this.contextManager.addMessages(toolMessages);
      this.runAgentLoop();
    });
  }
}
