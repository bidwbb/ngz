import { SiMessage } from '../SiMessage';
import { SiMessageQueue, TimeoutError } from '../SiMessageQueue';

function makeMsg(cmd: number): SiMessage {
  return new SiMessage(Buffer.from([0x02, cmd, 0x00, 0x00, 0x00, 0x03]));
}

describe('SiMessageQueue', () => {
  let queue: SiMessageQueue;

  beforeEach(() => {
    queue = new SiMessageQueue();
  });

  afterEach(() => {
    queue.clear();
  });

  test('push then take returns message immediately', async () => {
    const msg = makeMsg(0xf0);
    queue.push(msg);
    const result = await queue.take(100);
    expect(result).toBe(msg);
  });

  test('take before push resolves when message arrives', async () => {
    const msg = makeMsg(0xf0);
    const promise = queue.take(1000);
    queue.push(msg);
    const result = await promise;
    expect(result).toBe(msg);
  });

  test('take times out with TimeoutError', async () => {
    await expect(queue.take(50)).rejects.toThrow(TimeoutError);
  });

  test('takeForever waits until message arrives', async () => {
    const msg = makeMsg(0xe5);
    const promise = queue.takeForever();
    setTimeout(() => queue.push(msg), 20);
    const result = await promise;
    expect(result).toBe(msg);
  });

  test('clear rejects all pending waiters', async () => {
    const promise = queue.take(5000);
    queue.clear();
    await expect(promise).rejects.toThrow('Queue cleared');
  });

  test('multiple waiters resolve in FIFO order', async () => {
    const p1 = queue.take(1000);
    const p2 = queue.take(1000);

    const msg1 = makeMsg(0x01);
    const msg2 = makeMsg(0x02);
    queue.push(msg1);
    queue.push(msg2);

    expect(await p1).toBe(msg1);
    expect(await p2).toBe(msg2);
  });

  test('queued messages are returned in order', async () => {
    const msg1 = makeMsg(0x01);
    const msg2 = makeMsg(0x02);
    queue.push(msg1);
    queue.push(msg2);

    expect(await queue.take(100)).toBe(msg1);
    expect(await queue.take(100)).toBe(msg2);
  });
});
