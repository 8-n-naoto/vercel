// 08 4.14. Shown instead of a table when a list is empty. The text is passed by each screen (08 9.4).
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  )
}
