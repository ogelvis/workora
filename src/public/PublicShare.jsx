import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { BrandMark } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { displayValue, exportCsv, exportXlsx, optionFor } from '../lib/sheetData.js'
import { formatBytes } from '../lib/format.js'
import './public.css'

function Value({ column, value }) {
  if (value === null || value === undefined || value === '') return <span className="ps-empty">—</span>
  if (column.type === 'select') {
    const option = optionFor(column, value)
    return <span className={`chip tone-${option?.color || 'slate'}`}>{value}</span>
  }
  if (column.type === 'url') return <a href={/^https?:\/\//i.test(value) ? value : `https://${value}`} target="_blank" rel="noreferrer noopener">{value}</a>
  if (column.type === 'email') return <a href={`mailto:${value}`}>{value}</a>
  return <span>{displayValue(column, value)}</span>
}

// What someone outside the workspace sees from a secure, view-only link.
function PublicShare({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    api(`/api/public/share/${token}`).then((result) => {
      setData(result)
      document.title = `${result.sheet?.name || result.file?.name || 'Shared'} · ${result.organizationName}`
    }).catch((requestError) => setError(requestError.message))
  }, [token])

  const rows = useMemo(() => {
    if (!data?.rows) return []
    const needle = search.trim().toLowerCase()
    if (!needle) return data.rows
    return data.rows.filter((row) => data.sheet.columns.some((column) => displayValue(column, row[column.id]).toLowerCase().includes(needle)))
  }, [data, search])

  if (!data) {
    return (
      <div className="ps">
        <div className="pf-card pf-center">{error ? <><Icon name="alert" size={22} /><h1>Link unavailable</h1><p>{error}</p></> : <span className="spinner" />}</div>
      </div>
    )
  }

  const asRows = (list) => list.map((row) => ({ data: row }))
  return (
    <div className="ps">
      <header className="ps-top">
        <BrandMark size={22} label="OVO" />
        <span className="ps-from">Shared by <strong>{data.organizationName}</strong></span>
        <span className="ps-badge"><Icon name="eye" size={13} />View only</span>
      </header>
      <main className="ps-main">
        {data.type === 'file' && (
          <div className="pf-card ps-file">
            <span className="ps-file-icon"><Icon name="files" size={28} /></span>
            <h1>{data.file.name}</h1>
            <p>{formatBytes(data.file.size)}</p>
            <a className="pf-submit" href={`/api/public/share/${token}/download`}><Icon name="download" size={16} />Download</a>
          </div>
        )}
        {data.type === 'record' && (
          <div className="pf-card ps-record">
            <span className="pf-org">{data.sheet.name}</span>
            <h1>{displayValue(data.sheet.columns[0], data.record.data[data.sheet.columns[0]?.id]) || 'Record'}</h1>
            <dl>
              {data.sheet.columns.map((column) => (
                <div key={column.id}><dt>{column.name}</dt><dd><Value column={column} value={data.record.data[column.id]} /></dd></div>
              ))}
            </dl>
          </div>
        )}
        {data.type === 'sheet' && (
          <section className="ps-sheet">
            <div className="ps-sheet-head">
              <div>
                <h1>{data.sheet.name}{data.sheet.viewName && <span> · {data.sheet.viewName}</span>}</h1>
                <p>{data.sheet.description} {rows.length.toLocaleString()} records</p>
              </div>
              <div className="ps-tools">
                <label className="ps-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search…" aria-label="Search records" /></label>
                {data.allowDownload && <>
                  <button type="button" onClick={() => exportXlsx(data.sheet.name, data.sheet.columns, asRows(rows), [])}><Icon name="download" size={15} />Excel</button>
                  <button type="button" onClick={() => exportCsv(data.sheet.name, data.sheet.columns, asRows(rows), [])}><Icon name="download" size={15} />CSV</button>
                </>}
              </div>
            </div>
            <div className="ps-table-wrap">
              <table className="ps-table">
                <thead><tr>{data.sheet.columns.map((column) => <th key={column.id}>{column.name}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>{data.sheet.columns.map((column) => <td key={column.id} className={['number', 'currency'].includes(column.type) ? 'num' : ''}><Value column={column} value={row[column.id]} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p className="ps-none">No records to show.</p>}
            </div>
          </section>
        )}
        {data.expiresAt && <p className="ps-expiry">This link expires on {new Date(data.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>}
      </main>
    </div>
  )
}

export default PublicShare
