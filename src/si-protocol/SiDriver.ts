/**
 * SPORTident protocol driver — state machine for station communication.
 *
 * Ported from GecoSI (MIT license):
 *   - net.gecosi.internal.SiDriver
 *   - net.gecosi.internal.SiDriverState
 *
 * Original author: Simon Denier
 */

import { EventEmitter } from 'events';
import {
  SiMessage,
  STARTUP_SEQUENCE,
  GET_PROTOCOL_CONFIGURATION,
  GET_CARDBLOCKS_CONFIGURATION,
  ACK_SEQUENCE,
  BEEP_TWICE,
  READ_SICARD_5,
  SICARD_6_READOUT_COMMANDS,
  SICARD_8_9_READOUT_COMMANDS,
  SICARD_10_PLUS_READOUT_COMMANDS,
  SET_MASTER_MODE,
  GET_SYSTEM_VALUE,
  SI_CARD_5_DETECTED,
  SI_CARD_6_PLUS_DETECTED,
  SI_CARD_8_PLUS_DETECTED,
  SI_CARD_REMOVED,
  SI3_NUMBER_INDEX,
  SI_CARD_10_PLUS_SERIES,
  BEEP,
} from './SiMessage';
import {
  SiCardData,
  parseSi5,
  parseSi6,
  parseSi8Plus,
} from './SiDataFrame';
import { SiMessageQueue, TimeoutError, InvalidMessageError } from './SiMessageQueue';

// ─── Protocol constants ─────────────────────────────────────────────────────

/** Baud rate for high-speed SI stations (BSM7/8, most modern stations) */
const BAUD_HIGH = 38400;
/** Baud rate for legacy SI stations (BSM3/4) */
const BAUD_LOW = 4800;
/** Max serial frame size: STX + cmd + len(1) + data(max 128) + CRC(2) + ETX = 134, plus margin */
const SERIAL_BUFFER_SIZE = 139;
/** Time (ms) after which incomplete serial data is discarded */
const SERIAL_TIMEOUT_MS = 500;
/** Default timeout (ms) for waiting for a protocol response */
const RESPONSE_TIMEOUT_MS = 2000;
/** Timeout (ms) for waiting for the user to remove the card from the station */
const CARD_REMOVAL_TIMEOUT_MS = 5000;
/** Number of punches that fit in a single data block (SI-Card 6+) */
const PUNCHES_PER_BLOCK = 32;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CommStatus =
  | 'STARTING'
  | 'ON'
  | 'READY'
  | 'PROCESSING'
  | 'PROCESSING_ERROR'
  | 'OFF'
  | 'FATAL_ERROR';

export interface SiPortAdapter {
  /** Write raw bytes to the serial port */
  write(data: Buffer): Promise<void>;
  /** Set baud rate */
  setBaudRate(rate: number): Promise<void>;
  /** Close the port */
  close(): void;
}

export interface SiDriverEvents {
  status: (status: CommStatus, message?: string) => void;
  cardRead: (data: SiCardData) => void;
  log: (direction: 'SEND' | 'READ' | 'INFO' | 'ERROR', msg: string) => void;
}

// ─── Protocol config check masks ───────────────────────────────────────────────

const EXTENDED_PROTOCOL_MASK = 1;
const HANDSHAKE_MODE_MASK = 4;
const CONFIG_CHECK_MASK = EXTENDED_PROTOCOL_MASK | HANDSHAKE_MODE_MASK;

// ─── SI Driver ─────────────────────────────────────────────────────────────────

export class SiDriver extends EventEmitter {
  private port: SiPortAdapter;
  private messageQueue = new SiMessageQueue();
  private running = false;
  private zerohour: number;
  private si6_192PunchesMode = false;

  // Accumulator for serial framing
  private accBuffer = Buffer.alloc(SERIAL_BUFFER_SIZE);
  private accSize = 0;
  private lastDataTime = 0;

  constructor(port: SiPortAdapter, zerohour: number = 0) {
    super();
    this.port = port;
    this.zerohour = zerohour;
  }

  // ─── Typed event helpers ─────────────────────────────────────────────

  onStatus(listener: SiDriverEvents['status']): this {
    return this.on('status', listener);
  }

  onCardRead(listener: SiDriverEvents['cardRead']): this {
    return this.on('cardRead', listener);
  }

  onLog(listener: SiDriverEvents['log']): this {
    return this.on('log', listener);
  }

  // ─── Serial data input ───────────────────────────────────────────────

  /** Feed raw serial bytes into the driver (called by the serial port adapter) */
  handleSerialData(chunk: Buffer): void {
    const now = Date.now();
    if (now > this.lastDataTime + SERIAL_TIMEOUT_MS) {
      this.accSize = 0; // reset on timeout
    }
    this.lastDataTime = now;

    // Accumulate
    chunk.copy(this.accBuffer, this.accSize, 0, Math.min(chunk.length, SERIAL_BUFFER_SIZE - this.accSize));
    this.accSize += Math.min(chunk.length, SERIAL_BUFFER_SIZE - this.accSize);

    // Check if single-byte message (like ACK)
    if (this.accSize === 1 && this.accBuffer[0] !== 0x02) {
      this.dispatchMessage();
      return;
    }

    // Check for complete multi-byte message
    if (this.accSize >= 3) {
      const expectedDataLen = this.accBuffer[2] & 0xff;
      const expectedTotal = expectedDataLen + 6; // STX + cmd + len + data + CRC(2) + ETX
      if (this.accSize >= expectedTotal) {
        this.dispatchMessage();
      }
    }
  }

  private dispatchMessage(): void {
    const msgBuf = Buffer.from(this.accBuffer.subarray(0, this.accSize));
    const msg = new SiMessage(msgBuf);
    this.log('READ', msg.toString());
    this.messageQueue.push(msg);
    this.accSize = 0;
  }

  // ─── Port communication helpers ──────────────────────────────────────

  private async send(msg: SiMessage): Promise<void> {
    this.log('SEND', msg.toString());
    await this.port.write(msg.sequence);
  }

  private async pollAnswer(command: number, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<SiMessage> {
    const msg = await this.messageQueue.take(timeoutMs);
    if (!msg.check(command)) {
      throw new InvalidMessageError(msg, command);
    }
    return msg;
  }

  // ─── Logging ─────────────────────────────────────────────────────────

  private log(direction: 'SEND' | 'READ' | 'INFO' | 'ERROR', msg: string): void {
    this.emit('log', direction, msg);
  }

  // ─── Main driver loop ────────────────────────────────────────────────

  async start(): Promise<void> {
    this.running = true;
    try {
      this.emit('status', 'STARTING');
      await this.startupBootstrap();

      // Main dispatch loop
      while (this.running) {
        this.emit('status', 'READY');
        await this.dispatchReady();
      }
    } catch (err: any) {
      if (this.running) {
        this.log('ERROR', err.message || String(err));
        this.emit('status', 'FATAL_ERROR', err.message || String(err));
      }
    } finally {
      this.running = false;
      this.port.close();
      this.emit('status', 'OFF');
    }
  }

  stop(): void {
    this.running = false;
    this.messageQueue.clear();
  }

  // ─── Startup sequence ────────────────────────────────────────────────

  private async startupBootstrap(): Promise<void> {
    // Try high speed first (38400), fall back to low (4800)
    try {
      await this.port.setBaudRate(BAUD_HIGH);
      await this.startup();
    } catch (err) {
      if (err instanceof TimeoutError) {
        try {
          await this.port.setBaudRate(BAUD_LOW);
          await this.startup();
        } catch (err2) {
          if (err2 instanceof TimeoutError) {
            throw new Error(
              'Master station did not answer to startup sequence (high/low baud)'
            );
          }
          throw err2;
        }
      } else {
        throw err;
      }
    }
  }

  private async startup(): Promise<void> {
    // Send startup sequence → expect SET_MASTER_MODE response
    await this.send(STARTUP_SEQUENCE);
    await this.pollAnswer(SET_MASTER_MODE);

    // Get protocol config → check extended protocol + handshake mode
    await this.send(GET_PROTOCOL_CONFIGURATION);
    const configMsg = await this.pollAnswer(GET_SYSTEM_VALUE);
    const cpcByte = configMsg.byteAt(6);
    if ((cpcByte & CONFIG_CHECK_MASK) !== CONFIG_CHECK_MASK) {
      if ((cpcByte & EXTENDED_PROTOCOL_MASK) === 0) {
        throw new Error(
          'Master station should be configured with extended protocol'
        );
      } else {
        throw new Error(
          'Master station should be configured in handshake mode (no autosend)'
        );
      }
    }

    // Get SI-Card 6 block configuration
    await this.send(GET_CARDBLOCKS_CONFIGURATION);
    const blockMsg = await this.pollAnswer(GET_SYSTEM_VALUE);
    this.si6_192PunchesMode = (blockMsg.byteAt(6) & 0xff) === 0xff;
    this.log(
      'INFO',
      `SiCard6 192 Punches Mode ${this.si6_192PunchesMode ? 'Enabled' : 'Disabled'}`
    );

    // Beep twice to confirm ready
    await this.send(BEEP_TWICE);
    this.emit('status', 'ON');
  }

  // ─── Card dispatch ───────────────────────────────────────────────────

  private async dispatchReady(): Promise<void> {
    const message = await this.messageQueue.takeForever();
    if (!this.running) return;

    this.emit('status', 'PROCESSING');

    switch (message.commandByte) {
      case SI_CARD_5_DETECTED:
        await this.retrieveSiCard5();
        break;

      case SI_CARD_6_PLUS_DETECTED:
        await this.retrieveSiCard6();
        break;

      case SI_CARD_8_PLUS_DETECTED:
        if (message.byteAt(SI3_NUMBER_INDEX) === SI_CARD_10_PLUS_SERIES) {
          await this.retrieveSiCard10Plus();
        } else {
          await this.retrieveSiCard8_9();
        }
        break;

      case BEEP:
        // Station beep, ignore
        break;

      case SI_CARD_REMOVED:
        this.log('INFO', 'Late card removal');
        break;

      default:
        this.log('INFO', `Unexpected message: ${message.toString()}`);
    }
  }

  // ─── Card read operations ────────────────────────────────────────────

  private async retrieveSiCard5(): Promise<void> {
    try {
      await this.send(READ_SICARD_5);
      const response = await this.pollAnswer(READ_SICARD_5.commandByte);
      const cardData = parseSi5(response, this.zerohour);
      this.emit('cardRead', cardData);
      await this.ackAndWaitRemoval();
    } catch (err) {
      this.handleReadError(err, 'SiCard 5');
    }
  }

  private async retrieveSiCard6(): Promise<void> {
    try {
      const commands = SICARD_6_READOUT_COMMANDS;
      const nbPunchesIndex = 18 + 6; // Si6DataFrame.NB_PUNCHES_INDEX + metadata offset
      const dataMessages = await this.readMultipleBlocks(
        commands,
        nbPunchesIndex,
        'SiCard 6'
      );
      const cardData = parseSi6(dataMessages, this.zerohour);
      this.emit('cardRead', cardData);
      await this.ackAndWaitRemoval();
    } catch (err) {
      this.handleReadError(err, 'SiCard 6');
    }
  }

  private async retrieveSiCard8_9(): Promise<void> {
    try {
      const commands = SICARD_8_9_READOUT_COMMANDS;
      const dataMessages = await this.readAllBlocks(commands, 'SiCard 8/9');
      const cardData = parseSi8Plus(dataMessages, this.zerohour);
      this.emit('cardRead', cardData);
      await this.ackAndWaitRemoval();
    } catch (err) {
      this.handleReadError(err, 'SiCard 8/9');
    }
  }

  private async retrieveSiCard10Plus(): Promise<void> {
    try {
      const commands = SICARD_10_PLUS_READOUT_COMMANDS;
      const nbPunchesIndex = 22 + 6; // Si8PlusDataFrame.NB_PUNCHES_INDEX + metadata offset
      const dataMessages = await this.readMultipleBlocks(
        commands,
        nbPunchesIndex,
        'SiCard 10/11/SIAC'
      );
      const cardData = parseSi8Plus(dataMessages, this.zerohour);
      this.emit('cardRead', cardData);
      await this.ackAndWaitRemoval();
    } catch (err) {
      this.handleReadError(err, 'SiCard 10/11/SIAC');
    }
  }

  // ─── Multi-block read helpers ────────────────────────────────────────

  /**
   * Read all blocks without optimization (used for SI-Card 8/9 which always
   * need all blocks).
   */
  private async readAllBlocks(
    commands: SiMessage[],
    label: string
  ): Promise<SiMessage[]> {
    const messages: SiMessage[] = [];
    for (const cmd of commands) {
      await this.send(cmd);
      messages.push(await this.pollAnswer(cmd.commandByte));
    }
    return messages;
  }

  /**
   * Read blocks with punch-count optimization: read the first block, check
   * how many punches there are, and only read as many additional blocks as
   * needed. This matches GecoSI's extractNumberOfDataBlocks logic.
   */
  private async readMultipleBlocks(
    commands: SiMessage[],
    nbPunchesIndex: number,
    label: string
  ): Promise<SiMessage[]> {
    // Read first block
    const firstCmd = commands[0];
    await this.send(firstCmd);
    const firstBlock = await this.pollAnswer(firstCmd.commandByte);

    // Determine how many blocks we need
    const nbPunches = firstBlock.byteAt(nbPunchesIndex) & 0xff;
    const punchesPerBlock = PUNCHES_PER_BLOCK;
    const nbPunchDataBlocks =
      Math.floor(nbPunches / punchesPerBlock) +
      Math.min(1, nbPunches % punchesPerBlock);
    const totalBlocks = nbPunchDataBlocks + 1; // +1 for the header block

    this.log(
      'INFO',
      `${label}: ${nbPunches} punches, reading ${totalBlocks} blocks`
    );

    const messages: SiMessage[] = [firstBlock];
    for (let i = 1; i < totalBlocks && i < commands.length; i++) {
      await this.send(commands[i]);
      messages.push(await this.pollAnswer(commands[i].commandByte));
    }

    return messages;
  }

  // ─── Post-read: ACK and wait for card removal ────────────────────────

  private async ackAndWaitRemoval(): Promise<void> {
    await this.send(ACK_SEQUENCE);
    try {
      const msg = await this.messageQueue.take(CARD_REMOVAL_TIMEOUT_MS);
      if (msg.commandByte !== SI_CARD_REMOVED) {
        this.log('INFO', `Expected card removal, got: ${msg.toString()}`);
      }
    } catch {
      this.log('INFO', 'Timeout waiting for card removal');
    }
  }

  private handleReadError(err: unknown, cardType: string): void {
    const msg =
      err instanceof Error ? err.message : String(err);
    this.log('ERROR', `Error reading ${cardType}: ${msg}`);
    this.emit('status', 'PROCESSING_ERROR');
  }
}
