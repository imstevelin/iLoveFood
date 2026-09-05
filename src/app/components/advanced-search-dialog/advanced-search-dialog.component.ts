import { CommonModule } from '@angular/common';
import { Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

export type AdvancedSearchMatchMode = 'any' | 'all';

export interface AdvancedSearchOption {
  name: string;
  type: 'store' | 'product' | 'category' | 'text';
  addr?: string;
  label?: string;
  rawName?: string;
  storeNo?: string;
  pkeynew?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  image?: string;
  imageUrl?: string;
  [key: string]: unknown;
}

export interface AdvancedSearchDialogData {
  allOptions: AdvancedSearchOption[];
  initialKeywords?: AdvancedSearchOption[];
  matchMode?: AdvancedSearchMatchMode;
}

export interface AdvancedSearchDialogResult {
  keywords: AdvancedSearchOption[];
  matchMode: AdvancedSearchMatchMode;
}

@Component({
  selector: 'app-advanced-search-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatChipsModule,
    MatDialogModule
  ],
  templateUrl: './advanced-search-dialog.component.html',
  styleUrls: ['./advanced-search-dialog.component.scss']
})
export class AdvancedSearchDialogComponent {
  keywordCtrl = new FormControl('');
  selectedKeywords: AdvancedSearchOption[];
  matchMode: AdvancedSearchMatchMode;
  filteredOptions$: Observable<AdvancedSearchOption[]>;
  validationError = '';
  isComposing = false;
  readonly autocompletePanelWidth = 'min(410px, calc(100vw - 64px))';
  private readonly indexedOptions: Array<{ option: AdvancedSearchOption; searchText: string }>;

  @ViewChild('keywordInput') keywordInput!: ElementRef<HTMLInputElement>;

  constructor(
    public dialogRef: MatDialogRef<AdvancedSearchDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AdvancedSearchDialogData
  ) {
    this.selectedKeywords = (data.initialKeywords || []).map(keyword => ({ ...keyword }));
    this.matchMode = data.matchMode || 'any';
    this.indexedOptions = (data.allOptions || []).map(option => ({
      option,
      searchText: typeof option['searchText'] === 'string'
        ? option['searchText']
        : this.normalize(`${option.name} ${option.rawName || ''} ${option.addr || ''}`)
    }));
    this.filteredOptions$ = this.keywordCtrl.valueChanges.pipe(
      startWith(''),
      map(value => this.filterOptions(typeof value === 'string' ? value : ''))
    );
  }

  displayOption(option: AdvancedSearchOption | string | null): string {
    if (!option) return '';
    return typeof option === 'string' ? option : this.displayName(option);
  }

  displayName(option: AdvancedSearchOption): string {
    if (option.type !== 'store') return option.name;
    const rawName = option.rawName || option.name;
    if (option.label === '7-11') return `7-11 ${rawName.replace(/門市$/, '')}門市`;
    return rawName.includes('全家')
      ? rawName.replace(/店$/, '門市')
      : `全家${rawName.replace(/店$/, '')}門市`;
  }

  typeLabel(option: AdvancedSearchOption): string {
    if (option.type === 'store') return '門市';
    if (option.type === 'category') return '分類';
    if (option.type === 'text' || option.source === '自訂') return '關鍵字';
    return '商品';
  }

  selectOption(event: MatAutocompleteSelectedEvent): void {
    const option = event.option.value as AdvancedSearchOption;
    this.addKeyword(option);
    this.resetInput();
  }

  addCurrentKeyword(): void {
    const value = (this.keywordCtrl.value || '').trim();
    if (!value) return;
    this.addKeyword({
      name: value,
      rawName: value,
      type: 'text',
      label: '自訂搜尋',
      source: '自訂',
      addr: '自訂關鍵字'
    });
    this.resetInput();
  }

  onKeywordKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing || this.isComposing) return;
    event.preventDefault();
    this.addCurrentKeyword();
  }

  removeKeyword(keyword: AdvancedSearchOption): void {
    this.selectedKeywords = this.selectedKeywords.filter(item => this.optionKey(item) !== this.optionKey(keyword));
  }

  setMatchMode(mode: AdvancedSearchMatchMode): void {
    this.matchMode = mode;
  }

  applySearch(): void {
    this.addCurrentKeyword();
    if (this.selectedKeywords.length === 0) {
      this.validationError = '請至少加入一個搜尋條件';
      this.keywordInput?.nativeElement.focus();
      return;
    }
    this.dialogRef.close({
      keywords: this.selectedKeywords,
      matchMode: this.matchMode
    } satisfies AdvancedSearchDialogResult);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  private addKeyword(option: AdvancedSearchOption): void {
    const key = this.optionKey(option);
    if (!this.selectedKeywords.some(keyword => this.optionKey(keyword) === key)) {
      this.selectedKeywords = [...this.selectedKeywords, { ...option }];
    }
    this.validationError = '';
  }

  private resetInput(): void {
    this.keywordCtrl.setValue('');
    if (this.keywordInput) this.keywordInput.nativeElement.value = '';
  }

  private optionKey(option: AdvancedSearchOption): string {
    return `${option.type}:${option.storeNo || option.pkeynew || this.normalize(option.rawName || option.name)}`;
  }

  private filterOptions(value: string): AdvancedSearchOption[] {
    const normalizedValue = this.normalize(value);
    if (!normalizedValue) return [];

    const results: AdvancedSearchOption[] = [];
    const seen = new Set<string>();
    for (const indexedOption of this.indexedOptions) {
      const option = indexedOption.option;
      const matches = indexedOption.searchText.includes(normalizedValue);
      const key = this.optionKey(option);
      if (matches && !seen.has(key)) {
        seen.add(key);
        results.push(option);
        if (results.length >= 20) break;
      }
    }
    return results;
  }

  private normalize(value: string): string {
    return (value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  }
}
