const DRAG_THRESHOLD = 6;

/** Keep the browser in charge of vertical scrolling and pinch zoom. */
export function bindHeroDrag(canvas: HTMLCanvasElement, rotate: (dx: number) => void, end: () => void) {
  let pointer: { id: number; x: number; y: number; dragging: boolean } | null = null;

  const finish = () => {
    if (!pointer) return;
    const { id, dragging } = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (dragging) end();
  };
  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType !== 'touch' && e.pointerType !== 'mouse') || e.button !== 0 || pointer) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
    canvas.setPointerCapture(e.pointerId);
  };
  const onAdditionalTouch = (e: PointerEvent) => {
    if (pointer && e.pointerType === 'touch' && !e.isPrimary) finish();
  };
  const onMove = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x;
    if (!pointer.dragging) {
      const dy = Math.abs(e.clientY - pointer.y);
      if (e.pointerType === 'touch' && dy >= DRAG_THRESHOLD && dy >= Math.abs(dx)) {
        finish();
        return;
      }
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      pointer.dragging = true;
    }
    pointer.x = e.clientX;
    rotate(dx);
  };
  const onEnd = (e: PointerEvent) => { if (e.pointerId === pointer?.id) finish(); };

  window.addEventListener('pointerdown', onAdditionalTouch, true);
  window.addEventListener('blur', finish);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  canvas.addEventListener('lostpointercapture', onEnd);
  return () => {
    window.removeEventListener('pointerdown', onAdditionalTouch, true);
    window.removeEventListener('blur', finish);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onEnd);
    canvas.removeEventListener('pointercancel', onEnd);
    canvas.removeEventListener('lostpointercapture', onEnd);
    finish();
  };
}
