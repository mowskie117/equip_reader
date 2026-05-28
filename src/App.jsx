import { useState, useCallback, useRef } from 'react'
import { parseEquipFile, computeAnalysis, oneSampleTTest, twoSampleTTest } from './parser'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import './App.css'

const CHANNELS = ['s0', 's1', 's2', 's3']
const CHANNEL_LABELS = { s0: 'CH0 (Red)', s1: 'CH1 (Green)', s2: 'CH2 (Blue)', s3: 'CH3 (Cyan)' }
const CHANNEL_COLORS = { s0: '#ff4d4d', s1: '#44ff88', s2: '#4488ff', s3: '#cc88ff' }

const DEFAULT_TOP = ['s0', 's1']
const DEFAULT_BOTTOM = ['s2', 's3']

export default function App() {
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [bins, setBins] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [tResult, setTResult] = useState(null)
  const [topChannels, setTopChannels] = useState(DEFAULT_TOP)
  const [bottomChannels, setBottomChannels] = useState(DEFAULT_BOTTOM)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef()

  // Mode: 'interdetector' or 'timeperiod'
  const [mode, setMode] = useState('interdetector')
  const [timePeriodChannel, setTimePeriodChannel] = useState('s2')
  const [cutoffIndex, setCutoffIndex] = useState(null)
  const [tpResult, setTpResult] = useState(null)

  const processFile = useCallback(async (f) => {
    setFile(f)
    setParsing(true)
    setProgress(0)
    setError(null)
    setBins(null)
    setAnalysis(null)
    setTResult(null)

    try {
      // Read in chunks to show progress
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 60))
        }
        reader.onload = (e) => resolve(e.target.result)
        reader.onerror = reject
        reader.readAsText(f)
      })

      setProgress(70)
      await new Promise(r => setTimeout(r, 10))

      const parsed = parseEquipFile(text)
      setProgress(90)
      await new Promise(r => setTimeout(r, 10))

      if (parsed.length === 0) {
        setError('No valid ST/DS bin data found. Make sure this is a valid EQUIP .txt file.')
        setParsing(false)
        return
      }

      setBins(parsed)
      runAnalysis(parsed, topChannels, bottomChannels)
      setProgress(100)
    } catch (e) {
      setError('Failed to parse file: ' + e.message)
    }

    setParsing(false)
  }, [topChannels, bottomChannels])

  const runAnalysis = (b, top, bottom) => {
    const analyzed = computeAnalysis(b, top, bottom)
    setAnalysis(analyzed)
    const diffs = analyzed.map(r => r.difference)
    const tops = analyzed.map(r => r.topCount)
    const bottoms = analyzed.map(r => r.bottomCount)

    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length
    const std = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x-m)**2, 0) / (arr.length-1)) }
    const sorted = arr => [...arr].sort((a, b) => a - b)
    const quantile = (arr, q) => {
      const s = sorted(arr)
      const pos = (s.length - 1) * q
      const base = Math.floor(pos)
      const rest = pos - base
      return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base]
    }
    const fiveNum = arr => ({
      min: Math.min(...arr).toFixed(2),
      q1: quantile(arr, 0.25).toFixed(2),
      median: quantile(arr, 0.5).toFixed(2),
      q3: quantile(arr, 0.75).toFixed(2),
      max: Math.max(...arr).toFixed(2),
      mean: mean(arr).toFixed(2),
      sd: std(arr).toFixed(2),
    })

    const result = oneSampleTTest(diffs)
    result.statsTop = fiveNum(tops)
    result.statsBottom = fiveNum(bottoms)
    result.statsDiff = fiveNum(diffs)
    setTResult(result)
  }

  const runTimePeriod = (b, ch, cutoff) => {
    if (cutoff === null || cutoff === undefined) return
    const period1 = b.slice(0, cutoff).map(bin => bin[ch] ?? 0)
    const period2 = b.slice(cutoff).map(bin => bin[ch] ?? 0)
    if (period1.length < 2 || period2.length < 2) return
    const result = twoSampleTTest(period1, period2, true)
    setTpResult(result)
  }
    let newTop = [...topChannels]
    let newBottom = [...bottomChannels]

    if (side === 'top') {
      if (newTop.includes(ch)) {
        newTop = newTop.filter(c => c !== ch)
      } else {
        newTop.push(ch)
        newBottom = newBottom.filter(c => c !== ch)
      }
    } else {
      if (newBottom.includes(ch)) {
        newBottom = newBottom.filter(c => c !== ch)
      } else {
        newBottom.push(ch)
        newTop = newTop.filter(c => c !== ch)
      }
    }

    setTopChannels(newTop)
    setBottomChannels(newBottom)
    if (bins) runAnalysis(bins, newTop, newBottom)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }, [processFile])

  const chartData = analysis?.map((row, i) => ({
    name: row.timestamp.slice(11, 16),
    top: row.topCount,
    bottom: row.bottomCount,
    diff: row.difference,
    index: i,
  })) ?? []

  // Sample every N points for chart performance
  const sampledChart = chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 200)) === 0)

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⬡</span>
            <div>
              <div className="logo-title">EQUIP READER</div>
              <div className="logo-sub">QuarkNet Cosmic Ray Muon Analyzer</div>
            </div>
          </div>
          <div className="header-meta mono">
            Mounds View HS · Fermilab QuarkNet · 2026
          </div>
        </div>
      </header>

      <main className="main">
        {/* Upload Zone */}
        {!bins && (
          <section
            className={`dropzone ${dragging ? 'dragging' : ''} ${parsing ? 'parsing' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !parsing && fileRef.current.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && processFile(e.target.files[0])}
            />
            {parsing ? (
              <div className="parse-state">
                <div className="spinner" />
                <div className="parse-label mono">PARSING FILE — {progress}%</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="parse-sub mono">{file?.name}</div>
              </div>
            ) : (
              <div className="drop-content">
                <div className="drop-icon">⬡</div>
                <div className="drop-title">DROP EQUIP FILE HERE</div>
                <div className="drop-sub mono">or click to browse · .txt files only</div>
                {error && <div className="error-msg">{error}</div>}
              </div>
            )}
          </section>
        )}

        {bins && (
          <>
            {/* File info bar */}
            <div className="info-bar">
              <div className="info-item">
                <span className="info-label mono">FILE</span>
                <span className="info-value mono">{file?.name}</span>
              </div>
              <div className="info-item">
                <span className="info-label mono">BINS</span>
                <span className="info-value accent mono">{bins.length}</span>
              </div>
              <div className="info-item">
                <span className="info-label mono">DURATION</span>
                <span className="info-value mono">{bins.length * 5} min</span>
              </div>
              <div className="info-item">
                <span className="info-label mono">START</span>
                <span className="info-value mono">{bins[0]?.timestamp}</span>
              </div>
              <div className="info-item">
                <span className="info-label mono">END</span>
                <span className="info-value mono">{bins[bins.length - 1]?.timestamp}</span>
              </div>
              <button className="reset-btn" onClick={() => {
                setBins(null); setAnalysis(null); setTResult(null); setFile(null); setError(null); setTpResult(null); setCutoffIndex(null)
              }}>
                ← NEW FILE
              </button>
            </div>

            {/* Mode Toggle */}
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === 'interdetector' ? 'mode-active' : ''}`}
                onClick={() => setMode('interdetector')}
              >
                ⬡ INTER-DETECTOR
              </button>
              <button
                className={`mode-btn ${mode === 'timeperiod' ? 'mode-active' : ''}`}
                onClick={() => setMode('timeperiod')}
              >
                ◈ TIME PERIOD
              </button>
            </div>

            {/* Time Period Mode UI */}
            {mode === 'timeperiod' && (
              <section className="card">
                <div className="card-header">
                  <span className="card-title">TIME PERIOD COMPARISON</span>
                  <span className="card-sub mono">single channel · split by cutoff bin · 2-sample t-test</span>
                </div>
                <div className="channel-grid">
                  <div className="channel-row">
                    <div className="channel-label mono">Channel to analyze:</div>
                    <div className="channel-btns">
                      {CHANNELS.map(ch => (
                        <button
                          key={ch}
                          className={`ch-btn ${timePeriodChannel === ch ? 'active-top' : ''}`}
                          onClick={() => {
                            setTimePeriodChannel(ch)
                            if (cutoffIndex !== null) runTimePeriod(bins, ch, cutoffIndex)
                          }}
                        >
                          <span style={{ color: CHANNEL_COLORS[ch] }}>●</span> {CHANNEL_LABELS[ch]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="channel-row">
                    <div className="channel-label mono">Cutoff bin index:</div>
                    <div className="channel-btns" style={{ alignItems: 'center', gap: '1rem' }}>
                      <input
                        type="range"
                        min={1}
                        max={bins.length - 1}
                        value={cutoffIndex ?? Math.floor(bins.length / 2)}
                        onChange={e => {
                          const idx = parseInt(e.target.value)
                          setCutoffIndex(idx)
                          runTimePeriod(bins, timePeriodChannel, idx)
                        }}
                        style={{ width: '300px', accentColor: 'var(--accent)' }}
                      />
                      <span className="mono" style={{ color: 'var(--accent)', fontSize: 13 }}>
                        bin {cutoffIndex ?? Math.floor(bins.length / 2)} — {bins[cutoffIndex ?? Math.floor(bins.length / 2)]?.timestamp}
                      </span>
                    </div>
                  </div>
                  <div className="channel-row">
                    <div className="channel-label mono" style={{ fontSize: 11, color: 'var(--text-dimmer)' }}>
                      Period 1: bins 0 → {(cutoffIndex ?? Math.floor(bins.length / 2)) - 1} &nbsp;|&nbsp; Period 2: bins {cutoffIndex ?? Math.floor(bins.length / 2)} → {bins.length - 1}
                    </div>
                  </div>
                </div>

                {/* 2-sample t-test result */}
                {tpResult && (
                  <>
                    <div className="console-wrap" style={{ margin: '0 1.5rem 1.5rem' }}>
                      <div className="console-header mono">▶ 2-SAMPLE T-TEST OUTPUT — {CHANNEL_LABELS[timePeriodChannel]}</div>
                      <div className="console-body mono">
                        <span className="console-comment">{'# ── PERIOD 1 (lead above) ───────────────────'}</span>{'\n'}
                        <span className="console-key">n         </span> = <span className="console-val">{tpResult.stats1.n}</span>{'\n'}
                        <span className="console-key">mean      </span> = <span className="console-val">{tpResult.stats1.mean}</span>{'\n'}
                        <span className="console-key">sd        </span> = <span className="console-val">{tpResult.stats1.sd}</span>{'\n'}
                        <span className="console-key">min       </span> = <span className="console-val">{tpResult.stats1.min}</span>{'\n'}
                        <span className="console-key">Q1        </span> = <span className="console-val">{tpResult.stats1.q1}</span>{'\n'}
                        <span className="console-key">median    </span> = <span className="console-val">{tpResult.stats1.median}</span>{'\n'}
                        <span className="console-key">Q3        </span> = <span className="console-val">{tpResult.stats1.q3}</span>{'\n'}
                        <span className="console-key">max       </span> = <span className="console-val">{tpResult.stats1.max}</span>{'\n'}
                        {'\n'}
                        <span className="console-comment">{'# ── PERIOD 2 (lead not directly above) ──────'}</span>{'\n'}
                        <span className="console-key">n         </span> = <span className="console-val">{tpResult.stats2.n}</span>{'\n'}
                        <span className="console-key">mean      </span> = <span className="console-val">{tpResult.stats2.mean}</span>{'\n'}
                        <span className="console-key">sd        </span> = <span className="console-val">{tpResult.stats2.sd}</span>{'\n'}
                        <span className="console-key">min       </span> = <span className="console-val">{tpResult.stats2.min}</span>{'\n'}
                        <span className="console-key">Q1        </span> = <span className="console-val">{tpResult.stats2.q1}</span>{'\n'}
                        <span className="console-key">median    </span> = <span className="console-val">{tpResult.stats2.median}</span>{'\n'}
                        <span className="console-key">Q3        </span> = <span className="console-val">{tpResult.stats2.q3}</span>{'\n'}
                        <span className="console-key">max       </span> = <span className="console-val">{tpResult.stats2.max}</span>{'\n'}
                        {'\n'}
                        <span className="console-comment">{'# ── 2-SAMPLE T-TEST (H0: mu1 = mu2) ────────'}</span>{'\n'}
                        <span className="console-key">mean_diff </span> = <span className="console-val accent">{tpResult.meanDiff}</span>{'\n'}
                        <span className="console-key">se        </span> = <span className="console-val">{tpResult.se}</span>{'\n'}
                        <span className="console-key">t_stat    </span> = <span className="console-val accent">{tpResult.t}</span>{'\n'}
                        <span className="console-key">df        </span> = <span className="console-val">{tpResult.df}</span>{'\n'}
                        <span className="console-key">p_value   </span> = <span className="console-val accent">{tpResult.pDisplay}</span>{'\n'}
                        {'\n'}
                        <span className="console-comment">{'# ── 95% CONFIDENCE INTERVAL ─────────────────'}</span>{'\n'}
                        <span className="console-key">ci_lower  </span> = <span className="console-val">{tpResult.ciLow}</span>{'\n'}
                        <span className="console-key">ci_upper  </span> = <span className="console-val">{tpResult.ciHigh}</span>{'\n'}
                        <span className="console-key">contains_zero</span> = <span className={`console-val ${tpResult.containsZero ? 'warn' : 'accent'}`}>{tpResult.containsZero ? 'TRUE ⚠' : 'FALSE ✓'}</span>
                      </div>
                    </div>
                    <div className={`verdict ${tpResult.p < 0.05 ? 'verdict-sig' : 'verdict-ns'}`} style={{ margin: '0 1.5rem 1.5rem' }}>
                      {tpResult.p < 0.05
                        ? `✓ STATISTICALLY SIGNIFICANT — p ${tpResult.pDisplay} < 0.05 — reject H₀ — lead position significantly affects count rate`
                        : `✗ NOT SIGNIFICANT — p ${tpResult.pDisplay} ≥ 0.05 — fail to reject H₀`
                      }
                    </div>
                  </>
                )}
              </section>
            )}

            {mode === 'interdetector' && (<>
            <section className="card">
              <div className="card-header">
                <span className="card-title">CHANNEL CONFIGURATION</span>
                <span className="card-sub mono">assign channels to detector position</span>
              </div>
              <div className="channel-grid">
                {CHANNELS.map(ch => (
                  <div key={ch} className="channel-row">
                    <div className="channel-label">
                      <div className="ch-dot" style={{ background: CHANNEL_COLORS[ch] }} />
                      <span className="mono">{CHANNEL_LABELS[ch]}</span>
                    </div>
                    <div className="channel-btns">
                      <button
                        className={`ch-btn ${topChannels.includes(ch) ? 'active-top' : ''}`}
                        onClick={() => handleChannelToggle(ch, 'top')}
                      >
                        ABOVE LEAD
                      </button>
                      <button
                        className={`ch-btn ${bottomChannels.includes(ch) ? 'active-bottom' : ''}`}
                        onClick={() => handleChannelToggle(ch, 'bottom')}
                      >
                        BELOW LEAD
                      </button>
                      <button
                        className={`ch-btn ${!topChannels.includes(ch) && !bottomChannels.includes(ch) ? 'active-none' : ''}`}
                        onClick={() => {
                          const newTop = topChannels.filter(c => c !== ch)
                          const newBottom = bottomChannels.filter(c => c !== ch)
                          setTopChannels(newTop)
                          setBottomChannels(newBottom)
                          if (bins) runAnalysis(bins, newTop, newBottom)
                        }}
                      >
                        EXCLUDE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* T-Test Result */}
            {tResult && (
              <section className="card ttest-card">
                <div className="card-header">
                  <span className="card-title">STATISTICAL ANALYSIS</span>
                  <span className="card-sub mono">1-sample t-test · H₀: μ(diff) = 0 · one-tailed · α = 0.05</span>
                </div>
                <div className="ttest-grid">
                  <div className="stat-block">
                    <div className="stat-label mono">n (bins)</div>
                    <div className="stat-value mono">{tResult.n}</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label mono">mean diff</div>
                    <div className="stat-value mono">{tResult.mean}</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label mono">std error</div>
                    <div className="stat-value mono">{tResult.se}</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label mono">t statistic</div>
                    <div className="stat-value mono accent">{tResult.t}</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label mono">df</div>
                    <div className="stat-value mono">{tResult.df}</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-label mono">p-value (one-tailed)</div>
                    <div className="stat-value mono accent">{tResult.pDisplay}</div>
                  </div>
                </div>

                {/* Console Output */}
                <div className="console-wrap">
                  <div className="console-header mono">▶ SUMMARY STATISTICS OUTPUT</div>
                  <div className="console-body mono">
                    <span className="console-comment">{'# ── ABOVE LEAD ─────────────────────────────'}</span>{'\n'}
                    <span className="console-key">n         </span> = <span className="console-val">{tResult.n}</span>{'\n'}
                    <span className="console-key">mean      </span> = <span className="console-val">{tResult.statsTop?.mean}</span>{'\n'}
                    <span className="console-key">sd        </span> = <span className="console-val">{tResult.statsTop?.sd}</span>{'\n'}
                    <span className="console-key">min       </span> = <span className="console-val">{tResult.statsTop?.min}</span>{'\n'}
                    <span className="console-key">Q1        </span> = <span className="console-val">{tResult.statsTop?.q1}</span>{'\n'}
                    <span className="console-key">median    </span> = <span className="console-val">{tResult.statsTop?.median}</span>{'\n'}
                    <span className="console-key">Q3        </span> = <span className="console-val">{tResult.statsTop?.q3}</span>{'\n'}
                    <span className="console-key">max       </span> = <span className="console-val">{tResult.statsTop?.max}</span>{'\n'}
                    {'\n'}
                    <span className="console-comment">{'# ── BELOW LEAD ─────────────────────────────'}</span>{'\n'}
                    <span className="console-key">n         </span> = <span className="console-val">{tResult.n}</span>{'\n'}
                    <span className="console-key">mean      </span> = <span className="console-val">{tResult.statsBottom?.mean}</span>{'\n'}
                    <span className="console-key">sd        </span> = <span className="console-val">{tResult.statsBottom?.sd}</span>{'\n'}
                    <span className="console-key">min       </span> = <span className="console-val">{tResult.statsBottom?.min}</span>{'\n'}
                    <span className="console-key">Q1        </span> = <span className="console-val">{tResult.statsBottom?.q1}</span>{'\n'}
                    <span className="console-key">median    </span> = <span className="console-val">{tResult.statsBottom?.median}</span>{'\n'}
                    <span className="console-key">Q3        </span> = <span className="console-val">{tResult.statsBottom?.q3}</span>{'\n'}
                    <span className="console-key">max       </span> = <span className="console-val">{tResult.statsBottom?.max}</span>{'\n'}
                    {'\n'}
                    <span className="console-comment">{'# ── DIFFERENCE SCORES (above - below) ──────'}</span>{'\n'}
                    <span className="console-key">n         </span> = <span className="console-val">{tResult.n}</span>{'\n'}
                    <span className="console-key">mean      </span> = <span className="console-val accent">{tResult.statsDiff?.mean}</span>{'\n'}
                    <span className="console-key">sd        </span> = <span className="console-val">{tResult.statsDiff?.sd}</span>{'\n'}
                    <span className="console-key">min       </span> = <span className="console-val">{tResult.statsDiff?.min}</span>{'\n'}
                    <span className="console-key">Q1        </span> = <span className="console-val">{tResult.statsDiff?.q1}</span>{'\n'}
                    <span className="console-key">median    </span> = <span className="console-val">{tResult.statsDiff?.median}</span>{'\n'}
                    <span className="console-key">Q3        </span> = <span className="console-val">{tResult.statsDiff?.q3}</span>{'\n'}
                    <span className="console-key">max       </span> = <span className="console-val">{tResult.statsDiff?.max}</span>{'\n'}
                    {'\n'}
                    <span className="console-comment">{'# ── 1-SAMPLE T-TEST (H0: mean_diff = 0) ────'}</span>{'\n'}
                    <span className="console-key">t_stat    </span> = <span className="console-val accent">{tResult.t}</span>{'\n'}
                    <span className="console-key">df        </span> = <span className="console-val">{tResult.df}</span>{'\n'}
                    <span className="console-key">p_value   </span> = <span className="console-val accent">{tResult.pDisplay}</span>{'\n'}
                    {'\n'}
                    <span className="console-comment">{'# ── 95% CONFIDENCE INTERVAL ─────────────────'}</span>{'\n'}
                    <span className="console-key">ci_lower  </span> = <span className="console-val">{tResult.ciLow}</span>{'\n'}
                    <span className="console-key">ci_upper  </span> = <span className="console-val">{tResult.ciHigh}</span>{'\n'}
                    <span className="console-key">contains_zero</span> = <span className={`console-val ${tResult.containsZero ? 'warn' : 'accent'}`}>{tResult.containsZero ? 'TRUE ⚠' : 'FALSE ✓'}</span>
                  </div>
                </div>

                <div className="ci-section">
                  <div className="ci-header mono">95% CONFIDENCE INTERVAL — x̄ ± t* · SE &nbsp;|&nbsp; t* = {tResult.tStar}</div>
                  <div className="ci-row">
                    <div className="ci-bound">
                      <div className="stat-label mono">lower bound</div>
                      <div className="stat-value mono">{tResult.ciLow}</div>
                    </div>
                    <div className="ci-bar-wrap">
                      <div className="ci-bar">
                        <div className="ci-range" />
                        <div className={`ci-zero ${tResult.containsZero ? 'zero-inside' : 'zero-outside'}`}>0</div>
                      </div>
                      <div className="ci-label mono">
                        {tResult.containsZero
                          ? '⚠ zero is inside the interval'
                          : '✓ zero is outside the interval'}
                      </div>
                    </div>
                    <div className="ci-bound">
                      <div className="stat-label mono">upper bound</div>
                      <div className="stat-value mono">{tResult.ciHigh}</div>
                    </div>
                  </div>
                </div>

                <div className={`verdict ${tResult.p < 0.05 ? 'verdict-sig' : 'verdict-ns'}`}>
                  {tResult.p < 0.05
                    ? `✓ STATISTICALLY SIGNIFICANT — p ${tResult.pDisplay} < 0.05 — reject H₀ — CI does not contain zero`
                    : `✗ NOT SIGNIFICANT — p ${tResult.pDisplay} ≥ 0.05 — fail to reject H₀`
                  }
                </div>
              </section>
            )}

            {/* Chart */}
            {analysis && (
              <section className="card">
                <div className="card-header">
                  <span className="card-title">MUON COUNT RATES OVER TIME</span>
                  <span className="card-sub mono">5-min bins · sampled for display</span>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={sampledChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <XAxis dataKey="name" stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#18181d', border: '1px solid #2a2a35', fontFamily: 'Share Tech Mono', fontSize: 12 }}
                        labelStyle={{ color: '#e8e8f0' }}
                      />
                      <Legend wrapperStyle={{ fontFamily: 'Share Tech Mono', fontSize: 12 }} />
                      <ReferenceLine y={0} stroke="#2a2a35" />
                      <Line type="monotone" dataKey="top" stroke="#00ff88" dot={false} strokeWidth={1.5} name="Above Lead" />
                      <Line type="monotone" dataKey="bottom" stroke="#00ccff" dot={false} strokeWidth={1.5} name="Below Lead" />
                      <Line type="monotone" dataKey="diff" stroke="#ff6b35" dot={false} strokeWidth={1} name="Difference" strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Histogram of difference scores */}
            {analysis && (() => {
              const diffs = analysis.map(r => r.difference)
              const min = Math.min(...diffs)
              const max = Math.max(...diffs)
              const bins = 30
              const binWidth = (max - min) / bins
              const counts = Array(bins).fill(0)
              diffs.forEach(d => {
                const i = Math.min(Math.floor((d - min) / binWidth), bins - 1)
                counts[i]++
              })
              const histData = counts.map((count, i) => ({
                bin: (min + i * binWidth).toFixed(0),
                count
              }))
              return (
                <section className="card">
                  <div className="card-header">
                    <span className="card-title">DISTRIBUTION OF DIFFERENCE SCORES</span>
                    <span className="card-sub mono">above − below · per 5-min bin · use for SOCS shape analysis</span>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={histData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                        <XAxis dataKey="bin" stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 10 }} interval={4} label={{ value: 'Difference (counts/bin)', position: 'insideBottom', offset: -10, fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} />
                        <YAxis stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} label={{ value: 'Frequency', angle: -90, position: 'insideLeft', fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: '#18181d', border: '1px solid #2a2a35', fontFamily: 'Share Tech Mono', fontSize: 12 }}
                          formatter={(val, name) => [val, 'frequency']}
                          labelFormatter={(label) => `diff ≈ ${label}`}
                        />
                        <Bar dataKey="count" fill="#ff6b35" opacity={0.8} name="frequency" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )
            })()}

            {/* Data Table */}
            {analysis && (
              <section className="card">
                <div className="card-header">
                  <span className="card-title">BIN DATA</span>
                  <span className="card-sub mono">showing first 100 bins</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table mono">
                    <thead>
                      <tr>
                        <th>TIMESTAMP</th>
                        <th>S0</th>
                        <th>S1</th>
                        <th>S2</th>
                        <th>S3</th>
                        <th>ABOVE</th>
                        <th>BELOW</th>
                        <th>DIFF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.slice(0, 100).map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'row-even' : ''}>
                          <td>{row.timestamp}</td>
                          <td style={{ color: CHANNEL_COLORS.s0 }}>{row.s0.toLocaleString()}</td>
                          <td style={{ color: CHANNEL_COLORS.s1 }}>{row.s1.toLocaleString()}</td>
                          <td style={{ color: CHANNEL_COLORS.s2 }}>{row.s2.toLocaleString()}</td>
                          <td style={{ color: CHANNEL_COLORS.s3 }}>{row.s3.toLocaleString()}</td>
                          <td className="col-top">{row.topCount.toLocaleString()}</td>
                          <td className="col-bottom">{row.bottomCount.toLocaleString()}</td>
                          <td className="col-diff">{row.difference.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            </>}
          </>
        )}
      </main>

      <footer className="footer mono">
        EQUIP READER · QUARKNET COSMIC RAY MUON DETECTOR · MOUNDS VIEW HIGH SCHOOL
      </footer>
    </div>
  )
}
