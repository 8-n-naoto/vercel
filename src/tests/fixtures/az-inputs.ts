// A valid input per Server Action name, used by the authorization matrix (integration/authz-matrix.test.ts).
// defineAction validates input before authentication, so a missing or invalid entry would be answered with VALIDATION_FAILED
// and the matrix would prove nothing. Add an entry whenever a user / admin action is added (the matrix fails otherwise).
export const AZ_INPUTS: Record<string, unknown> = {
  'auth.signOut': {},
  'account.updateProfile': { displayName: 'AZ User' },
  'account.changePassword': { currentPassword: 'az-current-password', newPassword: 'az-new-password-123', newPasswordConfirm: 'az-new-password-123' },
  'admin.createInvite': { email: 'az-invitee@example.com', role: 'user' },
  'admin.revokeInvite': { inviteId: '00000000-0000-4000-8000-000000000001' },
  'admin.issuePasswordReset': { userId: '00000000-0000-4000-8000-000000000002' },
  'folders.create': { name: 'AZ Folder', description: '' },
  'folders.update': { folderId: '00000000-0000-4000-8000-000000000003', name: 'AZ Folder', description: '' },
  'folders.delete': { folderId: '00000000-0000-4000-8000-000000000003', confirmName: 'AZ Folder' },
  'members.add': { folderId: '00000000-0000-4000-8000-000000000003', userIds: ['00000000-0000-4000-8000-000000000004'] },
  'members.remove': { folderId: '00000000-0000-4000-8000-000000000003', userId: '00000000-0000-4000-8000-000000000004' },
  'files.startUpload': { folderId: '00000000-0000-4000-8000-000000000003', originalFilename: 'az.html', displayName: null, sizeBytes: 10, contentType: 'text/html' },
  'files.finalizeUpload': { fileId: '00000000-0000-4000-8000-000000000005' },
  'files.cancelUpload': { fileId: '00000000-0000-4000-8000-000000000005' },
  'files.update': { fileId: '00000000-0000-4000-8000-000000000005', displayName: 'AZ File' },
  'files.updateRestrictions': { fileId: '00000000-0000-4000-8000-000000000005', suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: false },
  'files.delete': { fileId: '00000000-0000-4000-8000-000000000005' },
  'view.openAsMember': { fileId: '00000000-0000-4000-8000-000000000005' },
  'view.requestMemberDownload': { fileId: '00000000-0000-4000-8000-000000000005' },
}
