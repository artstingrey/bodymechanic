'use client';
/**
 * Shared state of the body module (3D runtime + DOM UI + 2D fallback). Tiny external store (no extra library):
 * subscribe/getSnapshot for useSyncExternalStore. The booking draft is persisted in sessionStorage (ТЗ 6.8).
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { BodyMarker, BookingDraft, Locale } from '@/lib/api/types';
import { track } from '@/lib/analytics/track';
import { readUtm } from '@/lib/analytics/utm';
import { draftExpired } from '@/lib/booking/draft-ttl';
import { DEFAULT_MARKER_INTENSITY, GENERAL_NOTE_LIMIT, isMarkerIntensity, limitNote, MARKER_NOTE_LIMIT, MAX_MARKERS } from './booking-details';

export { MAX_MARKERS } from './booking-details';

export type Gender = 'male' | 'female';
export type Tool = 'rotate' | 'zoom' | 'marker';
export type Status = 'idle' | 'loading' | 'ready' | 'error' | 'timeout' | 'unavailable';
export type Marker = BodyMarker & { n: number; normal?: [number, number, number] };

/** Events for the aria-live region (formatted with messages by the UI, never hard-coded text). */
export type LiveEvent =
  | { type: 'markerAdded'; n: number; zoneId: string }
  | { type: 'markerRemoved'; n: number }
  | { type: 'allCleared' } | { type: 'maxReached' } | { type: 'outOfZones' } | { type: 'viewReset' } | { type: 'modelLoaded' }
  | { type: 'modelSwitched'; model: Gender; kept: number; dropped: number }
  | { type: 'mode2d' };

export interface BodyState {
  model: Gender;
  /** R-FINAL F-04 (lead): «Маркер» by default on /booking — a drag still rotates, a short tap places a marker */
  tool: Tool;
  autorotate: boolean;
  status: Status;
  progress: number; // 0..1
  mode2d: false | 'noWebgl' | 'lowFps' | 'user' | 'timeout';
  markers: Marker[];
  selectedZones: string[];
  generalNote: string;
  live: { seq: number; event: LiveEvent | null };
  /** recent announcements (≤ 3, last 4 s) — rendered as separate nodes, so a model announcement queues after a marker one
   *  instead of replacing it before the screen reader has read it (R-CODE-03 MINOR) */
  liveLog: { seq: number; event: LiveEvent; at: number }[];
  resetSeq: number; // bumps → runtime resets the view
  /** Visible hint next to the canvas (body3d.hint.*), e.g. a tap on the head or the front of the shin (outside the zone list). */
  hint: { seq: number; key: 'outOfZones' } | null;
  /** 'reduced' = DPR ≤ 1.5 + MeshStandard instead of MeshPhysical (FPS < 30 in the first 3 s; < 20 → 2D, ТЗ 6.11). */
  quality: 'high' | 'reduced';
  /** the draft came back from sessionStorage (ТЗ 6.8) → booking step 1 offers «Продолжить / Начать заново» (N-04) */
  restored: boolean;
  /** bumps → the runtime retries a failed model load (R-APP-01 F-07) */
  loadSeq: number;
}

const KEY = 'bm.bookingDraft';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Each standalone viewer gets a fresh store for its document lifetime. */
export function createBodyStore(viewer = false) {
  let state: BodyState = {
    model: 'male', tool: viewer ? 'rotate' : 'marker', autorotate: true, status: 'idle', progress: 0, mode2d: false,
    markers: [], selectedZones: [], generalNote: '', live: { seq: 0, event: null }, liveLog: [], resetSeq: 0, hint: null, quality: 'high', restored: false, loadSeq: 0,
  };
  const listeners = new Set<() => void>();
  let hydrated = false;

  function emit() { listeners.forEach((l) => l()); }
  function set(patch: Partial<BodyState>, persist = false) {
    state = { ...state, ...patch };
    if (persist) save();
    emit();
  }
  function announce(event: LiveEvent) {
    const seq = state.live.seq + 1, at = Date.now();
    set({ live: { seq, event }, liveLog: [...state.liveLog.filter((e) => at - e.at < 4000), { seq, event, at }].slice(-3) });
  }

  function save(savedAt = Date.now()) {
    if (viewer) return;
    try {
      const draft: Pick<BookingDraft, 'model' | 'markers' | 'generalNote'> & { v: 1 } = {
        v: 1, model: state.model, generalNote: state.generalNote,
        markers: state.markers.map(({ id, zoneId, position, note, intensity }) => ({ id, zoneId, position, note, intensity })),
      };
      sessionStorage.setItem(KEY, JSON.stringify({ ...draft, normals: state.markers.map((m) => m.normal ?? null), savedAt }));
    } catch { /* storage disabled: the draft simply does not survive a reload */ }
  }

  /** Restores the draft once on the client (ТЗ 6.8, 3D-13). */
  function hydrate() {
    if (viewer || hydrated || typeof window === 'undefined') return;
    hydrated = true;
    const patch: Partial<BodyState> = { autorotate: !reducedMotion() };
    let migratedAt: number | null = null;
    try {
      const raw = sessionStorage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : null;
      // Ж-5: zones and notes about the visitor's wellbeing do not wait in a restored tab for more than a day
      if (d && draftExpired(d.savedAt)) sessionStorage.removeItem(KEY);
      else if (d) {
        patch.model = d.model === 'female' ? 'female' : 'male';
        patch.generalNote = typeof d.generalNote === 'string' ? limitNote(d.generalNote, GENERAL_NOTE_LIMIT) : '';
        const markers: BodyMarker[] = Array.isArray(d.markers) ? d.markers : [];
        patch.markers = markers.slice(0, MAX_MARKERS).map((m, i) => ({
          ...m,
          n: i + 1, normal: d.normals?.[i] ?? undefined,
          note: typeof m.note === 'string' ? limitNote(m.note, MARKER_NOTE_LIMIT) : undefined,
          intensity: isMarkerIntensity(m.intensity) ? m.intensity : DEFAULT_MARKER_INTENSITY,
        }));
        patch.restored = patch.markers.length > 0 || !!patch.generalNote.trim();
        if (typeof d.savedAt === 'number' && (patch.generalNote !== d.generalNote || patch.markers.length !== markers.length ||
          patch.markers.some((m, i) => m.note !== markers[i].note || m.intensity !== markers[i].intensity))) migratedAt = d.savedAt;
      }
    } catch { /* ignore broken drafts */ }
    set(patch);
    if (migratedAt !== null) save(migratedAt);
  }

  const nextNumber = () => { const used = new Set(state.markers.map((m) => m.n)); let n = 1; while (used.has(n)) n++; return n; };

  return {
    hydrate,
    get: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
    setModel(model: Gender) {
      if (model === state.model) return;
      set({ model }, !viewer);
      if (!viewer) track('body_model_switch', { model });
    },
    setTool(tool: Tool) { set(tool === 'marker' ? { tool, autorotate: false } : { tool }); },
    setAutorotate(on: boolean) { set({ autorotate: on && !reducedMotion() }); },
    setStatus(status: Status, progress?: number) { set(progress === undefined ? { status } : { status, progress }); },
    setProgress(progress: number) { set({ progress }); },
    setMode2d(reason: BodyState['mode2d']) { set({ mode2d: reason }); if (reason) announce({ type: 'mode2d' }); },
    resetView() { set({ resetSeq: state.resetSeq + 1 }); announce({ type: 'viewReset' }); },
    toggleZone(zoneId: string) {
      const selected = state.selectedZones;
      set({ selectedZones: selected.includes(zoneId) ? selected.filter((id) => id !== zoneId) : [...selected, zoneId] });
    },
    setGeneralNote(generalNote: string) { set({ generalNote: limitNote(generalNote, GENERAL_NOTE_LIMIT) }, true); },
    /** Adds a marker; returns false when the zone is unknown or the limit is reached. */
    addMarker(m: { zoneId: string | null; position: [number, number, number]; normal?: [number, number, number] }): boolean {
      if (!m.zoneId) { set({ hint: { seq: (state.hint?.seq ?? 0) + 1, key: 'outOfZones' } }); announce({ type: 'outOfZones' }); return false; }
      if (state.markers.length >= MAX_MARKERS) { announce({ type: 'maxReached' }); return false; }
      const n = nextNumber();
      const marker: Marker = { id: `m${Date.now().toString(36)}${n}`, n, zoneId: m.zoneId, position: m.position, normal: m.normal, intensity: DEFAULT_MARKER_INTENSITY };
      set({ markers: [...state.markers, marker] }, true);
      announce({ type: 'markerAdded', n, zoneId: m.zoneId });
      if (!viewer) track('body_marker_add', { marker_count: state.markers.length, step: 1, model: state.model }); // no zone (D-01, M7)
      return true;
    },
    updateMarker(id: string, patch: Partial<Pick<Marker, 'note' | 'intensity' | 'position' | 'normal'>>) {
      const note = patch.note === undefined ? undefined : limitNote(patch.note, MARKER_NOTE_LIMIT);
      set({ markers: state.markers.map((m) => (m.id === id ? { ...m, ...patch, ...(note === undefined ? {} : { note }) } : m)) }, true);
    },
    removeMarker(id: string) {
      const m = state.markers.find((q) => q.id === id); if (!m) return;
      set({ markers: state.markers.filter((q) => q.id !== id) }, true);
      announce({ type: 'markerRemoved', n: m.n });
    },
    /** «Очистить все» (3D-07): returns the snapshot for «Вернуть» */
    clearMarkers(): Marker[] { const snapshot = state.markers; set({ markers: [] }, true); announce({ type: 'allCleared' }); return snapshot; },
    /** «Вернуть» after «Очистить все» */
    restoreMarkers(snapshot: Marker[]) { set({ markers: snapshot.slice(0, MAX_MARKERS) }, true); },
    /** after a successful booking (ТЗ 6.8 MUST): the draft is gone, silently (no aria-live «all cleared») */
    resetDraft() {
      set({ markers: [], generalNote: '', restored: false }, true);
      if (viewer) return;
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    },
    dismissRestored() { if (state.restored) set({ restored: false }); },
    retryLoad() { set({ status: 'loading', progress: 0, loadSeq: state.loadSeq + 1 }); },
    /** Used by the runtime after a model switch (markers re-projected; some may be dropped). */
    replaceMarkers(markers: Marker[], switched?: { model: Gender; dropped: number }) {
      set({ markers }, true);
      if (switched) announce({ type: 'modelSwitched', model: switched.model, kept: markers.length, dropped: switched.dropped });
    },
    announceLoaded() { announce({ type: 'modelLoaded' }); },
    clearHint() { if (state.hint) set({ hint: null }); },
    setQuality(quality: BodyState['quality']) { if (quality !== state.quality) set({ quality }); },
    draft(locale: Locale): BookingDraft {
      return { model: state.model, markers: state.markers.map(({ id, zoneId, position, note, intensity }) => ({ id, zoneId, position, note, intensity })), generalNote: state.generalNote || undefined, serviceIds: [], staffId: 0, locale, utm: readUtm() }; // utm: first visit, 30 days (ТЗ §14)
    },
  };
}

export const body = createBodyStore();
export const BodyStoreContext = createContext(body);
export const useBodyStore = () => useContext(BodyStoreContext);

export function useBody<T>(select: (s: BodyState) => T): T {
  const store = useBodyStore();
  const snapshot = () => select(store.get());
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
