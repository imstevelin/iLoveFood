import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface RouteDialogData {
  originalUrl: string;
}

@Component({
  selector: 'app-route-mode-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './route-mode-dialog.component.html',
  styleUrls: ['./route-mode-dialog.component.scss']
})
export class RouteModeDialogComponent {
  
  constructor(
    public dialogRef: MatDialogRef<RouteModeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: RouteDialogData
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  selectMode(mode: 'DRIVING' | 'BICYCLING'): void {
    this.dialogRef.close(mode);
  }
}
