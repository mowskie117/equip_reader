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
 * 2-sample t-test for difference in means between two independent groups
 * H0: mu1 - mu2 = 0
 * H1: mu1 - mu2 != 0 (two-tailed) or > 0 (one-tailed)
 */
export function twoSampleTTest(arr1, arr2, oneTailed = false) {
  const n1 = arr1.length, n2 = arr2.length
  if (n1 < 2 || n2 < 2) return null

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr => { const m = mean(arr); return arr.reduce((s, x) => s + (x-m)**2, 0) / (arr.length-1) }
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
    sd: Math.sqrt(variance(arr)).toFixed(2),
    n: arr.length,
  })

  const m1 = mean(arr1), m2 = mean(arr2)
  const v1 = variance(arr1), v2 = variance(arr2)
  const se = Math.sqrt(v1/n1 + v2/n2)
  // t = (period2 - period1) / se so positive t means period2 > period1 (lead removal increased counts)
  const t = (m2 - m1) / se

  // Welch-Satterthwaite df
  const df = Math.floor(
    Math.pow(v1/n1 + v2/n2, 2) /
    (Math.pow(v1/n1, 2)/(n1-1) + Math.pow(v2/n2, 2)/(n2-1))
  )

  const p = oneTailed ? oneTailedPValue(t, df) : twoTailedPValue(t, df)

  let pDisplay
  if (p < 0.0001) pDisplay = '< 0.0001'
  else if (p > 0.9999) pDisplay = '> 0.9999'
  else pDisplay = p.toFixed(4)

  const tStar = tCritical(0.025, df)
  const ciLow = (m1 - m2) - tStar * se
  const ciHigh = (m1 - m2) + tStar * se
  const containsZero = ciLow <= 0 && ciHigh >= 0

  return {
    n1, n2,
    meanDiff: (m2 - m1).toFixed(2),
    se: se.toFixed(2),
    t: t.toFixed(4),
    df,
    p,
    pDisplay,
    tStar: tStar.toFixed(3),
    ciLow: ((m2 - m1) - tStar * se).toFixed(2),
    ciHigh: ((m2 - m1) + tStar * se).toFixed(2),
    containsZero: ((m2 - m1) - tStar * se) <= 0 && ((m2 - m1) + tStar * se) >= 0,
    stats1: fiveNum(arr1),
    stats2: fiveNum(arr2),
  }
}

function twoTailedPValue(t, df) {
  const p = oneTailedPValue(Math.abs(t), df)
  return 2 * p
}

export function oneSampleTTest(differences) {
  const n = differences.length
  if (n < 2) return null

  const mean = differences.reduce((a, b) => a + b, 0) / n
  const variance = differences.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / (n - 1)
  const se = Math.sqrt(variance / n)
  const t = mean / se
  const df = n - 1

  // Approximate one-tailed p-value
  const p = oneTailedPValue(t, df)

  // 95% CI: mean ± t*(0.025, df) * se
  const tStar = tCritical(0.025, df)
  const ciLow = mean - tStar * se
  const ciHigh = mean + tStar * se
  const containsZero = ciLow <= 0 && ciHigh >= 0

  // Display p-value
  let pDisplay
  if (p < 0.0001) pDisplay = '< 0.0001'
  else if (p > 0.9999) pDisplay = '> 0.9999'
  else pDisplay = p.toFixed(4)

  return {
    n, 
    mean: mean.toFixed(2), 
    variance: variance.toFixed(2), 
    se: se.toFixed(2), 
    t: t.toFixed(4), 
    df, 
    p: p,
    pDisplay,
    tStar: tStar.toFixed(3),
    ciLow: ciLow.toFixed(2),
    ciHigh: ciHigh.toFixed(2),
    containsZero,
  }
}

// Approximate t critical value for two-tailed alpha using normal approximation
// Good enough for df > 30
function tCritical(alpha, df) {
  // For df > 30, t* is close to z*
  // Use iterative approximation
  if (df >= 30) {
    // Cornish-Fisher approximation
    const z = normalQuantile(alpha)
    const g1 = (z ** 3 + z) / (4 * df)
    const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    return Math.abs(z + g1 + g2)
  }
  // For small df use a lookup
  const table = {
    1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,
    6:2.447,7:2.365,8:2.306,9:2.262,10:2.228,
    15:2.131,20:2.086,25:2.060,29:2.045,30:2.042
  }
  return table[df] ?? 1.96
}

function normalQuantile(p) {
  // Rational approximation for inverse normal CDF
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00]
  const pLow = 0.02425, pHigh = 1 - pLow
  let q
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
      ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  } else if (p <= pHigh) {
    q = p - 0.5
    const r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
      (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
      ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  }
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
