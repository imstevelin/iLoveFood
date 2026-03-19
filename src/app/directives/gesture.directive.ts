import { Directive, ElementRef, Output, EventEmitter, OnInit, OnDestroy, NgZone } from '@angular/core';
import { DragGesture } from '@use-gesture/vanilla';

@Directive({
  selector: '[appGesture]',
  standalone: true
})
export class GestureDirective implements OnInit, OnDestroy {
  @Output() onDrag = new EventEmitter<any>();
  private gesture: any;

  constructor(private el: ElementRef, private zone: NgZone) {}

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.gesture = new DragGesture(this.el.nativeElement, (state) => {
        this.zone.run(() => {
          this.onDrag.emit(state);
        });
      }, {
        filterTaps: true
      });
    });
  }

  ngOnDestroy() {
    if (this.gesture) this.gesture.destroy();
  }
}
