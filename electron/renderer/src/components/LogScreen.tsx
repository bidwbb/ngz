import React, { useState } from 'react';
import type { ReadHistoryEntry, LogEntry } from '../types';

export function LogScreen({ history, logs }: { history: ReadHistoryEntry[]; logs: LogEntry[] }) {
  const [tab, setTab] = useState<'history'|'protocol'>('history');
  return (
    <div className="log-screen">
      <div className="log-tabs">
        <button className={`tab ${tab==='history'?'active':''}`} onClick={() => setTab('history')}>Read History ({history.length})</button>
        <button className={`tab ${tab==='protocol'?'active':''}`} onClick={() => setTab('protocol')}>Protocol Log</button>
      </div>
      {tab === 'history' && <div className="history-table-wrap">
        {history.length === 0 ? <p className="empty-msg">No cards read yet</p> :
        <table className="history-table"><thead><tr><th>Time</th><th>Card</th><th>Type</th><th>Course</th><th>Race Time</th><th>Punches</th><th>Status</th></tr></thead>
        <tbody>{history.map((h, i) => <tr key={i} className={h.allCorrect ? '' : 'row-error'}>
          <td>{h.time}</td><td className="mono">{h.cardNumber}</td><td>{h.cardSeries}</td><td>{h.courseName}</td>
          <td className="mono">{h.raceTime}</td><td>{h.punchCount}</td>
          <td><span className={`badge ${h.allCorrect ? 'badge-ok' : 'badge-pm'}`}>{h.allCorrect ? 'OK' : 'PM'}</span></td>
        </tr>)}</tbody></table>}
      </div>}
      {tab === 'protocol' && <div className="protocol-log">
        {logs.map((l, i) => <div key={i} className={`log-line log-${l.direction.toLowerCase()}`}>
          <span className="log-time">{l.time}</span><span className="log-dir">{l.direction==='SEND'?'→':l.direction==='READ'?'←':'●'}</span><span className="log-msg">{l.message}</span>
        </div>)}
      </div>}
    </div>
  );
}
