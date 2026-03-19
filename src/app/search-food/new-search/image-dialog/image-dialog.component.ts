import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MotionDirective } from 'src/app/directives/motion.directive';

@Component({
  selector: 'app-image-dialog',
  templateUrl: './image-dialog.component.html',
  standalone: true,
  imports: [CommonModule, MotionDirective],
  styleUrls: ['./image-dialog.component.scss']
})
export class ImageDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ImageDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { image: string }
  ) {}

  closeDialog(): void {
    this.dialogRef.close();
  }
}
