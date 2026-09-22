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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 将 LaTeX 符号与数学标记转换为夏夏规范的手写 HTML
 * 保证所有字符使用父容器手写字体（LikeJianJianTi / 楷体栈），不用 TeX 印刷体
 */
export function renderXiaXiaHandwrittenHtml(text) {
  let raw = String(text ?? '').trim()
  if (!raw) return ''

  // 1. 剥离可能存在的外部 $...$ 或 $$...$$ 或 \(...\) 或 \[...\] 包装
  raw = raw
    .replace(/^\$\$(.+)\$\$$/s, '$1')
    .replace(/^\$(.+)\$$/s, '$1')
    .replace(/^\\\[(.+)\\\]$/s, '$1')
    .replace(/^\\\((.+)\\\)$/s, '$1')
    .trim()

  // 2. 基础 HTML 实体转义，保证字符转义不丢失、不产生 XSS
  let safe = escapeHtml(raw)

  // 3. 递归/循环处理 LaTeX 分数 \frac{分子}{分母} 与 \dfrac{分子}{分母}
  // 匹配 \frac{...}{...}
  const fracRegex = /\\(?:d)?frac\{([^{}]+)\}\{([^{}]+)\}/g
  while (fracRegex.test(safe)) {
    safe = safe.replace(fracRegex, (m, num, den) => {
      const cleanNum = convertXiaXiaSymbols(num)
      const cleanDen = convertXiaXiaSymbols(den)
      return `<span class="hand-fraction"><span class="hand-fraction-num">${cleanNum}</span><span class="hand-fraction-bar"></span><span class="hand-fraction-den">${cleanDen}</span></span>`
    })
  }

  // 4. 处理单层简单数字分数，如 3/4（前后非英文单词或路径时）
  safe = safe.replace(/(^|[^\w./])(\d+)\/(\d+)(?=$|[^\w./])/g, (m, prefix, num, den) => {
    return `${prefix}<span class="hand-fraction"><span class="hand-fraction-num">${num}</span><span class="hand-fraction-bar"></span><span class="hand-fraction-den">${den}</span></span>`
  })

  // 5. 符号转换（乘号、除号、平方/角标、加减号、常见几何符号）
  safe = convertXiaXiaSymbols(safe)

  // 6. 换行转换为 <br>
  safe = safe.replace(/\n/g, '<br>')

  return safe
}

/**
 * 转换各种数学符号为夏夏最简手写符号
 */
function convertXiaXiaSymbols(str) {
  let s = str

  // (1) 乘号：英文小写 x（夏夏专用规范：乘号不用 \times，直接用手写英文小写 x）
  s = s
    .replace(/\\times\b/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/\\cdot\b/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/×/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/✕/g, '<span class="hand-sym hand-times">x</span>')
    .replace(/✖/g, '<span class="hand-sym hand-times">x</span>')

  // (2) 除号：分数的写法，英文的 .-. 两个点在横线上（使用手写标准除号样式）
  s = s.replace(/\\div\b|÷/g, '<span class="hand-sym hand-div">÷</span>')

  // (3) 加减号：加号，下面加一个小减号
  s = s.replace(/\\pm\b|±/g, '<span class="hand-sym hand-pm"><span class="pm-plus">+</span><span class="pm-minus">-</span></span>')

  // (4) 平方与角标：在右上角本字体缩小写
  // 支持 ^{2}、^{...}、^2、^3、以及已经是字符的 ²、³
  s = s.replace(/\^\{([^}]+)\}/g, '<sup class="hand-sup">$1</sup>')
  s = s.replace(/\^([0-9a-zA-Z\u4e00-\u9fa5]+)/g, '<sup class="hand-sup">$1</sup>')
  s = s.replace(/²/g, '<sup class="hand-sup">2</sup>')
  s = s.replace(/³/g, '<sup class="hand-sup">3</sup>')

  // (5) 下角标：在右下角本字体缩小写
  s = s.replace(/_\{([^}]+)\}/g, '<sub class="hand-sub">$1</sub>')
  s = s.replace(/_([0-9a-zA-Z]+)/g, '<sub class="hand-sub">$1</sub>')

  // (6) 根号
  s = s.replace(/\\sqrt\{([^}]+)\}/g, '<span class="hand-sqrt"><span class="sqrt-rad">√</span><span class="sqrt-body">$1</span></span>')

  // (7) 常用几何与关系符号
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

  // (8) 清理剩余的 LaTeX 辅助文本命令与间距命令（转为纯净文本）
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
 * 统一走夏夏手写规范：能不用 tex 就不用，使用本字体最简符号渲染
 */
export function renderProblemHtml(text) {
  return renderXiaXiaHandwrittenHtml(text)
}

