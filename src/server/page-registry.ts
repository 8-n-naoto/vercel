// Approved public pages (06 11). authz-coverage compares this list with the pages that call pageContext({ auth: 'public' }).
// Adding an entry requires changing 06 11 and ARCHITECTURE 5 in the same change.
export const PUBLIC_PAGES = ['/login', '/invite/[token]', '/reset/[token]', '/s/[token]'] as const
