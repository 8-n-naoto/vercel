import { describe, expect, it } from 'vitest'
import { deleteFolderConfirmText, folderDeletedDetailText, FOLDER_TEXT, membersAddedText, removeMemberConfirmText } from './messages'

// Fixed texts of 08 9.4 / 5.4 / 5.5 / 5.12 / 4.5 / 4.7, copied literally so that a drift fails the test.
describe('folder screen texts (08)', () => {
  it('empty states and notes', () => {
    expect(FOLDER_TEXT.emptyAdmin).toBe('まだフォルダがありません。[フォルダ作成] から作成してください')
    expect(FOLDER_TEXT.emptyMember).toBe('閲覧できるフォルダはまだありません。管理者に追加を依頼してください')
    expect(FOLDER_TEXT.emptyAdminAll).toBe('まだフォルダがありません')
    expect(FOLDER_TEXT.filesEmptyAdmin).toBe('ファイルはまだありません。[アップロード] から追加してください') // S05-E1
    expect(FOLDER_TEXT.filesEmptyMember).toBe('閲覧できるファイルはまだありません') // S05-E2
    expect(FOLDER_TEXT.membersEmpty).toBe('メンバーはまだいません') // S05-E3
    expect(FOLDER_TEXT.candidatesEmpty).toBe('追加できるユーザーがいません（有効な一般ユーザーは全員このフォルダに追加済みです）') // S05-E4
    expect(FOLDER_TEXT.membersNote).toBe('※ システム管理者は全フォルダを管理できるため、この一覧には出ません') // S05-N1
    expect(FOLDER_TEXT.deleted).toBe('フォルダを削除しました')
  })
  it('parameterised texts', () => {
    expect(removeMemberConfirmText('山田')).toBe('山田 さんをこのフォルダから外します。直ちにこのフォルダのファイルを閲覧できなくなります。') // C-02
    expect(deleteFolderConfirmText('設計')).toBe('フォルダ「設計」と、その中のすべてのファイル・公開リンクを削除します。元に戻せません。') // C-05
    expect(folderDeletedDetailText({ deletedFiles: 3, revokedLinks: 2 })).toBe('フォルダを削除しました（ファイル 3 件、公開リンク 2 本）') // S12-2
    expect(membersAddedText({ added: 2, skipped: 0 })).toBe('2 人を追加しました') // D02-2
    expect(membersAddedText({ added: 1, skipped: 1 })).toBe('1 人を追加しました（1 人は既に追加済み）')
  })
})
