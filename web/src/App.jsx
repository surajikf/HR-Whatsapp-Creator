import { useEffect, useMemo, useRef, useState } from 'react'
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

function normalizeHeaderKey(key) {
  const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
  return HEADER_ALIASES[compact] || key
}

function normalizeRowHeaders(row) {
  const normalized = {}
  for (const [rawKey, value] of Object.entries(row)) {
    const targetKey = normalizeHeaderKey(rawKey)
    normalized[targetKey] = value
  }
  return normalized
}

function cleanPhone(raw, countryCode, autoDetectCountry) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D+/g, '')
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

function ensureColumns(row) {
  const normalized = normalizeRowHeaders({ ...row })
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
  const [isDragging, setIsDragging] = useState(false)
  const [toast, setToast] = useState(null)

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

  const processed = useMemo(() => {
    const out = []
    const missing = []
    const invalid = []
    const seenPhones = new Set()

    for (const r of rows) {
      const normalized = ensureColumns(r)
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
  }, [rows, countryCode, template, dedupeByPhone, autoDetectCountry, search])

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
    const normalized = list.map(ensureColumns)
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
    showToast(`Copied ${processed.out.filter(r => r.WhatsApp_Link).length} links`)  
  }

  function exportInvalidCSV() {
    if (!processed.invalid.length) return
    exportCSV(processed.invalid, 'invalid_phone_rows.csv')
  }

  function onDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    onFilesSelected(files)
    setIsDragging(false)
  }

  function onDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function onDragEnter(e) {
    e.preventDefault(); e.stopPropagation(); setIsDragging(true)
  }

  function onDragLeave(e) {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false)
  }

  function showToast(message) {
    setToast(message)
    window.clearTimeout(showToast.__t)
    showToast.__t = window.setTimeout(() => setToast(null), 1800)
  }

  function loadSampleData() {
    const sample = [
      {
        Name: 'Aarav Mehta',
        Phone: '+91 9876543210',
        'Current Role': 'Frontend Engineer',
        'Key Skills': 'React, JS, UI',
        'Profile Summary': '3+ yrs, product UI',
        'JD Link': 'ikf.co.in/careers/frontend',
      },
      {
        Name: 'Riya Sharma',
        Phone: '9876501234',
        'Current Role': 'UX Designer',
        'Key Skills': 'Figma, UX',
        'Profile Summary': '5+ yrs, SaaS',
        'JD Link': 'https://www.ikf.co.in/careers/ux-designer',
      },
    ]
    handleParsedRows(sample)
    showToast('Loaded sample data')
  }

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">
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
                  <button
                    onClick={downloadTemplateCSV}
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Download Template
                  </button>
                  <button
                    onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }}
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${isDragging ? 'bg-emerald-50 ring-2 ring-emerald-400' : 'hover:bg-gray-50'}`}
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
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={loadSampleData}
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Load Sample Data
                  </button>
                </div>
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
                <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 text-gray-700 text-xs sm:text-sm px-3 py-1">
                  <span>📊</span> <span>Total: {processed.out.length}</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-lg bg-amber-100 text-amber-800 text-xs sm:text-sm px-3 py-1">
                  <span>⚠️</span> <span>Missing JD: {processed.missing.length}</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-lg bg-rose-100 text-rose-800 text-xs sm:text-sm px-3 py-1">
                  <span>🚫</span> <span>Invalid Phone: {processed.invalid.length}</span>
                </div>

                <div className="ml-auto flex gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or role"
                    className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-200"
                  />
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
        <footer className="text-xs text-gray-500 text-center py-4">
          Built for HR outreach. Data stays in your browser.
        </footer>
      </div>
    </div>
    {toast && (
      <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg/50 animate-fade">
        {toast}
      </div>
    )}
  )
}

function ResultsTable({ data }) {
  if (!data.length) return (
    <div className="text-center py-12">
      <div className="text-6xl mb-3">📄</div>
      <div className="text-sm text-gray-500">No data yet. Upload or paste to begin.</div>
    </div>
  )
  return (
    <div className="overflow-auto rounded-xl border max-h-[60vh]">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr className="text-left text-gray-600">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Current Role</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">JD Link</th>
            <th className="px-3 py-2">WhatsApp_Link</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, idx) => (
            <tr key={idx} className={"border-t " + (idx % 2 ? 'bg-white' : 'bg-gray-50/50') + ' hover:bg-emerald-50/40'}>
              <td className="px-3 py-2 whitespace-nowrap">{r['Name']}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r['Current Role']}</td>
              <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r['Phone']}</td>
              <td className="px-3 py-2 max-w-[280px] truncate">
                {r['JD Link'] ? (
                  <a href={r['JD Link']} target="_blank" className="text-emerald-700 underline">Open JD</a>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                {r['WhatsApp_Link'] ? (
                  <a
                    href={r['WhatsApp_Link']}
                    target="_blank"
                    className="inline-block px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white"
                  >
                    Send on WhatsApp
                  </a>
                ) : (
                  <span className="text-gray-400">Invalid phone</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default App

