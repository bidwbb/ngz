#!/usr/bin/env node

/**
 * NGZ — CLI card reader
 *
 * Usage:
 *   npx ts-node src/cli.ts                  # auto-detect SI station
 *   npx ts-node src/cli.ts COM3             # Windows — specify port
 *   npx ts-node src/cli.ts /dev/ttyUSB0     # Linux — specify port
 *   npx ts-node src/cli.ts --list           # list all serial ports
 */

import { SiDriver } from './si-protocol/SiDriver';
import { SiCardData, NO_TIME } from './si-protocol/SiDataFrame';
import { listPorts, autoDetectSiPort, openPort } from './si-protocol/SiSerial';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  if (ms === NO_TIME) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function printCard(card: SiCardData): void {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`  Card: ${card.cardNumber}  (${card.cardSeries})`);
  console.log('═══════════════════════════════════════════');
  console.log(`  Check:  ${formatTime(card.checkTime)}`);
  console.log(`  Start:  ${formatTime(card.startTime)}`);
  console.log(`  Finish: ${formatTime(card.finishTime)}`);

  if (card.startTime !== NO_TIME && card.finishTime !== NO_TIME) {
    const raceMs = card.finishTime - card.startTime;
    console.log(`  Time:   ${formatTime(raceMs)}`);
  }

  console.log(`  Punches: ${card.punchCount}`);
  console.log('───────────────────────────────────────────');

  for (let i = 0; i < card.punches.length; i++) {
    const p = card.punches[i];
    const num = (i + 1).toString().padStart(3, ' ');
    const code = p.code.toString().padStart(4, ' ');
    const time = formatTime(p.timestampMs);

    let split = '';
    if (p.timestampMs !== NO_TIME && card.startTime !== NO_TIME) {
      split = formatTime(p.timestampMs - card.startTime);
    }

    console.log(`  ${num}. Control ${code}   ${time}   +${split || '--:--:--'}`);
  }

  console.log('═══════════════════════════════════════════');
  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --list: just list ports and exit
  if (args.includes('--list') || args.includes('-l')) {
    console.log('Available serial ports:');
    console.log('');
    const ports = await listPorts();
    if (ports.length === 0) {
      console.log('  (none found)');
    }
    for (const p of ports) {
      const si = p.isSportident ? ' ★ SPORTident' : '';
      const mfr = p.manufacturer ? ` [${p.manufacturer}]` : '';
      const vid = p.vendorId ? ` VID:${p.vendorId}` : '';
      const pid = p.productId ? ` PID:${p.productId}` : '';
      console.log(`  ${p.path}${mfr}${vid}${pid}${si}`);
    }
    console.log('');
    return;
  }

  // Determine which port to use
  let portPath = args[0];

  if (!portPath) {
    console.log('Auto-detecting SPORTident station...');
    portPath = (await autoDetectSiPort()) ?? '';
    if (!portPath) {
      console.log('');
      console.log('No SPORTident station found. Available ports:');
      const ports = await listPorts();
      for (const p of ports) {
        console.log(`  ${p.path}  ${p.manufacturer || ''}`);
      }
      console.log('');
      console.log('Usage: npx ts-node src/cli.ts [PORT]');
      console.log('       npx ts-node src/cli.ts COM3');
      console.log('       npx ts-node src/cli.ts /dev/ttyUSB0');
      process.exit(1);
    }
    console.log(`Found: ${portPath}`);
  }

  console.log(`Opening ${portPath}...`);

  // Zerohour: midnight today in milliseconds since midnight
  // (We use 0 since SI times are already relative to midnight)
  const zerohour = 0;

  // Open at 38400 (the driver will try to fall back to 4800 if needed)
  const { adapter, port } = await openPort(portPath, 38400, () => {});

  const driver = new SiDriver(adapter, zerohour);

  // Wire serial data to the driver
  port.removeAllListeners('data');
  port.on('data', (chunk: Buffer) => {
    driver.handleSerialData(chunk);
  });

  // Log protocol messages
  driver.onLog((direction, msg) => {
    const prefix = direction === 'SEND' ? '→' : direction === 'READ' ? '←' : '●';
    const color =
      direction === 'ERROR'
        ? '\x1b[31m'
        : direction === 'SEND'
          ? '\x1b[36m'
          : direction === 'READ'
            ? '\x1b[33m'
            : '\x1b[90m';
    console.log(`${color}${prefix} [${direction}] ${msg}\x1b[0m`);
  });

  // Status updates
  driver.onStatus((status, msg) => {
    switch (status) {
      case 'ON':
        console.log('\x1b[32m✓ Station connected and configured\x1b[0m');
        break;
      case 'READY':
        console.log('\x1b[32m⏳ Waiting for card... (insert SI card into station)\x1b[0m');
        break;
      case 'PROCESSING':
        console.log('\x1b[36m📖 Reading card...\x1b[0m');
        break;
      case 'PROCESSING_ERROR':
        console.log(`\x1b[31m✗ Read error${msg ? ': ' + msg : ''}\x1b[0m`);
        break;
      case 'FATAL_ERROR':
        console.log(`\x1b[31m✗ Fatal error: ${msg}\x1b[0m`);
        break;
      case 'OFF':
        console.log('\x1b[90m○ Disconnected\x1b[0m');
        break;
    }
  });

  // Card read events — the main output!
  let readCount = 0;
  driver.onCardRead((card: SiCardData) => {
    readCount++;
    console.log(`\x1b[32m✓ Card #${readCount} read successfully!\x1b[0m`);
    printCard(card);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    driver.stop();
    process.exit(0);
  });

  // Start the driver
  console.log('Starting SI protocol driver...');
  console.log('(Press Ctrl+C to exit)');
  console.log('');

  try {
    await driver.start();
  } catch (err: any) {
    console.error(`\x1b[31mDriver error: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
