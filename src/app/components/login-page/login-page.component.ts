import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';
import { AuthService, LocalUser } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-login-page',
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
})
export class LoginPageComponent {
  authForm: FormGroup;
  isRegisterMode = false;
  isSubmitting = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private dialogRef: MatDialogRef<LoginPageComponent, LocalUser | false>
  ) {
    this.authForm = this.fb.group({
      username: ['', [
        Validators.required,
        Validators.pattern('^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$')
      ]],
      password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
      confirmPassword: ['']
    });
  }

  async submitForm(): Promise<void> {
    this.authForm.markAllAsTouched();
    if (this.authForm.invalid) {
      this.errorMessage = '請確認帳號與密碼格式。';
      return;
    }
    if (this.isRegisterMode && this.f['password'].value !== this.f['confirmPassword'].value) {
      this.errorMessage = '兩次輸入的密碼不一致。';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    try {
      const username = this.f['username'].value;
      const password = this.f['password'].value;
      const user = this.isRegisterMode
        ? await this.authService.register(username, password)
        : await this.authService.login(username, password);
      this.dialogRef.close(user);
    } catch (error) {
      this.errorMessage = this.getAuthErrorMessage(error);
    } finally {
      this.isSubmitting = false;
    }
  }

  setMode(register: boolean): void {
    if (this.isSubmitting || this.isRegisterMode === register) return;
    this.isRegisterMode = register;
    this.errorMessage = '';
    this.f['password'].reset();
    this.f['confirmPassword'].reset();
  }

  close(): void {
    this.dialogRef.close(false);
  }

  get f() {
    return this.authForm.controls;
  }

  private getAuthErrorMessage(error: unknown): string {
    const code = error instanceof HttpErrorResponse
      ? error.error?.code
      : undefined;
    switch (code) {
      case 'account-exists': return '此帳號已被使用，請直接登入或更換帳號。';
      case 'invalid-credentials': return '帳號或密碼不正確。';
      case 'invalid-username': return '帳號格式不正確。';
      case 'invalid-password': return '密碼長度需為 10 到 128 個字元。';
      case 'too-many-attempts': return '嘗試次數過多，請一分鐘後再試。';
      default: return '目前無法完成登入，請確認網路後再試一次。';
    }
  }
}
