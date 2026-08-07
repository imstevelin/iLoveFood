import { fakeAsync, TestBed, tick } from '@angular/core/testing';

import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  let service: LoadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LoadingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('tracks real stages without allowing actual progress to move backwards', fakeAsync(() => {
    let latest: any;
    service.state$.subscribe(state => latest = state);

    service.begin('定位中', 12, '準備定位');
    service.update('查詢中', 58, '平行查詢');
    service.update('較舊的階段', 30);
    tick(120);

    expect(latest.visible).toBeTrue();
    expect(latest.actualProgress).toBe(58);
    expect(latest.progress).toBeGreaterThan(4);
    expect(latest.message).toBe('較舊的階段');
    service.hide();
    tick(280);
  }));

  it('animates to completion before hiding', fakeAsync(() => {
    let latest: any;
    service.state$.subscribe(state => latest = state);
    service.begin('查詢中', 50);
    service.hide();

    expect(latest.visible).toBeTrue();
    expect(latest.progress).toBe(100);
    tick(280);
    expect(latest.visible).toBeFalse();
    expect(latest.message).toBe('');
  }));

  it('does not invent progress while the real query stage is stalled', fakeAsync(() => {
    let latest: any;
    service.state$.subscribe(state => latest = state);
    service.begin('查詢中', 40);
    tick(10_000);

    expect(latest.progress).toBe(40);
    service.hide();
    tick(280);
  }));

  it('stops progress immediately when the query fails', fakeAsync(() => {
    let latest: any;
    service.state$.subscribe(state => latest = state);
    service.begin('查詢中', 40);
    tick(600);
    service.fail('查詢暫時失敗');
    const stoppedAt = latest.progress;
    tick(1200);

    expect(latest.status).toBe('error');
    expect(latest.errorMessage).toBe('查詢暫時失敗');
    expect(latest.progress).toBe(stoppedAt);
  }));
});
