import { parseSi6, NO_TIME } from '../SiDataFrame';
import { sicard6_b0_data, sicard6_b6_data, sicard6_b7_data } from './fixtures';

describe('Si6DataFrame', () => {
  const card = parseSi6(
    [sicard6_b0_data, sicard6_b6_data, sicard6_b7_data],
    0
  );

  test('extracts card number 821003', () => {
    expect(card.cardNumber).toBe('821003');
  });

  test('card series is SiCard 6', () => {
    expect(card.cardSeries).toBe('SiCard 6');
  });

  test('has 5 punches', () => {
    expect(card.punchCount).toBe(5);
    expect(card.punches.length).toBe(5);
  });

  test('punch codes are valid control numbers', () => {
    for (const punch of card.punches) {
      expect(punch.code).toBeGreaterThan(0);
      expect(punch.code).toBeLessThan(512);
    }
  });

  test('first punch is control 31', () => {
    expect(card.punches[0].code).toBe(31);
  });

  test('last punch is control 35', () => {
    expect(card.punches[4].code).toBe(35);
  });

  test('punch timestamps are positive', () => {
    for (const punch of card.punches) {
      expect(punch.timestampMs).toBeGreaterThan(0);
    }
  });

  test('start, finish, and check times are present', () => {
    expect(card.startTime).not.toBe(NO_TIME);
    expect(card.finishTime).not.toBe(NO_TIME);
    expect(card.checkTime).not.toBe(NO_TIME);
  });

  test('times follow logical order: check < start < finish', () => {
    expect(card.checkTime).toBeLessThanOrEqual(card.startTime);
    expect(card.startTime).toBeLessThan(card.finishTime);
  });
});
