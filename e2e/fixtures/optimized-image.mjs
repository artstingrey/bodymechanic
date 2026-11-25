export function optimizerSource(src) {
  const url = new URL(src, 'http://localhost');
  return /^\/_next\/image\/?$/.test(url.pathname) ? url.searchParams.get('url') : null;
}

export function optimizedServicePhotoName(src) {
  const match = optimizerSource(src)?.match(/^\/_next\/static\/(?:immutable\/)?media\/([^/]+)\.[a-z\d_-]+\.png$/i);
  return match ? decodeURIComponent(match[1]) : null;
}
