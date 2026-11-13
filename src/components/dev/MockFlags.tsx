'use client';
/** Keeps `?mock=…` of the landing URL for the whole tab (lib/api/mock-flags): the booking steps drop the query later. */
import { useEffect } from 'react';
import { mockMode } from '@/lib/api/mock-flags';

export function MockFlags() {
  useEffect(() => { mockMode(); }, []);
  return null;
}
