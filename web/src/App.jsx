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
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>WhatsApp Link Generator</h1>
      <p style={{ textAlign: 'center', marginBottom: '30px' }}>
        Upload CSV/Excel or paste data to generate personalized messages and links.
      </p>

      <div style={{ width: '100%' }}>
        <div style={{ width: '100%' }}>
          <div style={{ border: '1px solid #ccc', padding: '20px', marginBottom: '20px', borderRadius: '8px' }}>
            <h2>Import Candidates</h2>
            <div style={{ marginBottom: '10px' }}>
              <button onClick={downloadTemplateCSV} style={{ marginRight: '10px', padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>
                Download Template
                  </button>
              <button onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }} style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>
                Clear
                  </button>
                  </div>

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onClick={() => fileInputRef.current?.click()}
              style={{ border: '2px dashed #ccc', padding: '20px', textAlign: 'center', cursor: 'pointer', marginBottom: '20px' }}
            >
              <div>Drag & drop file here, or click to browse</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Accepted: .csv, .xlsx</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                  onChange={(e) => onFilesSelected(e.target.files)}
                />
              </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Paste Tabular Data</label>
                <textarea
                style={{ width: '100%', height: '120px', padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
                placeholder="Paste CSV/TSV with header: Name, Phone, Current Role, Key Skills, Profile Summary, JD Link"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    handlePaste(text)
                  }}
                />
            </div>
            </div>

            {errors.length > 0 && (
            <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', marginBottom: '20px', borderRadius: '4px' }}>
                {errors.map((er, i) => (
                <div key={i}>{er}</div>
                ))}
              </div>
            )}

          <div style={{ border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #ccc', backgroundColor: '#f5f5f5' }}>
              <span style={{ marginRight: '20px' }}>Total: {processed.out.length}</span>
              <span style={{ marginRight: '20px' }}>Missing JD: {processed.missing.length}</span>
                    <button
                style={{ marginRight: '10px', padding: '8px 16px', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      disabled={!processed.out.length}
                      onClick={() => exportCSV(processed.out, 'whatsapp_links.csv')}
                    >
                Download CSV
                    </button>
                    <button
                style={{ padding: '8px 16px', backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      disabled={!processed.missing.length}
                      onClick={() => exportCSV(processed.missing, 'missing_jd_links.csv')}
                    >
                Export Missing JD Report
                    </button>
              </div>

            <div style={{ padding: '10px' }}>
              <div style={{ marginBottom: '10px' }}>
                  <button
                  style={{ marginRight: '10px', padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', backgroundColor: activeTab === 'results' ? '#e0e0e0' : 'white' }}
                    onClick={() => setActiveTab('results')}
                  >
                  Results
                  </button>
                  <button
                  style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', backgroundColor: activeTab === 'missing' ? '#e0e0e0' : 'white' }}
                    onClick={() => setActiveTab('missing')}
                  >
                  Missing JD Links
                  </button>
                </div>

              <div style={{ overflowX: 'auto' }}>
                {activeTab === 'results' ? (
                  <ResultsTable data={processed.out} />
                ) : (
                  <ResultsTable data={processed.missing} />
                )}
                  </div>
                </div>
              </div>
            </div>
      </div>
    </div>
  )
}

function ResultsTable({ data }) {
  if (!data.length) return (
    <div style={{ fontSize: '14px', color: '#666' }}>No data yet. Upload or paste to begin.</div>
  )
  return (
    <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ backgroundColor: '#f5f5f5' }}>
          <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ccc' }}>Name</th>
          <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ccc' }}>Current Role</th>
          <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ccc' }}>Phone</th>
          <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ccc' }}>JD Link</th>
          <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ccc' }}>WhatsApp_Link</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, idx) => (
          <tr key={idx} style={{ borderTop: '1px solid #ccc' }}>
            <td style={{ padding: '8px', border: '1px solid #ccc' }}>{r['Name']}</td>
            <td style={{ padding: '8px', border: '1px solid #ccc' }}>{r['Current Role']}</td>
            <td style={{ padding: '8px', border: '1px solid #ccc' }}>{r['Phone']}</td>
            <td style={{ padding: '8px', border: '1px solid #ccc', maxWidth: '200px', wordBreak: 'break-all' }}>
                {r['JD Link'] ? (
                <a href={r['JD Link']} target="_blank" style={{ color: '#4caf50', textDecoration: 'underline' }}>Open JD</a>
                ) : (
                <span style={{ color: '#999' }}>—</span>
                )}
              </td>
            <td style={{ padding: '8px', border: '1px solid #ccc' }}>
                {r['WhatsApp_Link'] ? (
                  <a
                    href={r['WhatsApp_Link']}
                    target="_blank"
                  style={{ display: 'inline-block', padding: '6px 12px', backgroundColor: '#4caf50', color: 'white', textDecoration: 'none', borderRadius: '4px' }}
                  >
                  Send on WhatsApp
                  </a>
                ) : (
                <span style={{ color: '#999' }}>Invalid phone</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
  )
}

export default App
