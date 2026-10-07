// 08 3.2 public layout (S01-S03): a 400px centered card with the product name. No navigation.
import { Card, CardContent } from '@/components/ui/card'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="flex w-full max-w-[400px] flex-col gap-4">
        <p className="text-center text-xl font-semibold">ファイル共有</p>
        <Card>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  )
}
