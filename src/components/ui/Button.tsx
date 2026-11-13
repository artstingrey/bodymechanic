import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'text';
type Common = {
  variant?: Variant;
  size?: 'md' | 'sm';
  full?: boolean;
  onDark?: boolean;
  /** Icon after the label; text-arrow buttons default to arrow-right. */
  icon?: IconName;
  className?: string;
  children: ReactNode;
};

function classes({ variant = 'primary', size = 'md', full, onDark, className }: Common) {
  return ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', full && 'btn--full', onDark && 'btn--on-dark', className].filter(Boolean).join(' ');
}

/** Link styled as a button (navigation). Spec: ui-kit «Кнопки». */
export function ButtonLink({ href, variant, size, full, onDark, icon, className, children, ...rest }: Common & Omit<ComponentProps<typeof Link>, 'className' | 'children'>) {
  const ic = icon ?? (variant === 'text' ? 'arrow-right' : undefined);
  return (
    <Link href={href} className={classes({ variant, size, full, onDark, className, children })} {...rest}>
      {children}
      {ic ? <Icon name={ic} /> : null}
    </Link>
  );
}

/**
 * Action button. `loading` sets aria-busy, keeps the width and shows the spinner + `loadingLabel` (from the deck).
 * Disabled buttons use the native attribute (not focusable) unless `ariaDisabled` keeps them in the tab order to explain why.
 */
export function Button({ variant, size, full, onDark, icon, className, children, loading, loadingLabel, type = 'button', ...rest }:
  Common & { loading?: boolean; loadingLabel?: string } & Omit<ComponentProps<'button'>, 'className' | 'children'>) {
  const ic = icon ?? (variant === 'text' ? 'arrow-right' : undefined);
  return (
    <button type={type} className={classes({ variant, size, full, onDark, className, children })} aria-busy={loading || undefined} {...rest}>
      {loading ? <><Icon name="loader" className="spin" />{loadingLabel ?? children}</> : <>{children}{ic ? <Icon name={ic} /> : null}</>}
    </button>
  );
}

export function IconButton({ icon, label, ghost, className, type = 'button', ...rest }:
  { icon: IconName; label: string; ghost?: boolean } & Omit<ComponentProps<'button'>, 'children' | 'aria-label'>) {
  return (
    <button type={type} className={['iconbtn', ghost && 'iconbtn--ghost', className].filter(Boolean).join(' ')} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
