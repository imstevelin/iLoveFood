import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { LlmRequestService } from './llm-request.service';

describe('LlmRequestService', () => {
  let service: LlmRequestService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(LlmRequestService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
