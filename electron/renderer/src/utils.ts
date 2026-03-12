import { NO_TIME } from './types';
import type { Course, CourseEvent } from './types';

// ─── Electron API ──────────────────────────────────────────────────────────────

export const api = (window as any).electronAPI || {
  listPorts: async () => [], autoDetect: async () => null,
  startDriver: async () => ({ success: false, error: 'Not in Electron' }),
  stopDriver: async () => {}, openXmlDialog: async () => null,
  onStatus: () => {}, onCardRead: () => {},
  onLog: () => {}, removeAllListeners: () => {},
};

// ─── Built-in Animal-O Event ───────────────────────────────────────────────────

export const ANIMAL_O_EVENT: CourseEvent = {
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

// ─── Time Formatting ──────────────────────────────────────────────────────────

export function formatTime(ms: number): string {
  if (ms === NO_TIME || ms < 0) return '--:--:--';
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t/3600).toString().padStart(2,'0')}:${Math.floor((t%3600)/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
}

export function formatRaceTime(ms: number): string {
  if (ms <= 0 || ms === NO_TIME) return '--:--';
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t/60)}:${(t%60).toString().padStart(2,'0')}`;
}

// ─── IOF XML Parser ────────────────────────────────────────────────────────────

export function parseIofXml(xmlText: string): CourseEvent | null {
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
  } catch (err) {
    console.error('Failed to parse IOF XML:', err);
    return null;
  }
}

// ─── Sound Effects ─────────────────────────────────────────────────────────────

export function playSuccessSound() {
  try { const ctx = new AudioContext();
    [523.25,659.25,783.99].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.3,ctx.currentTime+i*0.12); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.12+0.5);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime+i*0.12); o.stop(ctx.currentTime+i*0.12+0.5); });
  } catch {}
}

export function playErrorSound() {
  try { const ctx = new AudioContext();
    [300,220].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sawtooth'; o.frequency.value=f;
      g.gain.setValueAtTime(0.2,ctx.currentTime+i*0.25); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.25+0.4);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime+i*0.25); o.stop(ctx.currentTime+i*0.25+0.4); });
  } catch {}
}
