import { Component, OnInit, Inject, Renderer2 } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'friendly-time';

  constructor(
    @Inject(DOCUMENT) private document: Document,
    private renderer: Renderer2
  ) {}

  ngOnInit() {
    this.injectUmamiScript();
  }

  private injectUmamiScript() {
    if ((environment as any).umamiScript) {
      const tempDiv = this.document.createElement('div');
      tempDiv.innerHTML = (environment as any).umamiScript;
      
      const scriptElements = tempDiv.getElementsByTagName('script');
      Array.from(scriptElements).forEach(originalScript => {
        const newScript = this.document.createElement('script');
        Array.from(originalScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });
        newScript.text = originalScript.text;
        this.document.head.appendChild(newScript);
      });
    }
  }
}
