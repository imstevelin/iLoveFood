import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { SearchFoodModule } from '../search-food.module';

import { NewSearchComponent } from './new-search.component';

describe('NewSearchComponent', () => {
  let component: NewSearchComponent;
  let fixture: ComponentFixture<NewSearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchFoodModule, HttpClientTestingModule, MatDialogModule],
      providers: [
        { provide: AngularFirestore, useValue: {} }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NewSearchComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('normalizes common Traditional Chinese product variants', () => {
    const normalize = (component as any).normalizeSearchText.bind(component);
    expect(normalize('配．意大利麪')).toBe(normalize('義大利麵'));
    expect(normalize('臺式 飯糰')).toBe(normalize('台式飯糰'));
  });

  it('supports any and all keyword matching', () => {
    const matches = (component as any).matchesKeywordSet.bind(component);
    const keywords = [
      { text: '義大利麵', isCategory: false },
      { text: '便當', isCategory: false }
    ];

    component.keywordMatchMode = 'any';
    expect(matches((keyword: any) => '奶油培根義大利麵'.includes(keyword.text), keywords)).toBeTrue();

    component.keywordMatchMode = 'all';
    expect(matches((keyword: any) => '奶油培根義大利麵'.includes(keyword.text), keywords)).toBeFalse();
    expect(matches((keyword: any) => '義大利麵便當'.includes(keyword.text), keywords)).toBeTrue();
  });

  it('uses the active result source for the map store count', () => {
    component.totalStoresShowList = [{}, {}, {}];
    component.productSearchStores = [{}, {}];

    component.searchMode = 'location';
    expect(component.mapStoreCount).toBe(3);

    component.searchMode = 'product';
    expect(component.mapStoreCount).toBe(2);
  });

  it('can continue with the Taipei 101 fallback when location is unavailable', () => {
    const searchSpy = spyOn(component, 'searchCombineAndTransformStoresExpanded');
    component.locationDenied = true;
    component.isMapView = true;

    component.useFallbackLocation();

    expect(component.locationDenied).toBeFalse();
    expect(component.locationFallbackUsed).toBeTrue();
    expect(component.isMapView).toBeFalse();
    expect(component.searchCenterLat).toBe(25.0330);
    expect(component.searchCenterLng).toBe(121.5654);
    expect(searchSpy).toHaveBeenCalledWith(25.0330, 121.5654);
  });
});
