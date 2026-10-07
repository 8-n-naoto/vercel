// 08 3.3 viewer layout (S08): no navigation. The page renders its own ViewerHeader and an iframe that fills the rest of the screen.
export default function ViewLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}
