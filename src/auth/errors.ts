export function signInError(error: { code?: string; status?: number }): string {
  if (error.code === 'invalid_credentials') return 'Email or password is incorrect. Check both and try again.'
  if (error.code === 'email_not_confirmed') return 'This account needs email confirmation. Check its status in Supabase before signing in.'
  if (error.status === 429) return 'Too many sign-in attempts. Wait a few minutes and try again.'
  if (error.status === 401 || error.status === 403) return 'Sign-in was rejected. Check the account and project configuration.'
  return 'Unable to sign in. Check your connection and Supabase configuration, then try again.'
}
