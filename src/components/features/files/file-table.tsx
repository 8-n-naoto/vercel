// 08 5.5 files tab body (Server Component): the sort Select above the tables of file-list.tsx (admin / member columns and empty states).
import type { FileList as FileListDto } from '@/lib/dto'
import { FileList } from './file-list'
import { FileSortSelect, type SortValue } from './file-sort-select'

export function FileTable({ folderId, list, sort }: { folderId: string; list: FileListDto; sort: SortValue }) {
  return (
    <div>
      {list.files.length > 0 ? <FileSortSelect folderId={folderId} sort={sort} /> : null}
      <FileList list={list} />
    </div>
  )
}
