import { zip } from 'fflate'

// Downloads many files as one ZIP, built in the browser so there's no server size limit.
// items: [{ name, url }]. Returns how many files went into the ZIP.
export async function downloadZip(items, zipName, onProgress) {
  const entries = {}
  const used = new Set()
  let done = 0
  for (const item of items) {
    const response = await fetch(item.url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Couldn’t download ${item.name}.`)
    // Two files with the same name become "name (2).ext" instead of overwriting each other.
    let name = item.name.replace(/[\\/:*?"<>|]/g, '_')
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.')
      const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
      let copy = 2
      while (used.has(`${base} (${copy})${ext}`.toLowerCase())) copy += 1
      name = `${base} (${copy})${ext}`
    }
    used.add(name.toLowerCase())
    entries[item.folder ? `${item.folder}/${name}` : name] = [new Uint8Array(await response.arrayBuffer()), { level: 6 }]
    done += 1
    onProgress?.(done, items.length)
  }
  const data = await new Promise((resolve, reject) => zip(entries, (error, result) => (error ? reject(error) : resolve(result))))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
  link.download = `${zipName.replace(/[\\/:*?"<>|]/g, '_')}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  return done
}
