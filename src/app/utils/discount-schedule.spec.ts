import {
  calculateDiscountedPrice,
  getDiscountTimeSnapshot,
  resolveDiscountTimeStatus
} from './discount-schedule';

describe('discount schedule (Asia/Taipei)', () => {
  const atTaipei = (dateTime: string) => new Date(`${dateTime}+08:00`);

  it('uses Taiwan time even when the browser timezone differs', () => {
    const snapshot = getDiscountTimeSnapshot(new Date('2026-08-09T02:00:00.000Z'));
    expect(snapshot.minuteOfDay).toBe(10 * 60);
    expect(snapshot.timeLabel).toContain('10:00');
  });

  it('treats every 7-11 boundary as a half-open interval', () => {
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T09:59:00'))).toBeNull();
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T10:00:00'))).toBe(65);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T16:59:00'))).toBe(65);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T17:00:00'))).toBeNull();
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T19:00:00'))).toBe(80);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T19:59:00'))).toBe(80);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-09T20:00:00'))).toBe(65);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-10T02:59:00'))).toBe(65);
    expect(calculateDiscountedPrice('7-11', 100, atTaipei('2026-08-10T03:00:00'))).toBeNull();
  });

  it('keeps FamilyMart midnight boundary in Taiwan time', () => {
    expect(resolveDiscountTimeStatus('全家', 23 * 60 + 59).active).toBeTrue();
    expect(resolveDiscountTimeStatus('全家', 0).active).toBeFalse();
  });
});
