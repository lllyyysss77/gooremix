/**
 * 夏夏教学板书与题目公式渲染（纯手写字体最简符号规范）
 * 核心原则：能不要用 TeX 就不用，全量采用手写字体与最简手写符号
 * - 乘号：英文小写 x
 * - 除号：手写横线上下两个点 (÷ / .-.)
 * - 分数：手写上下分数横线（分子在上位、中细横线、分母在下位，纯手写字体）
 * - 加减号：加号，下面加一个小减号 (± / hand-pm)
 * - 平方与指数：右上角本字体缩小写 (hand-sup)
 * - 字符转义安全保留，杜绝字符转义丢失
 */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 夏夏教学板书与题目公式渲染（纯手写字体最简符号规范与真人手写排版感）
 * 核心原则：
 * 1. 能不用 TeX 就不用，全量采用手写字体与最简手写符号（乘号用小写 x、除号用 ÷ 或分线、平方角标本字体缩小）
 * 2. 5.1 规则：分数/上下标只缩放字号，绝不单独切 font-family，完全继承手写体
 * 3. 人性化板书感（学习 lecture.html）：
 *    - 行与行之间保持自然文本段落换行间距（margin-bottom ±10% 微起伏）
 *    - 整行 ±1.3° 自然微倾斜（右手运笔微上扬，transform-origin: left center）
 *    - 逐字轻微位移 (±0.8px) 与轻微旋转 (±1.0°)，产生真实手写温度
 *    - 确定性伪随机哈希，保证重绘/演播时字迹如干透墨水般稳固、绝不无故乱跳
 *    - 支持 4 档手写感：A 工整手写 / B 自然微感 (默认推荐) / C 笔触墨迹微扰 / D 随性手稿
 */

export const HANDWRITE_MODES = [
  {
    id: 'a',
    name: 'A · 工整手写',
    desc: '纯手写体，不倾斜、不抖动。干净整齐，像老师认真书写的示范板书。'
  },
  {
    id: 'b',
    name: 'B · 自然真人（推荐）',
    desc: '整行 ±1.3° 轻微自然倾斜 + 行距 ±10% 自然呼吸感 + 逐字 ±0.8px 位移与 ±1° 旋转。温和生动。'
  },
  {
    id: 'c',
    name: 'C · 墨迹微扰',
    desc: '字形轻微浮动 + 配合 SVG ink-warp 位移滤镜让墨水笔触微渗透，如同黑白板笔墨自然吸附。'
  },
  {
    id: 'd',
    name: 'D · 随性手稿',
    desc: '倾斜 ±2.8° + 行距不均 ±22% + 逐字 ±1.8px 随性位移与旋转，手稿感极强。'
  }
]

/**
 * 确定性伪随机数生成器（LCG），相同 seed 产生稳定序列，消除 Vue 响应重绘抖动
 */
function createSeededRandom(seed) {
  let s = (Math.abs(seed) | 0) || 7
  return function () {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function hashString(str) {
  let h = 5381
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/**
 * 板书行分割：解析 \begin{aligned}, \\\\, 换行符与对齐符号
 */
export function boardLines(content) {
  let c = String(content || '').trim()
  if (!c) return []
  c = c.replace(/\\begin\{aligned\}/g, '').replace(/\\end\{aligned\}/g, '')
  c = c.replace(/\\\\/g, '\n')
  c = c.replace(/&/g, '')
  return c.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}

/**
 * 门卫转义层（5.2 / 5.3）：乘法 -> x；除号转换；斜杠分数 -> \frac
 */
export function sanitizeBoard(line) {
  let s = String(line || '')
  // 乘号：英文小写 x
  s = s.replace(/\\times\b/g, 'x')
  s = s.replace(/\\cdot\b/g, 'x')
  s = s.replace(/[×✕✖]/g, 'x')
  // 除法：除号或分数
  s = s.replace(/([^\s{}\\]+)\s*\\div\s*([^\s{}\\]+)/g, '\\frac{$1}{$2}')
  // 简单斜杠分数转换 3/4 -> \frac{3}{4}
  s = s.replace(/(^|[^\w./])(\d+)\s*\/\s*(\d+)(?=$|[^\w./])/g, '$1\\frac{$2}{$3}')
  return s
}

function readBrace(s, idx) {
  if (s[idx] !== '{') return { text: '', next: idx }
  let depth = 0
  let k = idx
  let out = ''
  for (; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}') {
      depth--
      if (depth === 0) {
        k++
        break
      }
    } else {
      out += s[k]
    }
  }
  return { text: out, next: k }
}

/**
 * 渲染单行文本为带自然轻微抖动和字距排版的手写 HTML
 */
function renderHumanHandwrittenLine(lineText, lineIndex = 0, modeId = 'b', baseSeed = 7) {
  const sanitized = sanitizeBoard(lineText)
  const lineSeed = (baseSeed * 997 + lineIndex * 131 + hashString(sanitized)) % 2147483647
  const rand = createSeededRandom(lineSeed)

  // 4 档振幅参数
  let tiltAmp = 0
  let gapAmp = 0
  let posAmp = 0
  let rotAmp = 0

  if (modeId === 'b') {
    tiltAmp = 1.3
    gapAmp = 0.10
    posAmp = 0.75
    rotAmp = 0.95
  } else if (modeId === 'c') {
    tiltAmp = 0.6
    gapAmp = 0.06
    posAmp = 0.35
    rotAmp = 0.5
  } else if (modeId === 'd') {
    tiltAmp = 2.8
    gapAmp = 0.22
    posAmp = 1.75
    rotAmp = 2.2
  } // modeId === 'a' 全部为 0

  // 整行微倾斜：人类右手运笔习惯略带向上或微倾角
  const lineTilt = tiltAmp > 0 ? ((rand() - 0.45) * 2 * tiltAmp).toFixed(2) : '0'
  // 行间距呼吸感：默认 0.38em 基底，随 gapAmp 产生 ±gapAmp 的轻微浮动
  const lineGap = gapAmp > 0 ? (0.38 * (1 + (rand() - 0.5) * 2 * gapAmp)).toFixed(3) : '0.380'

  const cmds = {
    '\\Rightarrow': '->',
    '\\to': '->',
    '\\impliedby': '<-',
    '\\pm': '±',
    '\\div': '÷',
    '\\approx': '≈',
    '\\neq': '≠',
    '\\leq': '≤',
    '\\le': '≤',
    '\\geq': '≥',
    '\\ge': '≥',
    '\\checkmark': '√',
    '\\pi': 'π',
    '\\circ': '°',
    '\\triangle': '△',
    '\\angle': '∠',
    '\\perp': '⊥',
    '\\parallel': '∥',
  }

  let html = ''
  let i = 0
  const n = sanitized.length
  let charIdx = 0

  function makeChar(charContent, isSpecial = false, extraClass = '') {
    charIdx++
    if (posAmp <= 0 && rotAmp <= 0) {
      return `<span class="char ${extraClass}">${charContent}</span>`
    }
    const dx = ((rand() - 0.5) * 2 * posAmp).toFixed(2)
    const dy = ((rand() - 0.5) * 2 * posAmp).toFixed(2)
    const rt = ((rand() - 0.5) * 2 * rotAmp).toFixed(2)
    const transformStyle = `transform: translate(${dx}px, ${dy}px) rotate(${rt}deg);`
    return `<span class="char ${extraClass}" style="${transformStyle}">${charContent}</span>`
  }

  while (i < n) {
    const c = sanitized[i]

    if (c === '\\') {
      // 1. 分数 \frac{num}{den} 或 \dfrac{num}{den}
      if (sanitized.startsWith('\\frac', i) || sanitized.startsWith('\\dfrac', i)) {
        const offset = sanitized.startsWith('\\dfrac', i) ? 6 : 5
        let j = i + offset
        const num = readBrace(sanitized, j)
        j = num.next
        const den = readBrace(sanitized, j)
        j = den.next

        // 递归渲染分子与分母中的子字符
        const numHtml = renderFractionPart(num.text, rand, posAmp, rotAmp)
        const denHtml = renderFractionPart(den.text, rand, posAmp, rotAmp)

        html += `<span class="char frac hand-fraction"><span class="num hand-fraction-num">${numHtml}</span><span class="den hand-fraction-den">${denHtml}</span></span>`
        i = j
        continue
      }

      // 2. 根号 \sqrt{body}
      if (sanitized.startsWith('\\sqrt', i)) {
        let j = i + 5
        const body = readBrace(sanitized, j)
        j = body.next
        const bodyHtml = renderFractionPart(body.text, rand, posAmp, rotAmp)
        html += makeChar(`√(${bodyHtml})`, true, 'hand-sqrt')
        i = j
        continue
      }

      // 3. LaTeX 命名指令
      const m = sanitized.slice(i).match(/^\\[a-zA-Z]+/)
      if (m) {
        const name = m[0]
        if (cmds[name]) {
          html += makeChar(cmds[name], true)
        } else if (name === '\\quad') {
          html += '<span class="char-space">&nbsp;&nbsp;</span>'
        } else if (name === '\\qquad') {
          html += '<span class="char-space">&nbsp;&nbsp;&nbsp;&nbsp;</span>'
        }
        i += name.length
        continue
      }

      i++
      continue
    }

    // 4. 上下标 ^ 与 _
    if (c === '^' || c === '_') {
      let j = i + 1
      let content
      if (sanitized[j] === '{') {
        const b = readBrace(sanitized, j)
        content = b.text
        j = b.next
      } else {
        content = sanitized[j] || ''
        j++
      }
      const isSup = c === '^'
      const cls = isSup ? 'sup hand-sup' : 'sub hand-sub'
      html += makeChar(escapeHtml(content), true, cls)
      i = j
      continue
    }

    // 5. 空格：保持字词呼吸感
    if (c === ' ') {
      html += '<span class="char-space">&nbsp;</span>'
      i++
      continue
    }

    // 6. 普通单个字符：包装为具有微位移与微倾角的手写字符
    html += makeChar(escapeHtml(c))
    i++
  }

  const lineStyle = `transform: rotate(${lineTilt}deg); margin-bottom: ${lineGap}em;`
  return `<div class="board-line" style="${lineStyle}">${html}</div>`
}

function renderFractionPart(partText, rand, posAmp, rotAmp) {
  let out = ''
  for (const ch of String(partText || '')) {
    if (ch === ' ') {
      out += '&nbsp;'
    } else {
      const dx = posAmp > 0 ? ((rand() - 0.5) * 1.5 * posAmp).toFixed(2) : '0'
      const dy = posAmp > 0 ? ((rand() - 0.5) * 1.5 * posAmp).toFixed(2) : '0'
      const style = posAmp > 0 ? `style="transform: translate(${dx}px, ${dy}px);"` : ''
      out += `<span class="char-frac-sub" ${style}>${escapeHtml(ch)}</span>`
    }
  }
  return out
}

/**
 * 将 LaTeX / 板书文本渲染为高品质手写 HTML
 *
 * @param {string} text 待渲染板书文本
 * @param {object} options 选项 { mode: 'a'|'b'|'c'|'d', seed: number, humanize: boolean }
 * @returns {string} 带自然段落换行与微抖动排版的手写 HTML
 */
export function renderXiaXiaHandwrittenHtml(text, options = {}) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''

  const mode = options.mode || 'b'
  const seed = options.seed !== undefined ? options.seed : 7
  const humanize = options.humanize !== false

  // 1. 剥离可能存在的外部 $...$ 或 $$...$$
  let cleaned = raw
    .replace(/^\$\$(.+)\$\$$/s, '$1')
    .replace(/^\$(.+)\$$/s, '$1')
    .replace(/^\\\[(.+)\\\]$/s, '$1')
    .replace(/^\\\((.+)\\\)$/s, '$1')
    .trim()

  // 如果显式关闭人性化，走极简兼容逻辑
  if (!humanize) {
    let safe = escapeHtml(cleaned)
    safe = convertXiaXiaSymbols(safe)
    return safe.replace(/\n/g, '<br>')
  }

  // 2. 将段落按行切割（处理 aligned, \\, \n）
  const lines = boardLines(cleaned)
  if (!lines.length) return ''

  // 3. 逐行生成自然手写段落
  return lines
    .map((line, idx) => renderHumanHandwrittenLine(line, idx, mode, seed))
    .join('')
}

/**
 * 转换各种数学符号为夏夏最简手写符号（基础兼容备用）
 */
function convertXiaXiaSymbols(str) {
  let s = str
  s = s
    .replace(/\\times\b/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/\\cdot\b/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/×/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/✕/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/✖/g, '<span class="hand-sym hand-times">x</span>')
  s = s.replace(/\\div\b|÷/g, '<span class="hand-sym hand-div">÷</span>')
  s = s.replace(/\\pm\b|±/g, '<span class="hand-sym hand-pm"><span class="pm-plus">+</span><span class="pm-minus">-</span></span>')
  s = s.replace(/\^\{([^}]+)\}/g, '<sup class="hand-sup">$1</sup>')
  s = s.replace(/\^([0-9a-zA-Z\u4e00-\u9fa5]+)/g, '<sup class="hand-sup">$1</sup>')
  s = s.replace(/²/g, '<sup class="hand-sup">2</sup>')
  s = s.replace(/³/g, '<sup class="hand-sup">3</sup>')
  s = s.replace(/_\{([^}]+)\}/g, '<sub class="hand-sub">$1</sub>')
  s = s.replace(/_([0-9a-zA-Z]+)/g, '<sub class="hand-sub">$1</sub>')
  s = s.replace(/\\sqrt\{([^}]+)\}/g, '<span class="hand-sqrt"><span class="sqrt-rad">√</span><span class="sqrt-body">$1</span></span>')
  s = s
    .replace(/\\approx\b/g, '≈')
    .replace(/\\le\b|\\leq\b/g, '≤')
    .replace(/\\ge\b|\\geq\b/g, '≥')
    .replace(/\\ne\b|\\neq\b/g, '≠')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\circ\b|\^\\circ/g, '°')
    .replace(/\\triangle\b/g, '△')
    .replace(/\\angle\b/g, '∠')
    .replace(/\\perp\b/g, '⊥')
    .replace(/\\parallel\b/g, '∥')
  s = s
    .replace(/\\(?:text|mathrm|mathbf|mathit)\{([^}]+)\}/g, '$1')
    .replace(/\\[,;!]/g, ' ')
    .replace(/\\quad\b/g, ' &nbsp; ')
    .replace(/\\qquad\b/g, ' &nbsp;&nbsp; ')
    .replace(/\\left\b|\\right\b/g, '')
  return s
}

/**
 * 纯文本导出与口播使用的最简手写符号纯文本转换
 */
export function convertXiaXiaPlainMath(text) {
  let s = String(text ?? '')
  s = s
    .replace(/\\times\b|×|✕|✖/g, 'x')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\^\{?2\}?|²/g, '²')
    .replace(/\^\{?3\}?|³/g, '³')
    .replace(/\^\{?([0-9a-zA-Z]+)\}?/g, '^$1')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\le\b|\\leq\b/g, '≤')
    .replace(/\\ge\b|\\geq\b/g, '≥')
    .replace(/\\ne\b|\\neq\b/g, '≠')
    .replace(/\\pi\b/g, 'π')
    .replace(/\\(?:text|mathrm)\{([^}]+)\}/g, '$1')
  return s
}

/**
 * 把题文或板书渲染成 HTML
 */
export function renderProblemHtml(text, options) {
  return renderXiaXiaHandwrittenHtml(text, options)
}


