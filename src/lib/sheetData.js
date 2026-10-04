import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { formatDay } from './format.js'

const moneyFormat = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'NGN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 })
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })

// A cell's value as people read it (and as it is exported).
export function displayValue(column, value, members = []) {
  if (value === null || value === undefined || value === '') return ''
  switch (column.type) {
    case 'currency': return typeof value === 'number' ? moneyFormat.format(value) : String(value)
    case 'number': return typeof value === 'number' ? numberFormat.format(value) : String(value)
    case 'date': return formatDay(String(value), { day: 'numeric', month: 'short', year: 'numeric' })
    case 'checkbox': return value ? 'Yes' : 'No'
    case 'person': return members.find((member) => member.id === value)?.fullName || ''
    default: return String(value)
  }
}

// Raw value for spreadsheets: numbers stay numbers, dates stay ISO.
function exportValue(column, value, members) {
  if (value === null || value === undefined) return ''
  if (column.type === 'number' || column.type === 'currency') return typeof value === 'number' ? value : String(value)
  if (column.type === 'date') return String(value)
  return displayValue(column, value, members)
}

export function optionFor(column, value) {
  return column.options?.find((option) => option.label === value)
}

// ---------------------------------------------------------------- Filtering, sorting, grouping

export const OPERATORS = {
  text: [['contains', 'contains'], ['is', 'is'], ['empty', 'is empty'], ['filled', 'is not empty']],
  number: [['eq', '='], ['gt', '>'], ['lt', '<'], ['empty', 'is empty'], ['filled', 'is not empty']],
  date: [['before', 'is before'], ['after', 'is after'], ['is', 'is on'], ['empty', 'is empty'], ['filled', 'is not empty']],
  select: [['is', 'is'], ['not', 'is not'], ['empty', 'is empty'], ['filled', 'is not empty']],
  checkbox: [['checked', 'is checked'], ['unchecked', 'is not checked']],
}

export function operatorsFor(type) {
  if (type === 'number' || type === 'currency') return OPERATORS.number
  if (type === 'date') return OPERATORS.date
  if (type === 'select' || type === 'person') return OPERATORS.select
  if (type === 'checkbox') return OPERATORS.checkbox
  return OPERATORS.text
}

function matches(filter, column, value, members) {
  const empty = value === null || value === undefined || value === ''
  const target = String(filter.value ?? '').trim().toLowerCase()
  switch (filter.operator) {
    case 'empty': return empty
    case 'filled': return !empty
    case 'checked': return value === true
    case 'unchecked': return value !== true
    case 'contains': return displayValue(column, value, members).toLowerCase().includes(target)
    case 'is': {
      if (column.type === 'date') return String(value ?? '') === filter.value
      if (column.type === 'person') return value === filter.value
      return displayValue(column, value, members).toLowerCase() === target
    }
    case 'not': return column.type === 'person' ? value !== filter.value : displayValue(column, value, members).toLowerCase() !== target
    case 'eq': return !empty && Number(value) === Number(filter.value)
    case 'gt': return !empty && Number(value) > Number(filter.value)
    case 'lt': return !empty && Number(value) < Number(filter.value)
    case 'before': return !empty && String(value) < filter.value
    case 'after': return !empty && String(value) > filter.value
    default: return true
  }
}

export function applyView(rows, columns, view, members) {
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]))
  const needle = (view.search || '').trim().toLowerCase()
  let result = rows.filter((row) => {
    if (needle && !columns.some((column) => displayValue(column, row.data[column.id], members).toLowerCase().includes(needle))) return false
    return (view.filters || []).every((filter) => {
      const column = byId[filter.column]
      return !column || matches(filter, column, row.data[column.id], members)
    })
  })
  const sortColumn = view.sort && byId[view.sort.column]
  if (sortColumn) {
    const direction = view.sort.direction === 'desc' ? -1 : 1
    const order = sortColumn.type === 'select' ? sortColumn.options?.map((option) => option.label) || [] : null
    result = [...result].sort((a, b) => {
      const left = a.data[sortColumn.id]
      const right = b.data[sortColumn.id]
      const leftEmpty = left === null || left === undefined || left === ''
      const rightEmpty = right === null || right === undefined || right === ''
      if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1
      if (order) return (order.indexOf(left) - order.indexOf(right)) * direction
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction
      if (typeof left === 'boolean') return (Number(left) - Number(right)) * direction
      return displayValue(sortColumn, left, members).localeCompare(displayValue(sortColumn, right, members), undefined, { numeric: true }) * direction
    })
  }
  return result
}

export function groupRows(rows, column, members) {
  if (!column) return [{ key: '', label: '', rows }]
  const groups = new Map()
  const order = column.type === 'select' ? (column.options || []).map((option) => option.label) : []
  order.forEach((label) => groups.set(label, []))
  for (const row of rows) {
    const value = row.data[column.id]
    const key = column.type === 'checkbox' ? (value ? 'Yes' : 'No') : value === null || value === undefined || value === '' ? '' : String(value)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([key, list]) => ({
      key,
      label: key === '' ? `No ${column.name.toLowerCase()}` : column.type === 'person' ? displayValue(column, key, members) || 'Former member' : column.type === 'date' ? displayValue(column, key) : key,
      option: optionFor(column, key),
      rows: list,
    }))
}

// ---------------------------------------------------------------- Export

function download(name, blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(name) {
  return (name || 'sheet').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'sheet'
}

function csvCell(value) {
  const text = String(value ?? '')
  // Leading = + - @ would run as formulas in Excel; prefix them so data stays data.
  const guarded = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toTable(columns, rows, members) {
  return [columns.map((column) => column.name), ...rows.map((row) => columns.map((column) => exportValue(column, row.data[column.id], members)))]
}

export function exportCsv(name, columns, rows, members) {
  const csv = toTable(columns, rows, members).map((line) => line.map(csvCell).join(',')).join('\r\n')
  download(`${safeName(name)}.csv`, new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
}

export function toTsv(columns, rows, members) {
  return toTable(columns, rows, members).map((line) => line.map((value) => String(value).replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n')
}

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function columnLetter(index) {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  return letter
}

// A minimal, valid .xlsx: one worksheet, bold header row, numbers as numbers.
export function exportXlsx(name, columns, rows, members) {
  const table = toTable(columns, rows, members)
  const sheetRows = table.map((line, rowIndex) => `<row r="${rowIndex + 1}">${line.map((value, columnIndex) => {
    const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`
    const style = rowIndex === 0 ? ' s="1"' : ''
    if (typeof value === 'number') return `<c r="${ref}"${style}><v>${value}</v></c>`
    if (value === '') return ''
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(50, Math.max(12, column.name.length + 4))}" customWidth="1"/>`).join('')
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(safeName(name).slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  }
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])))
  download(`${safeName(name)}.xlsx`, new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

// ---------------------------------------------------------------- Import

export function parseCsv(text) {
  const source = text.replace(/^﻿/, '')
  const delimiter = (source.split('\n')[0].match(/\t/g) || []).length > (source.split('\n')[0].match(/,/g) || []).length ? '\t' : source.split('\n')[0].includes(';') && !source.split('\n')[0].includes(',') ? ';' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1 } else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"' && cell === '') quoted = true
    else if (character === delimiter) { row.push(cell); cell = '' } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += character
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((line) => line.some((value) => value.trim() !== ''))
}

function excelDate(serial) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000))
  return date.toISOString().slice(0, 10)
}

// Reads the first worksheet of an .xlsx file into rows of cell values.
export function parseXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer))
  const read = (path) => (files[path] ? strFromU8(files[path]) : '')
  const parser = new DOMParser()
  const shared = [...parser.parseFromString(read('xl/sharedStrings.xml') || '<sst/>', 'application/xml').getElementsByTagName('si')]
    .map((item) => [...item.getElementsByTagName('t')].map((node) => node.textContent).join(''))
  const workbook = parser.parseFromString(read('xl/workbook.xml'), 'application/xml')
  const rels = parser.parseFromString(read('xl/_rels/workbook.xml.rels'), 'application/xml')
  const firstSheet = workbook.getElementsByTagName('sheet')[0]
  const relId = firstSheet?.getAttribute('r:id')
  const target = [...rels.getElementsByTagName('Relationship')].find((rel) => rel.getAttribute('Id') === relId)?.getAttribute('Target') || 'worksheets/sheet1.xml'
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  // Number formats tell dates apart from plain numbers.
  const styles = parser.parseFromString(read('xl/styles.xml') || '<styleSheet/>', 'application/xml')
  const dateFormats = new Set([14, 15, 16, 17, 22, 165, 166, 167, 168])
  ;[...styles.getElementsByTagName('numFmt')].forEach((format) => {
    if (/[dmy]/i.test(format.getAttribute('formatCode') || '') && !/\[h\]|h:mm/i.test(format.getAttribute('formatCode') || '')) dateFormats.add(Number(format.getAttribute('numFmtId')))
  })
  const xfs = [...(styles.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') || [])].map((xf) => Number(xf.getAttribute('numFmtId') || 0))
  const sheet = parser.parseFromString(read(sheetPath), 'application/xml')
  const rows = []
  for (const rowNode of sheet.getElementsByTagName('row')) {
    const cells = []
    for (const cell of rowNode.getElementsByTagName('c')) {
      const ref = cell.getAttribute('r') || ''
      const letters = ref.replace(/\d+/g, '')
      const column = letters ? [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : cells.length
      const type = cell.getAttribute('t')
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      let value
      if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = [...cell.getElementsByTagName('t')].map((node) => node.textContent).join('')
      else if (type === 'b') value = raw === '1'
      else if (type === 'str' || type === 'e') value = raw
      else if (raw === '') value = ''
      else {
        const number = Number(raw)
        value = dateFormats.has(xfs[Number(cell.getAttribute('s') || 0)]) ? excelDate(number) : number
      }
      cells[column] = value
    }
    rows.push(Array.from(cells, (value) => value ?? ''))
  }
  return rows.filter((line) => line.some((value) => String(value).trim() !== ''))
}

export async function readSpreadsheetFile(file) {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer())
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files aren’t supported. In Excel, use File → Save As → .xlsx or .csv.')
  return parseCsv(await file.text())
}

// Guess a column type from imported values, so numbers and dates sort properly.
export function guessType(values) {
  const filled = values.filter((value) => String(value ?? '').trim() !== '')
  if (!filled.length) return 'text'
  if (filled.every((value) => typeof value === 'number' || /^-?[\d,]+(\.\d+)?$/.test(String(value).trim()))) return 'number'
  if (filled.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()))) return 'date'
  if (filled.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value).trim()))) return 'email'
  return 'text'
}
