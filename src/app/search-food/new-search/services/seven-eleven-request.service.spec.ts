import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { SevenElevenRequestService } from './seven-eleven-request.service';

describe('SevenElevenRequestService', () => {
  let service: SevenElevenRequestService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(SevenElevenRequestService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
