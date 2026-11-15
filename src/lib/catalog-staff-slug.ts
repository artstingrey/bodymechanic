export function catalogStaffSlug(id: number) {
  return `staff-${id}`;
}

export function catalogStaffId(slug: string): number | undefined {
  if (!/^staff-[1-9]\d*$/.test(slug)) return undefined;
  const id = Number(slug.slice('staff-'.length));
  return Number.isSafeInteger(id) && catalogStaffSlug(id) === slug ? id : undefined;
}
