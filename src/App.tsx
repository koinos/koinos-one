import { useEffect, useMemo, useState } from 'react'

type BlockRow = {
  height: number
  blockId: string
  producer: string
  txs: number
  timestamp: string
}

const producers = ['alpha.node', 'beta.node', 'gamma.node', 'delta.node']

function makeMockRow(height: number): BlockRow {
  const txs = Math.floor(Math.random() * 120)
  const producer = producers[Math.floor(Math.random() * producers.length)]
  const blockId = `${height.toString(16).padStart(6, '0')}-${Math.random().toString(16).slice(2, 10)}`
  const timestamp = new Date().toLocaleString()
  return { height, blockId, producer, txs, timestamp }
}

export function App() {
  const [rows, setRows] = useState<BlockRow[]>(() => {
    const start = 100000
    return Array.from({ length: 15 }, (_, i) => makeMockRow(start - i))
  })

  useEffect(() => {
    const t = setInterval(() => {
      setRows((prev) => {
        const nextHeight = prev[0].height + 1
        return [makeMockRow(nextHeight), ...prev.slice(0, 19)]
      })
    }, 3000)
    return () => clearInterval(t)
  }, [])

  const status = useMemo(() => `Mock stream activo · ${rows.length} filas`, [rows.length])

  return (
    <div className="layout">
      <header className="header">
        <h1>Knodel Explorer (UI Base)</h1>
        <span>{status}</span>
      </header>

      <main className="panel">
        <table>
          <thead>
            <tr>
              <th>Height</th>
              <th>Block ID</th>
              <th>Producer</th>
              <th>Txs</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.height}-${r.blockId}`}>
                <td>{r.height}</td>
                <td>{r.blockId}</td>
                <td>{r.producer}</td>
                <td>{r.txs}</td>
                <td>{r.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  )
}
