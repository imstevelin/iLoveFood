import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';

export interface LoadingState {
  visible: boolean;
  message: string;
  detail: string;
  progress: number;
  actualProgress: number;
  status: 'idle' | 'loading' | 'error';
  errorMessage: string;
  startedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private readonly stateSubject = new BehaviorSubject<LoadingState>({
    visible: false,
    message: '',
    detail: '',
    progress: 0,
    actualProgress: 0,
    status: 'idle',
    errorMessage: '',
    startedAt: 0
  });
  private displayProgress = 0;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private flowGeneration = 0;

  readonly state$ = this.stateSubject.asObservable();
  readonly loading$ = this.state$.pipe(
    map(state => state.visible && state.status === 'loading'),
    distinctUntilChanged()
  );
  readonly message$ = this.state$.pipe(
    map(state => state.message),
    distinctUntilChanged()
  );
  readonly progress$ = this.state$.pipe(
    map(state => state.progress),
    distinctUntilChanged()
  );

  /** 開始載入；畫面進度只追趕真實階段，不在停滯時虛構進度。 */
  begin(message: string, progress = 8, detail = ''): void {
    this.flowGeneration++;
    this.clearTimers();
    const actualProgress = this.clampProgress(progress);
    this.displayProgress = Math.min(4, actualProgress);
    this.stateSubject.next({
      visible: true,
      message,
      detail,
      progress: Math.round(this.displayProgress),
      actualProgress,
      status: 'loading',
      errorMessage: '',
      startedAt: Date.now()
    });
    this.startProgressAnimation(this.flowGeneration);
  }

  /** 向下相容舊呼叫；若流程已開始，更新文字但不把進度倒退。 */
  show(message: string, progress?: number, detail?: string): void {
    const current = this.stateSubject.value;
    if (!current.visible || current.status !== 'loading') {
      this.begin(message, progress ?? 8, detail ?? '');
      return;
    }

    this.update(message, progress, detail);
  }

  update(message?: string, progress?: number, detail?: string): void {
    const current = this.stateSubject.value;
    if (!current.visible || current.status !== 'loading') return;
    const nextActualProgress = progress == null
      ? current.actualProgress
      : Math.max(current.actualProgress, this.clampProgress(progress));

    this.stateSubject.next({
      ...current,
      message: message ?? current.message,
      detail: detail ?? current.detail,
      actualProgress: nextActualProgress,
      startedAt: current.startedAt || Date.now()
    });
  }

  hide(): void {
    const generation = this.flowGeneration;
    const current = this.stateSubject.value;
    if (!current.visible) return;
    this.stopProgressAnimation();
    this.displayProgress = 100;
    this.stateSubject.next({
      ...current,
      progress: 100,
      actualProgress: 100,
      status: 'loading'
    });
    this.completionTimer = setTimeout(() => {
      if (generation !== this.flowGeneration) return;
      this.stateSubject.next({
        ...this.stateSubject.value,
        visible: false,
        message: '',
        detail: '',
        status: 'idle',
        errorMessage: ''
      });
      this.completionTimer = null;
    }, 280);
  }

  fail(errorMessage: string): void {
    this.flowGeneration++;
    this.clearTimers();
    const current = this.stateSubject.value;
    this.stateSubject.next({
      ...current,
      visible: true,
      status: 'error',
      errorMessage,
      actualProgress: current.progress
    });
  }

  dismissError(): void {
    if (this.stateSubject.value.status !== 'error') return;
    this.stateSubject.next({
      ...this.stateSubject.value,
      visible: false,
      status: 'idle',
      errorMessage: ''
    });
  }

  private startProgressAnimation(generation: number): void {
    this.progressTimer = setInterval(() => {
      const current = this.stateSubject.value;
      if (generation !== this.flowGeneration || !current.visible || current.status !== 'loading') {
        this.stopProgressAnimation();
        return;
      }

      const gapToActual = current.actualProgress - this.displayProgress;
      if (gapToActual > 0.35) {
        // 大差距快速、接近目標時自然減速，形成非線性的 ease-out。
        this.displayProgress += Math.max(0.45, gapToActual * 0.18);
        this.displayProgress = Math.min(this.displayProgress, current.actualProgress);
      }

      const displayed = Math.min(94, Math.round(this.displayProgress));
      if (displayed !== current.progress) {
        this.stateSubject.next({ ...current, progress: displayed });
      }
    }, 120);
  }

  private stopProgressAnimation(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private clearTimers(): void {
    this.stopProgressAnimation();
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
  }

  private clampProgress(progress: number): number {
    return Math.min(100, Math.max(0, Math.round(progress)));
  }
}
