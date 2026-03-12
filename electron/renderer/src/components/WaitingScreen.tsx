import React from 'react';

export function WaitingScreen({ status }: { status: string }) {
  return (
    <div className="waiting-screen">
      <div className="waiting-pulse" />
      <div className="waiting-content">
        <div className="waiting-icon">◈</div>
        <h2>{status === 'PROCESSING' ? 'Reading card…' : 'Waiting for card'}</h2>
        <p>Insert an SI card into the station</p>
      </div>
    </div>
  );
}
