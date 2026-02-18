/**
 * Preload script — exposes a safe API to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

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
  listPorts: () => ipcRenderer.invoke('serial:listPorts'),
  autoDetect: () => ipcRenderer.invoke('serial:autoDetect'),

  startDriver: (portPath: string) => ipcRenderer.invoke('driver:start', portPath),
  stopDriver: () => ipcRenderer.invoke('driver:stop'),

  openXmlDialog: () => ipcRenderer.invoke('dialog:openXml'),

  onStatus: (callback: (status: string, msg?: string) => void) => {
    ipcRenderer.on('driver:status', (_event, status, msg) => callback(status, msg));
  },
  onCardRead: (callback: (card: any) => void) => {
    ipcRenderer.on('driver:cardRead', (_event, card) => callback(card));
  },
  onLog: (callback: (direction: string, msg: string) => void) => {
    ipcRenderer.on('driver:log', (_event, direction, msg) => callback(direction, msg));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('driver:status');
    ipcRenderer.removeAllListeners('driver:cardRead');
    ipcRenderer.removeAllListeners('driver:log');
  },
} as ElectronAPI);
