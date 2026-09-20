/* @qh-core LANE=B-V2 POINT=CONTRACT_NORMALIZE model rows into board-readable fields */
import { validateBoardToolAction } from '../board-tools/boardToolCatalog.js'
// 画布参数唯一真源：src/services/stepHandoff.js
export const AGENT_B_V2_COLUMNS = Object.freeze([
  'stage',
  'speech',
  'board',
  'actionSpec',
])

export const AGENT_B_V2_STAGES = Object.freeze(['题目', '分析', '解答', '总结'])

// 环节别名容错表（温和吸附，防止大模型在长篇生成中因同义词导致整表抛弃）
const STAGE_SYNONYMS = Object.freeze({
  '思路': '分析',
  '讲解': '分析',
  '过程': '解答',
  '步骤': '解答',
  '计算': '解答',
  '答案': '解答',
  '题面': '题目',
  '题干': '题目',
  '小结': '总结',
  '回顾': '总结',
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStage(stage, index) {
  const clean = String(stage || '').trim()
  if (AGENT_B_V2_STAGES.includes(clean)) return clean
  if (STAGE_SYNONYMS[clean]) return STAGE_SYNONYMS[clean]

  const fallback = index === 0 ? '题目' : '分析'
  console.warn(`[AgentB contract] 非法 stage 值：${JSON.stringify(stage)}（第${index + 1}行），已温和校正为"${fallback}"。合法值仅限：题目/分析/解答/总结`)
  return fallback
}

// 统一板书读取口：遵循「boards 优先、board 兜底」原则。
// 既支持传入完整的 row 对象，也支持传入单独的 board / boards 原始值。
export function getBoardFromRow(rowOrBoard) {
  if (rowOrBoard == null) return { content: '', startDelay: 0 }

  // 如果传入的是 row 对象
  if (isRecord(rowOrBoard) && (rowOrBoard.boards !== undefined || rowOrBoard.board !== undefined || rowOrBoard.boardSlice !== undefined || rowOrBoard.stage !== undefined || rowOrBoard.speech !== undefined)) {
    // 严格遵循「boards 优先、board 兜底」
    const target = (rowOrBoard.boards !== undefined && rowOrBoard.boards !== null)
      ? rowOrBoard.boards
      : ((rowOrBoard.board !== undefined && rowOrBoard.board !== null)
        ? rowOrBoard.board
        : (rowOrBoard.boardSlice ?? rowOrBoard.boardText ?? null))
    return normalizeBoard(target, rowOrBoard)
  }

  // 如果传入的是单独的 board / boards 变量
  return normalizeBoard(rowOrBoard)
}

// 统一提取板书文本内容（纯字符串），空板书返回空字符串
export function getBoardContent(rowOrBoard) {
  return getBoardFromRow(rowOrBoard).content || ''
}

// 统一提取板书数组格式（新契约 boards 数组），供需要数组的下游消费
export function getBoardArray(rowOrBoard) {
  if (rowOrBoard == null) return []
  if (isRecord(rowOrBoard) && rowOrBoard.boards !== undefined) {
    if (Array.isArray(rowOrBoard.boards)) return rowOrBoard.boards
  }
  if (isRecord(rowOrBoard) && rowOrBoard.board !== undefined) {
    if (Array.isArray(rowOrBoard.board)) return rowOrBoard.board
    if (rowOrBoard.board) return [rowOrBoard.board]
  }
  if (Array.isArray(rowOrBoard)) return rowOrBoard
  const norm = getBoardFromRow(rowOrBoard)
  return norm.content ? [norm] : []
}

// board/boards 双兼容：全面支持单对象、数组（新契约 boards 数组）、字符串以及历史坐标剥离。
// startDelay 暂保留为兼容的时间字段；具体排版由渲染层负责。
export function normalizeBoard(board, row = null) {
  // 如果 board 为空，尝试从 row 对象的备选字段提取（如 boards, boardSlice, boardText）
  let target = board
  if (target == null && row && typeof row === 'object') {
    target = row.boards ?? row.boardSlice ?? row.board_slice ?? row.boardText ?? null
  }

  // 1. 如果是数组格式（新契约 boards 数组，或模型返回的 board 数组）
  if (Array.isArray(target)) {
    let startDelay = 0
    let hasDelay = false
    const contentParts = []

    for (const item of target) {
      if (item == null) continue
      if (typeof item === 'string') {
        const trimmed = item.trim()
        if (trimmed) contentParts.push(trimmed)
      } else if (typeof item === 'object') {
        const itemContent = typeof item.content === 'string'
          ? item.content
          : (typeof item.text === 'string'
            ? item.text
            : (typeof item.boardSlice === 'string'
              ? item.boardSlice
              : (typeof item.boardText === 'string' ? item.boardText : '')))
        if (itemContent && itemContent.trim()) {
          contentParts.push(itemContent.trim())
        }
        if (!hasDelay) {
          if (typeof item.startDelay === 'number' && Number.isFinite(item.startDelay) && item.startDelay >= 0) {
            startDelay = Number(item.startDelay.toFixed(2))
            hasDelay = true
          } else if (typeof item.startDelay === 'string') {
            const match = item.startDelay.match(/[\d.]+/)
            if (match) {
              const val = parseFloat(match[0])
              if (Number.isFinite(val) && val >= 0) {
                startDelay = Number(val.toFixed(2))
                hasDelay = true
              }
            }
          }
        }
      }
    }

    return {
      content: contentParts.join('\n'),
      startDelay,
    }
  }

  // 2. 如果是普通对象
  if (isRecord(target)) {
    let startDelay = 0
    if (typeof target.startDelay === 'number' && Number.isFinite(target.startDelay) && target.startDelay >= 0) {
      startDelay = Number(target.startDelay.toFixed(2))
    } else if (typeof target.startDelay === 'string') {
      const match = target.startDelay.match(/[\d.]+/)
      if (match) {
        const val = parseFloat(match[0])
        if (Number.isFinite(val) && val >= 0) startDelay = Number(val.toFixed(2))
      }
    }

    // 尝试提取各种可能的文本字段，防止 content/text 键名偏差
    const content = typeof target.content === 'string'
      ? target.content
      : (typeof target.text === 'string'
        ? target.text
        : (typeof target.boardSlice === 'string'
          ? target.boardSlice
          : (typeof target.boardText === 'string' ? target.boardText : '')))

    return {
      content: content || '',
      startDelay,
    }
  }

  // 3. 如果是字符串
  if (typeof target === 'string') {
    const trimmed = target.trim()
    const legacyPrefix = trimmed.match(/^\s*[([]\s*[\d.]+(?:%|px)?\s*,\s*[\d.]+(?:%|px)?\s*[)\]]\s*(.*)$/s)
    return { content: legacyPrefix ? legacyPrefix[1] || '' : target, startDelay: 0 }
  }

  return { content: '', startDelay: 0 }
}

function tryParseCandidate(str) {
  try {
    return JSON.parse(str)
  } catch {
    // 尝试修补常见的字符串内未转义换行与尾部残缺
    try {
      let patched = str.trim()
      if (patched.startsWith('{') && !patched.endsWith('}')) {
        if (patched.lastIndexOf(']') < patched.lastIndexOf('[')) {
          patched += ']}'
        } else {
          patched += '}'
        }
      }
      return JSON.parse(patched)
    } catch {
      return null
    }
  }
}

function parseJsonObject(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || source
  
  let res = tryParseCandidate(candidate)
  if (res && isRecord(res)) return res

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    res = tryParseCandidate(candidate.slice(start, end + 1))
    if (res && isRecord(res)) return res
  }

  // 尝试在最深层的 { "rows" 块处截取
  const rowsIdx = candidate.indexOf('"rows"')
  if (rowsIdx > 0) {
    const subStart = candidate.lastIndexOf('{', rowsIdx)
    if (subStart >= 0) {
      res = tryParseCandidate(candidate.slice(subStart))
      if (res && isRecord(res)) return res
    }
  }

  return null
}

export function normalizeAgentBV2ActionSpec(actionSpec) {
  return (Array.isArray(actionSpec) ? actionSpec : []).flatMap((entry) => {
    if (!isRecord(entry)) return []
    if (entry.capabilityGap) return [{ ...entry }]

    const action = validateBoardToolAction(entry.action)
    if (!action.ok) return []
    return [{ ...entry, action: action.value }]
  })
}

export function normalizeAgentBV2BoardCells(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    if (!isRecord(row)) return []
    const normalizedBoard = normalizeBoard(row.board, row)
    const rawBoards = Array.isArray(row.boards)
      ? row.boards
      : (Array.isArray(row.board) ? row.board : [normalizedBoard])
    return [{
      stage: normalizeStage(row.stage, index),
      speech: typeof row.speech === 'string' ? row.speech : '',
      board: normalizedBoard,
      boards: rawBoards,
      // 模型偶尔漏写 actionSpec 或动作不合规，保留该行而不是卡死整表。
      actionSpec: normalizeAgentBV2ActionSpec(row.actionSpec),
      // 音频地址与实测时长由程序在 TTS 合成后回填，模型不产出；此处仅在已有值时透传，
      // 避免 Check Agent 应用路径把下游已绑定的音频信息整段丢掉。
      ...(typeof row.audioUrl === 'string' && row.audioUrl ? { audioUrl: row.audioUrl } : {}),
      ...(Number.isFinite(Number(row.audioDurationMs)) && Number(row.audioDurationMs) > 0
        ? { audioDurationMs: Math.round(Number(row.audioDurationMs)) }
        : {}),
    }]
  })
}

// 板书只归一化内容和兼容时间字段；每行坐标由渲染层根据实际文本布局。
export function sanitizeRowLayout(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.map((row) => {
    if (!isRecord(row)) return row
    const normalizedBoard = normalizeBoard(row.board, row)
    const rawBoards = Array.isArray(row.boards)
      ? row.boards
      : (Array.isArray(row.board) ? row.board : [normalizedBoard])
    return { ...row, board: normalizedBoard, boards: rawBoards }
  })
}

export function validateAgentBV2Rows(rows, _options = {}) {
  let normalizedRows = normalizeAgentBV2BoardCells(rows)
  if (!normalizedRows.length) {
    return { ok: false, error: 'Agent B 必须返回至少一行五字段数据' }
  }
  normalizedRows = sanitizeRowLayout(normalizedRows, _options)
  return { ok: true, value: normalizedRows }
}

export function parseAgentBV2Response(text, _options = {}) {
  const parsed = parseJsonObject(text)
  if (!isRecord(parsed)) return { ok: false, error: 'Agent B 返回内容不是 JSON 对象' }
  if (!Array.isArray(parsed.rows)) return { ok: false, error: 'Agent B 返回内容没有可用的 rows 数组' }

  // 归一化前先检查原始 stage：先清除首尾空格；在兜底模式（allowSynonyms）下允许温和吸附
  const allowSynonyms = Boolean(_options?.allowSynonyms)
  const invalidStageRows = parsed.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const clean = String(row?.stage || '').trim()
      if (AGENT_B_V2_STAGES.includes(clean)) return false
      if (allowSynonyms && STAGE_SYNONYMS[clean]) return false
      return true
    })
  if (invalidStageRows.length > 0) {
    const details = invalidStageRows
      .map(({ row, index }) => `第${index + 1}行 stage=${JSON.stringify(row?.stage)}`)
      .join('；')
    return {
      ok: false,
      code: 'INVALID_STAGE',
      error: `非法 stage 值（${details}）。stage 仅限四种："题目""分析""解答""总结"。禁止使用"思路""讲解""过程""步骤""方法""计算""答案"等同义词，请重新输出完整五字段表。`,
    }
  }

  return validateAgentBV2Rows(parsed.rows, _options)
}
