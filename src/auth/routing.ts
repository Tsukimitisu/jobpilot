export const protectedPaths = ['/dashboard', '/jobs', '/applications', '/settings', '/profile', '/resumes']
export function loginDestination(state: unknown): string {
  const from = state && typeof state === 'object' && 'from' in state ? state.from : null
  return typeof from === 'string' && protectedPaths.includes(from) ? from : '/dashboard'
}
