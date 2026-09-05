import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MotionDirective } from '../../directives/motion.directive';
import { AuthService } from '../../services/auth.service';

import { LoginPageComponent } from './login-page.component';

describe('LoginPageComponent', () => {
  let component: LoginPageComponent;
  let fixture: ComponentFixture<LoginPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoginPageComponent],
      imports: [ReactiveFormsModule, MatDialogModule, MotionDirective],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        {
          provide: AuthService,
          useValue: jasmine.createSpyObj('AuthService', ['prepareRecaptcha', 'sendVerificationCode', 'verifyCode', 'resetVerification'])
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
    const authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    authService.prepareRecaptcha.and.resolveTo();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
