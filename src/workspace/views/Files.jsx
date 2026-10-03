import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, IconButton, Meter, PageHeader } from '../../components/ui.jsx'
import { api, uploadFile } from '../../lib/api.js'
import { formatBytes, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function fileKind(file) {
  const extension = file.name.split('.').pop().toLowerCase()
  if (file.mimeType.startsWith('image/')) return ['IMG', 'img']
  if (file.mimeType === 'application/pdf' || extension === 'pdf') return ['PDF', 'pdf']
  if (['doc', 'docx', 'txt', 'rtf', 'md', 'odt'].includes(extension)) return ['DOC', 'doc']
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return ['XLS', 'xls']
  if (['ppt', 'pptx', 'key'].includes(extension)) return ['PPT', 'ppt']
  if (['zip', 'rar', '7z', 'gz'].includes(extension)) return ['ZIP', 'zip']
  if (file.mimeType.startsWith('video/')) return ['VID', 'vid']
  return [extension.slice(0, 3).toUpperCase() || 'FILE', 'other']
}

function Files({ vault }) {
  const { account, data, isManager, isAdmin, reload, confirm, toast, search } = useWorkspace()
  const [state, setState] = useState({ files: [], folders: [], maxFileBytes: 4 * 1024 * 1024 })
  const [folder, setFolder] = useState('')
  const [uploading, setUploading] = useState(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef(null)
  const stats = data.dashboard?.stats || {}

  const load = useCallback(async () => {
    const result = await api(`/api/files?vault=${vault ? 1 : 0}`)
    setState(result)
  }, [vault])

  useEffect(() => {
    load().catch((error) => toast(error.message, 'error'))
  }, [load, toast])

  async function upload(fileList) {
    const files = [...fileList]
    if (!files.length) return
    const target = folder || state.folders[state.folders.length - 1]?.name
    let done = 0
    for (const file of files) {
      if (file.size > state.maxFileBytes) {
        toast(`${file.name} is larger than ${formatBytes(state.maxFileBytes)}.`, 'error')
        continue
      }
      setUploading(`Uploading ${file.name}…`)
      try {
        await uploadFile(file, { folder: target, vault })
        done += 1
      } catch (error) {
        toast(`${file.name}: ${error.message}`, 'error')
      }
    }
    setUploading(null)
    if (input.current) input.current.value = ''
    if (done) {
      toast(done === 1 ? 'File uploaded' : `${done} files uploaded`)
      await Promise.all([load(), reload(['dashboard'])])
    }
  }

  function removeFile(file) {
    confirm({
      title: 'Delete file?',
      message: `“${file.name}” will be permanently deleted.`,
      onConfirm: async () => {
        await api(`/api/files/${file.id}`, { method: 'DELETE' })
        await Promise.all([load(), reload(['dashboard'])])
        toast('File deleted')
      },
    })
  }

  const query = search.trim().toLowerCase()
  const files = state.files
    .filter((file) => !folder || file.folder === folder)
    .filter((file) => !query || `${file.name} ${file.folder} ${file.uploadedBy || ''}`.toLowerCase().includes(query))
  const canDelete = (file) => isAdmin || isManager || file.uploadedById === account.user.id

  return (
    <div
      className={`stack${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files) } }}
    >
      <PageHeader
        eyebrow={vault ? 'Restricted workspace' : 'Collaborate / Files'}
        title={vault ? 'Document Vault' : 'Company files'}
        description={vault
          ? 'Contracts, certificates and records only owners and admins can open.'
          : 'Share documents with the whole team, organized by folder.'}
      >
        {vault && <span className="vault-badge"><Icon name="shield" size={15} /> Owners & admins only</span>}
        <input ref={input} type="file" multiple hidden onChange={(event) => upload(event.target.files)} />
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()} disabled={Boolean(uploading)}>
          {uploading ? 'Uploading…' : folder ? `Upload to ${folder}` : 'Upload'}
        </Button>
      </PageHeader>

      <div className="folder-row">
        <button type="button" className={`folder${!folder ? ' active' : ''}`} onClick={() => setFolder('')}>
          <Icon name={vault ? 'vault' : 'files'} size={16} /><span>All {vault ? 'records' : 'files'}</span><em>{state.files.length}</em>
        </button>
        {state.folders.map((item) => (
          <button key={item.name} type="button" className={`folder${folder === item.name ? ' active' : ''}`} onClick={() => setFolder(item.name)}>
            <Icon name="projects" size={16} /><span>{item.name}</span><em>{item.count}</em>
          </button>
        ))}
      </div>

      {uploading && <div className="upload-status"><span className="spinner" />{uploading}</div>}

      {files.length ? (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Name</th><th>Folder</th><th>Uploaded by</th><th>Added</th><th>Size</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {files.map((file) => {
                const [label, kind] = fileKind(file)
                return (
                  <tr key={file.id}>
                    <td>
                      <a className="file-cell" href={`/api/files/${file.id}/download${kind === 'img' ? '?inline=1' : ''}`} target="_blank" rel="noreferrer">
                        <i className={`file-icon file-${kind}`}>{label}</i>
                        <span>{file.name}</span>
                      </a>
                    </td>
                    <td>{file.folder}</td>
                    <td>{file.uploadedBy ? <span className="assignee"><Avatar name={file.uploadedBy} size="xs" />{file.uploadedBy}</span> : <span className="muted">Former member</span>}</td>
                    <td className="muted">{timeAgo(file.createdAt)}</td>
                    <td className="muted">{formatBytes(file.sizeBytes)}</td>
                    <td className="cell-actions">
                      <a className="icon-btn" href={`/api/files/${file.id}/download`} aria-label={`Download ${file.name}`} title="Download"><Icon name="download" size={17} /></a>
                      {canDelete(file) && <IconButton icon="trash" label={`Delete ${file.name}`} onClick={() => removeFile(file)} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <button type="button" className="dropzone" onClick={() => input.current?.click()}>
          <span className="empty-icon"><Icon name="upload" size={22} /></span>
          <strong>{state.files.length ? 'No files match' : folder ? `${folder} is empty` : vault ? 'Your vault is empty' : 'Upload your first file'}</strong>
          <span>Drag files here or click to browse · up to {formatBytes(state.maxFileBytes)} each</span>
        </button>
      )}

      {!vault && (
        <div className="storage-row">
          <div>
            <span className="eyebrow">Storage</span>
            <strong>{formatBytes(stats.storageUsedBytes)} <span>of {formatBytes(stats.storageLimitBytes)}</span></strong>
          </div>
          <Meter value={stats.storageUsedBytes || 0} max={stats.storageLimitBytes || 1} />
        </div>
      )}
      {dragging && <div className="drop-overlay"><Icon name="upload" size={28} />Drop to upload{folder ? ` to ${folder}` : ''}</div>}
    </div>
  )
}

export default Files
