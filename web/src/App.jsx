import { useEffect, useMemo, useRef, useState } from 'react'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const REQUIRED_COLUMNS = [
  'Name',
  'Phone',
  'Current Role',
  'Key Skills',
  'Profile Summary',
  'JD Link',
]

// Maps common header variants to canonical keys
const HEADER_ALIASES = {
  name: 'Name',
  fullname: 'Name',
  candidate: 'Name',

  phone: 'Phone',
  phonenumber: 'Phone',
  mobilenumber: 'Phone',
  mobile: 'Phone',
  contact: 'Phone',

  currentrole: 'Current Role',
  role: 'Current Role',
  designation: 'Current Role',

  keyskills: 'Key Skills',
  skills: 'Key Skills',

  profilesummary: 'Profile Summary',
  summary: 'Profile Summary',

  jd: 'JD Link',
  jdlink: 'JD Link',
  jobdescription: 'JD Link',
  joblink: 'JD Link',
  link: 'JD Link',
}

function normalizeHeaderKey(key, mappingLookup) {
  const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
  return mappingLookup[compact] || HEADER_ALIASES[compact] || key
}

function normalizeRowHeaders(row, mappingLookup) {
  const normalized = {}
  for (const [rawKey, value] of Object.entries(row)) {
    const targetKey = normalizeHeaderKey(rawKey, mappingLookup)
    normalized[targetKey] = value
  }
  return normalized
}

function cleanPhone(raw, countryCode, autoDetectCountry) {
  if (!raw) return ''
  const rawStr = String(raw)
  // Try libphonenumber first
  try {
    let phone = parsePhoneNumberFromString(rawStr, (countryCode || 'IN'))
    if (!phone && autoDetectCountry) phone = parsePhoneNumberFromString(rawStr)
    if (phone && phone.isValid()) return phone.number.replace(/\+/g, '')
  } catch {}
  // Fallback: last 10 digits + country code
  const digits = rawStr.replace(/\D+/g, '')
  const last10 = digits.slice(-10)
  if (!last10) return ''
  if (autoDetectCountry && digits.length > 10) {
    const detected = digits.slice(0, digits.length - 10)
    if (detected) return `${detected}${last10}`
  }
  const cc = String(countryCode || '').replace(/\D+/g, '') || '91'
  return `${cc}${last10}`
}

const DEFAULT_TEMPLATE = [
  'Dear *{NAME}*,',
  'I am *Vani, Recruiter at I Knowledge Factory Pvt. Ltd.* – a full-service *digital branding and marketing agency*.',
  '',
  'We reviewed your profile on *Naukri Portal* and found it suitable for the role of *{ROLE}*.',
  '',
  'If you are open to exploring opportunities with us, please review the *Job Description on our website and apply here*: {JD_LINK}',
  '',
  'Once done, I will connect with you to schedule the *screening round*.',
  '',
  'Best regards,',
  '*Vani Jha*',
  'Talent Acquisition Specialist',
  '*+91 9665079317*',
  '*www.ikf.co.in*',
].join('\n')

function fillTemplate(template, values) {
  const safe = template || DEFAULT_TEMPLATE
  return safe
    .replaceAll('{NAME}', values.name || '')
    .replaceAll('{ROLE}', values.role || '')
    .replaceAll('{JD_LINK}', values.jd || '')
}

function generateMessage(row, template) {
  const name = row['Name']?.toString().trim() || ''
  const role = row['Current Role']?.toString().trim() || ''
  const jd = row['JD Link']?.toString().trim() || ''

  return fillTemplate(template, { name, role, jd })
}

function encodeForWhatsApp(text) {
  return encodeURIComponent(text).replace(/%5Cn/g, '%0A').replace(/%20/g, '%20')
}

function ensureColumns(row, mappingLookup) {
  const normalized = normalizeRowHeaders({ ...row }, mappingLookup)
  for (const key of REQUIRED_COLUMNS) {
    if (!(key in normalized)) normalized[key] = ''
  }
  return normalized
}

function normalizeUrlMaybe(urlLike) {
  const raw = (urlLike ?? '').toString().trim()
  if (!raw) return ''
  const cleaned = raw.replace(/\s+/g, '')
  if (/^https?:\/\//i.test(cleaned)) return cleaned
  return `https://${cleaned}`
}

function App() {
  const [rows, setRows] = useState([])
  const [missingJDRows, setMissingJDRows] = useState([])
  const [activeTab, setActiveTab] = useState('results')
  const [errors, setErrors] = useState([])
  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  // Smart settings
  const [countryCode, setCountryCode] = useState('91')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [dedupeByPhone, setDedupeByPhone] = useState(true)
  const [autoDetectCountry, setAutoDetectCountry] = useState(true)
  const [search, setSearch] = useState('')
  const [detectedHeaders, setDetectedHeaders] = useState([])
  const [columnMapping, setColumnMapping] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hwc_colmap') || 'null') || {} } catch { return {} }
  })
  // URL import state
  const [importUrl, setImportUrl] = useState('')
  // Batch open state
  const [openIndex, setOpenIndex] = useState(0)
  const [batchSize, setBatchSize] = useState(10)
  // QR state
  const [qrOpen, setQrOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const mappingLookup = useMemo(() => {
    const map = {}
    for (const [canonical, original] of Object.entries(columnMapping || {})) {
      if (!original) continue
      const compact = String(original).toLowerCase().replace(/[^a-z0-9]/g, '')
      map[compact] = canonical
    }
    return map
  }, [columnMapping])

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hwc_settings') || '{}')
      if (saved?.countryCode) setCountryCode(String(saved.countryCode))
      if (saved?.template) setTemplate(String(saved.template))
      if (typeof saved?.dedupeByPhone === 'boolean') setDedupeByPhone(saved.dedupeByPhone)
      if (typeof saved?.autoDetectCountry === 'boolean') setAutoDetectCountry(saved.autoDetectCountry)
    } catch {}
  }, [])

  // Persist to localStorage
  useEffect(() => {
    const payload = { countryCode, template, dedupeByPhone, autoDetectCountry }
    try { localStorage.setItem('hwc_settings', JSON.stringify(payload)) } catch {}
  }, [countryCode, template, dedupeByPhone, autoDetectCountry])

  useEffect(() => {
    try { localStorage.setItem('hwc_colmap', JSON.stringify(columnMapping || {})) } catch {}
  }, [columnMapping])

  const processed = useMemo(() => {
    const out = []
    const missing = []
    const invalid = []
    const seenPhones = new Set()

    for (const r of rows) {
      const normalized = ensureColumns(r, mappingLookup)
      const phone = cleanPhone(normalized['Phone'], countryCode, autoDetectCountry)
      const jdNorm = normalizeUrlMaybe(normalized['JD Link'])
      const display = {
        Name: normalized['Name'],
        'Current Role': normalized['Current Role'],
        Phone: phone,
        'JD Link': jdNorm,
      }
      if (!phone) {
        invalid.push({ ...display, WhatsApp_Link: '' })
        if (!jdNorm) missing.push({ ...display, WhatsApp_Link: '' })
        continue
      }
      if (dedupeByPhone) {
        if (seenPhones.has(phone)) continue
        seenPhones.add(phone)
      }
      const message = generateMessage({ ...normalized, 'JD Link': jdNorm }, template)
      const encoded = encodeForWhatsApp(message)
      const link = `https://wa.me/${phone}?text=${encoded}`
      const record = { ...display, WhatsApp_Link: link }
      out.push(record)
      if (!jdNorm) missing.push(record)
    }

    // Search filter
    const q = search.trim().toLowerCase()
    const filterByQuery = (arr) => !q ? arr : arr.filter(r =>
      (r['Name'] || '').toString().toLowerCase().includes(q) ||
      (r['Current Role'] || '').toString().toLowerCase().includes(q)
    )

    return { out: filterByQuery(out), missing: filterByQuery(missing), invalid: filterByQuery(invalid) }
  }, [rows, countryCode, template, dedupeByPhone, autoDetectCountry, search, mappingLookup])

  function onFilesSelected(fileList) {
    const file = fileList?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => handleParsedRows(res.data),
        error: (err) => setErrors([`CSV parse error: ${err.message}`]),
      })
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const firstSheet = wb.SheetNames[0]
        const ws = wb.Sheets[firstSheet]
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
        handleParsedRows(json)
      }
      reader.onerror = () => setErrors(['Excel read error'])
      reader.readAsArrayBuffer(file)
    } else {
      setErrors(['Unsupported file type. Use .csv or .xlsx'])
    }
  }

  function handleParsedRows(list) {
    const headers = Object.keys(list?.[0] || {})
    setDetectedHeaders(headers)
    const normalized = list.map(r => ensureColumns(r, mappingLookup))
    const missingCols = REQUIRED_COLUMNS.filter(c => !(c in normalized[0] || {}))
    if (missingCols.length) {
      setErrors([`Missing required columns: ${missingCols.join(', ')}`])
    } else {
      setErrors([])
    }
    setRows(normalized)
    setMissingJDRows(normalized.filter(r => !r['JD Link']))
  }

  function handlePaste(text) {
    // Try to parse as CSV/TSV-like pasted table
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true })
    if (parsed?.data?.length) {
      handleParsedRows(parsed.data)
      return
    }
  }

  function exportCSV(list, filename) {
    const csv = Papa.unparse(list)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, filename)
  }

  function downloadTemplateCSV() {
    const template = [
      {
        Name: 'John Doe',
        Phone: '+91 98765 43210',
        'Current Role': 'Senior Designer',
        'Key Skills': 'Figma, UX, UI',
        'Profile Summary': '7+ years in product design',
        'JD Link': 'https://www.ikf.co.in/careers/example-role',
      },
    ]
    exportCSV(template, 'candidate_template.csv')
  }

  function copyAllLinks() {
    const links = processed.out.map(r => r.WhatsApp_Link).filter(Boolean).join('\n')
    if (!links) return
    navigator.clipboard.writeText(links)
  }

  // Batch open controls
  function openNextBatch() {
    const slice = processed.out.slice(openIndex, openIndex + batchSize)
    slice.forEach(r => { if (r.WhatsApp_Link) window.open(r.WhatsApp_Link, '_blank') })
    setOpenIndex(i => Math.min(i + slice.length, processed.out.length))
  }
  function resetBatch() { setOpenIndex(0) }

  function exportInvalidCSV() {
    if (!processed.invalid.length) return
    exportCSV(processed.invalid, 'invalid_phone_rows.csv')
  }

  function onDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    onFilesSelected(files)
  }

  function onDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  // Import from URL (CSV or Google Sheets)
  async function fetchCSVFromUrl() {
    try {
      if (!importUrl) return
      let url = importUrl.trim()
      const sheetsMatch = url.match(/docs.google.com\/spreadsheets\/d\/([^/]+)/)
      if (sheetsMatch) {
        const id = sheetsMatch[1]
        url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`
      }
      const res = await fetch(url)
      const text = await res.text()
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
      if (parsed?.data?.length) handleParsedRows(parsed.data)
    } catch (e) {
      setErrors([`Import failed: ${e.message}`])
    }
  }
  // Quick fix 10-digit phones
  function fixTenDigitPhones() {
    const cc = String(countryCode || '').replace(/\D+/g, '') || '91'
    const transformed = rows.map(r => {
      const digits = String(r['Phone'] || '').replace(/\D+/g, '')
      if (digits.length === 10) return { ...r, Phone: `${cc}${digits}` }
      return r
    })
    setRows(transformed)
  }
  // Project export/import
  function exportProject() {
    const payload = { settings: { countryCode, template, dedupeByPhone, autoDetectCountry }, columnMapping, rows }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    saveAs(blob, 'hr_whatsapp_project.json')
  }
  function importProject(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(String(e.target.result || '{}'))
        if (json?.settings) {
          setCountryCode(String(json.settings.countryCode || '91'))
          setTemplate(String(json.settings.template || DEFAULT_TEMPLATE))
          setDedupeByPhone(Boolean(json.settings.dedupeByPhone))
          setAutoDetectCountry(Boolean(json.settings.autoDetectCountry))
        }
        if (json?.columnMapping) setColumnMapping(json.columnMapping)
        if (Array.isArray(json?.rows)) setRows(json.rows)
      } catch {
        setErrors(['Invalid project file'])
      }
    }
    reader.readAsText(file)
  }
  async function openQr(link) {
    if (!link) return
    const { toDataURL } = await import('qrcode')
    const dataUrl = await toDataURL(link, { width: 256, margin: 1 })
    setQrDataUrl(dataUrl)
    setQrOpen(true)
  }

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            WhatsApp Link Generator
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            Upload CSV/Excel or paste data to generate personalized messages and links.
          </p>
        </header>

        <section className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl shadow-md p-5 bg-white/90 backdrop-blur">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-lg">Import Candidates</h2>
                <div className="flex gap-2">
                  <input value={importUrl} onChange={(e)=>setImportUrl(e.target.value)} placeholder="Paste CSV URL or Google Sheets link" className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 w-64" />
                  <button onClick={fetchCSVFromUrl} className="px-3 py-2 text-xs sm:text-sm rounded-lg border">Import URL</button>
                  <button onClick={downloadTemplateCSV} className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Download Template</button>
                  <button onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }} className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Clear</button>
                </div>
              </div>

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:bg-gray-50 transition"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click() }}
              >
                <div className="text-gray-700 font-medium">Drag & drop file here, or click to browse</div>
                <div className="text-xs text-gray-500 mt-1">Accepted: .csv, .xlsx</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => onFilesSelected(e.target.files)}
                />
              </div>

              <div className="mt-5">
                <label className="block font-medium mb-2">Paste Tabular Data</label>
                <textarea
                  className="w-full h-44 border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Paste CSV/TSV with header: Name, Phone, Current Role, Key Skills, Profile Summary, JD Link"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    handlePaste(text)
                  }}
                />
              </div>
            </div>

            {errors.length > 0 && (
              <div className="rounded-xl p-3 bg-red-50 text-red-700 border border-red-200">
                {errors.map((er, i) => (
                  <div key={i}>{er}</div>
                ))}
              </div>
            )}

            <div className="bg-white/90 rounded-2xl shadow-md overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b p-2 sm:p-3">
                <div className="inline-flex rounded-lg bg-gray-100 text-gray-700 text-xs sm:text-sm px-3 py-1">
                  Total: {processed.out.length}
                </div>
                <div className="inline-flex rounded-lg bg-amber-100 text-amber-800 text-xs sm:text-sm px-3 py-1">
                  Missing JD: {processed.missing.length}
                </div>
                <div className="inline-flex rounded-lg bg-rose-100 text-rose-800 text-xs sm:text-sm px-3 py-1">
                  Invalid Phone: {processed.invalid.length}
                </div>

                <div className="ml-auto flex gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or role"
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200"
                  />
                  <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600">
                    <span>Opened {openIndex}/{processed.out.length}</span>
                    <input
                      type="number"
                      min={1}
                      value={batchSize}
                      onChange={e => setBatchSize(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 px-2 py-1 border rounded-lg"
                      title="Batch size"
                    />
                    <button onClick={openNextBatch} disabled={!processed.out.length || openIndex>=processed.out.length} className="px-2 py-1 rounded-lg border">Open N</button>
                    <button onClick={resetBatch} className="px-2 py-1 rounded-lg border">Reset</button>
                  </div>
                  <button
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                    disabled={!processed.out.length}
                    onClick={() => exportCSV(processed.out, 'whatsapp_links.csv')}
                  >
                    Download CSV
                  </button>
                  <button
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                    disabled={!processed.missing.length}
                    onClick={() => exportCSV(processed.missing, 'missing_jd_links.csv')}
                  >
                    Export Missing JD Report
                  </button>
                  <button
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                    disabled={!processed.invalid.length}
                    onClick={exportInvalidCSV}
                  >
                    Export Invalid Phones
                  </button>
                  <button
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50"
                    disabled={!processed.out.length}
                    onClick={copyAllLinks}
                  >
                    Copy All Links
                  </button>
                  <button className="px-3 py-2 text-xs sm:text-sm rounded-lg border" onClick={fixTenDigitPhones}>Fix 10-digit Phones</button>
                </div>
              </div>

              <div className="px-3 pt-2">
                <div className="inline-flex rounded-xl bg-gray-100 p-1">
                  <button
                    className={`px-3 py-1 text-xs sm:text-sm rounded-lg ${activeTab === 'results' ? 'bg-white shadow text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => setActiveTab('results')}
                  >
                    Results
                  </button>
                  <button
                    className={`px-3 py-1 text-xs sm:text-sm rounded-lg ${activeTab === 'missing' ? 'bg-white shadow text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => setActiveTab('missing')}
                  >
                    Missing JD Links
                  </button>
                  <button
                    className={`px-3 py-1 text-xs sm:text-sm rounded-lg ${activeTab === 'invalid' ? 'bg-white shadow text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => setActiveTab('invalid')}
                  >
                    Invalid Phones
                  </button>
                </div>
              </div>

              <div className="p-3 overflow-x-auto">
                {activeTab === 'results' && <ResultsTable data={processed.out} />}
                {activeTab === 'missing' && <ResultsTable data={processed.missing} />}
                {activeTab === 'invalid' && <ResultsTable data={processed.invalid} />}
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl shadow-md p-5 bg-white/90 backdrop-blur">
              <h3 className="font-semibold mb-2">Column Mapping</h3>
              <div className="text-xs text-gray-600 mb-3">Map your source headers to required fields.</div>
              <div className="grid grid-cols-1 gap-3 text-sm">
                {REQUIRED_COLUMNS.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <div className="w-40 text-gray-600">{c}</div>
                    <select
                      value={columnMapping?.[c] || ''}
                      onChange={(e) => setColumnMapping(prev => ({ ...prev, [c]: e.target.value }))}
                      className="flex-1 border rounded-lg p-2"
                    >
                      <option value="">Auto</option>
                      {detectedHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="px-3 py-2 rounded-lg border"
                  onClick={() => {
                    // Auto map using aliases
                    const next = { ...columnMapping }
                    for (const h of detectedHeaders) {
                      const canonical = HEADER_ALIASES[String(h).toLowerCase().replace(/[^a-z0-9]/g, '')]
                      if (canonical && !next[canonical]) next[canonical] = h
                    }
                    setColumnMapping(next)
                  }}
                >Auto-map</button>
                <button className="px-3 py-2 rounded-lg border" onClick={() => setColumnMapping({})}>Clear</button>
              </div>
            </div>
            <div className="rounded-2xl shadow-md p-5 bg-white/90 backdrop-blur">
              <h3 className="font-semibold mb-2">Settings</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-gray-600 mb-1">Country Code</label>
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full border rounded-lg p-2"
                    placeholder="e.g. 91"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Message Template</label>
                  <div className="text-xs text-gray-500 mb-1">Use placeholders: {`{NAME}`}, {`{ROLE}`}, {`{JD_LINK}`}</div>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="w-full h-40 border rounded-lg p-2 font-mono"
                  />
                </div>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={dedupeByPhone}
                    onChange={(e) => setDedupeByPhone(e.target.checked)}
                  />
                  <span>Remove duplicates by phone</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoDetectCountry}
                    onChange={(e) => setAutoDetectCountry(e.target.checked)}
                  />
                  <span>Auto-detect country code from phone</span>
                </label>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-2 rounded-lg border" onClick={exportProject}>Export Project</button>
                  <label className="px-3 py-2 rounded-lg border cursor-pointer">
                    Import Project
                    <input type="file" accept="application/json" className="hidden" onChange={(e) => importProject(e.target.files?.[0])} />
                  </label>
                </div>
              </div>
            </div>
            <div className="rounded-2xl shadow-md p-5 bg-white/90 backdrop-blur">
              <h3 className="font-semibold mb-2">Instructions</h3>
              <ul className="text-sm text-gray-600 list-disc ml-5 space-y-1">
                <li>Headers required: <span className="font-mono">Name, Phone, Current Role, Key Skills, Profile Summary, JD Link</span>.</li>
                <li>We clean phone numbers to last 10 digits and prefix with 91.</li>
                <li>WhatsApp links open in a new tab.</li>
              </ul>
            </div>

            <div className="rounded-2xl shadow-md p-5 bg-white/90 backdrop-blur">
              <h3 className="font-semibold mb-2">About</h3>
              <p className="text-sm text-gray-600">
                Messages are personalized per candidate and encoded for WhatsApp.
              </p>
            </div>
          </aside>
        </section>
        {qrOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4" onClick={() => setQrOpen(false)}>
            <div className="bg-white rounded-xl p-4" onClick={(e) => e.stopPropagation()}>
              <img src={qrDataUrl} alt="QR" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultsTable({ data }) {
  if (!data.length) return (
    <div className="text-sm text-gray-500">No data yet. Upload or paste to begin.</div>
  )
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-left text-gray-600">
          <th className="px-3 py-2">Name</th>
          <th className="px-3 py-2">Current Role</th>
          <th className="px-3 py-2">Phone</th>
          <th className="px-3 py-2">JD Link</th>
          <th className="px-3 py-2">WhatsApp_Link</th>
          <th className="px-3 py-2">QR</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r, idx) => (
          <tr key={idx} className="border-t">
            <td className="px-3 py-2 whitespace-nowrap">{r['Name']}</td>
            <td className="px-3 py-2 whitespace-nowrap">{r['Current Role']}</td>
            <td className="px-3 py-2 whitespace-nowrap">{r['Phone']}</td>
            <td className="px-3 py-2 max-w-[280px] truncate">
              {r['JD Link'] ? (
                <a href={r['JD Link']} target="_blank" className="text-emerald-600 underline">Open JD</a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
            <td className="px-3 py-2">
              {r['WhatsApp_Link'] ? (
                <a href={r['WhatsApp_Link']} target="_blank" className="inline-block px-3 py-2 rounded-lg bg-green-600 text-white">Send on WhatsApp</a>
              ) : (
                <span className="text-gray-400">Invalid phone</span>
              )}
            </td>
            <td className="px-3 py-2">
              {r['WhatsApp_Link'] && (
                <button onClick={() => openQr(r['WhatsApp_Link'])} className="px-2 py-1 rounded-lg border">QR</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default App
