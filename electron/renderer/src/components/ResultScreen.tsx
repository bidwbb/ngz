import React from 'react';
import type { SiCardData, ValidationResult } from '../types';
import { NO_TIME } from '../types';
import { formatTime, formatRaceTime } from '../utils';

export function ResultScreen({ card, validation, paused, onDismiss }: {
  card: SiCardData; validation: ValidationResult | null; paused: boolean; onDismiss: () => void;
}) {
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
