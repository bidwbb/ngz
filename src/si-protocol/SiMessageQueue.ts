/**
 * Promise-based message queue with timeout support for SI protocol communication.
 *
 * Used by SiDriver to await protocol responses from the station.
 */

import { SiMessage } from './SiMessage';

export class TimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TimeoutError';
  }
}

export class InvalidMessageError extends Error {
  constructor(
    public readonly receivedMessage: SiMessage,
    expectedCommand?: number
  ) {
    super(
      `Invalid message: got ${receivedMessage.toString()}` +
        (expectedCommand !== undefined
          ? ` (expected command 0x${expectedCommand.toString(16)})`
          : '')
    );
    this.name = 'InvalidMessageError';
  }
}

export class SiMessageQueue {
  private queue: SiMessage[] = [];
  private waiters: Array<{
    resolve: (msg: SiMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  push(msg: SiMessage): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    } else {
      this.queue.push(msg);
    }
  }

  take(timeoutMs: number = 2000): Promise<SiMessage> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new TimeoutError('Message timeout'));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  /** Wait indefinitely for the next message */
  takeForever(): Promise<SiMessage> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {}, 2_147_483_647); // effectively forever
      this.waiters.push({
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: () => {},
        timer,
      });
    });
  }

  clear(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('Queue cleared'));
    }
    this.waiters = [];
    this.queue = [];
  }
}
