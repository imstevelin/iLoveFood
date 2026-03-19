import { Directive, ElementRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, NgZone } from '@angular/core';
import { animate } from 'motion';

@Directive({
  selector: '[appMotion]',
  standalone: true
})
export class MotionDirective implements OnInit, OnChanges, OnDestroy {
  @Input() initial: any;
  @Input() animate: any;
  @Input() transition: any = { type: 'spring', stiffness: 300, damping: 30 };
  
  private controls: any = null;

  constructor(private el: ElementRef, private zone: NgZone) {}

  ngOnInit() {
    // Only apply initial styles if we're not about to animate them immediately
    // or apply them as a base state.
    if (this.initial && !this.animate) {
      Object.assign(this.el.nativeElement.style, this.initial);
    }
    
    // Hint browser for GPU acceleration
    this.el.nativeElement.style.willChange = 'transform, opacity';
    
    // If we have an animation, start it.
    // We'll use the 'initial' values as the starting point for the animation if provided.
    if (this.animate) {
      this.playAnimation(true);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['animate'] && !changes['animate'].firstChange) {
      this.playAnimation(false);
    }
  }

  playAnimation(isInitial: boolean) {
    if (!this.animate) return;
    this.zone.runOutsideAngular(() => {
      if (this.controls && typeof this.controls.stop === 'function') {
        this.controls.stop();
      }
      
      const target = { ...this.animate };
      const options = { ...this.transition };

      // If this is the initial animation and we have initial values,
      // we need to set them as the 'from' state.
      // In vanilla motion, we can do this by setting the style immediately before animating.
      if (isInitial && this.initial) {
        Object.assign(this.el.nativeElement.style, this.initial);
      }

      // Auto-handle visibility for elements with opacity animations
      if (target.opacity !== undefined) {
        if (target.opacity > 0) {
          this.el.nativeElement.style.visibility = 'visible';
          this.el.nativeElement.style.pointerEvents = 'auto';
        }
      }

      this.controls = animate(this.el.nativeElement, target, {
        ...options,
        onComplete: () => {
          if (target.opacity === 0) {
            this.el.nativeElement.style.visibility = 'hidden';
            this.el.nativeElement.style.pointerEvents = 'none';
          }
          // Cleanup initial scale/transform if they were meant to be transient
          // but usually keeping the target state is desired.
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.controls && typeof this.controls.stop === 'function') {
      this.controls.stop();
    }
  }
}
