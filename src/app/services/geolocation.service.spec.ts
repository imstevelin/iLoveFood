import { TestBed } from '@angular/core/testing';

import { GeolocationService } from './geolocation.service';

describe('GeolocationService', () => {
  let service: GeolocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GeolocationService);
    localStorage.removeItem('ilovefood:last-position:v1');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns a fresh cached position without waiting for GPS', async () => {
    localStorage.setItem('ilovefood:last-position:v1', JSON.stringify({
      latitude: 25.033,
      longitude: 121.5654,
      accuracy: 12,
      timestamp: Date.now()
    }));

    const position = await service.getCurrentPosition({ maximumAge: 60_000 });
    expect(position.coords.latitude).toBe(25.033);
    expect(position.coords.longitude).toBe(121.5654);
  });

  it('ignores expired cached positions', () => {
    localStorage.setItem('ilovefood:last-position:v1', JSON.stringify({
      latitude: 25.033,
      longitude: 121.5654,
      timestamp: Date.now() - 120_000
    }));

    expect(service.getCachedPosition(60_000)).toBeNull();
  });
});
