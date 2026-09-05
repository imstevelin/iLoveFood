import { pinyin } from 'pinyin-pro';

export function normalizeSearchText(value: string): string {
  return (value || '').normalize('NFKC').toLowerCase()
    .replace(/^(?:(?:[一二三四五六七八九十\d]\s*配|配(?=[-_.．\s])|(?:北|中|南|東|全)區)[-_.．\s]*)+/, '')
    .replace(/臺/g, '台').replace(/意大利/g, '義大利').replace(/麪/g, '麵')
    .replace(/[^a-z0-9\u3100-\u312f\u3400-\u9fff]/g, '');
}

export function phoneticSearchText(value: string): string {
  return normalizeSearchText(pinyin(value, { toneType: 'none' }));
}
