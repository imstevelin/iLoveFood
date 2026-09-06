import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface FavoriteStore {
  storeName: string;
  store711Name?: string;
  storeFLongitude?: number;
  storeFLatitude?: number;
  label?: '7-11' | '全家';
}

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  constructor(private http: HttpClient) {}

  getAll(): Observable<FavoriteStore[]> {
    return this.http.get<{ favorites: FavoriteStore[] }>(
      '/api/favorites',
      { withCredentials: true }
    ).pipe(map(response => response.favorites || []));
  }

  save(storeKey: string, favorite: FavoriteStore): Observable<FavoriteStore> {
    return this.http.put<{ favorite: FavoriteStore }>(
      `/api/favorites/${encodeURIComponent(storeKey)}`,
      favorite,
      { withCredentials: true }
    ).pipe(map(response => response.favorite));
  }

  remove(storeKey: string): Observable<void> {
    return this.http.delete<void>(
      `/api/favorites/${encodeURIComponent(storeKey)}`,
      { withCredentials: true }
    );
  }
}
