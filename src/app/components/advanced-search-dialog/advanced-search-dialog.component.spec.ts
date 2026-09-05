import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { AdvancedSearchDialogComponent } from './advanced-search-dialog.component';

describe('AdvancedSearchDialogComponent', () => {
  let component: AdvancedSearchDialogComponent;
  let fixture: ComponentFixture<AdvancedSearchDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<AdvancedSearchDialogComponent>>;

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    await TestBed.configureTestingModule({
      imports: [AdvancedSearchDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { allOptions: [], initialKeywords: [], matchMode: 'any' } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdvancedSearchDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('requires at least one condition', () => {
    component.applySearch();
    expect(component.validationError).toBe('請至少加入一個搜尋條件');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('returns multiple conditions and the selected match mode', () => {
    component.keywordCtrl.setValue('便當');
    component.addCurrentKeyword();
    component.keywordCtrl.setValue('義大利麵');
    component.addCurrentKeyword();
    component.setMatchMode('all');

    component.applySearch();

    expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({
      matchMode: 'all',
      keywords: jasmine.arrayWithExactContents([
        jasmine.objectContaining({ name: '便當', type: 'text' }),
        jasmine.objectContaining({ name: '義大利麵', type: 'text' })
      ])
    }));
  });

  it('uses a viewport-safe wide autocomplete panel', () => {
    expect(component.autocompletePanelWidth).toBe('min(410px, calc(100vw - 64px))');
  });
});
