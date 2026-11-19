import { useEffect, useRef } from 'react';
import { MathUtils, Spherical } from 'three';
import type { OrbitControls } from 'three-stdlib';
import { useBodyStore } from '@/lib/body3d/store';
import { VIEWER_IDLE_MS, VIEWER_LEVEL_MS } from '@/lib/body3d/viewer-timing';

const RADIANS_PER_SECOND = 2 * Math.PI / 30;

export function useViewerAutoRotate(element: HTMLElement | undefined, initialPolarAngle: number) {
  const store = useBodyStore();
  const canRotate = useRef<(() => boolean) | null>(null);
  const alignment = useRef<{ offset: Spherical; elapsed: number } | null>(null);

  useEffect(() => {
    if (!element) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointers = new Set<number>();
    let resumeAt = 0;
    const pause = () => {
      resumeAt = performance.now() + VIEWER_IDLE_MS;
      alignment.current = null;
    };
    const onDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      pause();
    };
    const onEnd = (event: PointerEvent) => {
      if (pointers.delete(event.pointerId)) pause();
    };
    const onBlur = () => {
      if (!pointers.size) return;
      pointers.clear();
      pause();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      pause();
    };
    canRotate.current = () => !motion.matches && pointers.size === 0 && performance.now() >= resumeAt && store.get().status === 'ready';
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('wheel', pause, { passive: true });
    element.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    window.addEventListener('blur', onBlur);
    return () => {
      canRotate.current = null;
      alignment.current = null;
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('wheel', pause);
      element.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [element, store]);

  return function advanceRotation(orbit: OrbitControls | null, delta: number) {
    if (!orbit || !canRotate.current?.()) {
      alignment.current = null;
      return 0;
    }

    const step = Math.min(delta, 0.1);
    if (!alignment.current && Math.abs(orbit.getPolarAngle() - initialPolarAngle) > 0.001) {
      const offset = new Spherical().setFromVector3(orbit.object.position.clone().sub(orbit.target));
      alignment.current = { offset, elapsed: 0 };
      if (orbit.enableDamping) {
        // Clear residual drag before applying the saved view, even if frames were throttled while idle.
        orbit.enableDamping = false;
        orbit.update();
        orbit.enableDamping = true;
      }
    }

    const current = alignment.current;
    if (current) {
      current.elapsed += step * 1000;
      const progress = Math.min(current.elapsed / VIEWER_LEVEL_MS, 1);
      const easing = progress * progress * (3 - 2 * progress);
      const { phi, radius, theta } = current.offset;
      orbit.object.position.setFromSphericalCoords(radius, MathUtils.lerp(phi, initialPolarAngle, easing), theta).add(orbit.target);
      orbit.update();
      if (progress === 1) alignment.current = null;
      return 0;
    }

    return RADIANS_PER_SECOND * step;
  };
}
