/**
 * IPC channel name constants shared between main process and preload.
 *
 * Using constants eliminates magic strings and ensures channel names
 * stay in sync across main.ts and preload.ts.
 */

// Invoke channels (renderer → main, request/response)
export const SERIAL_LIST_PORTS = 'serial:listPorts';
export const SERIAL_AUTO_DETECT = 'serial:autoDetect';
export const DRIVER_START = 'driver:start';
export const DRIVER_STOP = 'driver:stop';
export const DIALOG_OPEN_XML = 'dialog:openXml';

// Event channels (main → renderer, push)
export const DRIVER_STATUS = 'driver:status';
export const DRIVER_CARD_READ = 'driver:cardRead';
export const DRIVER_LOG = 'driver:log';
