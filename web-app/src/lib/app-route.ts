export type AppRoute = 'draft' | 'assistant' | 'sidepanel';

export function getAppRoute(pathname: string): AppRoute {
  if (pathname === '/sidepanel' || pathname.startsWith('/sidepanel/')) {
    return 'sidepanel';
  }
  return pathname === '/assistant' || pathname.startsWith('/assistant/')
    ? 'assistant'
    : 'draft';
}

export function getAppPath(route: AppRoute): '/draft' | '/assistant' | '/sidepanel' {
  if (route === 'sidepanel') return '/sidepanel';
  return route === 'assistant' ? '/assistant' : '/draft';
}

export function getAppHref(
  route: AppRoute,
  search: string = '',
  hash: string = ''
): string {
  const normalizedSearch = search && !search.startsWith('?') ? `?${search}` : search;
  const normalizedHash = hash && !hash.startsWith('#') ? `#${hash}` : hash;
  return `${getAppPath(route)}${normalizedSearch}${normalizedHash}`;
}
