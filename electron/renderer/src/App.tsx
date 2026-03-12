import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

import type { SiCardData, ValidationResult, CourseEvent, PortInfo, LogEntry, ReadHistoryEntry, AppScreen } from './types';
import { NO_TIME, autoDetectCourse } from './types';
import { api, ANIMAL_O_EVENT, formatRaceTime, playSuccessSound, playErrorSound } from './utils';

import { StatusIndicator } from './components/StatusIndicator';
import { SetupScreen } from './components/SetupScreen';
import { WaitingScreen } from './components/WaitingScreen';
import { ResultScreen } from './components/ResultScreen';
import { LogScreen } from './components/LogScreen';

// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('setup');
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [driverStatus, setDriverStatus] = useState<string>('OFF');
  const [statusMessage, setStatusMessage] = useState('');
  const [events, setEvents] = useState<CourseEvent[]>([ANIMAL_O_EVENT]);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [lastCard, setLastCard] = useState<SiCardData | null>(null);
  const [lastValidation, setLastValidation] = useState<ValidationResult | null>(null);
  const [resultPaused, setResultPaused] = useState(false);
  const resultTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<ReadHistoryEntry[]>([]);
  const activeCourses = events[activeEventIndex]?.courses || [];

  const scanPorts = useCallback(async () => {
    const found = await api.listPorts(); setPorts(found);
    if (found.length > 0 && !selectedPort) { const si = found.find((p:PortInfo) => p.isSportident); setSelectedPort(si ? si.path : found[0].path); }
  }, [selectedPort]);
  useEffect(() => { scanPorts(); }, [scanPorts]);

  useEffect(() => {
    api.onStatus((status: string, msg?: string) => {
      setDriverStatus(status); if (msg) setStatusMessage(msg);
      if (status === 'READY' && screen !== 'result') setScreen('waiting');
    });
    api.onCardRead((card: SiCardData) => {
      setLastCard(card);
      // Filter punches to only those between start and finish time
      // This handles cards that weren't cleared — old punches from previous runs are ignored
      let validPunches = card.punches;
      if (card.startTime !== NO_TIME && card.finishTime !== NO_TIME) {
        validPunches = card.punches.filter(p =>
          p.timestampMs !== NO_TIME && p.timestampMs >= card.startTime && p.timestampMs <= card.finishTime
        );
      } else if (card.startTime !== NO_TIME) {
        validPunches = card.punches.filter(p =>
          p.timestampMs !== NO_TIME && p.timestampMs >= card.startTime
        );
      }
      const v = activeCourses.length > 0 ? autoDetectCourse(activeCourses, validPunches) : null;
      setLastValidation(v);
      (v ? (v.allCorrect ? playSuccessSound : playErrorSound) : playSuccessSound)();
      const raceMs = (card.startTime !== NO_TIME && card.finishTime !== NO_TIME) ? card.finishTime - card.startTime : -1;
      setHistory(h => [{ cardNumber: card.cardNumber, cardSeries: card.cardSeries, time: new Date().toLocaleTimeString(),
        raceTime: formatRaceTime(raceMs), courseName: v?.course.name || '(no course)', allCorrect: v?.allCorrect ?? true, punchCount: card.punchCount }, ...h]);
      setScreen('result'); setResultPaused(false);
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(() => setScreen('waiting'), 10000);
    });
    api.onLog((dir: string, msg: string) => {
      setLogs(prev => [...prev.slice(-200), { time: new Date().toLocaleTimeString(), direction: dir, message: msg }]);
    });
    return () => api.removeAllListeners();
  }, [activeCourses, screen]);

  const connect = async () => { if (!selectedPort) return; const r = await api.startDriver(selectedPort); r.success ? setScreen('waiting') : setStatusMessage(r.error || 'Failed'); };
  const disconnect = async () => { await api.stopDriver(); setScreen('setup'); setDriverStatus('OFF'); };
  const dismissResult = () => { if (resultTimerRef.current) clearTimeout(resultTimerRef.current); resultPaused ? (setScreen('waiting'), setResultPaused(false)) : setResultPaused(true); };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left"><span className="logo">◈ NGZ</span></div>
        <div className="top-bar-center"><StatusIndicator status={driverStatus} /></div>
        <div className="top-bar-right">
          {screen !== 'setup' && (<>
            {events[activeEventIndex] && <span className="active-event-label">{events[activeEventIndex].name}</span>}
            <button className="nav-btn" onClick={() => setScreen('waiting')} data-active={screen === 'waiting'}>Reader</button>
            <button className="nav-btn" onClick={() => setScreen('log')} data-active={screen === 'log'}>Log ({history.length})</button>
            <button className="nav-btn disconnect" onClick={disconnect}>Disconnect</button>
          </>)}
        </div>
      </header>
      <main className="main-content">
        {screen === 'setup' && <SetupScreen ports={ports} selectedPort={selectedPort} onSelectPort={setSelectedPort} onScanPorts={scanPorts} onConnect={connect}
          events={events} activeEventIndex={activeEventIndex} onSelectEvent={setActiveEventIndex}
          onAddEvent={(ev) => { setEvents(p => [...p, ev]); setActiveEventIndex(events.length); }}
          onRemoveEvent={(i) => { setEvents(p => p.filter((_,j) => j!==i)); if (activeEventIndex >= i && activeEventIndex > 0) setActiveEventIndex(activeEventIndex-1); }}
          statusMessage={statusMessage} />}
        {screen === 'waiting' && <WaitingScreen status={driverStatus} />}
        {screen === 'result' && lastCard && <ResultScreen card={lastCard} validation={lastValidation} paused={resultPaused} onDismiss={dismissResult} />}
        {screen === 'log' && <LogScreen history={history} logs={logs} />}
      </main>
    </div>
  );
}
