import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Field, IconButton, Meter, Modal, PageHeader } from '../../components/ui.jsx'
import { api, uploadFile } from '../../lib/api.js'
import { formatBytes, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'
import { ShareModal } from '../Share.jsx'
import { downloadZip } from '../../lib/zip.js'

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

function NewFolderModal({ vault, onClose, onCreated }) {
  const { toast } = useWorkspace()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/files/folders', { method: 'POST', body: { name, vault } })
      toast(`Folder “${name.trim()}” added`)
      onCreated(name.trim())
    } catch (error) {
      toast(error.message, 'error')
      setBusy(false)
    }
  }
  return (
    <Modal title="New folder" eyebrow={vault ? 'Document Vault' : 'Files'} onClose={onClose} width={440} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <Field label="Folder name" hint={vault ? 'Only owners and admins can open vault folders.' : 'Everyone in the workspace can see files in this folder.'}>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required autoFocus placeholder={vault ? 'e.g. Land Titles' : 'e.g. Site Photos'} />
          </Field>
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add folder'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function Files({ vault }) {
  const { account, isManager, isAdmin, reload, confirm, toast, search } = useWorkspace()
  const [state, setState] = useState({ files: [], folders: [], maxFileBytes: 4 * 1024 * 1024, storage: null })
  const [folder, setFolder] = useState('')
  const [uploading, setUploading] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [sharing, setSharing] = useState(null)
  const [addingFolder, setAddingFolder] = useState(false)
  const [zipping, setZipping] = useState('')
  const input = useRef(null)

  const load = useCallback(async () => {
    const result = await api(`/api/files?vault=${vault ? 1 : 0}`)
    setState(result)
  }, [vault])

  useEffect(() => {
    load().catch((error) => toast(error.message, 'error'))
  }, [load, toast])

  const storage = state.storage
  const full = Boolean(storage && storage.usedBytes >= storage.limitBytes)

  async function upload(fileList) {
    const files = [...fileList]
    if (!files.length) return
    const target = folder || (vault ? 'Financial Records' : 'Shared Files')
    let done = 0
    // Mirror the server's hard limit so people learn before uploading; the server still decides.
    let remaining = state.storage ? state.storage.limitBytes - state.storage.usedBytes : Infinity
    for (const file of files) {
      if (file.size > state.maxFileBytes) {
        toast(`${file.name} is larger than ${formatBytes(state.maxFileBytes)}.`, 'error')
        continue
      }
      if (file.size > remaining) {
        toast(remaining <= 0
          ? 'Your storage is full. Delete files or upgrade your plan to upload more.'
          : `${file.name} (${formatBytes(file.size)}) doesn’t fit: ${formatBytes(remaining)} left on your plan.`, 'error')
        continue
      }
      setUploading(`Uploading ${file.name}…`)
      try {
        await uploadFile(file, {
          folder: target, vault, direct: state.directUploads,
          onProgress: (percent) => setUploading(`Uploading ${file.name}… ${percent}%`),
        })
        remaining -= file.size
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

  function removeFolder(item) {
    confirm({
      title: `Delete the “${item.name}” folder?`,
      message: 'The folder is empty, so nothing else is deleted.',
      confirmLabel: 'Delete folder',
      onConfirm: async () => {
        await api(`/api/files/folders?${new URLSearchParams({ name: item.name, vault: vault ? '1' : '0' })}`, { method: 'DELETE' })
        if (folder === item.name) setFolder('')
        toast('Folder deleted')
        await load()
      },
    })
  }

  async function downloadAll() {
    if (!files.length) return
    setZipping(`Preparing 0 of ${files.length}…`)
    try {
      const count = await downloadZip(
        files.map((file) => ({ name: file.name, url: `/api/files/${file.id}/download`, folder: folder ? '' : file.folder })),
        `${account.organization.name} ${vault ? 'Document Vault' : 'Files'}${folder ? ` - ${folder}` : ''}`,
        (done, total) => setZipping(`Preparing ${done} of ${total}…`),
      )
      toast(`Downloaded ${count} ${count === 1 ? 'file' : 'files'} as a ZIP`)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setZipping('')
    }
  }

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
        {files.length > 0 && <Button icon="download" onClick={downloadAll} disabled={Boolean(zipping)}>{zipping || `Download all${folder ? ` in ${folder}` : ''}`}</Button>}
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()} disabled={Boolean(uploading) || full}>
          {uploading ? 'Uploading…' : folder ? `Upload to ${folder}` : 'Upload'}
        </Button>
      </PageHeader>

      {full && (
        <div className="storage-full">
          <Icon name="alert" size={16} />
          <span>Your plan’s storage is full ({formatBytes(storage.usedBytes)} of {formatBytes(storage.limitBytes)}). Delete files or upgrade your plan to upload more.</span>
          {isAdmin && <a href="#/billing">View plans</a>}
        </div>
      )}

      <div className="folder-row">
        <button type="button" className={`folder${!folder ? ' active' : ''}`} onClick={() => setFolder('')}>
          <Icon name={vault ? 'vault' : 'files'} size={16} /><span>All {vault ? 'records' : 'files'}</span><em>{state.files.length}</em>
        </button>
        {state.folders.map((item) => (
          <span key={item.name} className={`folder-wrap${item.custom ? ' custom' : ''}`}>
            <button type="button" className={`folder${folder === item.name ? ' active' : ''}`} onClick={() => setFolder(item.name)}>
              <Icon name="projects" size={16} /><span>{item.name}</span><em>{item.count}</em>
            </button>
            {item.custom && state.canManageFolders && item.count === 0 && (
              <button type="button" className="folder-remove" aria-label={`Delete folder ${item.name}`} title="Delete empty folder" onClick={() => removeFolder(item)}><Icon name="close" size={12} /></button>
            )}
          </span>
        ))}
        {state.canManageFolders && (
          <button type="button" className="folder folder-add" onClick={() => setAddingFolder(true)}>
            <Icon name="plus" size={16} /><span>New folder</span>
          </button>
        )}
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
                      {!vault && <IconButton icon="link" label={`Share ${file.name}`} onClick={() => setSharing(file)} />}
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

      {storage && (
        <div className="storage-row">
          <div>
            <span className="eyebrow">Storage{vault ? ' (shared with Files)' : ''}</span>
            <strong>{formatBytes(storage.usedBytes)} <span>of {formatBytes(storage.limitBytes)}</span></strong>
          </div>
          <Meter value={storage.usedBytes} max={storage.limitBytes || 1} />
          <span className={`storage-left${full ? ' full' : ''}`}>
            {full ? 'Full' : `${formatBytes(storage.limitBytes - storage.usedBytes)} left`}
          </span>
        </div>
      )}
      {addingFolder && <NewFolderModal vault={vault} onClose={() => setAddingFolder(false)} onCreated={async (name) => { setAddingFolder(false); await load(); setFolder(name) }} />}
      {sharing && <ShareModal type="file" id={sharing.id} name={sharing.name} onClose={() => setSharing(null)} />}
      {dragging && <div className="drop-overlay"><Icon name="upload" size={28} />Drop to upload{folder ? ` to ${folder}` : ''}</div>}
    </div>
  )
}

export default Files
