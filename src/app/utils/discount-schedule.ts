export type DiscountChain = '7-11' | '全家';

export interface DiscountPeriod {
  startMinute: number;
  endMinute: number;
  timeLabel: string;
  discountLabel: string;
  productLabel: string;
  discountRate: number;
}

export interface DiscountSchedule {
  programName: string;
  periods: DiscountPeriod[];
}

export interface DiscountTimeStatus {
  chain: DiscountChain;
  programName: string;
  active: boolean;
  activePeriod: DiscountPeriod | null;
  nextPeriod: DiscountPeriod;
}

export interface DiscountTimeSnapshot {
  timeLabel: string;
  minuteOfDay: number;
  statuses: DiscountTimeStatus[];
}

export const DISCOUNT_SCHEDULES: Record<DiscountChain, DiscountSchedule> = {
  '7-11': {
    programName: 'i珍食',
    periods: [
      { startMinute: 10 * 60, endMinute: 17 * 60, timeLabel: '10:00–17:00', discountLabel: '65 折', discountRate: 0.65, productLabel: '鮮食' },
      { startMinute: 19 * 60, endMinute: 20 * 60, timeLabel: '19:00–19:59', discountLabel: '8 折', discountRate: 0.8, productLabel: '鮮食' },
      { startMinute: 20 * 60, endMinute: 3 * 60, timeLabel: '20:00–03:00', discountLabel: '65 折', discountRate: 0.65, productLabel: '鮮食、麵包、三角與圓形飯糰' }
    ]
  },
  '全家': {
    programName: '友善食光',
    periods: [
      { startMinute: 10 * 60, endMinute: 17 * 60, timeLabel: '10:00–17:00', discountLabel: '7 折', discountRate: 0.7, productLabel: '飯糰、壽司、手卷' },
      { startMinute: 17 * 60, endMinute: 24 * 60, timeLabel: '17:00–00:00', discountLabel: '7 折', discountRate: 0.7, productLabel: '各種鮮食、生鮮蔬果' }
    ]
  }
};

export function isMinuteInDiscountPeriod(minuteOfDay: number, period: DiscountPeriod): boolean {
  if (period.startMinute < period.endMinute) {
    return minuteOfDay >= period.startMinute && minuteOfDay < period.endMinute;
  }
  return minuteOfDay >= period.startMinute || minuteOfDay < period.endMinute;
}

export function resolveDiscountTimeStatus(chain: DiscountChain, minuteOfDay: number): DiscountTimeStatus {
  const schedule = DISCOUNT_SCHEDULES[chain];
  const activePeriod = schedule.periods.find(period => isMinuteInDiscountPeriod(minuteOfDay, period)) || null;
  const nextPeriod = schedule.periods.reduce((closest, period) => {
    const waitMinutes = (period.startMinute - minuteOfDay + 24 * 60) % (24 * 60);
    const closestWait = (closest.startMinute - minuteOfDay + 24 * 60) % (24 * 60);
    return waitMinutes < closestWait ? period : closest;
  }, schedule.periods[0]);

  return {
    chain,
    programName: schedule.programName,
    active: activePeriod !== null,
    activePeriod,
    nextPeriod
  };
}

export function getDiscountTimeSnapshot(now: Date = new Date()): DiscountTimeSnapshot {
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const hour = Number(timeParts.find(part => part.type === 'hour')?.value || 0);
  const minute = Number(timeParts.find(part => part.type === 'minute')?.value || 0);
  const minuteOfDay = hour * 60 + minute;
  const timeLabel = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(now);

  return {
    timeLabel,
    minuteOfDay,
    statuses: (['7-11', '全家'] as DiscountChain[])
      .map(chain => resolveDiscountTimeStatus(chain, minuteOfDay))
  };
}

export function calculateDiscountedPrice(
  chain: DiscountChain,
  originalPrice: number,
  now: Date = new Date()
): number | null {
  if (!Number.isFinite(originalPrice) || originalPrice < 0) return null;
  const snapshot = getDiscountTimeSnapshot(now);
  const activePeriod = snapshot.statuses.find(status => status.chain === chain)?.activePeriod;
  return activePeriod ? originalPrice * activePeriod.discountRate : null;
}
