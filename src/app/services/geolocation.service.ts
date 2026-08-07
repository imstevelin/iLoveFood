import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class GeolocationService {
  private readonly cacheKey = 'ilovefood:last-position:v1';
  private readonly defaultMaxAge = 5 * 60 * 1000;

  constructor() {}

  getCurrentPosition(options: PositionOptions = {}): Promise<GeolocationPosition> {
    const cached = this.getCachedPosition(options.maximumAge ?? this.defaultMaxAge);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve, reject) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            this.cachePosition(position);
            resolve(position);
          },
          (error) => reject(error),
          {
            enableHighAccuracy: options.enableHighAccuracy ?? false,
            timeout: options.timeout ?? 5000,
            maximumAge: options.maximumAge ?? this.defaultMaxAge
          }
        );
      } else {
        reject(new Error('瀏覽器不支援地理位置功能'));
      }
    });
  }

  getCachedPosition(maxAge = this.defaultMaxAge): GeolocationPosition | null {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached?.timestamp || Date.now() - cached.timestamp > maxAge) return null;
      if (!Number.isFinite(cached.latitude) || !Number.isFinite(cached.longitude)) return null;

      return {
        timestamp: cached.timestamp,
        coords: {
          latitude: cached.latitude,
          longitude: cached.longitude,
          accuracy: cached.accuracy || 0,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        }
      };
    } catch {
      return null;
    }
  }

  private cachePosition(position: GeolocationPosition): void {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp || Date.now()
      }));
    } catch {
      // 儲存空間不可用時仍可正常使用即時定位。
    }
  }
}
