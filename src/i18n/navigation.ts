import { createNavigation } from 'next-intl/navigation';
import { createElement, type ComponentProps } from 'react';
import { routing } from './routing';

const navigation = createNavigation(routing);
export const { redirect, usePathname, getPathname, useRouter } = navigation;

// Proxy canonicalizes incoming page URLs. Generate canonical links before navigation.
function pageHref(href: string): string {
  const [pathname] = href.split(/[?#]/, 1);
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.endsWith('/') || /\.[^/]+$/.test(pathname)) return href;
  return `${pathname}/${href.slice(pathname.length)}`;
}

export function Link({ href, ...props }: ComponentProps<typeof navigation.Link>) {
  const normalized = typeof href === 'string' ? pageHref(href) :
    typeof href.pathname === 'string' ? { ...href, pathname: pageHref(href.pathname) } : href;
  return createElement(navigation.Link, { ...props, href: normalized });
}
