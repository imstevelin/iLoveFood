import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ImageDialogComponent } from './image-dialog.component';

describe('ImageDialogComponent', () => {
  let component: ImageDialogComponent;
  let fixture: ComponentFixture<ImageDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useValue: { image: 'assets/iLoveFood-icon.webp' } }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImageDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the image close action as a circular button', () => {
    const closeButton = fixture.nativeElement.querySelector('.modern-close-btn') as HTMLButtonElement;
    expect(closeButton.getAttribute('aria-label')).toBe('關閉圖片');
    expect(getComputedStyle(closeButton).borderRadius).toBe('999px');
  });
});
