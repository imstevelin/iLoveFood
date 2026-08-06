import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { RouteModeDialogComponent } from './route-mode-dialog.component';

describe('RouteModeDialogComponent', () => {
  let component: RouteModeDialogComponent;
  let fixture: ComponentFixture<RouteModeDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteModeDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useValue: { allOptions: [] } }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RouteModeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should require a Google Maps URL before starting', () => {
    component.selectMode('DRIVING');
    expect(component.urlError).toBe('請貼上 Google Maps 的路線分享連結');
  });
});
