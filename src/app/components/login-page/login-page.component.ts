import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MatDialogRef } from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { MessageDialogComponent } from '../message-dialog/message-dialog.component';

@Component({
  standalone: false,
  selector: 'app-login-page',
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
})
export class LoginPageComponent {
  authForm: FormGroup;
  errorMessage = '';
  verificationSent = false;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private dialogRef: MatDialogRef<LoginPageComponent>,
    public dialog: MatDialog,
  ) {
    // 只需要手機號碼，使用台灣手機號碼正則表達式驗證
    this.authForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern('^09\\d{8}$')]],
      code: ['', [Validators.required, Validators.pattern('^\\d{6}$')]]
    });
    this.f['code'].disable();
  }

  async submitForm() {
    const control = this.verificationSent ? this.f['code'] : this.f['phone'];
    if (control.invalid) {
      control.markAsTouched();
      this.errorMessage = this.verificationSent
        ? '請輸入簡訊中的 6 碼驗證碼。'
        : '請輸入有效的手機號碼（例如：0912345678）。';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    try {
      if (!this.verificationSent) {
        await this.authService.sendVerificationCode(this.f['phone'].value, 'phone-recaptcha');
        this.verificationSent = true;
        this.f['phone'].disable();
        this.f['code'].enable();
      } else {
        await this.authService.verifyCode(this.f['code'].value);
        this.close(true);
      }
    } catch (error: any) {
      console.error('Phone auth error:', error?.code || error);
      this.errorMessage = this.getAuthErrorMessage(error?.code);
    } finally {
      this.isSubmitting = false;
    }
  }

  editPhone(): void {
    this.authService.resetVerification();
    this.verificationSent = false;
    this.f['code'].reset();
    this.f['code'].disable();
    this.f['phone'].enable();
    this.errorMessage = '';
  }

  close(data: boolean) {
    if (!data) this.authService.resetVerification();
    this.dialogRef.close(data);
  }

  get f() {
    return this.authForm.controls;
  }

  private getAuthErrorMessage(code?: string): string {
    switch (code) {
      case 'auth/invalid-verification-code': return '驗證碼不正確，請重新輸入。';
      case 'auth/code-expired': return '驗證碼已過期，請重新發送。';
      case 'auth/too-many-requests': return '嘗試次數過多，請稍後再試。';
      case 'auth/quota-exceeded': return '簡訊驗證服務目前已達上限，請稍後再試。';
      default: return '驗證失敗，請確認網路狀態後再試一次。';
    }
  }
}
