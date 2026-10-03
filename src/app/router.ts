import { useEffect, useState } from 'react';

/** Tiny hash router: #/section/id?tab=x – works offline and from any static host. */
export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? ''), raw };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string, replace = false) {
  const hash = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else window.location.hash = hash;
}

/** Updates one query parameter without adding a history entry. */
export function setQuery(key: string, value: string | null) {
  const r = parse();
  if (value === null || value === '') r.query.delete(key);
  else r.query.set(key, value);
  const qs = r.query.toString();
  navigate(`/${r.path.map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`, true);
}

export const href = (to: string) => `#${to.startsWith('/') ? to : `/${to}`}`;
