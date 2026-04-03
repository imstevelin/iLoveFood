import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LlmRequestService {

  // MiniMax Configuration
  private url = 'https://api.minimax.io/v1/text/chatcompletion_v2';
  private model = 'MiniMax-M2.5';
  private apiKey = environment.minimaxApiKey;

  // Google Gemini Configuration
  // private url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  // private model = 'gemini-2.5-flash';
  // private apiKey = environment.geminiApiKey;


  constructor(
    private http: HttpClient
  ) { }

  /**
   * 包含 Tools 的通用聊天端點
   */
  chatWithTools(conversationHistory: any[], tools: any[] = [], systemPrompt: string): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        ...conversationHistory
      ],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      max_tokens: 1500,
    };

    return this.http.post(this.url, body, { headers });
  }
}
