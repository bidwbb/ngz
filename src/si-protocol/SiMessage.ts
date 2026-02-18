/**
 * SPORTident message frame.
 *
 * Ported from GecoSI (MIT license) - net.gecosi.internal.SiMessage
 * Original author: Simon Denier
 */

import { crc } from './crc';

// ─── Basic protocol bytes ──────────────────────────────────────────────────────

export const WAKEUP = 0xff;
export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;

// ─── Command instructions ──────────────────────────────────────────────────────

export const GET_SYSTEM_VALUE = 0x83;
export const SET_MASTER_MODE = 0xf0;
export const DIRECT_MODE = 0x4d;
export const BEEP = 0xf9;

// ─── Card detected / removed ───────────────────────────────────────────────────

export const SI_CARD_5_DETECTED = 0xe5;
export const SI_CARD_6_PLUS_DETECTED = 0xe6;
export const SI_CARD_8_PLUS_DETECTED = 0xe8;
export const SI_CARD_REMOVED = 0xe7;

// ─── Card readout instructions ─────────────────────────────────────────────────

export const GET_SI_CARD_5 = 0xb1;
export const GET_SI_CARD_6_BN = 0xe1;
export const GET_SI_CARD_8_PLUS_BN = 0xef;

// ─── SiCard special data ───────────────────────────────────────────────────────

export const SI3_NUMBER_INDEX = 5;
export const SI_CARD_10_PLUS_SERIES = 0x0f;

// ─── Metadata size (STX + cmd + len + ... + CRC + ETX) ─────────────────────────

export const METADATA_SIZE = 6;
export const MAX_MESSAGE_SIZE = 139;

// ─── SiMessage class ───────────────────────────────────────────────────────────

export class SiMessage {
  private readonly _sequence: Buffer;

  constructor(data: Buffer | number[]) {
    this._sequence = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  get sequence(): Buffer {
    return this._sequence;
  }

  /** Byte at position i (unsigned) */
  byteAt(i: number): number {
    return this._sequence[i];
  }

  /** Command byte (position 1) */
  get commandByte(): number {
    return this._sequence[1];
  }

  /** Start byte (position 0) */
  get startByte(): number {
    return this._sequence[0];
  }

  /** End byte (last position) */
  get endByte(): number {
    return this._sequence[this._sequence.length - 1];
  }

  /** Data portion of the frame (between STX/ETX, excluding CRC) */
  get data(): Buffer {
    const cmdLength = this._sequence.length - 4;
    return this._sequence.subarray(1, 1 + cmdLength);
  }

  /** Extract the CRC embedded in the message */
  get extractedCRC(): number {
    const i = this._sequence.length;
    return ((this._sequence[i - 3] << 8) & 0xffff) | (this._sequence[i - 2] & 0xff);
  }

  /** Compute the CRC from the data portion */
  get computedCRC(): number {
    return crc(this.data);
  }

  /** Check that the CRC is valid */
  get validCRC(): boolean {
    return this.computedCRC === this.extractedCRC;
  }

  /** Full validity check: starts with STX, ends with ETX, valid CRC */
  get valid(): boolean {
    return this.startByte === STX && this.endByte === ETX && this.validCRC;
  }

  /** Check validity and that command matches expected */
  check(command: number): boolean {
    return this.valid && this.commandByte === command;
  }

  /** Hex string representation for logging */
  toString(): string {
    return Array.from(this._sequence)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  }
}

// ─── Pre-built command messages ────────────────────────────────────────────────

export const STARTUP_SEQUENCE = new SiMessage([
  WAKEUP, STX, STX, SET_MASTER_MODE, 0x01, DIRECT_MODE, 0x6d, 0x0a, ETX,
]);

export const GET_PROTOCOL_CONFIGURATION = new SiMessage([
  STX, GET_SYSTEM_VALUE, 0x02, 0x74, 0x01, 0x04, 0x14, ETX,
]);

export const GET_CARDBLOCKS_CONFIGURATION = new SiMessage([
  STX, GET_SYSTEM_VALUE, 0x02, 0x33, 0x01, 0x16, 0x11, ETX,
]);

export const ACK_SEQUENCE = new SiMessage([ACK]);

export const BEEP_TWICE = new SiMessage([
  STX, BEEP, 0x01, 0x02, 0x14, 0x0a, ETX,
]);

// ─── Card-read commands ────────────────────────────────────────────────────────

export const READ_SICARD_5 = new SiMessage([
  STX, GET_SI_CARD_5, 0x00, GET_SI_CARD_5, 0x00, ETX,
]);

export const READ_SICARD_6_B0 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x00, 0x46, 0x0a, ETX,
]);
export const READ_SICARD_6_B6 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x06, 0x40, 0x0a, ETX,
]);
export const READ_SICARD_6_B7 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x07, 0x41, 0x0a, ETX,
]);
export const READ_SICARD_6_PLUS_B2 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x02, 0x44, 0x0a, ETX,
]);
export const READ_SICARD_6_PLUS_B3 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x03, 0x45, 0x0a, ETX,
]);
export const READ_SICARD_6_PLUS_B4 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x04, 0x42, 0x0a, ETX,
]);
export const READ_SICARD_6_PLUS_B5 = new SiMessage([
  STX, GET_SI_CARD_6_BN, 0x01, 0x05, 0x43, 0x0a, ETX,
]);

export const READ_SICARD_8_PLUS_B0 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x00, 0xe2, 0x09, ETX,
]);
export const READ_SICARD_8_PLUS_B1 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x01, 0xe3, 0x09, ETX,
]);

export const READ_SICARD_10_PLUS_B0 = READ_SICARD_8_PLUS_B0;
export const READ_SICARD_10_PLUS_B4 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x04, 0xe6, 0x09, ETX,
]);
export const READ_SICARD_10_PLUS_B5 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x05, 0xe7, 0x09, ETX,
]);
export const READ_SICARD_10_PLUS_B6 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x06, 0xe4, 0x09, ETX,
]);
export const READ_SICARD_10_PLUS_B7 = new SiMessage([
  STX, GET_SI_CARD_8_PLUS_BN, 0x01, 0x07, 0xe5, 0x09, ETX,
]);

// ─── Grouped readout commands per card type ────────────────────────────────────

export const SICARD_6_READOUT_COMMANDS = [
  READ_SICARD_6_B0,
  READ_SICARD_6_B6,
  READ_SICARD_6_B7,
  READ_SICARD_6_PLUS_B2,
  READ_SICARD_6_PLUS_B3,
  READ_SICARD_6_PLUS_B4,
  READ_SICARD_6_PLUS_B5,
];

export const SICARD_8_9_READOUT_COMMANDS = [
  READ_SICARD_8_PLUS_B0,
  READ_SICARD_8_PLUS_B1,
];

export const SICARD_10_PLUS_READOUT_COMMANDS = [
  READ_SICARD_10_PLUS_B0,
  READ_SICARD_10_PLUS_B4,
  READ_SICARD_10_PLUS_B5,
  READ_SICARD_10_PLUS_B6,
  READ_SICARD_10_PLUS_B7,
];
