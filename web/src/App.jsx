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

function generateMessage(row, template) {
  let message = template || `Dear *{Name}*,
I am *Vani, Recruiter at I Knowledge Factory Pvt. Ltd.* – a full-service *digital branding and marketing agency*.

We reviewed your profile on *Naukri Portal* and found it suitable for the role of *{Current Role}*.

If you are open to exploring opportunities with us, please review the *Job Description on our website and apply here*: {JD Link}

Once done, I will connect with you to schedule the *screening round*.

Best regards,
*Vani Jha*
Talent Acquisition Specialist
*+91 9665079317*
*www.ikf.co.in*`

  // Replace placeholders with actual values
  Object.keys(row).forEach(key => {
    const placeholder = `{${key}}`
    const value = row[key]?.toString().trim() || ''
    message = message.replace(new RegExp(placeholder, 'g'), value)
  })

  return message
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
  const [messageTemplate, setMessageTemplate] = useState(`Dear *{Name}*,
I am *Vani, Recruiter at I Knowledge Factory Pvt. Ltd.* – a full-service *digital branding and marketing agency*.

We reviewed your profile on *Naukri Portal* and found it suitable for the role of *{Current Role}*.

If you are open to exploring opportunities with us, please review the *Job Description on our website and apply here*: {JD Link}

Once done, I will connect with you to schedule the *screening round*.

Best regards,
*Vani Jha*
Talent Acquisition Specialist
*+91 9665079317*
*www.ikf.co.in*`)
  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  const processed = useMemo(() => {
    const out = []
    const missing = []

    for (const r of rows) {
      const normalized = ensureColumns(r)
      const phone = cleanPhone(normalized['Phone'])
      const message = generateMessage(normalized, messageTemplate)
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
  }, [rows, messageTemplate])

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
    <div style={{ 
      padding: '20px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', 
      maxWidth: '100%', 
      margin: '0 auto',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      minHeight: '100vh'
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '20px',
        padding: '40px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(10px)'
      }}>
        <h1 style={{ 
          textAlign: 'center', 
          marginBottom: '10px',
          fontSize: '2.5rem',
          fontWeight: '700',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
        }}>WhatsApp Link Generator</h1>
        <p style={{ 
          textAlign: 'center', 
          marginBottom: '40px',
          fontSize: '1.1rem',
          color: '#6b7280',
          fontWeight: '500'
        }}>
          Upload CSV/Excel or paste data to generate personalized messages and links.
        </p>

      <div style={{ width: '100%', maxWidth: '100%' }}>
        <div style={{ width: '100%', maxWidth: '100%' }}>
          <div style={{ 
            background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
            border: 'none',
            padding: '30px', 
            marginBottom: '30px', 
            borderRadius: '16px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <h2 style={{ 
              fontSize: '1.5rem',
              fontWeight: '600',
              color: '#1e293b',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              📁 Import Candidates
            </h2>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={downloadTemplateCSV} style={{ 
                padding: '12px 24px', 
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px', 
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                transition: 'all 0.2s ease',
                ':hover': { transform: 'translateY(-2px)' }
              }}>
                📥 Download Template
              </button>
              <button onClick={() => { setRows([]); setMissingJDRows([]); setErrors([]) }} style={{ 
                padding: '12px 24px', 
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px', 
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
                transition: 'all 0.2s ease'
              }}>
                🗑️ Clear
              </button>
            </div>

              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onClick={() => fileInputRef.current?.click()}
                style={{ 
                  border: '2px dashed #cbd5e1', 
                  padding: '40px 20px', 
                  textAlign: 'center', 
                  cursor: 'pointer', 
                  marginBottom: '25px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
                  transition: 'all 0.3s ease',
                  borderColor: '#94a3b8',
                  ':hover': {
                    borderColor: '#667eea',
                    background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
                    transform: 'translateY(-2px)'
                  }
                }}
            >
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#475569', marginBottom: '8px' }}>
                📎 Drag & drop file here, or click to browse
              </div>
              <div style={{ fontSize: '14px', color: '#64748b' }}>Accepted: .csv, .xlsx</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                  onChange={(e) => onFilesSelected(e.target.files)}
                />
              </div>

            <div>
              <label style={{ 
                display: 'block', 
                marginBottom: '10px', 
                fontWeight: '600',
                fontSize: '16px',
                color: '#374151'
              }}>📋 Paste Tabular Data</label>
                <textarea
                style={{ 
                  width: '100%', 
                  height: '140px', 
                  padding: '16px', 
                  border: '2px solid #e5e7eb', 
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  background: '#fafafa',
                  transition: 'all 0.2s ease',
                  resize: 'vertical',
                  ':focus': {
                    outline: 'none',
                    borderColor: '#667eea',
                    boxShadow: '0 0 0 3px rgba(102, 126, 234, 0.1)'
                  }
                }}
                placeholder="Paste CSV/TSV with header: Name, Phone, Current Role, Key Skills, Profile Summary, JD Link"
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    handlePaste(text)
                  }}
                />
              </div>
            </div>

            {errors.length > 0 && (
            <div style={{ 
              background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
              color: '#dc2626', 
              padding: '16px', 
              marginBottom: '20px', 
              borderRadius: '12px',
              border: '1px solid #fecaca',
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.1)'
            }}>
                {errors.map((er, i) => (
                <div key={i} style={{ fontWeight: '500' }}>⚠️ {er}</div>
                ))}
              </div>
            )}

          {/* Message Template Editor */}
          <div style={{ 
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: '1px solid #bae6fd',
            padding: '30px', 
            marginBottom: '30px', 
            borderRadius: '16px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.08)'
          }}>
            <h3 style={{ 
              marginBottom: '20px',
              fontSize: '1.5rem',
              fontWeight: '600',
              color: '#0c4a6e',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>✏️ Message Template Editor</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '10px', 
                fontWeight: '600',
                fontSize: '16px',
                color: '#0c4a6e'
              }}>
                Edit your message template:
              </label>
              <textarea
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                style={{ 
                  width: '100%', 
                  height: '200px', 
                  padding: '16px', 
                  border: '2px solid #bae6fd', 
                  borderRadius: '12px',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  background: '#fafafa',
                  transition: 'all 0.2s ease',
                  resize: 'vertical',
                  ':focus': {
                    outline: 'none',
                    borderColor: '#0ea5e9',
                    boxShadow: '0 0 0 3px rgba(14, 165, 233, 0.1)'
                  }
                }}
                placeholder="Use {Name}, {Current Role}, {JD Link} as placeholders..."
              />
                <p style={{ 
                  fontSize: '13px', 
                  color: '#64748b', 
                  marginTop: '8px', 
                  marginBottom: 0,
                  fontStyle: 'italic'
                }}>
                  💡 Use placeholders: {'{Name}'}, {'{Current Role}'}, {'{JD Link}'}, {'{Key Skills}'}, {'{Profile Summary}'}
                </p>
            </div>

            {/* Live Preview */}
            {processed.out.length > 0 && (
                  <div>
                <h4 style={{ 
                  marginBottom: '15px',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: '#0c4a6e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>👁️ Live Preview (First Candidate):</h4>
                <div style={{ 
                  background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                  padding: '20px', 
                  borderRadius: '12px', 
                  border: '2px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)'
                }}>
                  <pre style={{ 
                    whiteSpace: 'pre-wrap', 
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace', 
                    fontSize: '14px', 
                    lineHeight: '1.6',
                    margin: 0,
                    color: '#1e293b',
                    background: 'transparent'
                  }}>
                    {generateMessage(processed.out[0], messageTemplate)}
                  </pre>
                </div>
                <p style={{ 
                  fontSize: '13px', 
                  color: '#64748b', 
                  marginTop: '12px', 
                  marginBottom: 0,
                  fontStyle: 'italic'
                }}>
                  ✨ This preview updates as you edit the template above. All messages will use this template.
                </p>
              </div>
            )}
          </div>

          <div style={{ 
            background: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)',
            border: '1px solid #fde68a',
            borderRadius: '16px', 
            overflow: 'hidden', 
            width: '100%',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ 
              padding: '20px', 
              borderBottom: '2px solid #fde68a', 
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '15px'
            }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ 
                  background: 'rgba(34, 197, 94, 0.1)',
                  color: '#166534',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  fontWeight: '600',
                  fontSize: '14px',
                  border: '1px solid rgba(34, 197, 94, 0.2)'
                }}>
                  ✅ Total: {processed.out.length}
                </div>
                <div style={{ 
                  background: 'rgba(245, 158, 11, 0.1)',
                  color: '#92400e',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  fontWeight: '600',
                  fontSize: '14px',
                  border: '1px solid rgba(245, 158, 11, 0.2)'
                }}>
                  ⚠️ Missing JD: {processed.missing.length}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                style={{ 
                  padding: '12px 20px', 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '12px', 
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                  transition: 'all 0.2s ease',
                  opacity: !processed.out.length ? 0.5 : 1
                }}
                disabled={!processed.out.length}
                onClick={() => exportCSV(processed.out, 'whatsapp_links.csv')}
              >
                📥 Download CSV
              </button>
              <button
                style={{ 
                  padding: '12px 20px', 
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '12px', 
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                  transition: 'all 0.2s ease',
                  opacity: !processed.missing.length ? 0.5 : 1
                }}
                disabled={!processed.missing.length}
                onClick={() => exportCSV(processed.missing, 'missing_jd_links.csv')}
              >
                📊 Export Missing JD Report
              </button>
              </div>
            </div>

            <div style={{ padding: '20px', width: '100%', background: '#fefce8' }}>
              <div style={{ 
                marginBottom: '20px',
                display: 'flex',
                gap: '8px',
                background: 'rgba(255, 255, 255, 0.5)',
                padding: '4px',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)'
              }}>
                  <button
                  style={{ 
                    padding: '12px 24px', 
                    border: 'none', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    background: activeTab === 'results' ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' : 'transparent',
                    color: activeTab === 'results' ? 'white' : '#6b7280',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'all 0.2s ease',
                    boxShadow: activeTab === 'results' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                  }}
                  onClick={() => setActiveTab('results')}
                >
                  📊 Results
                </button>
                <button
                  style={{ 
                    padding: '12px 24px', 
                    border: 'none', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    background: activeTab === 'missing' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'transparent',
                    color: activeTab === 'missing' ? 'white' : '#6b7280',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'all 0.2s ease',
                    boxShadow: activeTab === 'missing' ? '0 4px 12px rgba(245, 158, 11, 0.3)' : 'none'
                  }}
                  onClick={() => setActiveTab('missing')}
                >
                  ⚠️ Missing JD Links
                </button>
              </div>

              <div style={{ overflowX: 'auto', width: '100%' }}>
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
    </div>
  )
}

function ResultsTable({ data }) {
  if (!data.length) return (
    <div style={{ 
      fontSize: '16px', 
      color: '#6b7280',
      textAlign: 'center',
      padding: '40px',
      background: 'rgba(255, 255, 255, 0.5)',
      borderRadius: '12px',
      border: '2px dashed #d1d5db'
    }}>
      📋 No data yet. Upload or paste to begin.
    </div>
  )
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.8)',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <table style={{ 
        width: '100%', 
        fontSize: '14px', 
        borderCollapse: 'collapse', 
        minWidth: '100%',
        background: 'white'
      }}>
        <thead>
          <tr style={{ 
            background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
            borderBottom: '2px solid #e5e7eb'
          }}>
            <th style={{ 
              padding: '16px 12px', 
              textAlign: 'left', 
              fontWeight: '600',
              color: '#374151',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>👤 Name</th>
            <th style={{ 
              padding: '16px 12px', 
              textAlign: 'left', 
              fontWeight: '600',
              color: '#374151',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>💼 Current Role</th>
            <th style={{ 
              padding: '16px 12px', 
              textAlign: 'left', 
              fontWeight: '600',
              color: '#374151',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>📱 Phone</th>
            <th style={{ 
              padding: '16px 12px', 
              textAlign: 'left', 
              fontWeight: '600',
              color: '#374151',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>🔗 JD Link</th>
            <th style={{ 
              padding: '16px 12px', 
              textAlign: 'left', 
              fontWeight: '600',
              color: '#374151',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>💬 WhatsApp</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, idx) => (
            <tr key={idx} style={{ 
              borderBottom: '1px solid #f3f4f6',
              transition: 'all 0.2s ease',
              ':hover': {
                background: '#f8fafc'
              }
            }}>
              <td style={{ 
                padding: '16px 12px', 
                fontWeight: '500',
                color: '#1f2937'
              }}>{r['Name']}</td>
              <td style={{ 
                padding: '16px 12px', 
                color: '#4b5563'
              }}>{r['Current Role']}</td>
              <td style={{ 
                padding: '16px 12px', 
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                color: '#6b7280',
                fontSize: '13px'
              }}>{r['Phone']}</td>
              <td style={{ 
                padding: '16px 12px', 
                maxWidth: '200px', 
                wordBreak: 'break-all' 
              }}>
                {r['JD Link'] ? (
                  <a href={r['JD Link']} target="_blank" style={{ 
                    color: '#3b82f6', 
                    textDecoration: 'none',
                    fontWeight: '500',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    transition: 'all 0.2s ease',
                    ':hover': {
                      background: 'rgba(59, 130, 246, 0.2)'
                    }
                  }}>🔗 Open JD</a>
                ) : (
                  <span style={{ color: '#9ca3af' }}>—</span>
                )}
              </td>
              <td style={{ padding: '16px 12px' }}>
                {r['WhatsApp_Link'] ? (
                  <a
                    href={r['WhatsApp_Link']}
                    target="_blank"
                    style={{ 
                      display: 'inline-block', 
                      padding: '8px 16px', 
                      background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)',
                      color: 'white', 
                      textDecoration: 'none', 
                      borderRadius: '8px',
                      fontWeight: '600',
                      fontSize: '13px',
                      boxShadow: '0 2px 8px rgba(37, 211, 102, 0.3)',
                      transition: 'all 0.2s ease',
                      ':hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(37, 211, 102, 0.4)'
                      }
                    }}
                  >
                    💬 Send on WhatsApp
                  </a>
                ) : (
                  <span style={{ 
                    color: '#ef4444',
                    fontWeight: '500',
                    fontSize: '13px'
                  }}>❌ Invalid phone</span>
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
