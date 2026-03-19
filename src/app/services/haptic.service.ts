import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class HapticService {

  /** 輕量震動 (Light haptic feedback) */
  light() {
    if (this.canVibrate()) {
      navigator.vibrate(10);
    }
  }

  /** 中等震動 (Medium haptic feedback) */
  medium() {
    if (this.canVibrate()) {
      navigator.vibrate(20);
    }
  }

  /** 重度/成功震動 (Heavy/Success haptic feedback) */
  heavy() {
    if (this.canVibrate()) {
      navigator.vibrate([30, 50, 30]);
    }
  }

  private canVibrate(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }
}
