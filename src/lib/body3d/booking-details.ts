export const MAX_MARKERS = 10;
export const MARKER_NOTE_LIMIT = 200;
export const GENERAL_NOTE_LIMIT = 400;
export const DEFAULT_MARKER_INTENSITY = 5;

export function isMarkerIntensity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}

export function limitNote(text: string, limit: number) {
  return text.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '');
}
