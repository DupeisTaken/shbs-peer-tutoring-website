/** New credentials must remain usable by the bounded account-confirmation path.
 * Do not apply this creation policy to sign-in or normalize an existing secret. */
export const NEW_PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;

export function newPasswordLengthError(
  password: string,
  minimum = NEW_PASSWORD_MIN_LENGTH,
): string | null {
  if (password.length < minimum)
    return `Password must be at least ${minimum} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}
