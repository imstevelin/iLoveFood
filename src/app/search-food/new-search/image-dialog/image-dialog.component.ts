import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-image-dialog',
  templateUrl: './image-dialog.component.html',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['./image-dialog.component.scss']
})
export class ImageDialogComponent {
  readonly fallbackImage = 'assets/no-image.jpeg';
  imageSrc = this.data.image;
  isLoaded = false;

  constructor(
    public dialogRef: MatDialogRef<ImageDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { image: string }
  ) {}

  onImageLoad(): void {
    this.isLoaded = true;
  }

  onImageError(): void {
    if (this.imageSrc !== this.fallbackImage) {
      this.imageSrc = this.fallbackImage;
      this.isLoaded = false;
      return;
    }
    this.isLoaded = true;
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
