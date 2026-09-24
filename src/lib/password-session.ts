/** A complete navigation clears cached workspace content. Proxy expires the revoked cookie
 * before rendering sign-in; the current browser follows the same policy as every other device. */
export function signInAfterPasswordChange() {
  window.location.replace("/signin?reason=password-changed");
}
