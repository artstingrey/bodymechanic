'use client';
/**
 * Error state of one form (R-CODE-02 F-05): `submit(errors)` shows all errors at once and moves the focus to the first
 * invalid field; after the first attempt every `field(id, code)` call (blur / change) keeps that field's error current.
 * Callers can defer errors for empty fields until the first submit attempt by passing filled=false.
 *
 * A blur caused by a mouse / touch press (clicking the next checkbox…) must not move the layout under the pointer: a new
 * error line above the target would shift it between pointerdown and pointerup and the click would be lost. While a
 * pointer is pressed, such an update waits for the click to finish (or 400 ms if no click follows).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorCode } from './validate';

let pressed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pressed = true; }, true);
  const up = () => { window.setTimeout(() => { pressed = false; }, 0); };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}
/** run after the current click (bubble phase on window = after React's handlers), with a fallback when no click comes */
export function afterPress(run: () => void) {
  if (!pressed) { run(); return; }
  let done = false;
  const go = () => { if (done) return; done = true; window.removeEventListener('click', go); window.clearTimeout(tm); run(); };
  const tm = window.setTimeout(go, 400);
  window.addEventListener('click', go);
}

export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, ErrorCode>>({});
  const [attempt, setAttempt] = useState(0);
  const focusTo = useRef<string | null>(null);

  useEffect(() => {
    const id = focusTo.current; focusTo.current = null;
    if (id) document.getElementById(id)?.focus();
  }, [attempt]);

  /** true = no errors (go on); false = errors shown, focus on the first one */
  const submit = useCallback((next: Record<string, ErrorCode>) => {
    setErrors(next);
    const first = Object.keys(next)[0];
    if (!first) return true;
    focusTo.current = first;
    setAttempt((a) => a + 1);
    return false;
  }, []);

  /** one field on blur / change: `filled` = the field has a value (before the first attempt only those are checked) */
  const field = useCallback((id: string, code: ErrorCode | null, filled = true) => {
    const apply = () => setErrors((e) => {
      if (!code) { if (!(id in e)) return e; const n = { ...e }; delete n[id]; return n; }
      if (!attempt && !filled && !(id in e)) return e;
      return e[id] === code ? e : { ...e, [id]: code };
    });
    if (code) afterPress(apply); else apply(); // removing an error never waits (the field is fixed)
  }, [attempt]);

  return { errors, attempt, submit, field };
}
