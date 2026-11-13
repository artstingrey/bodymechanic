'use client';
/**
 * Online booking, 7 steps (ТЗ §07) — shell: stepper, step announcement and focus (R-APP-01 F-04), the current step view.
 * Logic: ./useBookingFlow (Frontend Builder). Views: ./steps/* (visual layer: Web Art Director).
 */
import { useEffect, useRef } from 'react';
import type { Service } from '@/lib/api/types';
import { STEPS, useBookingFlow } from './useBookingFlow';
import { StepZones } from './steps/StepZones';
import { StepService } from './steps/StepService';
import { StepSpecialist } from './steps/StepSpecialist';
import { StepTime } from './steps/StepTime';
import { StepContacts } from './steps/StepContacts';
import { StepReview } from './steps/StepReview';
import { StepDone } from './steps/StepDone';
import { Stepper } from '@/components/ui/Misc';

const VIEWS = [StepZones, StepService, StepSpecialist, StepTime, StepContacts, StepReview, StepDone];

export function BookingFlow({ services }: { services: Service[] }) {
  const flow = useBookingFlow(services);
  const { t, ready, step, error } = flow;

  // F-04: on every step change move the focus to the step heading (or to the error after slot_taken) — not on first load
  // (the first load = the first step in effect after hydration: a deep link lands on step N without moving the focus)
  const mounted = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!mounted.current) { mounted.current = true; return; }
    const id = requestAnimationFrame(() => {
      const target = (error === 'slotTaken' && document.getElementById('booking-error')) || document.getElementById(`st${step}`);
      target?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [ready, step, error]);

  const View = VIEWS[step - 1];
  return (
    <div className="booking" data-step={step} data-ready={ready || undefined}>
      <Stepper steps={STEPS.map((s) => t(`booking.step.${s}.title`))} current={step - 1} label={t('booking.stepper.label')}
        mobileLabel={t('booking.stepper.progress', { current: step, total: 7 })}
        hrefFor={step < 7 ? (i) => (i === 0 ? '/booking' : { pathname: '/booking', query: { step: String(i + 1) } }) : undefined}
        done={[flow.canLeaveZones, !!flow.sel.serviceId, !!flow.sel.serviceId && step > 3, !!flow.sel.datetime, flow.contactOk, !!flow.result, false]} />
      {/* polite announcement of the step (its text changes with the step → read once, after navigation only) */}
      <p className="sr-only" aria-live="polite" data-testid="booking-live">
        {`${t('booking.stepper.progress', { current: step, total: 7 })}: ${t(`booking.step.${STEPS[step - 1]}.title`)}`}
      </p>
      <View flow={flow} />
    </div>
  );
}
