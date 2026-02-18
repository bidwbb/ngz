/**
 * Course validation algorithms.
 *
 * Ported from EasyGecNG (MIT license):
 *   - outils.EnLigne  → validateInline (Levenshtein-based ordered matching)
 *   - outils.AuScore  → validateScoreO (set-based unordered matching)
 *
 * Original author: Thierry (EasyGec)
 */

import { SiPunch, NO_TIME } from '../si-protocol/SiDataFrame';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface Course {
  name: string;
  controls: number[];          // Expected control codes in order
  isInline: boolean;           // true = ordered (inline), false = score-O
  useBoxStart: boolean;        // true = use SI card start time, false = fixed start time
  fixedStartTimeMs?: number;   // If useBoxStart is false, the fixed start time
}

export interface ControlResult {
  expectedCode: number;
  found: boolean;
  timestampMs: number;         // NO_TIME if not found
}

export interface ValidationResult {
  course: Course;
  controlResults: ControlResult[];
  missingCount: number;
  extraControls: number[];     // Control codes punched but not on the course
  allCorrect: boolean;
}

// ─── Validate inline course (order matters) ────────────────────────────────────

/**
 * Validates an ordered course using Levenshtein distance to find the best
 * alignment between expected controls and actual punches. This handles
 * missing punches, extra punches, and out-of-order punches gracefully.
 *
 * Algorithm ported from EasyGec's `EnLigne.java`.
 */
export function validateInline(
  course: Course,
  punches: SiPunch[]
): ValidationResult {
  const expected = course.controls;

  // Filter punches to only those codes that appear in the expected course.
  // This matches EasyGec's suppCodesInutiles().
  const relevantPunches: SiPunch[] = [];
  for (const p of punches) {
    if (expected.includes(p.code)) {
      relevantPunches.push(p);
    }
  }

  const m = expected.length;
  const n = relevantPunches.length;

  // Build Levenshtein distance matrix
  const matrix: number[][] = [];
  for (let i = 0; i <= m; i++) {
    matrix[i] = new Array(n + 1);
    matrix[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    matrix[0][j] = j;
  }

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const cost = expected[i] === relevantPunches[j].code ? 0 : 1;
      matrix[i + 1][j + 1] = Math.min(
        1 + matrix[i + 1][j],     // insertion
        1 + matrix[i][j + 1],     // deletion
        cost + matrix[i][j]       // substitution
      );
    }
  }

  const totalCost = matrix[m][n];

  // Trace back through the matrix to determine OK/PM for each expected control.
  // This matches EasyGec's okPm() method.
  const controlResults: ControlResult[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (matrix[i + 1][j + 1] === matrix[i][j]) {
      // Match: expected[i] matches punch[j]
      controlResults.push({
        expectedCode: expected[i],
        found: true,
        timestampMs: relevantPunches[j].timestampMs,
      });
      i++;
      j++;
    } else if (!existsCodeFrom(expected[i], relevantPunches, j + 1)) {
      // No more occurrences of this code ahead → missing
      controlResults.push({
        expectedCode: expected[i],
        found: false,
        timestampMs: NO_TIME,
      });
      i++;
    } else {
      // Code exists later — check if skipping this punch is better
      if (matrix[i][j + 1] > totalCost) {
        controlResults.push({
          expectedCode: expected[i],
          found: false,
          timestampMs: NO_TIME,
        });
        i++;
        j--; // Don't advance j (will be incremented by the outer j++ below)
      }
      j++;
    }
  }

  // Handle remaining expected controls (not enough punches)
  while (i < m) {
    controlResults.push({
      expectedCode: expected[i],
      found: false,
      timestampMs: NO_TIME,
    });
    i++;
  }

  // Find extra controls (punched but not on course)
  const extraControls = findExtraControls(expected, punches);

  const missingCount = controlResults.filter((r) => !r.found).length;

  return {
    course,
    controlResults,
    missingCount,
    extraControls,
    allCorrect: missingCount === 0,
  };
}

// ─── Validate score-O course (order doesn't matter) ────────────────────────────

/**
 * Validates a score-O course by simple set matching. Each expected control
 * is checked against the punch list; each punch can only satisfy one expected
 * control.
 *
 * Algorithm ported from EasyGec's `AuScore.java`.
 */
export function validateScoreO(
  course: Course,
  punches: SiPunch[]
): ValidationResult {
  const expected = course.controls;

  // Track which punches have been "used" to satisfy an expected control
  const used = new Array(punches.length).fill(false);

  const controlResults: ControlResult[] = expected.map((expectedCode) => {
    // Find the first unused punch matching this code
    for (let i = 0; i < punches.length; i++) {
      if (!used[i] && punches[i].code === expectedCode) {
        used[i] = true;
        return {
          expectedCode,
          found: true,
          timestampMs: punches[i].timestampMs,
        };
      }
    }
    return {
      expectedCode,
      found: false,
      timestampMs: NO_TIME,
    };
  });

  const extraControls = findExtraControls(expected, punches);
  const missingCount = controlResults.filter((r) => !r.found).length;

  return {
    course,
    controlResults,
    missingCount,
    extraControls,
    allCorrect: missingCount === 0,
  };
}

// ─── Auto-detect course ────────────────────────────────────────────────────────

/**
 * Given multiple courses, validate against all of them and return the one
 * with the fewest missing controls. Ties are broken by course length (prefer
 * longer courses, since a shorter course is more likely a subset match).
 */
export function autoDetectCourse(
  courses: Course[],
  punches: SiPunch[]
): ValidationResult {
  if (courses.length === 0) {
    throw new Error('No courses defined');
  }

  let bestResult: ValidationResult | null = null;

  for (const course of courses) {
    const result = course.isInline
      ? validateInline(course, punches)
      : validateScoreO(course, punches);

    if (
      bestResult === null ||
      result.missingCount < bestResult.missingCount ||
      (result.missingCount === bestResult.missingCount &&
        result.course.controls.length > bestResult.course.controls.length)
    ) {
      bestResult = result;
    }
  }

  return bestResult!;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Check if a given code exists in the punch list starting from a given index */
function existsCodeFrom(
  code: number,
  punches: SiPunch[],
  fromIndex: number
): boolean {
  for (let j = fromIndex; j < punches.length; j++) {
    if (punches[j].code === code) return true;
  }
  return false;
}

/** Find controls that were punched but aren't in the expected course */
function findExtraControls(expected: number[], punches: SiPunch[]): number[] {
  const extras: number[] = [];
  for (const p of punches) {
    if (!expected.includes(p.code)) {
      extras.push(p.code);
    }
  }
  return extras;
}
