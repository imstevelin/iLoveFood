import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';

import { SearchFoodModule } from './search-food/search-food.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MessageDialogComponent } from './components/message-dialog/message-dialog.component';
import { LoginPageComponent } from './components/login-page/login-page.component'

import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAnalytics, getAnalytics } from '@angular/fire/analytics';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';

import { environment } from 'src/environments/environment';
import { ChatbotComponent } from './chatbot/chatbot.component';
import { MotionDirective } from './directives/motion.directive';
import { GestureDirective } from './directives/gesture.directive';

@NgModule({
  declarations: [AppComponent, MessageDialogComponent, LoginPageComponent],
  bootstrap: [AppComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    SearchFoodModule,
    BrowserAnimationsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatOptionModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatButtonModule,
    FormsModule,
    ReactiveFormsModule,
    AngularFireModule.initializeApp(environment.firebaseConfig),  // 初始化 Firebase
    AngularFireDatabaseModule,
    MatDividerModule,
    MatCardModule,
    MatMenuModule,
    ChatbotComponent,
    MotionDirective,
    GestureDirective
  ],
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),  // 提供 Firebase 初始化
    provideAnalytics(() => getAnalytics()),
  ],
})
export class AppModule {}
