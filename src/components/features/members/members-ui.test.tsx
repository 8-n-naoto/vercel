// S05 members tab, D02 and the files tab (08 5.5 / 4.7) via react-dom/server; see folders-ui.test.tsx for why the views are driven by props.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FileList as FileListDto, MemberCandidate, MemberList } from '@/lib/dto'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))
vi.mock('@/app/_actions/members', () => ({
  membersAdd: () => Promise.resolve({ ok: true, data: { added: 1, skipped: 0 } }),
  membersRemove: () => Promise.resolve({ ok: true, data: null }),
}))

import { FileList } from '@/components/features/files/file-list'
import { AddMembersFormView, filterCandidates, MAX_ADD_MEMBERS } from './add-members-dialog'
import { MemberTable } from './member-table'
import { treatNotFoundAsDone } from './remove-member-button'

const none = () => undefined
const F = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'

const adminList: MemberList = {
  access: 'admin',
  members: [
    { userId: 'u1', displayName: '山田', email: 'yamada@example.com', addedAt: '2026-10-10T00:00:00.000Z', disabled: false },
    { userId: 'u2', displayName: '佐藤', email: 'sato@example.com', addedAt: '2026-10-10T00:00:00.000Z', disabled: true },
  ],
}
const memberList: MemberList = { access: 'member', members: [{ userId: 'u1', displayName: '山田' }] }

describe('MemberTable (08 5.5 members tab)', () => {
  it('admin: email, the disabled mark and a remove button per row', () => {
    const html = renderToStaticMarkup(<MemberTable folderId={F} list={adminList} />)
    expect(html).toContain('yamada@example.com')
    expect(html).toContain('佐藤（無効）')
    expect(html).not.toContain('山田（無効）')
    expect(html.match(/外す/g)?.length).toBeGreaterThanOrEqual(2)
  })
  it('S05-4: a member sees display names only (no email, no remove button)', () => {
    const html = renderToStaticMarkup(<MemberTable folderId={F} list={memberList} />)
    expect(html).toContain('山田')
    expect(html).not.toContain('メール')
    expect(html).not.toContain('外す')
    expect(html).not.toContain('@')
  })
  it('empty: only the admin text continues with the add instruction (S05-E3)', () => {
    const admin = renderToStaticMarkup(<MemberTable folderId={F} list={{ access: 'admin', members: [] }} />)
    expect(admin).toContain('メンバーはまだいません')
    expect(admin).toContain('[メンバー追加]')
    const member = renderToStaticMarkup(<MemberTable folderId={F} list={{ access: 'member', members: [] }} />)
    expect(member).toContain('メンバーはまだいません')
    expect(member).not.toContain('[メンバー追加]')
  })
})

describe('treatNotFoundAsDone (06 6.5)', () => {
  it('turns NOT_FOUND into success and leaves other results alone', () => {
    expect(treatNotFoundAsDone({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } })).toEqual({ ok: true, data: null })
    const other = { ok: false, error: { code: 'INTERNAL', message: 'y' } } as const
    expect(treatNotFoundAsDone(other)).toBe(other)
    expect(treatNotFoundAsDone({ ok: true, data: null })).toEqual({ ok: true, data: null })
  })
})

const cands: MemberCandidate[] = [
  { userId: 'a', displayName: 'Alice', email: 'alice@example.com' },
  { userId: 'b', displayName: '田中', email: 'tanaka@Example.org' },
  { userId: 'c', displayName: 'Bob', email: 'bob@example.com' },
]

describe('filterCandidates (08 4.7, D02-3)', () => {
  it('an empty or blank query keeps everyone', () => {
    expect(filterCandidates(cands, '')).toHaveLength(3)
    expect(filterCandidates(cands, '   ')).toHaveLength(3)
  })
  it('matches display name or email, ignoring case and surrounding spaces', () => {
    expect(filterCandidates(cands, ' ALI ').map((c) => c.userId)).toEqual(['a'])
    expect(filterCandidates(cands, 'example.org').map((c) => c.userId)).toEqual(['b'])
    expect(filterCandidates(cands, '田').map((c) => c.userId)).toEqual(['b'])
    expect(filterCandidates(cands, 'zzz')).toEqual([])
  })
})

describe('AddMembersFormView (08 4.7 D02)', () => {
  const base = {
    candidates: cands,
    query: '',
    onQueryChange: none,
    selected: new Set<string>(),
    onToggle: none,
    state: null,
    pending: false,
    onSubmit: none,
  } as const
  it('D02-1: lists the candidates with checkbox, name and email', () => {
    const html = renderToStaticMarkup(<AddMembersFormView {...base} />)
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toContain('alice@example.com')
    expect(html).toContain('0 人選択中')
  })
  it('the selection count follows the selected set', () => {
    const html = renderToStaticMarkup(<AddMembersFormView {...base} selected={new Set(['a', 'c'])} />)
    expect(html).toContain('2 人選択中')
  })
  it('D02-3: filtering hides non-matching rows but the selection stays in the hidden inputs', () => {
    const html = renderToStaticMarkup(<AddMembersFormView {...base} query="田中" selected={new Set(['a'])} />)
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(html).toContain('name="userIds"')
    expect(html).toContain('value="a"')
  })
  it('the checkbox beyond the limit is disabled', () => {
    const many: MemberCandidate[] = Array.from({ length: MAX_ADD_MEMBERS + 1 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `U${i}`,
      email: `u${i}@example.com`,
    }))
    const selected = new Set(many.slice(0, MAX_ADD_MEMBERS).map((c) => c.userId))
    const html = renderToStaticMarkup(<AddMembersFormView {...base} candidates={many} selected={selected} />)
    expect(html.match(/<input[^>]*type="checkbox"[^>]*>/g)?.filter((t) => t.includes('disabled'))).toHaveLength(1)
  })
  it('S05-E4: with no candidates it shows the invite link instead of a form', () => {
    const html = renderToStaticMarkup(<AddMembersFormView {...base} candidates={[]} />)
    expect(html).toContain('追加できるユーザーがいません')
    expect(html).toContain('href="/admin/invites"')
    expect(html).not.toContain('type="checkbox"')
  })
  it('a server error is shown inside the dialog', () => {
    const state = { ok: false, error: { code: 'VALIDATION_FAILED', message: '追加できないユーザーが含まれています' } } as const
    const html = renderToStaticMarkup(<AddMembersFormView {...base} state={state} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('追加できないユーザーが含まれています')
  })
})

describe('FileList (08 5.5 files tab)', () => {
  const adminFiles: FileListDto = {
    access: 'admin',
    files: [
      {
        id: 'f1',
        folderId: F,
        displayName: 'a.html',
        sizeBytes: 2048,
        displayState: 'suspended',
        viewStartsAt: null,
        activeShareLinkCount: 2,
        updatedAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  }
  const memberFiles: FileListDto = {
    access: 'member',
    files: [{ id: 'f1', folderId: F, displayName: 'a.html', sizeBytes: 2048, updatedAt: '2026-10-10T00:00:00.000Z' }],
  }
  it('S05-2 admin: state, link count and the open and detail links', () => {
    const html = renderToStaticMarkup(<FileList list={adminFiles} />)
    expect(html).toContain('a.html')
    expect(html).toContain('公開停止')
    expect(html).toContain('href="/view/f1"')
    expect(html).toContain(`href="/folders/${F}/files/f1"`)
  })
  it('S05-2 member: no state, link count or detail link', () => {
    const html = renderToStaticMarkup(<FileList list={memberFiles} />)
    expect(html).toContain('href="/view/f1"')
    expect(html).not.toContain('状態')
    expect(html).not.toContain('公開リンク')
    expect(html).not.toContain('/files/f1')
  })
  it('empty texts differ by role (S05-E1 / E2)', () => {
    expect(renderToStaticMarkup(<FileList list={{ access: 'admin', files: [] }} />)).toContain('[アップロード]')
    const member = renderToStaticMarkup(<FileList list={{ access: 'member', files: [] }} />)
    expect(member).not.toContain('[アップロード]')
    expect(member).not.toContain('<table')
  })
})
