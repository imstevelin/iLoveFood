import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatDialogModule } from '@angular/material/dialog';

import { DisplayComponent } from './display.component';

describe('DisplayComponent', () => {
  let component: DisplayComponent;
  let fixture: ComponentFixture<DisplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ DisplayComponent ],
      imports: [HttpClientTestingModule, MatDialogModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('tracks loaded product images so they can fade in without flashing', () => {
    expect(component.isProductImageLoaded('https://example.com/product.jpg')).toBeFalse();

    component.markProductImageLoaded('https://example.com/product.jpg');

    expect(component.isProductImageLoaded('https://example.com/product.jpg')).toBeTrue();
  });
});
