export function isMeetCallUrl(pathname) {
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(pathname);
}
