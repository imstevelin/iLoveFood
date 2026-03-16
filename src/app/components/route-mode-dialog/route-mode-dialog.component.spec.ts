import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RouteModeDialogComponent } from './route-mode-dialog.component';

describe('RouteModeDialogComponent', () => {
  let component: RouteModeDialogComponent;
  let fixture: ComponentFixture<RouteModeDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteModeDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RouteModeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
