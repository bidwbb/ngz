/**
 * Serial port adapter bridging the `serialport` npm package to SiDriver.
 *
 * Handles:
 *  - Listing available ports (with SPORTident auto-detection via USB VID/PID)
 *  - Opening a port and wiring data events to SiDriver.handleSerialData()
 *  - Implementing the SiPortAdapter interface
 */

import { SerialPort } from 'serialport';
import { SiPortAdapter } from './SiDriver';

// SPORTident stations use a CP210x USB-to-UART chip
// Silicon Labs CP210x: VID 10C4, PID 800A (common for SI stations)
const SI_VENDOR_IDS = ['10c4', '10C4'];
const SI_PRODUCT_IDS = ['800a', '800A'];

export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  pnpId?: string;
  friendlyName?: string;
  isSportident: boolean;
}

/**
 * List all serial ports, marking any that look like SPORTident stations.
 */
export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    vendorId: p.vendorId,
    productId: p.productId,
    serialNumber: p.serialNumber,
    pnpId: p.pnpId,
    friendlyName: (p as any).friendlyName,
    isSportident:
      SI_VENDOR_IDS.includes(p.vendorId || '') &&
      SI_PRODUCT_IDS.includes(p.productId || ''),
  }));
}

/**
 * Auto-detect the first SPORTident port, or return null.
 */
export async function autoDetectSiPort(): Promise<string | null> {
  const ports = await listPorts();
  const si = ports.find((p) => p.isSportident);
  return si ? si.path : null;
}

/**
 * Open a serial port and return an adapter compatible with SiDriver.
 * The caller must wire `onData` to `driver.handleSerialData()`.
 */
export function openPort(
  path: string,
  baudRate: number,
  onData: (chunk: Buffer) => void
): Promise<{ adapter: SiPortAdapter; port: SerialPort }> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort(
      {
        path,
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false,
      }
    );

    port.on('data', (data: Buffer) => {
      onData(data);
    });

    port.on('error', (err) => {
      console.error(`[Serial Error] ${err.message}`);
    });

    port.open((err) => {
      if (err) {
        reject(new Error(`Failed to open ${path}: ${err.message}`));
        return;
      }

      const adapter: SiPortAdapter = {
        write: (data: Buffer) =>
          new Promise<void>((res, rej) => {
            port.write(data, (writeErr) => {
              if (writeErr) rej(writeErr);
              else port.drain((drainErr) => {
                if (drainErr) rej(drainErr);
                else res();
              });
            });
          }),

        setBaudRate: (rate: number) =>
          new Promise<void>((res, rej) => {
            port.update({ baudRate: rate }, (updateErr) => {
              if (updateErr) rej(updateErr);
              else res();
            });
          }),

        close: () => {
          if (port.isOpen) {
            port.close();
          }
        },
      };

      resolve({ adapter, port });
    });
  });
}
