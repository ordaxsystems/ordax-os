import { sections, type AccountPath } from '@/lib/account/model';

/** Resolve a browser pathname against the public /conta base path.
 * The Lovable section catalog remains the only navigation authority.
 */
export function accountSectionFromUrl(pathname: string): AccountPath {
  const canonical = pathname.replace(/\/$/, '');
  const subpath = canonical === '/conta' ? '/'
    : canonical.startsWith('/conta/') ? canonical.slice('/conta'.length) : canonical;
  return sections.find(section => section.path === subpath)?.path ?? '/';
}
