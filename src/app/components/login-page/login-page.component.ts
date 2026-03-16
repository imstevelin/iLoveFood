import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MatDialogRef } from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { MessageDialogComponent } from '../message-dialog/message-dialog.component';

@Component({
  selector: 'app-login-page',
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
})
export class LoginPageComponent {
  authForm: FormGroup;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private dialogRef: MatDialogRef<LoginPageComponent>,
    public dialog: MatDialog,
  ) {
    // 只需要手機號碼，使用台灣手機號碼正則表達式驗證
    this.authForm = this.fb.group({
      phone: ['', [Validators.required, Validators.pattern('^09\\d{8}$')]]
    });
  }

  submitForm() {
    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      this.errorMessage = '請輸入有效的手機號碼 (例如: 0912345678)';
      return;
    }

    const { phone } = this.authForm.value;
    
    // 使用 authService 登入並儲存到 localStorage
    this.authService.login(phone).then(user => {
      this.close(true);
    }).catch(error => {
      console.error('Login error:', error);
      this.errorMessage = '登入失敗，請稍後再試。';
    });
  }

  close(data: boolean) {
    this.dialogRef.close(data);
  }

  get f() {
    return this.authForm.controls;
  }
}
