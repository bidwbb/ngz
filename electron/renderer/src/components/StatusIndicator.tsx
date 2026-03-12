import React from 'react';

const labels: Record<string, string> = {
  OFF: 'Disconnected', STARTING: 'Connecting…', ON: 'Connected',
  READY: 'Ready', PROCESSING: 'Reading card…', PROCESSING_ERROR: 'Read error', FATAL_ERROR: 'Error',
};

export function StatusIndicator({ status }: { status: string }) {
  return (
    <div className={`status-indicator ${['ON','READY','PROCESSING'].includes(status) ? 'active' : ''}`}>
      <span className="status-dot" />
      <span className="status-label">{labels[status] || status}</span>
    </div>
  );
}
