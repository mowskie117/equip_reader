/**
 * Parses an EQUIP .txt file and extracts ST/DS bin data.
 * Returns array of { timestamp, s0, s1, s2, s3, s4 } per 5-min bin.
 */
export function parseEquipFile(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const bins = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ST status line format:
    // ST 0913 +000 +058 3354 124529 030426 A 12 ...
    if (line.startsWith('ST ') && !line.startsWith('ST E') && !line.startsWith('ST 3') && !line.startsWith('ST 0') === false) {
      const parts = line.split(/\s+/)
      // Need at least 7 parts: ST mbar pps_err pps_off alt HHMMSS DDMMYY
      if (parts.length >= 7) {
        const timeStr = parts[5] // HHMMSS
        const dateStr = parts[6] // DDMMYY

        if (/^\d{6}$/.test(timeStr) && /^\d{6}$/.test(dateStr)) {
          const hh = timeStr.slice(0, 2)
          const mm = timeStr.slice(2, 4)
          const ss = timeStr.slice(4, 6)
          const dd = dateStr.slice(0, 2)
          const mo = dateStr.slice(2, 4)
          const yy = dateStr.slice(4, 6)
          const timestamp = `20${yy}-${mo}-${dd} ${hh}:${mm}:${ss}`

          // Look ahead for DS line
          let dsLine = null
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (lines[j].startsWith('DS ') && lines[j].split(/\s+/).length >= 5) {
              dsLine = lines[j]
              break
            }
          }

          if (dsLine) {
            const dsParts = dsLine.split(/\s+/)
            // DS values can be with or without S0= prefix
            const vals = dsParts.slice(1).map(v => {
              const clean = v.replace(/S\d=/, '')
              return parseInt(clean, 16)
            }).filter(v => !isNaN(v))

            if (vals.length >= 4) {
              bins.push({
                timestamp,
                s0: vals[0],
                s1: vals[1],
                s2: vals[2],
                s3: vals[3],
                s4: vals[4] ?? 0,
              })
            }
          }
        }
      }
    }
  }

  return bins
}

/**
 * Given bins and channel config, compute per-bin analysis.
 * topChannels and bottomChannels are arrays of 's0','s1','s2','s3'
 */
export function computeAnalysis(bins, topChannels, bottomChannels) {
  return bins.map(bin => {
    const topCount = topChannels.reduce((sum, ch) => sum + (bin[ch] ?? 0), 0)
    const bottomCount = bottomChannels.reduce((sum, ch) => sum + (bin[ch] ?? 0), 0)
    const difference = topCount - bottomCount
    return { ...bin, topCount, bottomCount, difference }
  })
}

/**
 * 1-sample t-test on differences against mu=0
 * H0: mean difference = 0
 * H1: mean difference > 0 (one-tailed)
 */
export function oneSampleTTest(differences) {
  const n = differences.length
  if (n < 2) return null

  const mean = differences.reduce((a, b) => a + b, 0) / n
  const variance = differences.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / (n - 1)
  const se = Math.sqrt(variance / n)
  const t = mean / se
  const df = n - 1

  // Approximate one-tailed p-value using t-distribution
  const p = oneTailedPValue(t, df)

  return { n, mean: mean.toFixed(2), variance: variance.toFixed(2), se: se.toFixed(2), t: t.toFixed(4), df, p: p.toFixed(4) }
}

// Approximation of one-tailed p-value from t and df
function oneTailedPValue(t, df) {
  // Use incomplete beta function approximation
  const x = df / (df + t * t)
  const p = 0.5 * incompleteBeta(x, df / 2, 0.5)
  return t > 0 ? p : 1 - p
}

function incompleteBeta(x, a, b) {
  // Continued fraction approximation (Lentz method)
  if (x < 0 || x > 1) return 0
  if (x === 0) return 0
  if (x === 1) return 1

  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a

  // Modified Lentz
  let f = 1, C = 1, D = 1 - (a + b) * x / (a + 1)
  if (Math.abs(D) < 1e-30) D = 1e-30
  D = 1 / D
  f = D

  for (let m = 1; m <= 200; m++) {
    // Even step
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
    D = 1 + numerator * D
    if (Math.abs(D) < 1e-30) D = 1e-30
    C = 1 + numerator / C
    if (Math.abs(C) < 1e-30) C = 1e-30
    D = 1 / D
    f *= C * D

    // Odd step
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
    D = 1 + numerator * D
    if (Math.abs(D) < 1e-30) D = 1e-30
    C = 1 + numerator / C
    if (Math.abs(C) < 1e-30) C = 1e-30
    D = 1 / D
    const delta = C * D
    f *= delta
    if (Math.abs(delta - 1) < 1e-10) break
  }

  return front * f
}

function lgamma(x) {
  // Stirling approximation
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x, tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += c[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
