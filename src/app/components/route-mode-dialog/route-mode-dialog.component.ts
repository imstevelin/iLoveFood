import { Component, Inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { COMMA, ENTER } from '@angular/cdk/keycodes';

export interface RouteDialogData {
  originalUrl: string;
  allOptions: { name: string, type: 'category' | 'product', addr?: string }[];
}

@Component({
  selector: 'app-route-mode-dialog',
  standalone: true,
  imports: [
    CommonModule, 
    MatDialogModule, 
    MatButtonModule, 
    FormsModule, 
    ReactiveFormsModule, 
    MatAutocompleteModule, 
    MatChipsModule, 
    MatIconModule
  ],
  templateUrl: './route-mode-dialog.component.html',
  styleUrls: ['./route-mode-dialog.component.scss']
})
export class RouteModeDialogComponent implements OnInit {
  separatorKeysCodes: number[] = [ENTER, COMMA];
  keywordCtrl = new FormControl('');
  filteredOptions$: Observable<{ name: string, type: 'category' | 'product', addr?: string }[]>;
  selectedKeywords: string[] = [];

  @ViewChild('keywordInput') keywordInput!: ElementRef<HTMLInputElement>;

  constructor(
    public dialogRef: MatDialogRef<RouteModeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: RouteDialogData
  ) {
    this.filteredOptions$ = this.keywordCtrl.valueChanges.pipe(
      startWith(''),
      map(value => this._filter(value || ''))
    );
  }

  ngOnInit() {}

  removeKeyword(keyword: string): void {
    const index = this.selectedKeywords.indexOf(keyword);
    if (index >= 0) {
      this.selectedKeywords.splice(index, 1);
    }
  }

  selected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value;
    if (!this.selectedKeywords.includes(value)) {
      this.selectedKeywords.push(value);
    }
    this.keywordInput.nativeElement.value = '';
    this.keywordCtrl.setValue(null);
  }

  addToken(event: any): void {
    const value = (event.value || '').trim();
    if (value && !this.selectedKeywords.includes(value)) {
      this.selectedKeywords.push(value);
    }
    event.chipInput!.clear();
    this.keywordCtrl.setValue(null);
  }

  private _filter(value: string): { name: string, type: 'category' | 'product', addr?: string }[] {
    const filterValue = value.toLowerCase();
    if (!filterValue) return [];
    
    // 從 `allOptions` 中篩選並去重
    const results = [];
    const seen = new Set<string>();
    
    for (const opt of (this.data.allOptions || [])) {
      if (opt.name.toLowerCase().includes(filterValue) && !seen.has(opt.name)) {
        seen.add(opt.name);
        results.push(opt);
        if (results.length >= 10) break; // 最多顯示 10 筆
      }
    }
    
    // 如果找不到精確相符，且輸入值有意義，也推入一個手動新增的選項
    if (results.length === 0 && filterValue.length > 0) {
      results.push({ name: value, type: 'product' as const, addr: '自訂關鍵字' });
    }
    
    return results;
  }

  onCancel(): void {
    this.dialogRef.close('CANCEL');
  }

  selectMode(mode: 'DRIVING' | 'BICYCLING'): void {
    this.dialogRef.close({ mode, productKeywords: this.selectedKeywords });
  }
}
