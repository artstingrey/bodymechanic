import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware Link/router: hrefs are written without the locale (`/services`), the prefix is added automatically.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
