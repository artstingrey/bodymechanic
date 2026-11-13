/** Types for body2d-callouts.mjs (Brand Designer, site/design/body2d/lib; synced by scripts/sync-assets.mjs). */
export type CalloutMode = 'full' | 'compact' | 'none';
export interface LayoutOptions {
  mode?: 'auto' | CalloutMode;
  allowCompact?: boolean;
  names?: Record<string, string>;
  locale?: 'ru' | 'en';
  guard?: boolean;
}
export interface LayoutResult {
  mode: CalloutMode;
  scale: number;
  viewBox: { x: number; y: number; w: number; h: number };
  items: { id: string; n: number; side: 'L' | 'R'; y: number; points: { x: number; y: number }[]; lines: string[] }[];
  collisions: { markers: number; leaders: number };
  clipped: boolean;
  dropped?: 'no-room' | 'clipped';
}
export function layout(svg: SVGSVGElement, selected: string[], options?: LayoutOptions): LayoutResult;
export function drawMarkers(svg: SVGSVGElement, selected: string[], options?: { justAdded?: string | null }): void;
export function crosshair(svg: SVGSVGElement, zoneId: string | null, selected?: string[]): boolean;
export function clearCache(): void;
export function applyView(svg: SVGSVGElement, options?: LayoutOptions): void;
export function destroy(svg: SVGSVGElement): void;
export function figureScale(svg: SVGSVGElement): number;
