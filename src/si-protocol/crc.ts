/**
 * CRC calculator for SPORTident protocol.
 *
 * Ported from SPORTident Java code released under CC BY 3.0 license.
 * Original: de.sportident.CRCCalculator
 * http://creativecommons.org/licenses/by/3.0/
 */

const POLY = 0x8005;
const BITF = 0x8000;

export function crc(buffer: Buffer): number {
  const count = buffer.length;
  let ptr = 0;

  let tmp = ((buffer[ptr++] << 8) | (buffer[ptr++] & 0xff)) & 0xffff;

  if (count > 2) {
    for (let i = Math.floor(count / 2); i > 0; i--) {
      let val: number;
      if (i > 1) {
        val = ((buffer[ptr++] << 8) | (buffer[ptr++] & 0xff)) & 0xffff;
      } else {
        if (count % 2 === 1) {
          val = (buffer[count - 1] << 8) & 0xffff;
        } else {
          val = 0;
        }
      }

      for (let j = 0; j < 16; j++) {
        if ((tmp & BITF) !== 0) {
          tmp = (tmp << 1) & 0xffff;
          if ((val & BITF) !== 0) {
            tmp = (tmp + 1) & 0xffff;
          }
          tmp = (tmp ^ POLY) & 0xffff;
        } else {
          tmp = (tmp << 1) & 0xffff;
          if ((val & BITF) !== 0) {
            tmp = (tmp + 1) & 0xffff;
          }
        }
        val = (val << 1) & 0xffff;
      }
    }
  }
  return tmp & 0xffff;
}
