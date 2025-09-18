import { useMemo, useRef, useState } from 'react'
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

function cleanPhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D+/g, '')
  const last10 = digits.slice(-10)
  return last10 ? `91${last10}` : ''
}

function generateMessage(row) {
  const name = row['Name']?.toString().trim() || ''
  const role = row['Current Role']?.toString().trim() || ''
  const jd = row['JD Link']?.toString().trim() || ''

  const lines = [
    `Dear *${name}*,`,
    `I am *Vani, Recruiter at I Knowledge Factory Pvt. Ltd.* – a full-service *digital branding and marketing agency*.`,
    '',
    `We reviewed your profile on *Naukri Portal* and found it suitable for the role of *${role}*.`,
    '',
    `If you are open to exploring opportunities with us, please review the *Job Description on our website and apply here*: ${jd}`,
    '',
    `Once done, I will connect with you to schedule the *screening round*.`,
    '',
    `Best regards,`,
    `*Vani Jha*`,
    `Talent Acquisition Specialist`,
    `*+91 9665079317*`,
    `*www.ikf.co.in*`,
  ]

  return lines.join('\n')
}

function encodeForWhatsApp(text) {
  return encodeURIComponent(text).replace(/%5Cn/g, '%0A').replace(/%20/g, '%20')
}

function ensureColumns(row) {
  const normalized = { ...row }
  for (const key of REQUIRED_COLUMNS) {
    if (!(key in normalized)) normalized[key] = ''
  }
  return normalized
}

function App() {
  const [rows, setRows] = useState([])
  const [missingJDRows, setMissingJDRows] = useState([])
  const [activeTab, setActiveTab] = useState('results')
  const [errors, setErrors] = useState([])
  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  const processed = useMemo(() => {
    const out = []
    const missing = []

    for (const r of rows) {
      const normalized = ensureColumns(r)
      const phone = cleanPhone(normalized['Phone'])
      const message = generateMessage(normalized)
      const encoded = encodeForWhatsApp(message)
      const link = phone ? `https://wa.me/${phone}?text=${encoded}` : ''
      const record = {
        Name: normalized['Name'],
        'Current Role': normalized['Current Role'],
        Phone: phone,
        'JD Link': normalized['JD Link'],
        WhatsApp_Link: link,
      }
      out.push(record)
      if (!normalized['JD Link']) missing.push(record)
    }
    return { out, missing }
  }, [rows])

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

                <div className="ml-auto flex gap-2">
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
                </div>
              </div>

              <div className="p-3 overflow-x-auto">
                {activeTab === 'results' ? (
                  <ResultsTable data={processed.out} />
                ) : (
                  <ResultsTable data={processed.missing} />
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-6">
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
                <a
                  href={r['WhatsApp_Link']}
                  target="_blank"
                  className="inline-block px-3 py-2 rounded-lg bg-green-600 text-white"
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
  )
}

export default App
