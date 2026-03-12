import { SiDriver, SiPortAdapter, CommStatus } from '../SiDriver';
import { SiCardData } from '../SiDataFrame';
import {
  startup_answer,
  ok_ext_protocol_answer,
  no_ext_protocol_answer,
  no_handshake_answer,
  si6_64_punches_answer,
  sicard5_detected,
  sicard5_data,
  sicard5_removed,
} from './fixtures';
import { SiMessage } from '../SiMessage';

/** Feed a complete SiMessage into the driver as serial data */
function feedMessage(driver: SiDriver, msg: SiMessage): void {
  driver.handleSerialData(msg.sequence);
}

/**
 * Create a mock port that feeds queued responses via process.nextTick
 * each time the driver writes. This keeps timing deterministic.
 */
function createMockPort(driver: () => SiDriver) {
  const responseQueue: SiMessage[] = [];
  const port: SiPortAdapter & {
    write: jest.Mock;
    setBaudRate: jest.Mock;
    close: jest.Mock;
  } = {
    write: jest.fn().mockImplementation(async () => {
      const resp = responseQueue.shift();
      if (resp) {
        process.nextTick(() => feedMessage(driver(), resp));
      }
    }),
    setBaudRate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  };
  return { port, responseQueue };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Startup Tests ──────────────────────────────────────────────────────────

describe('SiDriver startup', () => {
  test('successful startup emits STARTING then ON then READY', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    // Queue the 3 responses expected during startup (4th write is BEEP, no response)
    responseQueue.push(startup_answer, ok_ext_protocol_answer, si6_64_punches_answer);

    driverRef = new SiDriver(port, 0);
    const statuses: CommStatus[] = [];
    driverRef.onStatus((s) => statuses.push(s));

    const startPromise = driverRef.start();
    await waitMs(100);

    expect(statuses).toContain('STARTING');
    expect(statuses).toContain('ON');
    expect(statuses).toContain('READY');
    expect(port.setBaudRate).toHaveBeenCalledWith(38400);

    driverRef.stop();
    await startPromise.catch(() => {});
  }, 10000);

  test('rejects missing extended protocol', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    // startup_answer OK, but protocol config has no extended protocol
    responseQueue.push(startup_answer, no_ext_protocol_answer);

    driverRef = new SiDriver(port, 0);
    const statuses: string[] = [];
    driverRef.onStatus((s, msg) => statuses.push(msg || s));

    const startPromise = driverRef.start();
    await startPromise.catch(() => {});

    expect(statuses.some((s) => s.includes('extended protocol'))).toBe(true);
  }, 10000);

  test('rejects missing handshake mode', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    responseQueue.push(startup_answer, no_handshake_answer);

    driverRef = new SiDriver(port, 0);
    const statuses: string[] = [];
    driverRef.onStatus((s, msg) => statuses.push(msg || s));

    const startPromise = driverRef.start();
    await startPromise.catch(() => {});

    expect(statuses.some((s) => s.includes('handshake mode'))).toBe(true);
  }, 10000);
});

// ─── Card Dispatch Tests ──────────────────────────────────────────────────

describe('SiDriver card dispatch', () => {
  test('Si5 card read emits cardRead with parsed data', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    // Startup responses
    responseQueue.push(startup_answer, ok_ext_protocol_answer, si6_64_punches_answer);

    driverRef = new SiDriver(port, 0);
    let cardData: SiCardData | null = null;
    driverRef.onCardRead((card) => { cardData = card; });

    const startPromise = driverRef.start();
    await waitMs(100);

    // Now the driver is in READY state, waiting for card detection.
    // Feed Si5 card detected, then queue the card data response for when driver writes READ_SICARD_5
    responseQueue.push(sicard5_data);
    feedMessage(driverRef, sicard5_detected);
    await waitMs(50);

    // Feed card removal (driver waits for it after ACK)
    feedMessage(driverRef, sicard5_removed);
    await waitMs(50);

    expect(cardData).not.toBeNull();
    expect(cardData!.cardSeries).toBe('SiCard 5');
    expect(cardData!.punchCount).toBe(10);

    driverRef.stop();
    await startPromise.catch(() => {});
  }, 10000);

  test('stop() terminates the driver loop', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    responseQueue.push(startup_answer, ok_ext_protocol_answer, si6_64_punches_answer);

    driverRef = new SiDriver(port, 0);
    const statuses: CommStatus[] = [];
    driverRef.onStatus((s) => statuses.push(s));

    const startPromise = driverRef.start();
    await waitMs(100);

    driverRef.stop();
    await startPromise.catch(() => {});

    expect(statuses).toContain('OFF');
    expect(port.close).toHaveBeenCalled();
  }, 10000);
});

// ─── Serial Framing Tests ───────────────────────────────────────────────────

describe('SiDriver serial framing', () => {
  test('handles chunked data (message split across two chunks)', async () => {
    let driverRef: SiDriver;
    const { port, responseQueue } = createMockPort(() => driverRef);

    driverRef = new SiDriver(port, 0);
    const statuses: CommStatus[] = [];
    driverRef.onStatus((s) => statuses.push(s));

    // Override write mock: feed first response as two chunks, rest normally
    let writeCount = 0;
    const responses = [startup_answer, ok_ext_protocol_answer, si6_64_punches_answer];
    port.write.mockImplementation(async () => {
      const resp = responses[writeCount++];
      if (resp) {
        process.nextTick(() => {
          if (writeCount === 1) {
            // Split first response into two chunks
            const raw = resp.sequence;
            const mid = Math.floor(raw.length / 2);
            driverRef.handleSerialData(raw.subarray(0, mid));
            driverRef.handleSerialData(raw.subarray(mid));
          } else {
            feedMessage(driverRef, resp);
          }
        });
      }
    });

    const startPromise = driverRef.start();
    await waitMs(200);

    expect(statuses).toContain('ON');

    driverRef.stop();
    await startPromise.catch(() => {});
  }, 10000);
});
