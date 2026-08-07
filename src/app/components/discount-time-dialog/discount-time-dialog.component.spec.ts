import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { DiscountTimeDialogComponent } from './discount-time-dialog.component';

describe('DiscountTimeDialogComponent', () => {
  let fixture: ComponentFixture<DiscountTimeDialogComponent>;
  let component: DiscountTimeDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscountTimeDialogComponent],
      providers: [{ provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } }]
    }).compileComponents();

    fixture = TestBed.createComponent(DiscountTimeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows both complete convenience-store schedules', () => {
    expect(component.chains).toEqual(['7-11', '全家']);
    expect(component.schedules['7-11'].periods.length).toBe(3);
    expect(component.schedules['全家'].periods.length).toBe(2);
    expect(component.currentTaipeiTimeLabel).toBeTruthy();
  });
});
