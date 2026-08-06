import { RoundPipe } from './round.pipe';

describe('RoundPipe', () => {
  it('create an instance', () => {
    const pipe = new RoundPipe();
    expect(pipe).toBeTruthy();
  });

  it('returns a rounded price without currency text', () => {
    const pipe = new RoundPipe();
    expect(pipe.transform(45.4, -1)).toBe('45');
    expect(pipe.transform(45.6, -1)).toBe('46');
  });
});
