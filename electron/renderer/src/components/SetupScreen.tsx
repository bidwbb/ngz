import React, { useState } from 'react';
import type { Course, CourseEvent, PortInfo } from '../types';
import { api, parseIofXml, ANIMAL_O_EVENT } from '../utils';

export function SetupScreen({ ports, selectedPort, onSelectPort, onScanPorts, onConnect, events, activeEventIndex, onSelectEvent, onAddEvent, onRemoveEvent, statusMessage }: {
  ports: PortInfo[]; selectedPort: string; onSelectPort: (p: string) => void; onScanPorts: () => void; onConnect: () => void;
  events: CourseEvent[]; activeEventIndex: number; onSelectEvent: (i: number) => void; onAddEvent: (ev: CourseEvent) => void; onRemoveEvent: (i: number) => void; statusMessage: string;
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

// ─── NewEventForm (private to SetupScreen) ──────────────────────────────────

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
