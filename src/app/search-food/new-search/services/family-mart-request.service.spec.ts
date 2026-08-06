import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { FamilyMartRequestService } from './family-mart-request.service';

describe('FamilyMartRequestService', () => {
  let service: FamilyMartRequestService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(FamilyMartRequestService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
