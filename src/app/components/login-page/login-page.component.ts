import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  standalone: false,
  selector: 'app-login-page',
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
})
export class LoginPageComponent implements AfterViewInit, OnDestroy {
  authForm: FormGroup;
  errorMessage = '';
  verificationSent = false;
  isSubmitting = false;
  captchaLoading = true;
  captchaReady = false;
  private destroyed = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private dialogRef: MatDialogRef<LoginPageComponent>,
    private cdr: ChangeDetectorRef
  ) {
    // 只需要手機號碼，使用台灣手機號碼正則表達式驗證
    this.authForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern('^09\\d{8}$')]],
      code: ['', [Validators.required, Validators.pattern('^\\d{6}$')]]
    });
    this.f['code'].disable();
  }

  ngAfterViewInit(): void {
    void this.prepareCaptcha();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.authService.resetVerification();
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
      if (!this.verificationSent) {
        this.authService.resetVerification();
        void this.prepareCaptcha();
      }
    } finally {
      this.isSubmitting = false;
      if (!this.destroyed) this.cdr.detectChanges();
    }
  }

  editPhone(): void {
    this.authService.resetVerification();
    this.verificationSent = false;
    this.f['code'].reset();
    this.f['code'].disable();
    this.f['phone'].enable();
    this.errorMessage = '';
    void this.prepareCaptcha();
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
      case 'auth/captcha-check-failed': return '機器人驗證未完成或已過期，請重新驗證。';
      case 'auth/missing-app-credential':
      case 'auth/invalid-app-credential': return '無法完成網站安全驗證，請重新整理後再試。';
      case 'auth/unauthorized-domain': return '目前網址尚未獲准使用登入服務，請聯絡網站管理者。';
      case 'auth/network-request-failed': return '安全驗證連線中斷，請確認網路後重新驗證。';
      case 'auth/invalid-phone-number': return '手機號碼格式不正確，請輸入 09 開頭的 10 碼號碼。';
      default: return '驗證失敗，請確認網路狀態後再試一次。';
    }
  }

  private async prepareCaptcha(): Promise<void> {
    this.captchaLoading = true;
    this.captchaReady = false;
    try {
      await this.authService.prepareRecaptcha('phone-recaptcha', solved => {
        if (this.destroyed) return;
        this.captchaReady = solved;
        this.errorMessage = solved ? '' : '機器人驗證已過期，請重新完成驗證。';
        this.cdr.detectChanges();
      });
    } catch (error) {
      console.error('Unable to render phone reCAPTCHA:', error);
      this.errorMessage = '安全驗證載入失敗，請確認網路後重新開啟登入視窗。';
    } finally {
      this.captchaLoading = false;
      if (!this.destroyed) this.cdr.detectChanges();
    }
  }
}
