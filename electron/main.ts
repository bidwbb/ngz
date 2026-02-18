/**
 * NGZ — Electron main process
 *
 * Creates the BrowserWindow, manages the SI protocol driver in the main process,
 * and bridges card-read events to the renderer via IPC.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SiDriver, CommStatus, SiPortAdapter } from '../src/si-protocol/SiDriver';
import { SiCardData } from '../src/si-protocol/SiDataFrame';
import { listPorts, autoDetectSiPort, openPort, PortInfo } from '../src/si-protocol/SiSerial';
import { SerialPort } from 'serialport';

let mainWindow: BrowserWindow | null = null;
let driver: SiDriver | null = null;
let serialPort: SerialPort | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'NGZ',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0a0a0f',
    show: false,
  });

  // In development, load from the React dev server; in production, load the built files
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopDriver();
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────

/** List serial ports */
ipcMain.handle('serial:listPorts', async (): Promise<PortInfo[]> => {
  return listPorts();
});

/** Auto-detect SI station */
ipcMain.handle('serial:autoDetect', async (): Promise<string | null> => {
  return autoDetectSiPort();
});

/** Connect to a port and start the SI driver */
ipcMain.handle('driver:start', async (_event, portPath: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Stop any existing driver
    stopDriver();

    const { adapter, port } = await openPort(portPath, 38400, () => {});
    serialPort = port;

    driver = new SiDriver(adapter, 0);

    // Wire serial data → driver
    port.removeAllListeners('data');
    port.on('data', (chunk: Buffer) => {
      driver?.handleSerialData(chunk);
    });

    // Forward events to renderer
    driver.onStatus((status: CommStatus, msg?: string) => {
      mainWindow?.webContents.send('driver:status', status, msg);
    });

    driver.onCardRead((card: SiCardData) => {
      mainWindow?.webContents.send('driver:cardRead', card);
    });

    driver.onLog((direction, msg) => {
      mainWindow?.webContents.send('driver:log', direction, msg);
    });

    // Start the driver (async, runs forever until stopped)
    driver.start().catch((err: Error) => {
      mainWindow?.webContents.send('driver:status', 'FATAL_ERROR', err.message);
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
});

/** Stop the driver */
ipcMain.handle('driver:stop', async (): Promise<void> => {
  stopDriver();
});

/** Open native file dialog for IOF XML files, return file content */
ipcMain.handle('dialog:openXml', async (): Promise<{ content: string; filename: string } | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open IOF XML Course File',
    filters: [
      { name: 'IOF XML Files', extensions: ['xml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  return { content, filename };
});

function stopDriver(): void {
  if (driver) {
    driver.stop();
    driver = null;
  }
  if (serialPort?.isOpen) {
    serialPort.close();
    serialPort = null;
  }
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopDriver();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
