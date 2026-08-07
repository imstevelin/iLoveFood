import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import {
  DISCOUNT_SCHEDULES,
  DiscountChain,
  DiscountTimeStatus,
  getDiscountTimeSnapshot
} from 'src/app/utils/discount-schedule';

@Component({
  selector: 'app-discount-time-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './discount-time-dialog.component.html',
  styleUrls: ['./discount-time-dialog.component.scss']
})
export class DiscountTimeDialogComponent implements OnInit, OnDestroy {
  readonly schedules = DISCOUNT_SCHEDULES;
  readonly chains: DiscountChain[] = ['7-11', '全家'];
  statuses: DiscountTimeStatus[] = [];
  currentTaipeiTimeLabel = '';
  private timer: number | null = null;

  constructor(public dialogRef: MatDialogRef<DiscountTimeDialogComponent>) {}

  ngOnInit(): void {
    this.updateTime();
    this.timer = window.setInterval(() => this.updateTime(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  statusFor(chain: DiscountChain): DiscountTimeStatus | undefined {
    return this.statuses.find(status => status.chain === chain);
  }

  isActivePeriod(chain: DiscountChain, startMinute: number): boolean {
    return this.statusFor(chain)?.activePeriod?.startMinute === startMinute;
  }

  close(): void {
    this.dialogRef.close();
  }

  private updateTime(): void {
    const snapshot = getDiscountTimeSnapshot();
    this.currentTaipeiTimeLabel = snapshot.timeLabel;
    this.statuses = snapshot.statuses;
  }
}
