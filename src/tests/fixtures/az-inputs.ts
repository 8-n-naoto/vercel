// A valid input per Server Action name, used by the authorization matrix (integration/authz-matrix.test.ts).
// defineAction validates input before authentication, so a missing or invalid entry would be answered with VALIDATION_FAILED
// and the matrix would prove nothing. Add an entry whenever a user / admin action is added (the matrix fails otherwise).
export const AZ_INPUTS: Record<string, unknown> = {
  'auth.signOut': {},
}
