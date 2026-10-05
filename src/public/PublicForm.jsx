import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { BrandMark } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import './public.css'

function Input({ field, value, onChange }) {
  const common = { id: field.columnId, name: field.columnId, required: field.required, value: value ?? '', onChange: (event) => onChange(event.target.value) }
  switch (field.type) {
    case 'longtext': return <textarea {...common} rows={4} maxLength={5000} />
    case 'number': case 'currency': return <input {...common} type="number" step="any" inputMode="decimal" />
    case 'date': return <input {...common} type="date" />
    case 'email': return <input {...common} type="email" autoComplete="email" />
    case 'phone': return <input {...common} type="tel" autoComplete="tel" />
    case 'url': return <input {...common} type="url" placeholder="https://" />
    case 'checkbox':
      return <label className="pf-check"><input type="checkbox" checked={Boolean(value)} required={field.required} onChange={(event) => onChange(event.target.checked)} /> Yes</label>
    case 'select':
      return field.options.length <= 5 ? (
        <div className="pf-options">
          {field.options.map((option) => (
            <label key={option} className={`pf-option${value === option ? ' on' : ''}`}>
              <input type="radio" name={field.columnId} value={option} checked={value === option} required={field.required} onChange={() => onChange(option)} />{option}
            </label>
          ))}
        </div>
      ) : (
        <select {...common}><option value="">Choose…</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
      )
    default: return <input {...common} type="text" maxLength={5000} />
  }
}

// A form anyone with the link can fill in; answers land in the business's OVO sheet.
function PublicForm({ token }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    api(`/api/public/forms/${token}`).then((result) => {
      setForm(result.form)
      document.title = `${result.form.title} · ${result.form.organizationName}`
    }).catch((requestError) => setError(requestError.message))
  }, [token])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const website = new FormData(event.currentTarget).get('website')
      const result = await api(`/api/public/forms/${token}`, { method: 'POST', body: { answers, website } })
      setDone(result.message)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  if (!form) {
    return (
      <div className="pf">
        <div className="pf-card pf-center">{error ? <><Icon name="alert" size={22} /><h1>Form unavailable</h1><p>{error}</p></> : <span className="spinner" />}</div>
      </div>
    )
  }

  return (
    <div className={`pf tone-${form.color}`}>
      <div className="pf-card">
        <header className="pf-head">
          <span className="pf-org">{form.organizationName}</span>
          <h1>{form.title}</h1>
          {form.description && <p>{form.description}</p>}
        </header>
        {done ? (
          <div className="pf-done">
            <span className="pf-done-icon"><Icon name="check" size={26} /></span>
            <h2>Sent</h2>
            <p>{done}</p>
            <button type="button" className="pf-again" onClick={() => { setDone(''); setAnswers({}) }}>Submit another response</button>
          </div>
        ) : !form.active ? (
          <div className="pf-done"><h2>This form is closed</h2><p>It’s no longer accepting responses.</p></div>
        ) : (
          <form onSubmit={submit} className="pf-form">
            {form.fields.map((field) => (
              <div key={field.columnId} className="pf-field">
                <label htmlFor={field.columnId}>{field.label}{field.required && <span className="pf-req" aria-label="required">*</span>}</label>
                {field.help && <small>{field.help}</small>}
                <Input field={field} value={answers[field.columnId]} onChange={(value) => setAnswers((current) => ({ ...current, [field.columnId]: value }))} />
              </div>
            ))}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="pf-trap" aria-hidden="true" />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="pf-submit" disabled={busy}>{busy ? 'Sending…' : 'Submit'}<Icon name="send" size={16} /></button>
          </form>
        )}
      </div>
      <a className="pf-brand" href="/" target="_blank" rel="noreferrer">Powered by <BrandMark size={16} label="OVO" /></a>
    </div>
  )
}

export default PublicForm
