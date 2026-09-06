import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MotionDirective } from '../../directives/motion.directive';
import { AuthService } from '../../services/auth.service';
import { LoginPageComponent } from './login-page.component';

describe('LoginPageComponent', () => {
  let component: LoginPageComponent;
  let fixture: ComponentFixture<LoginPageComponent>;
  let authService: jasmine.SpyObj<AuthService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<LoginPageComponent>>;

  beforeEach(async () => {
    authService = jasmine.createSpyObj('AuthService', ['login', 'register']);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    await TestBed.configureTestingModule({
      declarations: [LoginPageComponent],
      imports: [ReactiveFormsModule, MatDialogModule, MotionDirective],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AuthService, useValue: authService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('logs in directly without a CAPTCHA or SMS step', async () => {
    authService.login.and.resolveTo({ uid: 'u1', username: 'friendly', displayName: 'friendly' });
    component.authForm.patchValue({ username: 'friendly', password: 'a-safe-password-1' });

    await component.submitForm();

    expect(authService.login).toHaveBeenCalledWith('friendly', 'a-safe-password-1');
    expect(dialogRef.close).toHaveBeenCalledWith({ uid: 'u1', username: 'friendly', displayName: 'friendly' });
    expect(fixture.nativeElement.querySelector('.captcha-section')).toBeNull();
  });

  it('only explains the benefit of signing in', () => {
    const intro = fixture.nativeElement.querySelector('.login-intro') as HTMLElement;

    expect(intro.textContent?.trim()).toBe('登入即可收藏喜愛門市，並在不同裝置同步。');
    expect(fixture.nativeElement.querySelector('.security-note')).toBeNull();
  });

  it('does not register when the password confirmation differs', async () => {
    component.setMode(true);
    component.authForm.patchValue({
      username: 'friendly',
      password: 'a-safe-password-1',
      confirmPassword: 'a-different-password-2'
    });

    await component.submitForm();

    expect(authService.register).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('不一致');
  });
});
