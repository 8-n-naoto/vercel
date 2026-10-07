// A valid input per Server Action name, used by the authorization matrix (integration/authz-matrix.test.ts).
// defineAction validates input before authentication, so a missing or invalid entry would be answered with VALIDATION_FAILED
// and the matrix would prove nothing. Add an entry whenever a user / admin action is added (the matrix fails otherwise).
export const AZ_INPUTS: Record<string, unknown> = {
  'auth.signOut': {},
  'account.updateProfile': { displayName: 'AZ User' },
  'account.changePassword': { currentPassword: 'az-current-password', newPassword: 'az-new-password-123', newPasswordConfirm: 'az-new-password-123' },
  'admin.createInvite': { email: 'az-invitee@example.com', role: 'user' },
  'admin.revokeInvite': { inviteId: '00000000-0000-4000-8000-000000000001' },
}
