// Chromium and Safari enforce form-action across the redirect that follows a
// form submission, so an OAuth consent page must allow the client's redirect
// origin or the browser silently refuses to follow the authorization response.
export function contentSecurityPolicy(formAction: string[] = ["'self'"]) {
  return `default-src 'self'; script-src 'self' https://cdn.plaid.com; frame-src https://*.plaid.com; connect-src 'self' https://*.plaid.com; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction.join(' ')}`;
}
export function formActionSource(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}
