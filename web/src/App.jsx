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
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

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
    setIsLoading(true)
    const name = file.name.toLowerCase()
    if (name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => { handleParsedRows(res.data); setIsLoading(false) },
        error: (err) => setErrors([`CSV parse error: ${err.message}`]),
      })
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setIsProcessing(true)
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const firstSheet = wb.SheetNames[0]
        const ws = wb.Sheets[firstSheet]
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
        setTimeout(() => { handleParsedRows(json); setIsProcessing(false); setIsLoading(false) }, 800)
      }
      reader.onerror = () => setErrors(['Excel read error'])
      reader.readAsArrayBuffer(file)
    } else {
      setErrors(['Unsupported file type. Use .csv or .xlsx'])
      setIsLoading(false)
    }
  }

  function handleParsedRows(list) {
    setIsProcessing(true)
    const normalized = list.map(ensureColumns)
    const missingCols = REQUIRED_COLUMNS.filter(c => !(c in normalized[0] || {}))
    if (missingCols.length) {
      setErrors([`Missing required columns: ${missingCols.join(', ')}`])
    } else {
      setErrors([])
    }
    setTimeout(() => {
    setRows(normalized)
    setMissingJDRows(normalized.filter(r => !r['JD Link']))
      setIsProcessing(false)
    }, 500)
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
    setIsProcessing(true)
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
    setTimeout(() => {
      handleParsedRows(sample)
      showToast('Loaded sample data')
    }, 300)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl mb-6 shadow-lg">
            <span className="text-2xl">📱</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-gray-900 via-emerald-600 to-blue-600 bg-clip-text text-transparent mb-4">
            WhatsApp Link Generator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Transform your candidate data into personalized WhatsApp messages with smart processing and instant export capabilities.
          </p>
        </header>

        <section className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-50 to-blue-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                      <span className="text-white text-lg">📊</span>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Import Candidates</h2>
                      <p className="text-sm text-gray-600">Upload files or paste data to get started</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                  <button
                    onClick={downloadTemplateCSV}
                      className="px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 text-sm font-medium text-gray-700 shadow-sm"
                  >
                      📥 Template
                  </button>
                  <button
                    onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }}
                      className="px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 text-sm font-medium text-gray-700 shadow-sm"
                  >
                      🗑️ Clear
                  </button>
                  </div>
                </div>
              </div>
              <div className="p-8">

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                  onDragEnter={onDragEnter}
                  onDragLeave={onDragLeave}
                onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 group ${isDragging ? 'bg-gradient-to-br from-emerald-50 to-blue-50 border-emerald-400 scale-105 shadow-lg' : 'border-gray-300 hover:border-emerald-400 hover:bg-gradient-to-br hover:from-gray-50 hover:to-blue-50'}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click() }}
              >
                  <div className="text-6xl mb-4 group-hover:scale-110 transition-transform duration-300">
                    {isLoading ? '⏳' : '📁'}
                  </div>
                  <div className="text-xl font-semibold text-gray-700 mb-2">
                    {isLoading ? 'Processing your file...' : 'Drop your file here or click to browse'}
                  </div>
                  <div className="text-sm text-gray-500 mb-4">Supports CSV and Excel files (.csv, .xlsx)</div>
                  {isLoading && (
                    <div className="flex items-center justify-center gap-3">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-emerald-500 border-t-transparent"></div>
                      <span className="text-emerald-600 font-medium">Processing...</span>
                    </div>
                  )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => onFilesSelected(e.target.files)}
                />
              </div>

                <div className="mt-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm">📋</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Or paste data directly</h3>
                  </div>
                <textarea
                    className="w-full h-32 border-2 border-gray-200 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 resize-none font-mono text-sm"
                    placeholder="Paste your CSV/TSV data here with headers: Name, Phone, Current Role, Key Skills, Profile Summary, JD Link"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    handlePaste(text)
                  }}
                />
                  <div className="mt-4 flex justify-start">
                    <button
                      onClick={loadSampleData}
                      className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105"
                    >
                      🎲 Load Sample Data
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">⚠️</span>
                  </div>
                  <h3 className="text-lg font-semibold text-red-800">Error</h3>
                </div>
                {errors.map((er, i) => (
                  <div key={i} className="text-red-700 font-medium">{er}</div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-blue-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                      <span className="text-white text-lg">📈</span>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Results Dashboard</h2>
                      <p className="text-sm text-gray-600">View and export your processed data</p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
                        <span className="text-white text-lg">✅</span>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-900">{processed.out.length}</div>
                        <div className="text-sm text-gray-600">Valid Records</div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl flex items-center justify-center">
                        <span className="text-white text-lg">⚠️</span>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-900">{processed.missing.length}</div>
                        <div className="text-sm text-gray-600">Missing JD</div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-red-600 rounded-xl flex items-center justify-center">
                        <span className="text-white text-lg">❌</span>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-900">{processed.invalid.length}</div>
                        <div className="text-sm text-gray-600">Invalid Phone</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="flex-1">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="🔍 Search by name or role..."
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 bg-white"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                      disabled={!processed.out.length}
                      onClick={() => exportCSV(processed.out, 'whatsapp_links.csv')}
                    >
                      📥 Download CSV
                    </button>
                    <button
                      className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                      disabled={!processed.missing.length}
                      onClick={() => exportCSV(processed.missing, 'missing_jd_links.csv')}
                    >
                      ⚠️ Missing JD
                    </button>
                    <button
                      className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                      disabled={!processed.invalid.length}
                      onClick={exportInvalidCSV}
                    >
                      ❌ Invalid
                    </button>
                    <button
                      className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                      disabled={!processed.out.length}
                      onClick={copyAllLinks}
                    >
                      📋 Copy All
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6">
                <div className="flex gap-2 mb-6">
                  <button
                    className={`px-6 py-3 rounded-2xl font-medium transition-all duration-200 ${activeTab === 'results' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => setActiveTab('results')}
                  >
                    📊 Results ({processed.out.length})
                  </button>
                  <button
                    className={`px-6 py-3 rounded-2xl font-medium transition-all duration-200 ${activeTab === 'missing' ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => setActiveTab('missing')}
                  >
                    ⚠️ Missing JD ({processed.missing.length})
                  </button>
                  <button
                    className={`px-6 py-3 rounded-2xl font-medium transition-all duration-200 ${activeTab === 'invalid' ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => setActiveTab('invalid')}
                  >
                    ❌ Invalid ({processed.invalid.length})
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {isProcessing && (
                    <div className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mx-auto mb-4"></div>
                        <div className="text-lg font-semibold text-gray-600 mb-2">Processing your data...</div>
                        <div className="text-sm text-gray-500">Please wait while we process your information</div>
                      </div>
                    </div>
                  )}
                  {activeTab === 'results' && <ResultsTable data={processed.out} />}
                  {activeTab === 'missing' && <ResultsTable data={processed.missing} />}
                  {activeTab === 'invalid' && <ResultsTable data={processed.invalid} />}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-8">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-50 to-blue-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl flex items-center justify-center">
                    <span className="text-white text-lg">⚙️</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Settings</h3>
                    <p className="text-sm text-gray-600">Configure your preferences</p>
                  </div>
                </div>
              </div>
              <div className="p-8 space-y-6">
                <div>
                  <label className="block text-gray-700 font-semibold mb-3 flex items-center gap-2">
                    🌍 Country Code
                  </label>
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-2xl p-4 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 text-center font-mono text-lg"
                    placeholder="e.g. 91"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-3 flex items-center gap-2">
                    📝 Message Template
                  </label>
                  <div className="text-sm text-gray-500 mb-4 bg-gray-50 p-4 rounded-2xl border border-gray-200">
                    Use placeholders: <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600 border">{`{NAME}`}</span>, <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600 border">{`{ROLE}`}</span>, <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600 border">{`{JD_LINK}`}</span>
                  </div>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="w-full h-40 border-2 border-gray-200 rounded-2xl p-4 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 resize-none text-sm"
                  />
                </div>
                <div className="space-y-4">
                  <label className="flex items-center gap-4 p-4 rounded-2xl hover:bg-gray-50 transition-colors duration-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dedupeByPhone}
                      onChange={(e) => setDedupeByPhone(e.target.checked)}
                      className="w-5 h-5 rounded focus:ring-2 focus:ring-emerald-500 text-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-gray-700">🔄 Remove duplicates by phone</div>
                      <div className="text-sm text-gray-500">Automatically filter out duplicate phone numbers</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-4 p-4 rounded-2xl hover:bg-gray-50 transition-colors duration-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDetectCountry}
                      onChange={(e) => setAutoDetectCountry(e.target.checked)}
                      className="w-5 h-5 rounded focus:ring-2 focus:ring-emerald-500 text-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-gray-700">🔍 Auto-detect country code</div>
                      <div className="text-sm text-gray-500">Detect country code from existing phone numbers</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
                    <span className="text-white text-lg">📚</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Instructions</h3>
                    <p className="text-sm text-gray-600">How to use this tool</p>
                  </div>
                </div>
              </div>
              <div className="p-8">
                <div className="space-y-6">
                  <div className="flex items-start gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
                    <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-white text-sm">1</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 mb-2">Required Headers</div>
                      <div className="text-sm text-gray-600">
                        Your data must include: <span className="font-mono bg-white px-2 py-1 rounded text-emerald-600 border">Name, Phone, Current Role, Key Skills, Profile Summary, JD Link</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-blue-50 rounded-2xl border border-blue-200">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-white text-sm">2</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 mb-2">Phone Processing</div>
                      <div className="text-sm text-gray-600">
                        We clean phone numbers to last 10 digits and prefix with your country code
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-purple-50 rounded-2xl border border-purple-200">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-white text-sm">3</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 mb-2">WhatsApp Links</div>
                      <div className="text-sm text-gray-600">
                        Generated links open in a new tab for easy messaging
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-slate-50 px-8 py-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-gray-500 to-slate-500 rounded-xl flex items-center justify-center">
                    <span className="text-white text-lg">ℹ️</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">About</h3>
                    <p className="text-sm text-gray-600">Privacy & features</p>
                  </div>
                </div>
              </div>
              <div className="p-8">
                <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-6 rounded-2xl border border-emerald-200">
                  <div className="text-sm text-gray-700 leading-relaxed">
                    <div className="font-semibold text-gray-900 mb-2">🔒 Privacy First</div>
                    <div className="mb-4">All data processing happens in your browser. Your candidate information never leaves your device.</div>
                    <div className="font-semibold text-gray-900 mb-2">✨ Smart Features</div>
                    <div>Messages are personalized per candidate and automatically encoded for WhatsApp compatibility.</div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>
        <footer className="text-center py-12">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-2xl mx-auto">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl flex items-center justify-center">
                <span className="text-white text-xl">🚀</span>
              </div>
              <div className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-emerald-600 to-blue-600 bg-clip-text text-transparent">
                WhatsApp Link Generator
              </div>
            </div>
            <div className="text-gray-600 mb-4">
              Built for HR outreach • Data stays in your browser • Made with ❤️ for efficient recruitment
            </div>
            <div className="text-sm text-gray-400">
              Transform your recruitment process with personalized WhatsApp messaging
            </div>
          </div>
        </footer>
        {toast && (
          <div className="fixed bottom-6 right-6 bg-gradient-to-r from-gray-900 to-gray-800 text-white px-6 py-4 rounded-2xl shadow-2xl animate-slide-in-up border border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm">✨</span>
              </div>
              <div className="font-medium">{toast}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultsTable({ data }) {
  if (!data.length) return (
    <div className="text-center py-16">
      <div className="w-24 h-24 bg-gradient-to-r from-gray-100 to-gray-200 rounded-3xl flex items-center justify-center mx-auto mb-6">
        <span className="text-4xl">📄</span>
      </div>
      <div className="text-xl font-semibold text-gray-700 mb-2">No data yet</div>
      <div className="text-gray-500">Upload a file or paste data to get started</div>
    </div>
  )
  return (
    <div className="overflow-auto rounded-2xl border-2 border-gray-200 max-h-[60vh] shadow-inner">
      <table className="min-w-full text-sm">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
          <tr className="text-left text-gray-700">
            <th className="px-6 py-4 font-semibold">👤 Name</th>
            <th className="px-6 py-4 font-semibold">💼 Current Role</th>
            <th className="px-6 py-4 font-semibold">📱 Phone</th>
            <th className="px-6 py-4 font-semibold">🔗 JD Link</th>
            <th className="px-6 py-4 font-semibold">💬 WhatsApp</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, idx) => (
            <tr key={idx} className={"border-t border-gray-200 " + (idx % 2 ? 'bg-white' : 'bg-gray-50/30') + ' hover:bg-gradient-to-r hover:from-emerald-50 hover:to-blue-50 transition-all duration-300 group'} style={{ animationDelay: `${idx * 50}ms` }}>
              <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-800 group-hover:text-emerald-700 transition-colors duration-200">{r['Name']}</td>
              <td className="px-6 py-4 whitespace-nowrap text-gray-600 group-hover:text-gray-800 transition-colors duration-200">{r['Current Role']}</td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="font-mono text-xs bg-gray-100 px-3 py-2 rounded-lg text-gray-700">{r['Phone']}</span>
              </td>
              <td className="px-6 py-4 max-w-[280px] truncate">
                {r['JD Link'] ? (
                  <a href={r['JD Link']} target="_blank" className="text-emerald-600 hover:text-emerald-800 font-medium transition-colors duration-200 hover:underline flex items-center gap-2">
                    <span>🔗</span>
                    <span>Open JD</span>
                  </a>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-6 py-4">
                {r['WhatsApp_Link'] ? (
                  <a
                    href={r['WhatsApp_Link']}
                    target="_blank"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    <span>💬</span>
                    <span>Send</span>
                  </a>
                ) : (
                  <span className="text-gray-400 text-sm">Invalid phone</span>
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

