// Throwaway (T-064): removes only the objects created by the F-014 spike route (prefix spike/t064-).
import { requireDevEnv } from './_guard'
requireDevEnv()
async function main() {
  const { getObjects } = await import('../../src/server/storage/objects')
  const o = getObjects()
  const mine: string[] = []
  for await (const x of o.listAll()) if (x.path.startsWith('spike/t064-')) mine.push(x.path)
  console.error(`found ${mine.length}`)
  if (mine.length) console.error(JSON.stringify(await o.removeMany(mine)))
}
main()
