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
    <div className="min-h-screen p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="text-center animate-fade-in">
          <div className="relative">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight gradient-text-emerald animate-bounce-in">
              📱 WhatsApp Link Generator
            </h1>
            <div className="absolute -top-2 -right-2 text-2xl floating">✨</div>
            <div className="absolute -bottom-1 -left-2 text-xl floating-delayed">🚀</div>
          </div>
          <p className="text-lg text-gray-600 mt-4 font-medium">
            Upload CSV/Excel or paste data to generate personalized messages and links.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm">
            <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-sm border border-white/30 shadow-sm">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              <span className="text-gray-600 font-medium">Smart Processing</span>
            </span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-sm border border-white/30 shadow-sm">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
              <span className="text-gray-600 font-medium">Auto Detection</span>
            </span>
            <span className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-sm border border-white/30 shadow-sm">
              <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
              <span className="text-gray-600 font-medium">Instant Export</span>
            </span>
          </div>
        </header>

        <section className="grid lg:grid-cols-3 gap-6 animate-slide-up">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-soft rounded-3xl shadow-xl p-6 card-hover">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold text-xl gradient-text-emerald flex items-center gap-2">
                  📊 Import Candidates
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={downloadTemplateCSV}
                    className="btn-secondary text-sm px-4 py-2 flex items-center gap-2"
                  >
                    <span>📥</span>
                    <span>Download Template</span>
                  </button>
                  <button
                    onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }}
                    className="btn-soft text-sm px-4 py-2 flex items-center gap-2"
                  >
                    <span>🗑️</span>
                    <span>Clear</span>
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
                className={`border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all duration-300 ${isDragging ? 'bg-gradient-to-br from-emerald-50/80 to-blue-50/80 ring-4 ring-emerald-300 scale-105 animate-glow backdrop-blur-sm' : 'hover:bg-gradient-to-br hover:from-gray-50/60 hover:to-blue-50/60 hover:scale-102 backdrop-blur-sm'}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click() }}
              >
                <div className="text-7xl mb-6 floating">📁</div>
                <div className="text-gray-700 font-semibold text-xl mb-3">
                  {isLoading ? '⏳ Processing file...' : '🎯 Drag & drop file here, or click to browse'}
                </div>
                <div className="text-sm text-gray-500 mb-6 px-4 py-2 rounded-full bg-white/50 backdrop-blur-sm inline-block">Accepted: .csv, .xlsx</div>
                {isLoading && (
                  <div className="mt-6">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500"></div>
                    <div className="mt-3 text-sm text-emerald-600 font-medium">Processing your file...</div>
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
                <label className="block font-semibold mb-4 text-gray-700 flex items-center gap-2">
                  📋 Paste Tabular Data
                </label>
                <textarea
                  className="w-full h-48 border-2 border-gray-200 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all duration-200 resize-none bg-white/80 backdrop-blur-sm"
                  placeholder="Paste CSV/TSV with header: Name, Phone, Current Role, Key Skills, Profile Summary, JD Link"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    handlePaste(text)
                  }}
                />
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={loadSampleData}
                    className="btn-accent text-sm px-6 py-3 flex items-center gap-2"
                  >
                    <span>🎲</span>
                    <span>Load Sample Data</span>
                  </button>
                </div>
              </div>
            </div>

            {errors.length > 0 && (
              <div className="rounded-2xl p-4 bg-gradient-to-r from-red-50 to-pink-50 text-red-700 border-2 border-red-200 animate-bounce-in">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">⚠️</span>
                  <span className="font-semibold">Error</span>
                </div>
                {errors.map((er, i) => (
                  <div key={i} className="text-sm">{er}</div>
                ))}
              </div>
            )}

            <div className="glass rounded-3xl shadow-xl overflow-hidden card-hover">
              <div className="border-b border-gray-200/50 p-6 bg-gradient-to-r from-gray-50/50 to-blue-50/50">
                {/* Stats Row */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-100 to-emerald-200 text-emerald-800 text-sm px-4 py-3 font-semibold shadow-sm hover:shadow-md transition-all duration-200">
                    <span className="text-lg">📊</span> 
                    <span>Total: {processed.out.length}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-100 to-amber-200 text-amber-800 text-sm px-4 py-3 font-semibold shadow-sm hover:shadow-md transition-all duration-200">
                    <span className="text-lg">⚠️</span> 
                    <span>Missing JD: {processed.missing.length}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-100 to-rose-200 text-rose-800 text-sm px-4 py-3 font-semibold shadow-sm hover:shadow-md transition-all duration-200">
                    <span className="text-lg">🚫</span> 
                    <span>Invalid Phone: {processed.invalid.length}</span>
                  </div>
                </div>

                {/* Search and Actions Row */}
                <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                  {/* Search Input */}
                  <div className="relative flex-shrink-0">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="🔍 Search name or role..."
                      className="pl-12 pr-4 py-3 text-sm rounded-2xl border-2 border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 w-full lg:w-64 bg-white/80 backdrop-blur-sm"
                    />
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 text-lg">
                      🔍
                    </div>
                </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-3 justify-end w-full lg:w-auto">
                  <button
                      className="btn-primary text-sm px-5 py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[120px] justify-center"
                    disabled={!processed.out.length}
                    onClick={() => exportCSV(processed.out, 'whatsapp_links.csv')}
                  >
                      <span>📥</span>
                      <span>Download CSV</span>
                  </button>
                  <button
                      className="btn-secondary text-sm px-5 py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[120px] justify-center"
                    disabled={!processed.missing.length}
                    onClick={() => exportCSV(processed.missing, 'missing_jd_links.csv')}
                  >
                      <span>⚠️</span>
                      <span>Missing JD</span>
                    </button>
                    <button
                      className="px-5 py-3 text-sm rounded-2xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl flex items-center gap-2 min-w-[120px] justify-center"
                      disabled={!processed.invalid.length}
                      onClick={exportInvalidCSV}
                    >
                      <span>🚫</span>
                      <span>Invalid</span>
                    </button>
                    <button
                      className="btn-accent text-sm px-5 py-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[120px] justify-center"
                      disabled={!processed.out.length}
                      onClick={copyAllLinks}
                    >
                      <span>📋</span>
                      <span>Copy All</span>
                  </button>
                  </div>
                </div>
              </div>

              <div className="px-4 pt-4">
                <div className="inline-flex rounded-2xl bg-gradient-to-r from-gray-100 to-gray-200 p-1 shadow-inner">
                  <button
                    className={`px-4 py-2 text-sm rounded-xl transition-all duration-200 font-medium ${activeTab === 'results' ? 'bg-white shadow-lg text-emerald-700 scale-105' : 'text-gray-600 hover:text-gray-800 hover:scale-102'}`}
                    onClick={() => setActiveTab('results')}
                  >
                    📊 Results
                  </button>
                  <button
                    className={`px-4 py-2 text-sm rounded-xl transition-all duration-200 font-medium ${activeTab === 'missing' ? 'bg-white shadow-lg text-emerald-700 scale-105' : 'text-gray-600 hover:text-gray-800 hover:scale-102'}`}
                    onClick={() => setActiveTab('missing')}
                  >
                    ⚠️ Missing JD
                  </button>
                  <button
                    className={`px-4 py-2 text-sm rounded-xl transition-all duration-200 font-medium ${activeTab === 'invalid' ? 'bg-white shadow-lg text-emerald-700 scale-105' : 'text-gray-600 hover:text-gray-800 hover:scale-102'}`}
                    onClick={() => setActiveTab('invalid')}
                  >
                    🚫 Invalid
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-x-auto">
                {isProcessing && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
                      <div className="text-lg font-semibold text-gray-600 mb-2">Processing data...</div>
                      <div className="text-sm text-gray-500">Please wait while we process your data</div>
                    </div>
                  </div>
                )}
                {activeTab === 'results' && <ResultsTable data={processed.out} />}
                {activeTab === 'missing' && <ResultsTable data={processed.missing} />}
                {activeTab === 'invalid' && <ResultsTable data={processed.invalid} />}
              </div>
            </div>
          </div>

          <aside className="space-y-6 animate-slide-in-right">
            <div className="glass-soft rounded-3xl shadow-xl p-6 card-hover">
              <h3 className="font-bold text-xl gradient-text-emerald mb-6 flex items-center gap-2">
                ⚙️ Settings
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-gray-700 font-semibold mb-3 flex items-center gap-2">
                    🌍 Country Code
                  </label>
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-2xl p-4 focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all duration-200 text-center font-mono text-lg bg-white/80 backdrop-blur-sm"
                    placeholder="e.g. 91"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-semibold mb-3 flex items-center gap-2">
                    📝 Message Template
                  </label>
                  <div className="text-xs text-gray-500 mb-3 bg-white/60 backdrop-blur-sm p-3 rounded-xl border border-white/30">
                    Use placeholders: <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600">{`{NAME}`}</span>, <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600">{`{ROLE}`}</span>, <span className="font-mono bg-white px-2 py-1 rounded-lg text-emerald-600">{`{JD_LINK}`}</span>
                  </div>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="w-full h-44 border-2 border-gray-200 rounded-2xl p-4 font-mono focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-all duration-200 resize-none bg-white/80 backdrop-blur-sm"
                  />
                </div>
                <div className="space-y-4">
                  <label className="inline-flex items-center gap-3 p-4 rounded-2xl hover:bg-white/40 transition-colors duration-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dedupeByPhone}
                      onChange={(e) => setDedupeByPhone(e.target.checked)}
                      className="w-5 h-5 rounded focus:ring-2 focus:ring-emerald-400 text-emerald-500"
                    />
                    <span className="font-medium text-gray-700">🔄 Remove duplicates by phone</span>
                  </label>
                  <label className="inline-flex items-center gap-3 p-4 rounded-2xl hover:bg-white/40 transition-colors duration-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDetectCountry}
                      onChange={(e) => setAutoDetectCountry(e.target.checked)}
                      className="w-5 h-5 rounded focus:ring-2 focus:ring-emerald-400 text-emerald-500"
                    />
                    <span className="font-medium text-gray-700">🔍 Auto-detect country code from phone</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="glass-soft rounded-3xl shadow-xl p-6 card-hover">
              <h3 className="font-bold text-xl gradient-text-emerald mb-6 flex items-center gap-2">
                📚 Instructions
              </h3>
              <ul className="space-y-4 text-sm text-gray-600">
                <li className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/30 transition-colors duration-200">
                  <span className="text-emerald-500 mt-1 text-lg">•</span>
                  <span>Headers required: <span className="font-mono bg-white/60 px-2 py-1 rounded-lg text-emerald-600">Name, Phone, Current Role, Key Skills, Profile Summary, JD Link</span></span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/30 transition-colors duration-200">
                  <span className="text-emerald-500 mt-1 text-lg">•</span>
                  <span>We clean phone numbers to last 10 digits and prefix with country code</span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/30 transition-colors duration-200">
                  <span className="text-emerald-500 mt-1 text-lg">•</span>
                  <span>WhatsApp links open in a new tab automatically</span>
                </li>
              </ul>
            </div>

            <div className="glass-soft rounded-3xl shadow-xl p-6 card-hover">
              <h3 className="font-bold text-xl gradient-text-emerald mb-6 flex items-center gap-2">
                ℹ️ About
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed p-4 rounded-xl bg-white/30 backdrop-blur-sm">
                Messages are personalized per candidate and encoded for WhatsApp. 
                All data processing happens in your browser for privacy.
              </p>
            </div>
          </aside>
        </section>
        <footer className="text-center py-8 animate-fade-in">
          <div className="glass rounded-2xl p-4 max-w-md mx-auto">
            <div className="text-sm text-gray-600 font-medium">
              🚀 Built for HR outreach • Data stays in your browser
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Made with ❤️ for efficient recruitment
            </div>
          </div>
        </footer>
        {toast && (
          <div className="fixed bottom-6 right-6 bg-gradient-to-r from-gray-900 to-gray-800 text-white text-sm px-4 py-3 rounded-2xl shadow-2xl animate-slide-in-up border border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <span className="font-medium">{toast}</span>
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
      <div className="text-8xl mb-6 floating">📄</div>
      <div className="text-lg text-gray-500 font-medium">No data yet. Upload or paste to begin.</div>
      <div className="text-sm text-gray-400 mt-2">Try the sample data button above!</div>
    </div>
  )
  return (
    <div className="overflow-auto rounded-2xl border-2 border-gray-200 max-h-[60vh] shadow-inner">
    <table className="min-w-full text-sm">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
          <tr className="text-left text-gray-700">
            <th className="px-4 py-3 font-semibold">👤 Name</th>
            <th className="px-4 py-3 font-semibold">💼 Current Role</th>
            <th className="px-4 py-3 font-semibold">📱 Phone</th>
            <th className="px-4 py-3 font-semibold">🔗 JD Link</th>
            <th className="px-4 py-3 font-semibold">💬 WhatsApp</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r, idx) => (
            <tr key={idx} className={"border-t border-gray-200 " + (idx % 2 ? 'bg-white' : 'bg-gray-50/30') + ' hover:bg-gradient-to-r hover:from-emerald-50 hover:to-blue-50 transition-all duration-300 animate-fade-in group'} style={{ animationDelay: `${idx * 50}ms` }}>
              <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800 group-hover:text-emerald-700 transition-colors duration-200">{r['Name']}</td>
              <td className="px-4 py-3 whitespace-nowrap text-gray-600 group-hover:text-gray-800 transition-colors duration-200">{r['Current Role']}</td>
              <td className="px-4 py-3 whitespace-nowrap font-mono text-xs bg-gray-100 px-2 py-1 rounded-lg text-gray-700">{r['Phone']}</td>
              <td className="px-4 py-3 max-w-[280px] truncate">
              {r['JD Link'] ? (
                  <a href={r['JD Link']} target="_blank" className="text-emerald-600 hover:text-emerald-800 font-medium transition-colors duration-200 hover:underline">
                    🔗 Open JD
                  </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
              <td className="px-4 py-3">
              {r['WhatsApp_Link'] ? (
                <a
                  href={r['WhatsApp_Link']}
                  target="_blank"
                    className="inline-block px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl"
                >
                    💬 Send
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

