import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ContextManagerService {
  private history: any[] = [];
  private readonly MAX_HISTORY = 40; // Allow a decent amount of messages

  private appState = {
    focusedLandmark: '',
    focusedKeyword: ''
  };

  getState(): any {
    return this.appState;
  }

  updateState(partialState: any) {
    this.appState = { ...this.appState, ...partialState };
  }

  getHistory(): any[] {
    return this.history;
  }

  addMessage(message: any) {
    this.history.push(message);
    this.compressContextIfNeeded();
  }

  addMessages(messages: any[]) {
    this.history.push(...messages);
    this.compressContextIfNeeded();
  }

  private compressContextIfNeeded() {
    if (this.history.length > this.MAX_HISTORY) {
      // We want to keep about half the max history
      let sliceIndex = this.history.length - Math.floor(this.MAX_HISTORY / 2);
      
      // Ensure we don't break tool_calls ↔ tool sequence.
      // We look forward to find a safe boundary (a user message or a pure assistant text message).
      while (sliceIndex < this.history.length) {
        const msg = this.history[sliceIndex];
        // Safe boundaries are 'user' messages, or 'assistant' messages without tool_calls
        if (msg.role === 'user' || (msg.role === 'assistant' && !msg.tool_calls)) {
          break;
        }
        sliceIndex++;
      }

      // If we couldn't find a good boundary, fallback
      if (sliceIndex >= this.history.length) {
         sliceIndex = this.history.length - 10;
      }
      
      this.history = this.history.slice(sliceIndex);
    }
  }

  clear() {
    this.history = [];
  }
}
