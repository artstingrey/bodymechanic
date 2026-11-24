export function optimizerSource(src) {
  const url = new URL(src, 'http://localhost');
  return /^\/_next\/image\/?$/.test(url.pathname) ? url.searchParams.get('url') : null;
}
