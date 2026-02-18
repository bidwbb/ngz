import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SiPunch { code: number; timestampMs: number; }
interface SiCardData {
  cardNumber: string; cardSeries: string; startTime: number; finishTime: number;
  checkTime: number; punchCount: number; punches: SiPunch[];
}
interface Course { name: string; controls: number[]; isInline: boolean; useBoxStart: boolean; }
interface CourseEvent { name: string; courses: Course[]; }
interface ControlResult { expectedCode: number; found: boolean; timestampMs: number; }
interface ValidationResult {
  course: Course; controlResults: ControlResult[]; missingCount: number;
  extraControls: number[]; allCorrect: boolean;
}
interface PortInfo { path: string; manufacturer?: string; vendorId?: string; productId?: string; isSportident: boolean; }
interface LogEntry { time: string; direction: string; message: string; }
interface ReadHistoryEntry {
  cardNumber: string; cardSeries: string; time: string; raceTime: string;
  courseName: string; allCorrect: boolean; punchCount: number;
}
type AppScreen = 'setup' | 'waiting' | 'result' | 'log';
const NO_TIME = -1;

// ─── Built-in Animal-O Event ───────────────────────────────────────────────────

const ANIMAL_O_EVENT: CourseEvent = {
  name: 'Animal-O',
  courses: [
    { name: 'Blue Jay', controls: [36, 34, 31, 38, 37], isInline: true, useBoxStart: true },
    { name: 'Bee', controls: [35, 37, 38, 40, 33], isInline: true, useBoxStart: true },
    { name: 'Crab', controls: [39, 31, 32, 35, 37], isInline: true, useBoxStart: true },
    { name: 'Dog', controls: [33, 32, 40, 38, 34], isInline: true, useBoxStart: true },
    { name: 'Lion', controls: [31, 33, 36, 38, 39], isInline: true, useBoxStart: true },
    { name: 'Elephant', controls: [37, 34, 31, 40, 39], isInline: true, useBoxStart: true },
    { name: 'Sheep', controls: [40, 36, 34, 31, 32, 33, 35, 37, 38, 39], isInline: true, useBoxStart: true },
    { name: 'Frog', controls: [32, 40, 39, 38, 35, 34, 36, 37, 31, 33], isInline: true, useBoxStart: true },
    { name: 'Octopus', controls: [34, 36, 39, 40, 32, 33, 37, 38, 31, 35], isInline: true, useBoxStart: true },
    { name: 'Penguin', controls: [38, 39, 32, 34, 35, 36, 37, 33, 31, 40], isInline: true, useBoxStart: true },
  ],
};

// ─── Electron API ──────────────────────────────────────────────────────────────

const api = (window as any).electronAPI || {
  listPorts: async () => [], autoDetect: async () => null,
  startDriver: async () => ({ success: false, error: 'Not in Electron' }),
  stopDriver: async () => {}, openXmlDialog: async () => null,
  onStatus: () => {}, onCardRead: () => {},
  onLog: () => {}, removeAllListeners: () => {},
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  if (ms === NO_TIME || ms < 0) return '--:--:--';
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t/3600).toString().padStart(2,'0')}:${Math.floor((t%3600)/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
}
function formatRaceTime(ms: number): string {
  if (ms <= 0 || ms === NO_TIME) return '--:--';
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t/60)}:${(t%60).toString().padStart(2,'0')}`;
}

// ─── IOF XML Parser ────────────────────────────────────────────────────────────

function parseIofXml(xmlText: string): CourseEvent | null {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const ns = 'http://www.orienteering.org/datastandard/3.0';
    const g = (parent: Element, ...names: string[]) => {
      for (const n of names) {
        const el = parent.getElementsByTagNameNS(ns, n)[0] || parent.getElementsByTagName(n)[0];
        if (el) return el;
      }
      return null;
    };
    const eventEl = g(doc.documentElement, 'Event');
    let eventName = 'Imported Event';
    if (eventEl) { const n = g(eventEl, 'n', 'Name'); if (n?.textContent) eventName = n.textContent.trim(); }
    const courseEls = doc.getElementsByTagNameNS(ns, 'Course').length > 0
      ? doc.getElementsByTagNameNS(ns, 'Course') : doc.getElementsByTagName('Course');
    const courses: Course[] = [];
    for (let i = 0; i < courseEls.length; i++) {
      const ce = courseEls[i];
      const nameEl = g(ce, 'n', 'Name');
      const name = nameEl?.textContent?.trim() || `Course ${i+1}`;
      const ccEls = ce.getElementsByTagNameNS(ns, 'CourseControl').length > 0
        ? ce.getElementsByTagNameNS(ns, 'CourseControl') : ce.getElementsByTagName('CourseControl');
      const controls: number[] = [];
      for (let j = 0; j < ccEls.length; j++) {
        const cc = ccEls[j];
        if ((cc.getAttribute('type')||'') === 'Start' || (cc.getAttribute('type')||'') === 'Finish') continue;
        const ctrl = g(cc, 'Control');
        if (ctrl?.textContent) { const c = parseInt(ctrl.textContent.trim()); if (!isNaN(c)) controls.push(c); }
      }
      if (controls.length > 0) courses.push({ name, controls, isInline: true, useBoxStart: true });
    }
    return courses.length > 0 ? { name: eventName, courses } : null;
  } catch { return null; }
}

// ─── Course Validation ─────────────────────────────────────────────────────────

function validateInline(course: Course, punches: SiPunch[]): ValidationResult {
  const expected = course.controls;
  const relevant = punches.filter(p => expected.includes(p.code));
  const m = expected.length, n = relevant.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= m; i++) { matrix[i] = new Array(n+1); matrix[i][0] = i; }
  for (let j = 0; j <= n; j++) matrix[0][j] = j;
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    const cost = expected[i] === relevant[j].code ? 0 : 1;
    matrix[i+1][j+1] = Math.min(1+matrix[i+1][j], 1+matrix[i][j+1], cost+matrix[i][j]);
  }
  const cr: ControlResult[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (matrix[i+1][j+1] === matrix[i][j]) { cr.push({expectedCode:expected[i],found:true,timestampMs:relevant[j].timestampMs}); i++; j++; }
    else if (!relevant.slice(j+1).some(p => p.code === expected[i])) { cr.push({expectedCode:expected[i],found:false,timestampMs:NO_TIME}); i++; }
    else j++;
  }
  while (i < m) { cr.push({expectedCode:expected[i],found:false,timestampMs:NO_TIME}); i++; }
  const extra = punches.filter(p => !expected.includes(p.code)).map(p => p.code);
  const miss = cr.filter(r => !r.found).length;
  return { course, controlResults: cr, missingCount: miss, extraControls: extra, allCorrect: miss === 0 };
}
function validateScoreO(course: Course, punches: SiPunch[]): ValidationResult {
  const used = new Array(punches.length).fill(false);
  const cr: ControlResult[] = course.controls.map(code => {
    for (let i = 0; i < punches.length; i++) { if (!used[i] && punches[i].code === code) { used[i] = true; return {expectedCode:code,found:true,timestampMs:punches[i].timestampMs}; } }
    return {expectedCode:code,found:false,timestampMs:NO_TIME};
  });
  const extra = punches.filter(p => !course.controls.includes(p.code)).map(p => p.code);
  const miss = cr.filter(r => !r.found).length;
  return { course, controlResults: cr, missingCount: miss, extraControls: extra, allCorrect: miss === 0 };
}
function autoDetectAndValidate(courses: Course[], punches: SiPunch[]): ValidationResult | null {
  if (courses.length === 0) return null;
  let best: ValidationResult | null = null;
  for (const c of courses) {
    const r = c.isInline ? validateInline(c, punches) : validateScoreO(c, punches);
    if (!best || r.missingCount < best.missingCount || (r.missingCount === best.missingCount && r.course.controls.length > best.course.controls.length)) best = r;
  }
  return best;
}

// ─── Sound Effects ─────────────────────────────────────────────────────────────

function playSuccessSound() {
  try { const ctx = new AudioContext();
    [523.25,659.25,783.99].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.3,ctx.currentTime+i*0.12); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.12+0.5);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime+i*0.12); o.stop(ctx.currentTime+i*0.12+0.5); });
  } catch {}
}
function playErrorSound() {
  try { const ctx = new AudioContext();
    [300,220].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sawtooth'; o.frequency.value=f;
      g.gain.setValueAtTime(0.2,ctx.currentTime+i*0.25); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.25+0.4);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime+i*0.25); o.stop(ctx.currentTime+i*0.25+0.4); });
  } catch {}
}

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
      const v = activeCourses.length > 0 ? autoDetectAndValidate(activeCourses, validPunches) : null;
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

function StatusIndicator({ status }: { status: string }) {
  const labels: Record<string, string> = { OFF:'Disconnected', STARTING:'Connecting…', ON:'Connected', READY:'Ready', PROCESSING:'Reading card…', PROCESSING_ERROR:'Read error', FATAL_ERROR:'Error' };
  return (<div className={`status-indicator ${['ON','READY','PROCESSING'].includes(status) ? 'active' : ''}`}><span className="status-dot" /><span className="status-label">{labels[status]||status}</span></div>);
}

// ═══════════════════════════════════════════════════════════════════════════════

function SetupScreen({ ports, selectedPort, onSelectPort, onScanPorts, onConnect, events, activeEventIndex, onSelectEvent, onAddEvent, onRemoveEvent, statusMessage }: {
  ports: PortInfo[]; selectedPort: string; onSelectPort: (p:string)=>void; onScanPorts: ()=>void; onConnect: ()=>void;
  events: CourseEvent[]; activeEventIndex: number; onSelectEvent: (i:number)=>void; onAddEvent: (ev:CourseEvent)=>void; onRemoveEvent: (i:number)=>void; statusMessage: string;
}) {
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="setup-screen">
      <div className="setup-hero"><h1>NGZ</h1><p className="subtitle">SPORTident card reader for orienteering</p></div>
      <div className="setup-panels">
        <section className="panel connection-panel">
          <h2>① Connect Station</h2>
          <div className="port-row">
            <select value={selectedPort} onChange={e => onSelectPort(e.target.value)} className="port-select">
              {ports.length === 0 && <option value="">No ports found</option>}
              {ports.map(p => <option key={p.path} value={p.path}>{p.path} {p.isSportident ? '★ SI' : ''} {p.manufacturer || ''}</option>)}
            </select>
            <button className="btn-icon" onClick={onScanPorts} title="Refresh">↻</button>
          </div>
          <button className="btn-primary" onClick={onConnect} disabled={!selectedPort}>Connect</button>
          {statusMessage && <p className="error-msg">{statusMessage}</p>}
        </section>

        <section className="panel events-panel">
          <h2>② Select Event</h2>
          <p className="hint">An event is a set of courses. Select which event to use for validation, or create a new one.</p>
          <div className="event-list">
            {events.map((ev, i) => (
              <div key={i} className={`event-card ${i === activeEventIndex ? 'event-active' : ''}`} onClick={() => onSelectEvent(i)}>
                <div className="event-card-header">
                  <span className="event-name">{ev.name}</span>
                  <span className="event-course-count">{ev.courses.length} courses</span>
                  {i === activeEventIndex && <span className="event-active-badge">Active</span>}
                </div>
                <div className="event-courses-preview">
                  {ev.courses.map((c, j) => <span key={j} className="course-chip">{c.name}<span className="course-chip-count">{c.controls.length}</span></span>)}
                </div>
                {ev !== ANIMAL_O_EVENT && <button className="event-remove" onClick={e => { e.stopPropagation(); onRemoveEvent(i); }}>×</button>}
              </div>
            ))}
          </div>
          {!showNew ? <button className="btn-new-event" onClick={() => setShowNew(true)}>+ New Event</button>
          : <NewEventForm onAdd={ev => { onAddEvent(ev); setShowNew(false); }} onCancel={() => setShowNew(false)} />}
        </section>
      </div>
    </div>
  );
}

function NewEventForm({ onAdd, onCancel }: { onAdd: (ev: CourseEvent) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'text'|'xml'>('text');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  const addText = () => {
    const eName = name.trim() || 'Custom Event';
    const courses: Course[] = [];
    for (const [i, line] of text.split('\n').filter(l => l.trim()).entries()) {
      let cName: string, cPart: string;
      if (line.includes(':')) { [cName, cPart] = line.split(':'); cName = cName.trim(); } else { cName = `Course ${i+1}`; cPart = line; }
      const controls = cPart.split(/[,\s]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
      if (controls.length > 0) courses.push({ name: cName, controls, isInline: true, useBoxStart: true });
    }
    if (courses.length > 0) onAdd({ name: eName, courses });
  };

  const handleNativeFileOpen = async () => {
    setErr('');
    const result = await api.openXmlDialog();
    if (!result) return; // cancelled
    const parsed = parseIofXml(result.content);
    if (parsed) {
      onAdd({ name: name.trim() || parsed.name, courses: parsed.courses });
    } else {
      setErr('Could not parse IOF XML file. Make sure it\'s a valid IOF v3 CourseData file.');
    }
  };

  const handlePaste = () => { const p = parseIofXml(text); p ? onAdd({ name: name.trim() || p.name, courses: p.courses }) : setErr('Could not parse XML.'); };

  return (
    <div className="new-event-form">
      <div className="new-event-header"><h3>New Event</h3><button className="btn-cancel" onClick={onCancel}>Cancel</button></div>
      <input type="text" placeholder="Event name" value={name} onChange={e => setName(e.target.value)} className="input-event-name" />
      <div className="mode-tabs">
        <button className={`mode-tab ${mode==='text'?'active':''}`} onClick={() => setMode('text')}>Paste Controls</button>
        <button className={`mode-tab ${mode==='xml'?'active':''}`} onClick={() => setMode('xml')}>IOF XML</button>
      </div>
      {mode === 'text' && <div className="text-input-section">
        <textarea placeholder={'One course per line:\nLion: 31, 33, 36, 38, 39\nFrog: 32, 40, 39, 38, 35\n\nOr just controls (auto-named):\n31, 32, 33, 34, 35'}
          value={text} onChange={e => setText(e.target.value)} className="course-textarea" rows={6} />
        <button className="btn-primary" onClick={addText}>Create Event</button>
      </div>}
      {mode === 'xml' && <div className="xml-input-section">
        <button className="btn-upload" onClick={handleNativeFileOpen}>📁 Open XML File…</button>
        <div className="xml-divider"><span className="xml-or">or paste XML below</span></div>
        <textarea placeholder="Paste IOF v3 XML here..." value={text} onChange={e => { setText(e.target.value); setErr(''); }} className="course-textarea" rows={6} />
        {text.trim() && <button className="btn-primary" onClick={handlePaste}>Import from XML</button>}
        {err && <p className="error-msg">{err}</p>}
      </div>}
    </div>
  );
}

function WaitingScreen({ status }: { status: string }) {
  return (<div className="waiting-screen"><div className="waiting-pulse" /><div className="waiting-content">
    <div className="waiting-icon">◈</div><h2>{status === 'PROCESSING' ? 'Reading card…' : 'Waiting for card'}</h2><p>Insert an SI card into the station</p></div></div>);
}

function ResultScreen({ card, validation, paused, onDismiss }: { card: SiCardData; validation: ValidationResult | null; paused: boolean; onDismiss: () => void }) {
  const isGood = validation ? validation.allCorrect : true;
  const raceMs = (card.startTime !== NO_TIME && card.finishTime !== NO_TIME) ? card.finishTime - card.startTime : -1;
  return (
    <div className={`result-screen ${isGood ? 'result-good' : 'result-bad'}`} onClick={onDismiss}>
      <div className="result-face"><div className="face-circle"><div className="face-eyes"><div className="eye" /><div className="eye" /></div>
        <div className={`face-mouth ${isGood ? 'mouth-happy' : 'mouth-sad'}`} /></div></div>
      <div className="result-info">
        <div className="result-card-number">Card {card.cardNumber}</div>
        {raceMs > 0 && <div className="result-time">{formatTime(raceMs)}</div>}
        {validation && <div className="result-course">{validation.course.name}</div>}
      </div>
      {validation && <div className="result-controls">
        {validation.controlResults.map((cr, i) => <div key={i} className={`control-row ${cr.found ? 'control-ok' : 'control-miss'}`}>
          <span className="control-status">{cr.found ? '✓' : '✗'}</span><span className="control-code">{cr.expectedCode}</span>
          {cr.found && cr.timestampMs !== NO_TIME && card.startTime !== NO_TIME && <span className="control-split">+{formatRaceTime(cr.timestampMs - card.startTime)}</span>}
        </div>)}
        {validation.extraControls.length > 0 && <div className="extra-controls">Extra: {validation.extraControls.join(', ')}</div>}
      </div>}
      <div className="result-footer">{paused ? 'Click to dismiss' : 'Click to pause • Auto-dismiss in 10s'}</div>
    </div>
  );
}

function LogScreen({ history, logs }: { history: ReadHistoryEntry[]; logs: LogEntry[] }) {
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
