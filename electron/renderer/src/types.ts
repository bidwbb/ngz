// Re-export core types so components only need one import source
export type { SiPunch, SiCardData } from '@ngz/si-protocol/types';
export { NO_TIME } from '@ngz/si-protocol/types';
export type { Course, ControlResult, ValidationResult } from '@ngz/course-validator/validator';
export { autoDetectCourse } from '@ngz/course-validator/validator';

// ─── Local types ────────────────────────────────────────────────────────────────

export interface CourseEvent { name: string; courses: Course[]; }
export interface PortInfo { path: string; manufacturer?: string; vendorId?: string; productId?: string; isSportident: boolean; }
export interface LogEntry { time: string; direction: string; message: string; }
export interface ReadHistoryEntry {
  cardNumber: string; cardSeries: string; time: string; raceTime: string;
  courseName: string; allCorrect: boolean; punchCount: number;
}
export type AppScreen = 'setup' | 'waiting' | 'result' | 'log';
