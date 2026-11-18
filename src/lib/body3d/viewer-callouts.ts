export const VIEWER_CALLOUTS = [
  { id: 'shoulder_joint_l', side: 'right' },
  { id: 'chest', side: 'left' },
  { id: 'abdomen', side: 'left' },
  { id: 'knee_l', side: 'right' },
  { id: 'ankle_l', side: 'right' },
  { id: 'shoulder_girdle_r', side: 'right' },
  { id: 'thoracic_spine', side: 'left' },
  { id: 'lumbar', side: 'right' },
  { id: 'gluteal_r', side: 'right' },
  { id: 'calves_l', side: 'left' },
] as const;

export const VIEWER_CALLOUT_IDS: ReadonlySet<string> = new Set(VIEWER_CALLOUTS.map(({ id }) => id));
