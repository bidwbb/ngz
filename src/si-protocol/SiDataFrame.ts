/**
 * SPORTident card data frames — parsed card data.
 *
 * Ported from GecoSI (MIT license):
 *   - net.gecosi.dataframe.SiDataFrame
 *   - net.gecosi.dataframe.SiAbstractDataFrame
 *   - net.gecosi.dataframe.Si5DataFrame
 *   - net.gecosi.dataframe.Si6DataFrame
 *   - net.gecosi.dataframe.Si6PlusAbstractDataFrame
 *   - net.gecosi.dataframe.Si8PlusDataFrame
 *
 * Original author: Simon Denier
 */

import { SiMessage } from './SiMessage';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SiPunch {
  code: number;
  timestampMs: number; // milliseconds since midnight, or NO_TIME
}

export interface SiCardData {
  cardNumber: string;
  cardSeries: string;
  startTime: number;  // ms since midnight, or NO_TIME
  finishTime: number;
  checkTime: number;
  punchCount: number;
  punches: SiPunch[];
}

export const NO_TIME = -1;

// ─── Internal constants ────────────────────────────────────────────────────────

const NO_SI_TIME = 1000 * 0xeeee;
const TWELVE_HOURS = 1000 * 12 * 3600;
const ONE_DAY = 2 * TWELVE_HOURS;

// ─── Shared helper functions ───────────────────────────────────────────────────

function byteAt(data: Buffer, i: number): number {
  return data[i] & 0xff;
}

function wordAt(data: Buffer, i: number): number {
  return (byteAt(data, i) << 8) | byteAt(data, i + 1);
}

function block3At(data: Buffer, i: number): number {
  return (byteAt(data, i) << 16) | wordAt(data, i + 1);
}

function timestampAt(data: Buffer, i: number): number {
  return 1000 * wordAt(data, i);
}

/**
 * Advance a timestamp forward in steps until it's within one hour before refTime.
 * Handles 12-hour rollovers and day boundaries.
 */
function advanceTimePast(
  timestamp: number,
  refTime: number,
  stepTime: number
): number {
  if (timestamp === NO_SI_TIME) return NO_TIME;
  if (refTime === NO_TIME) return timestamp;
  let newTimestamp = timestamp;
  const baseTime = refTime - 3600000; // 1 hour before ref
  while (newTimestamp < baseTime) {
    newTimestamp += stepTime;
  }
  return newTimestamp;
}

function newRefTime(refTime: number, punchTime: number): number {
  return punchTime !== NO_TIME ? punchTime : refTime;
}

// ─── SI-Card 5 parser ──────────────────────────────────────────────────────────

const SI5_TIMED_PUNCHES = 30;

export function parseSi5(message: SiMessage, zerohour: number): SiCardData {
  // Extract data frame: bytes 5..132 of the message
  const data = message.sequence.subarray(5, 133);

  // Card number (with CNS prefix for numbers > 65535)
  let siNumber = wordAt(data, 0x04);
  const cns = byteAt(data, 0x06);
  if (cns > 0x01) {
    siNumber = siNumber + cns * 100000;
  }

  // Punch count (stored as count + 1)
  const nbPunches = byteAt(data, 0x17) - 1;

  // Raw times
  const rawStart = timestampAt(data, 0x13);
  const rawFinish = timestampAt(data, 0x15);
  const rawCheck = timestampAt(data, 0x19);

  // Advance times past zerohour (SI-5 uses 12-hour steps)
  const startTime = advanceTimePast(rawStart, zerohour, TWELVE_HOURS);
  const checkTime = advanceTimePast(rawCheck, zerohour, TWELVE_HOURS);

  // Parse punches with time shifting
  const nbTimed = Math.min(nbPunches, SI5_TIMED_PUNCHES);
  const punches: SiPunch[] = [];
  let refTime = newRefTime(zerohour, startTime);

  for (let i = 0; i < nbTimed; i++) {
    const offset = 0x21 + Math.floor(i / 5) * 0x10 + (i % 5) * 0x03;
    const code = byteAt(data, offset);
    const rawTime = timestampAt(data, offset + 1);
    const punchTime = advanceTimePast(rawTime, refTime, TWELVE_HOURS);
    punches.push({ code, timestampMs: punchTime });
    refTime = newRefTime(refTime, punchTime);
  }

  // Non-timed punches (code only, beyond the 30 timed slots)
  for (let i = 0; i < nbPunches - SI5_TIMED_PUNCHES; i++) {
    const code = byteAt(data, 0x20 + i * 0x10);
    punches.push({ code, timestampMs: NO_TIME });
  }

  // Finish time uses the last timed punch as reference
  const lastTimedRef =
    nbTimed > 0
      ? newRefTime(
          newRefTime(zerohour, startTime),
          punches[nbTimed - 1].timestampMs
        )
      : newRefTime(zerohour, startTime);
  const finishTime = advanceTimePast(rawFinish, lastTimedRef, TWELVE_HOURS);

  return {
    cardNumber: siNumber.toString(),
    cardSeries: 'SiCard 5',
    startTime,
    finishTime,
    checkTime,
    punchCount: nbPunches,
    punches,
  };
}

// ─── SI-Card 6+ shared logic ───────────────────────────────────────────────────

/**
 * Merge multiple 128-byte data blocks from SI-Card 6/8/9/10/11/SIAC messages
 * into a single flat data buffer.
 */
function extractSi6PlusDataFrame(dataMessages: SiMessage[]): Buffer {
  const totalLength = dataMessages.length * 128;
  const dataFrame = Buffer.alloc(totalLength);

  // First block: copy from offset 6
  const first = dataMessages[0].sequence;
  first.copy(dataFrame, 0, 6, 6 + 128);

  // Subsequent blocks: also from offset 6
  for (let i = 1; i < dataMessages.length; i++) {
    dataMessages[i].sequence.copy(dataFrame, i * 128, 6, 6 + 128);
  }

  return dataFrame;
}

/**
 * Extract full time (with PM flag) from a 4-byte page.
 * Format: [TD byte with PM flag in bit 0] [unused] [time_high] [time_low]
 */
function extractFullTime(data: Buffer, pageStart: number): number {
  const pmFlag = byteAt(data, pageStart) & 1;
  const twelveHoursTime = timestampAt(data, pageStart + 2);
  if (twelveHoursTime === NO_SI_TIME) return NO_SI_TIME;
  return pmFlag * TWELVE_HOURS + twelveHoursTime;
}

/** Extract control code from a 4-byte punch record */
function extractCode(data: Buffer, punchIndex: number): number {
  const codeHigh = (byteAt(data, punchIndex) & 0xc0) << 2;
  const code = codeHigh + byteAt(data, punchIndex + 1);
  return code;
}

/**
 * Parse an SI-6+ card given its specific memory layout indices.
 */
function parseSi6Plus(
  dataMessages: SiMessage[],
  layout: {
    siNumberIndex: number;
    startTimeIndex: number;
    finishTimeIndex: number;
    checkTimeIndex: number;
    nbPunchesIndex: number;
    punchesStartIndex: number;
    punchPageSize: number;
    cardSeries: string;
  },
  zerohour: number
): SiCardData {
  const data = extractSi6PlusDataFrame(dataMessages);

  const cardNumber = block3At(data, layout.siNumberIndex).toString();
  const nbPunches = byteAt(data, layout.nbPunchesIndex);

  // Extract and advance times (SI-6+ uses one-day steps)
  const rawStart = extractFullTime(data, layout.startTimeIndex);
  const rawCheck = extractFullTime(data, layout.checkTimeIndex);
  const startTime = advanceTimePast(rawStart, zerohour, ONE_DAY);
  const checkTime = advanceTimePast(rawCheck, zerohour, ONE_DAY);

  // Parse punches
  const punches: SiPunch[] = [];
  let refTime = newRefTime(zerohour, startTime);

  for (let i = 0; i < nbPunches; i++) {
    const punchIndex = (layout.punchesStartIndex + i) * layout.punchPageSize;
    const rawTime = extractFullTime(data, punchIndex);
    const punchTime = advanceTimePast(rawTime, refTime, ONE_DAY);
    const code = extractCode(data, punchIndex);
    punches.push({ code, timestampMs: punchTime });
    refTime = newRefTime(refTime, punchTime);
  }

  // Finish time: advance past last punch
  if (punches.length > 0) {
    const lastPunch = punches[punches.length - 1];
    refTime = newRefTime(refTime, lastPunch.timestampMs);
  }
  const rawFinish = extractFullTime(data, layout.finishTimeIndex);
  const finishTime = advanceTimePast(rawFinish, refTime, ONE_DAY);

  return {
    cardNumber,
    cardSeries: layout.cardSeries,
    startTime,
    finishTime,
    checkTime,
    punchCount: nbPunches,
    punches,
  };
}

// ─── SI-Card 6 parser ──────────────────────────────────────────────────────────

const SI6_PAGE_SIZE = 16;
const SI6_DOUBLE_WORD = 4;

export function parseSi6(
  dataMessages: SiMessage[],
  zerohour: number
): SiCardData {
  return parseSi6Plus(
    dataMessages,
    {
      siNumberIndex: 2 * SI6_DOUBLE_WORD + 3,     // byte 11
      startTimeIndex: SI6_PAGE_SIZE + 2 * SI6_DOUBLE_WORD,   // byte 24
      finishTimeIndex: SI6_PAGE_SIZE + 1 * SI6_DOUBLE_WORD,  // byte 20
      checkTimeIndex: SI6_PAGE_SIZE + 3 * SI6_DOUBLE_WORD,   // byte 28
      nbPunchesIndex: SI6_PAGE_SIZE + 2,                     // byte 18
      punchesStartIndex: 8 * SI6_PAGE_SIZE / SI6_DOUBLE_WORD, // start at page-index 32
      punchPageSize: SI6_DOUBLE_WORD,
      cardSeries: 'SiCard 6',
    },
    zerohour
  );
}

// ─── SI-Card 8/9/10/11/SIAC parser ────────────────────────────────────────────

const SI8_PAGE_SIZE = 4;
const SI8_SINUMBER_PAGE = 6 * SI8_PAGE_SIZE; // byte 24

enum Si8PlusSeries {
  SI8 = 'SiCard 8',
  SI9 = 'SiCard 9',
  SI10PLUS = 'SiCard 10/11/SIAC',
  PCARD = 'pCard',
  UNKNOWN = 'Unknown',
}

const SI8_PLUS_PUNCHES_START: Record<Si8PlusSeries, number> = {
  [Si8PlusSeries.SI8]: 34,
  [Si8PlusSeries.SI9]: 14,
  [Si8PlusSeries.SI10PLUS]: 32,
  [Si8PlusSeries.PCARD]: 44,
  [Si8PlusSeries.UNKNOWN]: 0,
};

function detectSi8Series(data: Buffer): Si8PlusSeries {
  switch (byteAt(data, SI8_SINUMBER_PAGE) & 0x0f) {
    case 2:
      return Si8PlusSeries.SI8;
    case 1:
      return Si8PlusSeries.SI9;
    case 4:
      return Si8PlusSeries.PCARD;
    case 15:
      return Si8PlusSeries.SI10PLUS;
    default:
      return Si8PlusSeries.UNKNOWN;
  }
}

export function parseSi8Plus(
  dataMessages: SiMessage[],
  zerohour: number
): SiCardData {
  // We need to peek at the merged data to detect the series
  const data = extractSi6PlusDataFrame(dataMessages);
  const series = detectSi8Series(data);
  const punchesStart = SI8_PLUS_PUNCHES_START[series];

  return parseSi6Plus(
    dataMessages,
    {
      siNumberIndex: SI8_SINUMBER_PAGE + 1,     // byte 25
      startTimeIndex: 3 * SI8_PAGE_SIZE,        // byte 12
      finishTimeIndex: 4 * SI8_PAGE_SIZE,       // byte 16
      checkTimeIndex: 2 * SI8_PAGE_SIZE,        // byte 8
      nbPunchesIndex: 5 * SI8_PAGE_SIZE + 2,    // byte 22
      punchesStartIndex: punchesStart,
      punchPageSize: SI8_PAGE_SIZE,
      cardSeries: series,
    },
    zerohour
  );
}
