import { useState, useCallback, useRef } from 'react'
import { parseEquipFile, computeAnalysis, oneSampleTTest, twoSampleTTest } from './parser'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import './App.css'

const CHANNELS = ['s0', 's1', 's2', 's3']
const CHANNEL_LABELS = { s0: 'CH0 (Red)', s1: 'CH1 (Green)', s2: 'CH2 (Blue)', s3: 'CH3 (Cyan)' }
const CHANNEL_COLORS = { s0: '#ff4d4d', s1: '#44ff88', s2: '#4488ff', s3: '#cc88ff' }
const DEFAULT_TOP = ['s0', 's1']
const DEFAULT_BOTTOM = ['s2', 's3']

function StatBlock({ label, value, accent }) {
  return (
    <div className="stat-block">
      <div className="stat-label mono">{label}</div>
      <div className={`stat-value mono${accent ? ' accent' : ''}`}>{value}</div>
    </div>
  )
}

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
  const [mode, setMode] = useState('interdetector')
  const [timePeriodChannel, setTimePeriodChannel] = useState('s2')
  const [cutoffIndex, setCutoffIndex] = useState(null)
  const [tpResult, setTpResult] = useState(null)
  const fileRef = useRef()

  const computeStats = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const n = arr.length
    const mean = arr.reduce((a, b) => a + b, 0) / n
    const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)
    const sd = Math.sqrt(variance)
    const q = (p) => {
      const pos = (sorted.length - 1) * p
      const base = Math.floor(pos)
      const rest = pos - base
      return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
    }
    return {
      n, mean: mean.toFixed(2), sd: sd.toFixed(2),
      min: sorted[0].toFixed(2), q1: q(0.25).toFixed(2),
      median: q(0.5).toFixed(2), q3: q(0.75).toFixed(2),
      max: sorted[sorted.length - 1].toFixed(2),
    }
  }

  const processFile = useCallback(async (f) => {
    setFile(f); setParsing(true); setProgress(0); setError(null)
    setBins(null); setAnalysis(null); setTResult(null); setTpResult(null); setCutoffIndex(null)
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 60)) }
        reader.onload = (e) => resolve(e.target.result)
        reader.onerror = reject
        reader.readAsText(f)
      })
      setProgress(70)
      await new Promise(r => setTimeout(r, 10))
      const parsed = parseEquipFile(text)
      setProgress(90)
      await new Promise(r => setTimeout(r, 10))
      if (parsed.length === 0) { setError('No valid ST/DS bin data found.'); setParsing(false); return }
      setBins(parsed)
      doRunAnalysis(parsed, topChannels, bottomChannels)
      setProgress(100)
    } catch (e) { setError('Failed to parse file: ' + e.message) }
    setParsing(false)
  }, [topChannels, bottomChannels])

  const doRunAnalysis = (b, top, bottom) => {
    const analyzed = computeAnalysis(b, top, bottom)
    setAnalysis(analyzed)
    const diffs = analyzed.map(r => r.difference)
    const tops = analyzed.map(r => r.topCount)
    const bots = analyzed.map(r => r.bottomCount)
    const result = oneSampleTTest(diffs)
    result.statsTop = computeStats(tops)
    result.statsBottom = computeStats(bots)
    result.statsDiff = computeStats(diffs)
    setTResult(result)
  }

  const doRunTimePeriod = (b, ch, cutoff) => {
    if (cutoff === null || cutoff === undefined) return
    const p1 = b.slice(0, cutoff).map(bin => bin[ch] ?? 0)
    const p2 = b.slice(cutoff).map(bin => bin[ch] ?? 0)
    if (p1.length < 2 || p2.length < 2) return
    setTpResult(twoSampleTTest(p1, p2, true))
  }

  const handleChannelToggle = (ch, side) => {
    let newTop = [...topChannels]
    let newBottom = [...bottomChannels]
    if (side === 'top') {
      if (newTop.includes(ch)) newTop = newTop.filter(c => c !== ch)
      else { newTop.push(ch); newBottom = newBottom.filter(c => c !== ch) }
    } else {
      if (newBottom.includes(ch)) newBottom = newBottom.filter(c => c !== ch)
      else { newBottom.push(ch); newTop = newTop.filter(c => c !== ch) }
    }
    setTopChannels(newTop); setBottomChannels(newBottom)
    if (bins) doRunAnalysis(bins, newTop, newBottom)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }, [processFile])

  const sampledChart = (analysis || [])
    .map((row, i) => ({ name: row.timestamp.slice(11, 16), top: row.topCount, bottom: row.bottomCount, diff: row.difference }))
    .filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 200)) === 0)

  const cutoff = cutoffIndex ?? (bins ? Math.floor(bins.length / 2) : 0)

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
          <div className="header-meta mono">Mounds View HS · Fermilab QuarkNet · 2026</div>
        </div>
      </header>

      <main className="main">

        {!bins && (
          <section
            className={`dropzone ${dragging ? 'dragging' : ''} ${parsing ? 'parsing' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !parsing && fileRef.current.click()}
          >
            <input ref={fileRef} type="file" accept=".txt" style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && processFile(e.target.files[0])} />
            {parsing ? (
              <div className="parse-state">
                <div className="spinner" />
                <div className="parse-label mono">PARSING FILE — {progress}%</div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
                <div className="parse-sub mono">{file && file.name}</div>
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
          <div className="bins-container">

            <div className="info-bar">
              <div className="info-item">
                <span className="info-label mono">FILE</span>
                <span className="info-value mono">{file && file.name}</span>
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
                <span className="info-value mono">{bins[0] && bins[0].timestamp}</span>
              </div>
              <div className="info-item">
                <span className="info-label mono">END</span>
                <span className="info-value mono">{bins[bins.length - 1] && bins[bins.length - 1].timestamp}</span>
              </div>
              <button className="reset-btn" onClick={() => {
                setBins(null); setAnalysis(null); setTResult(null); setFile(null)
                setError(null); setTpResult(null); setCutoffIndex(null)
              }}>← NEW FILE</button>
            </div>

            <div className="mode-toggle">
              <button className={`mode-btn ${mode === 'interdetector' ? 'mode-active' : ''}`} onClick={() => setMode('interdetector')}>
                ⬡ INTER-DETECTOR
              </button>
              <button className={`mode-btn ${mode === 'timeperiod' ? 'mode-active' : ''}`} onClick={() => setMode('timeperiod')}>
                ◈ TIME PERIOD
              </button>
            </div>

            {mode === 'timeperiod' && (
              <div className="interdetector-container">
                <section className="card">
                  <div className="card-header">
                    <span className="card-title">TIME PERIOD COMPARISON</span>
                    <span className="card-sub mono">single channel · click chart to set cutoff · 2-sample t-test (period2 - period1)</span>
                  </div>
                  <div className="channel-grid">
                    <div className="channel-row">
                      <div className="channel-label mono">Channel:</div>
                      <div className="channel-btns">
                        {CHANNELS.map(ch => (
                          <button key={ch}
                            className={`ch-btn ${timePeriodChannel === ch ? 'active-top' : ''}`}
                            onClick={() => {
                              setTimePeriodChannel(ch)
                              doRunTimePeriod(bins, ch, cutoffIndex)
                            }}
                          >
                            {CHANNEL_LABELS[ch]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="channel-row">
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-dimmer)' }}>
                        {cutoffIndex !== null
                          ? 'Cutoff: bin ' + cutoffIndex + ' — ' + (bins[cutoffIndex] && bins[cutoffIndex].timestamp) + ' | Period 1: 0 to ' + (cutoffIndex - 1) + ' | Period 2: ' + cutoffIndex + ' to ' + (bins.length - 1)
                          : 'Click the chart below to set the cutoff point between periods'}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="card">
                  <div className="card-header">
                    <span className="card-title">SINGLE CHANNEL COUNTS OVER TIME</span>
                    <span className="card-sub mono">click anywhere on chart to set cutoff · green line = cutoff</span>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={bins.map((b, i) => ({ name: b.timestamp.slice(11, 16), count: b[timePeriodChannel] ?? 0, index: i }))}
                        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                        onClick={(e) => {
                          if (e && e.activePayload && e.activePayload[0]) {
                            const idx = e.activePayload[0].payload.index
                            setCutoffIndex(idx)
                            doRunTimePeriod(bins, timePeriodChannel, idx)
                          }
                        }}
                        style={{ cursor: 'crosshair' }}
                      >
                        <XAxis dataKey="name" stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: '#18181d', border: '1px solid #2a2a35', fontFamily: 'Share Tech Mono', fontSize: 12 }} />
                        {cutoffIndex !== null && <ReferenceLine x={bins[cutoffIndex] && bins[cutoffIndex].timestamp.slice(11, 16)} stroke="#00ff88" strokeWidth={2} label={{ value: 'cutoff', fill: '#00ff88', fontFamily: 'Share Tech Mono', fontSize: 11 }} />}
                        <Line type="monotone" dataKey="count" stroke={CHANNEL_COLORS[timePeriodChannel]} dot={false} strokeWidth={1.5} name="Count" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {tpResult && (
                  <section className="card ttest-card">
                    <div className="card-header">
                      <span className="card-title">STATISTICAL ANALYSIS</span>
                      <span className="card-sub mono">2-sample t-test · H0: mu2 = mu1 · Ha: mu2 &gt; mu1 · one-tailed · alpha = 0.05</span>
                    </div>
                    <div className="ttest-grid">
                      <StatBlock label="n1 (period 1)" value={tpResult.n1} />
                      <StatBlock label="n2 (period 2)" value={tpResult.n2} />
                      <StatBlock label="mean diff (p2-p1)" value={tpResult.meanDiff} />
                      <StatBlock label="std error" value={tpResult.se} />
                      <StatBlock label="t statistic" value={tpResult.t} accent />
                      <StatBlock label="df" value={tpResult.df} />
                      <StatBlock label="p-value (one-tailed)" value={tpResult.pDisplay} accent />
                    </div>
                    <div style={{ padding: '0 1.5rem 1.5rem' }}>
                      <div className="console-wrap">
                        <div className="console-header mono">▶ 2-SAMPLE T-TEST — {CHANNEL_LABELS[timePeriodChannel]}</div>
                        <div className="console-body mono">
                          {'# PERIOD 1 (lead directly above — lower counts)\n'}
                          {'n       = '}<span className="console-val">{tpResult.stats1.n}</span>{'\n'}
                          {'mean    = '}<span className="console-val">{tpResult.stats1.mean}</span>{'\n'}
                          {'sd      = '}<span className="console-val">{tpResult.stats1.sd}</span>{'\n'}
                          {'min/Q1/med/Q3/max = '}<span className="console-val">{tpResult.stats1.min} / {tpResult.stats1.q1} / {tpResult.stats1.median} / {tpResult.stats1.q3} / {tpResult.stats1.max}</span>{'\n\n'}
                          {'# PERIOD 2 (lead not directly above — higher counts)\n'}
                          {'n       = '}<span className="console-val">{tpResult.stats2.n}</span>{'\n'}
                          {'mean    = '}<span className="console-val">{tpResult.stats2.mean}</span>{'\n'}
                          {'sd      = '}<span className="console-val">{tpResult.stats2.sd}</span>{'\n'}
                          {'min/Q1/med/Q3/max = '}<span className="console-val">{tpResult.stats2.min} / {tpResult.stats2.q1} / {tpResult.stats2.median} / {tpResult.stats2.q3} / {tpResult.stats2.max}</span>{'\n\n'}
                          {'# 2-SAMPLE T-TEST (t = (mu2-mu1)/se)\n'}
                          {'mean_diff (p2-p1) = '}<span className="console-val accent">{tpResult.meanDiff}</span>{'\n'}
                          {'se        = '}<span className="console-val">{tpResult.se}</span>{'\n'}
                          {'t_stat    = '}<span className="console-val accent">{tpResult.t}</span>{'\n'}
                          {'df        = '}<span className="console-val">{tpResult.df}</span>{'\n'}
                          {'p_value   = '}<span className="console-val accent">{tpResult.pDisplay}</span>{'\n\n'}
                          {'# 95% CI (mu2 - mu1)\n'}
                          {'ci_lower  = '}<span className="console-val">{tpResult.ciLow}</span>{'\n'}
                          {'ci_upper  = '}<span className="console-val">{tpResult.ciHigh}</span>{'\n'}
                          {'contains_zero = '}<span className={tpResult.containsZero ? 'console-val warn' : 'console-val accent'}>{tpResult.containsZero ? 'TRUE' : 'FALSE'}</span>
                        </div>
                      </div>
                      <div className={tpResult.p < 0.05 ? 'verdict verdict-sig' : 'verdict verdict-ns'}>
                        {tpResult.p < 0.05
                          ? 'STATISTICALLY SIGNIFICANT — p ' + tpResult.pDisplay + ' < 0.05 — reject H0 — removing lead significantly increased count rate'
                          : 'NOT SIGNIFICANT — p ' + tpResult.pDisplay + ' >= 0.05 — fail to reject H0'}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            {mode === 'interdetector' && (
              <div className="interdetector-container">

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
                          <button className={`ch-btn ${topChannels.includes(ch) ? 'active-top' : ''}`}
                            onClick={() => handleChannelToggle(ch, 'top')}>ABOVE LEAD</button>
                          <button className={`ch-btn ${bottomChannels.includes(ch) ? 'active-bottom' : ''}`}
                            onClick={() => handleChannelToggle(ch, 'bottom')}>BELOW LEAD</button>
                          <button className={`ch-btn ${!topChannels.includes(ch) && !bottomChannels.includes(ch) ? 'active-none' : ''}`}
                            onClick={() => {
                              const t = topChannels.filter(c => c !== ch)
                              const b = bottomChannels.filter(c => c !== ch)
                              setTopChannels(t); setBottomChannels(b)
                              if (bins) doRunAnalysis(bins, t, b)
                            }}>EXCLUDE</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {tResult && (
                  <section className="card ttest-card">
                    <div className="card-header">
                      <span className="card-title">STATISTICAL ANALYSIS</span>
                      <span className="card-sub mono">1-sample t-test · H0: mean diff = 0 · one-tailed · alpha = 0.05</span>
                    </div>
                    <div className="ttest-grid">
                      <StatBlock label="n (bins)" value={tResult.n} />
                      <StatBlock label="mean diff" value={tResult.mean} />
                      <StatBlock label="std error" value={tResult.se} />
                      <StatBlock label="t statistic" value={tResult.t} accent />
                      <StatBlock label="df" value={tResult.df} />
                      <StatBlock label="p-value (one-tailed)" value={tResult.pDisplay} accent />
                    </div>
                    <div className="console-wrap">
                      <div className="console-header mono">▶ SUMMARY STATISTICS OUTPUT</div>
                      <div className="console-body mono">
                        {'# ABOVE LEAD\n'}
                        {'n       = '}<span className="console-val">{tResult.n}</span>{'\n'}
                        {'mean    = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.mean}</span>{'\n'}
                        {'sd      = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.sd}</span>{'\n'}
                        {'min     = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.min}</span>{'\n'}
                        {'Q1      = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.q1}</span>{'\n'}
                        {'median  = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.median}</span>{'\n'}
                        {'Q3      = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.q3}</span>{'\n'}
                        {'max     = '}<span className="console-val">{tResult.statsTop && tResult.statsTop.max}</span>{'\n\n'}
                        {'# BELOW LEAD\n'}
                        {'n       = '}<span className="console-val">{tResult.n}</span>{'\n'}
                        {'mean    = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.mean}</span>{'\n'}
                        {'sd      = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.sd}</span>{'\n'}
                        {'min     = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.min}</span>{'\n'}
                        {'Q1      = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.q1}</span>{'\n'}
                        {'median  = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.median}</span>{'\n'}
                        {'Q3      = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.q3}</span>{'\n'}
                        {'max     = '}<span className="console-val">{tResult.statsBottom && tResult.statsBottom.max}</span>{'\n\n'}
                        {'# DIFFERENCE SCORES\n'}
                        {'n       = '}<span className="console-val">{tResult.n}</span>{'\n'}
                        {'mean    = '}<span className="console-val accent">{tResult.statsDiff && tResult.statsDiff.mean}</span>{'\n'}
                        {'sd      = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.sd}</span>{'\n'}
                        {'min     = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.min}</span>{'\n'}
                        {'Q1      = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.q1}</span>{'\n'}
                        {'median  = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.median}</span>{'\n'}
                        {'Q3      = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.q3}</span>{'\n'}
                        {'max     = '}<span className="console-val">{tResult.statsDiff && tResult.statsDiff.max}</span>{'\n\n'}
                        {'# 1-SAMPLE T-TEST\n'}
                        {'t_stat  = '}<span className="console-val accent">{tResult.t}</span>{'\n'}
                        {'df      = '}<span className="console-val">{tResult.df}</span>{'\n'}
                        {'p_value = '}<span className="console-val accent">{tResult.pDisplay}</span>{'\n\n'}
                        {'# 95% CI\n'}
                        {'ci_lower     = '}<span className="console-val">{tResult.ciLow}</span>{'\n'}
                        {'ci_upper     = '}<span className="console-val">{tResult.ciHigh}</span>{'\n'}
                        {'contains_zero = '}<span className={tResult.containsZero ? 'console-val warn' : 'console-val accent'}>{tResult.containsZero ? 'TRUE' : 'FALSE'}</span>
                      </div>
                    </div>
                    <div className="ci-section">
                      <div className="ci-header mono">95% CONFIDENCE INTERVAL — t* = {tResult.tStar}</div>
                      <div className="ci-row">
                        <div className="ci-bound">
                          <div className="stat-label mono">lower bound</div>
                          <div className="stat-value mono">{tResult.ciLow}</div>
                        </div>
                        <div className="ci-bar-wrap">
                          <div className="ci-bar">
                            <div className="ci-range" />
                            <div className={tResult.containsZero ? 'ci-zero zero-inside' : 'ci-zero zero-outside'}>0</div>
                          </div>
                          <div className="ci-label mono">
                            {tResult.containsZero ? 'zero is inside the interval' : 'zero is outside the interval'}
                          </div>
                        </div>
                        <div className="ci-bound">
                          <div className="stat-label mono">upper bound</div>
                          <div className="stat-value mono">{tResult.ciHigh}</div>
                        </div>
                      </div>
                    </div>
                    <div className={tResult.p < 0.05 ? 'verdict verdict-sig' : 'verdict verdict-ns'}>
                      {tResult.p < 0.05
                        ? 'STATISTICALLY SIGNIFICANT — p ' + tResult.pDisplay + ' < 0.05 — reject H0 — CI does not contain zero'
                        : 'NOT SIGNIFICANT — p ' + tResult.pDisplay + ' >= 0.05 — fail to reject H0'}
                    </div>
                  </section>
                )}

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
                          <Tooltip contentStyle={{ background: '#18181d', border: '1px solid #2a2a35', fontFamily: 'Share Tech Mono', fontSize: 12 }} />
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

                {analysis && (() => {
                  const diffs = analysis.map(r => r.difference)
                  const mn = Math.min(...diffs), mx = Math.max(...diffs)
                  const nb = 30, bw = (mx - mn) / nb
                  const counts = Array(nb).fill(0)
                  diffs.forEach(d => { const i = Math.min(Math.floor((d - mn) / bw), nb - 1); counts[i]++ })
                  const histData = counts.map((count, i) => ({ bin: (mn + i * bw).toFixed(0), count }))
                  return (
                    <section className="card">
                      <div className="card-header">
                        <span className="card-title">DISTRIBUTION OF DIFFERENCE SCORES</span>
                        <span className="card-sub mono">above minus below · per 5-min bin</span>
                      </div>
                      <div className="chart-wrap">
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={histData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                            <XAxis dataKey="bin" stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 10 }} interval={4} />
                            <YAxis stroke="#3a3a50" tick={{ fill: '#6b6b80', fontFamily: 'Share Tech Mono', fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: '#18181d', border: '1px solid #2a2a35', fontFamily: 'Share Tech Mono', fontSize: 12 }} />
                            <Bar dataKey="count" fill="#ff6b35" opacity={0.8} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )
                })()}

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
                            <th>TIMESTAMP</th><th>S0</th><th>S1</th><th>S2</th><th>S3</th>
                            <th>ABOVE</th><th>BELOW</th><th>DIFF</th>
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

              </div>
            )}

          </div>
        )}

      </main>

      <footer className="footer mono">
        EQUIP READER · QUARKNET COSMIC RAY MUON DETECTOR · MOUNDS VIEW HIGH SCHOOL
      </footer>
    </div>
  )
}
