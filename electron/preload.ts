/**
 * Preload script — exposes a safe API to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  SERIAL_LIST_PORTS, SERIAL_AUTO_DETECT,
  DRIVER_START, DRIVER_STOP, DRIVER_STATUS, DRIVER_CARD_READ, DRIVER_LOG,
  DIALOG_OPEN_XML,
} from './ipc-channels';

export interface ElectronAPI {
  // Serial port
  listPorts: () => Promise<any[]>;
  autoDetect: () => Promise<string | null>;

  // Driver control
  startDriver: (portPath: string) => Promise<{ success: boolean; error?: string }>;
  stopDriver: () => Promise<void>;

  // File dialog
  openXmlDialog: () => Promise<{ content: string; filename: string } | null>;

  // Event listeners
  onStatus: (callback: (status: string, msg?: string) => void) => void;
  onCardRead: (callback: (card: any) => void) => void;
  onLog: (callback: (direction: string, msg: string) => void) => void;

  // Remove listeners
  removeAllListeners: () => void;
}

contextBridge.exposeInMainWorld('electronAPI', {
  listPorts: () => ipcRenderer.invoke(SERIAL_LIST_PORTS),
  autoDetect: () => ipcRenderer.invoke(SERIAL_AUTO_DETECT),

  startDriver: (portPath: string) => ipcRenderer.invoke(DRIVER_START, portPath),
  stopDriver: () => ipcRenderer.invoke(DRIVER_STOP),

  openXmlDialog: () => ipcRenderer.invoke(DIALOG_OPEN_XML),

  onStatus: (callback: (status: string, msg?: string) => void) => {
    ipcRenderer.on(DRIVER_STATUS, (_event, status, msg) => callback(status, msg));
  },
  onCardRead: (callback: (card: any) => void) => {
    ipcRenderer.on(DRIVER_CARD_READ, (_event, card) => callback(card));
  },
  onLog: (callback: (direction: string, msg: string) => void) => {
    ipcRenderer.on(DRIVER_LOG, (_event, direction, msg) => callback(direction, msg));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners(DRIVER_STATUS);
    ipcRenderer.removeAllListeners(DRIVER_CARD_READ);
    ipcRenderer.removeAllListeners(DRIVER_LOG);
  },
} as ElectronAPI);
