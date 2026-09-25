<script setup>
/* @qh-core LANE=SHARED POINT=TRUE_PREVIEW 1726x980 capture source */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import BoardContentLayer from './BoardContentLayer.vue'
import {
  CANVAS_W as DESIGN_W,
  CANVAS_H as DESIGN_H,
} from '../utils/canvasCoords'
import { BOARD_FONT_SIZE, BOARD_FONT_SIZE_COMPACT } from '../services/stepHandoff.js'
import { createBoardToolRuntime } from '../board-tools/boardToolCatalog.js'
import { renderXiaXiaHandwrittenHtml } from '../utils/mathText.js'
import { calculateBoardWritingDuration } from '../agent-b-v2/timing.js'

const props = defineProps({
  canvasImageUrl: { type: String, default: '/canvas.png' },
  problemText: { type: String, default: '' },
  /** 完整规划：四标签+区+题目；没有则只显示题目标签/题文默认位 */
  boardPlan: { type: Object, default: null },
  /** 兼容只传 topicLayout */
  topicLayout: { type: Object, default: null },
  showGrid: { type: Boolean, default: false },
  showAllLabels: { type: Boolean, default: false },
  showZoneGuides: { type: Boolean, default: false },
  interactive: { type: Boolean, default: true },
  sourceImageUrl: { type: String, default: '' },
  keepOriginal: { type: Boolean, default: false },
  /** Agent B 输出的动作数组，自动在 L3 层播放 */
  actionSpec: { type: Array, default: () => [] },
  /** 当前交付物的五字段行，供 L3 板书文本和 exactText 锚点使用 */
  boardRows: { type: Array, default: () => [] },
  /** 是否自动播放 actionSpec，默认 true */
  autoPlay: { type: Boolean, default: true },
  /** 外部控制的当前激活步数（如从时间轴点击联动） */
  activeStepIndex: { type: Number, default: null },
  /** 是否直接显示最终定妆照（全部揭开），默认 false（分步揭开） */
  showFullBoard: { type: Boolean, default: false },
  /** 是否显示底部演播与遮罩控制 Dock */
  showPlaybackControls: { type: Boolean, default: true },
  /** CSS 遮罩模式：'mask-image' | 'clip-path' | 'both'，默认 'mask-image' */
  maskMode: { type: String, default: 'mask-image' },
  /** 遮罩羽化边缘宽度 (px)，模拟墨水/粉笔在黑白板上的自然吸附扩散，默认 26px */
  maskFeather: { type: Number, default: 26 },
  /** 手写倾角 (度数)，模拟右手书写自然运笔微倾角，默认 102deg */
  maskAngle: { type: Number, default: 102 },
  /** 遮罩风格：'natural'(自然倾角墨水羽化) | 'soft'(柔和横向渐隐) | 'sharp'(硬边缘) */
  maskStyle: { type: String, default: 'natural' },
  /** 外部直接控制遮罩揭开百分比 (0~1)，若传入则直接以此状态接管全局/当前行 */
  maskProgress: { type: Number, default: null },
  /** 是否启用一行一行的分步教学动画效果 */
  maskLineByLine: { type: Boolean, default: true },
  /** 手写排版与温度感档位：'a'(工整) | 'b'(自然微感，推荐) | 'c'(墨迹微扰) | 'd'(随性手稿) */
  handwriteMode: { type: String, default: 'b' },
  /** 确定性伪随机抖动种子，支持一键重置换一批抖动 */
  handwriteSeed: { type: Number, default: 7 },
  /** 是否开启 SVG ink-warp 墨迹渗透滤镜 */
  enableInkWarp: { type: Boolean, default: false },
})

const emit = defineEmits([
  'pick-coord',
  'topic-measured',
  'update:topic-layout',
  'layout-change',
  'update:problem-text',
  'step-change',
  'play-state-change',
  'mask-progress-change',
])

const hover = ref(null)
const boardRef = ref(null)
const roughSvgRef = ref(null)
let runtime = null

// 播放与分步骤遮罩揭开状态
const isPlaying = ref(false)
const isSettledView = ref(props.showFullBoard)
const currentStepIndex = ref(0)
const currentLineProgress = ref(props.showFullBoard ? 1 : 0)
const playbackSpeed = ref(1.0)
const isDockCollapsed = ref(false)
let playTimer = null
let animationFrameId = null

const totalSteps = computed(() => (props.boardRows || []).length)

const currentStepStageName = computed(() => {
  const row = props.boardRows?.[currentStepIndex.value]
  return row?.stage || '板书'
})

const currentStepStageKey = computed(() => {
  const stage = currentStepStageName.value
  if (stage.includes('读题')) return 'question'
  if (stage.includes('分析')) return 'analysis'
  if (stage.includes('解答')) return 'solution'
  if (stage.includes('总结')) return 'summary'
  return 'general'
})

function resolveCanvas() {
  return boardRef.value || roughSvgRef.value?.parentElement || document.querySelector('[data-board-canvas]') || roughSvgRef.value
}

function resolveRegion(region) {
  if (!boardRef.value) return null
  return boardRef.value.querySelector(`[data-board-region="${region}"]`)
}

function resolveRegionBounds(region) {
  const zone = props.boardPlan?.[region]
  if (!zone) return null
  return {
    x: (zone.x / 100) * DESIGN_W,
    y: (zone.y / 100) * DESIGN_H,
    width: (zone.w / 100) * DESIGN_W,
    height: (zone.h / 100) * DESIGN_H,
  }
}

function initRuntime() {
  if (runtime) return
  runtime = createBoardToolRuntime({
    resolveCanvas,
    resolveRegion,
    resolveRegionBounds,
    boardPlan: props.boardPlan,
  })
}

function normalizeActionSpecItem(item) {
  if (item?.capabilityGap) return null
  if (item?.action && typeof item.action === 'object') {
    return { ...item.action }
  }
  return item
}

function parseBoardContent(board) {
  if (board && typeof board === 'object') {
    return { content: String(board.content || '') }
  }
  if (typeof board !== 'string') return { content: '' }
  const legacy = board.match(/^\s*\[[^\]]+\]\s*([\s\S]*)$/)
  return { content: legacy ? legacy[1] || '' : board }
}

function resolveBoardRegion(row) {
  const stage = String(row?.stage || '')
  if (stage === '解答' || stage === '解答过程') return 'solution'
  if (stage === '总结' || stage === '总结提升') return 'summary'
  return 'analysis'
}

function isAnswerRow(item) {
  const c = item?.content || ''
  return c.includes('答：') || c.includes('答:') || c.includes('答案')
}

/**
 * 板书字号严格对齐题目的 1.2 ~ 1.5 倍：
 * - 题目：30px（印刷体）
 * - 分析区 / 重点 / 最终答案：45px (1.5倍)
 * - 解答区密集步骤（多列并排）：36px (1.2倍)
 * - 总结区：42px (1.4倍)
 */
function getRowFontSize(item) {
  if (item?.region === 'analysis') return BOARD_FONT_SIZE // 45px (1.5倍)
  if (item?.region === 'summary') return 42 // 1.4倍
  if (item?.region === 'solution') {
    if (isAnswerRow(item)) return BOARD_FONT_SIZE // 45px (1.5倍)
    return BOARD_FONT_SIZE_COMPACT // 36px (1.2倍)
  }
  return 42
}

const isSolutionMultiColumn = computed(() => {
  const solutionRows = (props.boardRows || []).filter(r => resolveBoardRegion(r) === 'solution')
  if (solutionRows.length < 3) return false
  const hasLongEquals = solutionRows.some(r => String(r.board || '').trim().startsWith('='))
  return !hasLongEquals
})

function regionStyle(region) {
  const zone = props.boardPlan?.[region]
  if (!zone) return {}
  return {
    left: `${zone.x}%`,
    top: `${zone.y}%`,
    width: `${zone.w}%`,
    minHeight: `${zone.h}%`,
  }
}

/**
 * 手写式自然倾角剪裁（备用/兼容方案）
 */
function createRevealClipPath(progress) {
  if (progress >= 1) return 'none'
  if (progress <= 0) return 'polygon(0 0, 0 0, 0 100%, 0 100%)'
  const pct = Math.min(100, Math.max(0, progress * 100))
  const topEdge = Math.min(100, pct + 2.5).toFixed(1)
  const bottomEdge = Math.max(0, pct - 1.5).toFixed(1)
  return `polygon(0 0, ${topEdge}% 0, ${bottomEdge}% 100%, 0 100%)`
}

/**
 * 学习 cs-board 的自然板书揭开遮罩（CSS mask-image）
 * 1. 采用 102deg - 105deg 自然书写微倾角（右倾右手笔触，避免死板直条）
 * 2. 边缘采用 24px - 32px 软羽化，模拟真人在白板/黑板上墨水与粉笔扩散吸附
 * 3. 支持通过 CSS 自定义属性 (--mask-progress, --mask-pct, --mask-feather) 动态驱动
 */
function getMaskStyle(progress) {
  const mode = props.maskMode || 'mask-image'
  let angle = props.maskAngle ?? 102
  let feather = props.maskFeather ?? 26

  if (props.maskStyle === 'soft') {
    angle = 90
    feather = 36
  } else if (props.maskStyle === 'sharp') {
    angle = 90
    feather = 4
  }

  if (progress >= 1) {
    return {
      '--mask-progress': 1,
      '--mask-pct': '100%',
      '--mask-angle': `${angle}deg`,
      '--mask-feather': `${feather}px`,
      WebkitMaskImage: 'none',
      maskImage: 'none',
      clipPath: mode === 'clip-path' || mode === 'both' ? 'none' : undefined,
      opacity: 1,
      visibility: 'visible',
    }
  }

  if (progress <= 0) {
    return {
      '--mask-progress': 0,
      '--mask-pct': '0%',
      '--mask-angle': `${angle}deg`,
      '--mask-feather': `${feather}px`,
      WebkitMaskImage: `linear-gradient(${angle}deg, #000 0%, transparent 0%)`,
      maskImage: `linear-gradient(${angle}deg, #000 0%, transparent 0%)`,
      clipPath: mode === 'clip-path' || mode === 'both' ? 'polygon(0 0, 0 0, 0 100%, 0 100%)' : undefined,
      opacity: 0,
      visibility: 'hidden',
    }
  }

  const pct = Math.min(100, Math.max(0, progress * 100)).toFixed(2)
  const grad = `linear-gradient(${angle}deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) ${pct}%, rgba(0,0,0,0) calc(${pct}% + ${feather}px), rgba(0,0,0,0) 100%)`

  const styleObj = {
    '--mask-progress': progress.toFixed(3),
    '--mask-pct': `${pct}%`,
    '--mask-angle': `${angle}deg`,
    '--mask-feather': `${feather}px`,
    opacity: 1,
    visibility: 'visible',
  }

  if (mode === 'mask-image' || mode === 'both') {
    styleObj.WebkitMaskImage = grad
    styleObj.maskImage = grad
    styleObj.WebkitMaskSize = '100% 100%'
    styleObj.maskSize = '100% 100%'
    styleObj.WebkitMaskRepeat = 'no-repeat'
    styleObj.maskRepeat = 'no-repeat'
  }

  if (mode === 'clip-path' || mode === 'both') {
    styleObj.clipPath = createRevealClipPath(progress)
  }

  return styleObj
}

function getNibLeftPercent(progress) {
  return Math.min(100, Math.max(0, progress * 100)).toFixed(1)
}

/**
 * 完整板书预排版数据：所有阶段文本始终在 DOM 中占据精确排版空间，
 * 每个板书块根据当前播放步骤计算 revealProgress，消除字体与换行抖动。
 */
const boardTextRows = computed(() => {
  const rows = props.boardRows || []
  return rows.map((row, index) => {
    const board = parseBoardContent(row?.board)
    if (!board.content.trim()) return null
    const region = resolveBoardRegion(row)

    let progress
    if (props.maskProgress !== null && props.maskProgress !== undefined) {
      // 外部显式指定遮罩进度
      progress = Math.min(1, Math.max(0, props.maskProgress))
    } else if (isSettledView.value || props.showFullBoard) {
      progress = 1
    } else if (props.activeStepIndex !== null && props.activeStepIndex !== undefined) {
      if (index < props.activeStepIndex) progress = 1
      else if (index === props.activeStepIndex) progress = currentLineProgress.value
      else progress = 0
    } else {
      if (index < currentStepIndex.value) progress = 1
      else if (index === currentStepIndex.value) progress = currentLineProgress.value
      else progress = 0
    }

    return {
      id: `${region}-${index}`,
      rowIndex: index,
      stage: row?.stage || '',
      region,
      content: board.content,
      revealProgress: progress,
    }
  }).filter(Boolean)
})

function stopPlayback() {
  isPlaying.value = false
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  emit('play-state-change', false)
}

async function playStep(stepIndex) {
  if (!isPlaying.value) return
  const total = totalSteps.value
  if (stepIndex >= total) {
    stopPlayback()
    currentStepIndex.value = total - 1
    currentLineProgress.value = 1
    return
  }

  currentStepIndex.value = stepIndex
  emit('step-change', stepIndex)
  const row = props.boardRows[stepIndex]
  const board = parseBoardContent(row?.board)
  const hasBoardContent = Boolean(board.content && board.content.trim())
  const rowActions = Array.isArray(row?.actionSpec)
    ? row.actionSpec.map(normalizeActionSpecItem).filter(Boolean)
    : []

  // 1. 如果该行有板书内容：进行手写式平滑揭开
  if (hasBoardContent) {
    currentLineProgress.value = 0
    const rawDur = calculateBoardWritingDuration(board.content)
    const writeDuration = Math.max(500, rawDur / playbackSpeed.value)
    const startTime = typeof window !== 'undefined' && window.performance ? window.performance.now() : Date.now()

    await new Promise((resolve) => {
      function animate(now) {
        if (!isPlaying.value) {
          resolve()
          return
        }
        const elapsed = now - startTime
        const p = Math.min(1, elapsed / writeDuration)
        currentLineProgress.value = p
        emit('mask-progress-change', { stepIndex, progress: p })
        if (p < 1) {
          animationFrameId = requestAnimationFrame(animate)
        } else {
          currentLineProgress.value = 1
          emit('mask-progress-change', { stepIndex, progress: 1 })
          resolve()
        }
      }
      animationFrameId = requestAnimationFrame(animate)
    })
  } else {
    currentLineProgress.value = 1
    emit('mask-progress-change', { stepIndex, progress: 1 })
  }

  if (!isPlaying.value) return

  // 2. 如果该行包含动作规范（圈画打勾、下划线、箭头等）：立即在锚点上执行
  if (rowActions.length > 0 && runtime) {
    try {
      const tasks = runtime.enqueueAll(rowActions)
      if (Array.isArray(tasks)) {
        tasks.forEach((t) => t?.catch?.(() => {}))
      }
    } catch (e) {
      console.warn('执行板书动作失败:', e)
    }
    // 留出动作书写视觉驻留时长
    await new Promise((resolve) => {
      playTimer = setTimeout(resolve, Math.max(500, 1200 / playbackSpeed.value))
    })
  } else {
    // 纯文字行写完后留出自然抬笔换行停顿
    await new Promise((resolve) => {
      playTimer = setTimeout(resolve, Math.max(250, 450 / playbackSpeed.value))
    })
  }

  if (!isPlaying.value) return

  // 3. 自动进入下一行
  if (stepIndex + 1 < total) {
    playStep(stepIndex + 1)
  } else {
    stopPlayback()
  }
}

function togglePlay() {
  if (isPlaying.value) {
    stopPlayback()
  } else {
    if (isSettledView.value) {
      isSettledView.value = false
      currentStepIndex.value = 0
      currentLineProgress.value = 0
      runtime?.clear()
    } else if (currentStepIndex.value >= totalSteps.value - 1 && currentLineProgress.value >= 1) {
      // 已播放到最后一步，从头重播
      currentStepIndex.value = 0
      currentLineProgress.value = 0
      runtime?.clear()
    }
    isPlaying.value = true
    emit('play-state-change', true)
    playStep(currentStepIndex.value)
  }
}

function triggerCurrentStepActions() {
  const row = props.boardRows?.[currentStepIndex.value]
  const rowActions = Array.isArray(row?.actionSpec)
    ? row.actionSpec.map(normalizeActionSpecItem).filter(Boolean)
    : []
  if (rowActions.length > 0 && runtime) {
    try {
      const tasks = runtime.enqueueAll(rowActions)
      if (Array.isArray(tasks)) {
        tasks.forEach((t) => t?.catch?.(() => {}))
      }
    } catch (e) {
      console.warn('执行当前步骤动作失败:', e)
    }
  }
}

function nextStep() {
  stopPlayback()
  isSettledView.value = false
  if (currentStepIndex.value < totalSteps.value - 1) {
    currentStepIndex.value += 1
    currentLineProgress.value = 1
    emit('step-change', currentStepIndex.value)
    triggerCurrentStepActions()
  }
}

function prevStep() {
  stopPlayback()
  isSettledView.value = false
  if (currentStepIndex.value > 0) {
    currentStepIndex.value -= 1
    currentLineProgress.value = 1
    emit('step-change', currentStepIndex.value)
    triggerCurrentStepActions()
  }
}

function replayAll() {
  stopPlayback()
  runtime?.clear()
  isSettledView.value = false
  currentStepIndex.value = 0
  currentLineProgress.value = 0
  emit('step-change', 0)
  isPlaying.value = true
  emit('play-state-change', true)
  playStep(0)
}

function toggleSettledView() {
  stopPlayback()
  isSettledView.value = !isSettledView.value
  if (isSettledView.value) {
    currentStepIndex.value = Math.max(0, totalSteps.value - 1)
    currentLineProgress.value = 1
    playActionSpec()
  } else {
    currentStepIndex.value = 0
    currentLineProgress.value = 0
    runtime?.clear()
  }
}

function cycleSpeed() {
  const speeds = [1.0, 1.5, 2.0]
  const nextIdx = (speeds.indexOf(playbackSpeed.value) + 1) % speeds.length
  playbackSpeed.value = speeds[nextIdx]
}

function playActionSpec() {
  if (!runtime) return
  runtime.clear()
  if (props.actionSpec?.length) {
    const normalized = props.actionSpec
      .map(normalizeActionSpecItem)
      .filter(Boolean)
    if (normalized.length) {
      try {
        const tasks = runtime.enqueueAll(normalized)
        if (Array.isArray(tasks)) {
          tasks.forEach((t) => t?.catch?.(() => {}))
        }
      } catch (e) {
        console.warn('执行动作规范失败:', e)
      }
    }
  }
}

watch(() => props.activeStepIndex, (val) => {
  if (typeof val === 'number' && val >= 0) {
    stopPlayback()
    isSettledView.value = false
    currentStepIndex.value = val
    currentLineProgress.value = 1
    triggerCurrentStepActions()
  }
})

watch(() => props.showFullBoard, (val) => {
  isSettledView.value = Boolean(val)
  if (val) {
    currentLineProgress.value = 1
  }
})

onMounted(() => nextTick(() => {
  initRuntime()
  if (props.showFullBoard) {
    isSettledView.value = true
    currentLineProgress.value = 1
    if (props.autoPlay) playActionSpec()
  } else if (props.autoPlay && props.boardRows?.length > 0) {
    // 自动播放手写分步演播
    togglePlay()
  }
}))

watch(() => props.actionSpec, () => {
  if (isSettledView.value) {
    nextTick(playActionSpec)
  }
}, { deep: true })

onBeforeUnmount(() => {
  stopPlayback()
  runtime?.clear()
  runtime = null
})

const localMaskStyle = ref(props.maskStyle || 'natural')
watch(() => props.maskStyle, (newVal) => {
  if (newVal) localMaskStyle.value = newVal
})

function cycleMaskStyle() {
  const styles = ['natural', 'soft', 'sharp']
  const next = styles[(styles.indexOf(localMaskStyle.value) + 1) % styles.length]
  localMaskStyle.value = next
}

const activeMaskStyleText = computed(() => {
  if (localMaskStyle.value === 'natural') return '🌿 自然墨水'
  if (localMaskStyle.value === 'soft') return '☁️ 柔和渐隐'
  return '📐 锐利边缘'
})

// 手写感与自然微抖动状态控制（4 档位与确定性随机种子）
const localHandwriteMode = ref(props.handwriteMode || 'b')
const localHandwriteSeed = ref(props.handwriteSeed || 7)
const localEnableInkWarp = ref(props.enableInkWarp || props.handwriteMode === 'c')

watch(() => props.handwriteMode, (val) => {
  if (val) localHandwriteMode.value = val
})
watch(() => props.handwriteSeed, (val) => {
  if (typeof val === 'number') localHandwriteSeed.value = val
})
watch(() => props.enableInkWarp, (val) => {
  localEnableInkWarp.value = Boolean(val)
})

function cycleHandwriteMode() {
  const modes = ['b', 'c', 'd', 'a']
  const next = modes[(modes.indexOf(localHandwriteMode.value) + 1) % modes.length]
  localHandwriteMode.value = next
}

function reshuffleJitter() {
  localHandwriteSeed.value = (localHandwriteSeed.value + 13) % 1000
}

const activeHandwriteModeText = computed(() => {
  if (localHandwriteMode.value === 'b') return '✍️ B·自然微感'
  if (localHandwriteMode.value === 'c') return '💧 C·墨迹微扰'
  if (localHandwriteMode.value === 'd') return '📜 D·随性手稿'
  return '📏 A·工整手写'
})

defineExpose({
  play: () => {
    if (!isPlaying.value) togglePlay()
  },
  pause: () => {
    if (isPlaying.value) stopPlayback()
  },
  togglePlay,
  nextStep,
  prevStep,
  replayAll,
  toggleSettledView,
  revealAll: () => {
    stopPlayback()
    isSettledView.value = true
    currentStepIndex.value = Math.max(0, totalSteps.value - 1)
    currentLineProgress.value = 1
  },
  hideAll: () => {
    stopPlayback()
    isSettledView.value = false
    currentStepIndex.value = 0
    currentLineProgress.value = 0
  },
  setStep: (step) => {
    stopPlayback()
    isSettledView.value = false
    currentStepIndex.value = Math.max(0, Math.min(totalSteps.value - 1, step))
    currentLineProgress.value = 1
  },
  setMaskProgress: (val) => {
    currentLineProgress.value = Math.min(1, Math.max(0, val))
  },
  setMaskStyle: (style) => {
    localMaskStyle.value = style
  },
  setHandwriteMode: (mode) => {
    localHandwriteMode.value = mode
  },
  setHandwriteSeed: (seed) => {
    localHandwriteSeed.value = seed
  },
  cycleHandwriteMode,
  reshuffleJitter,
  isPlaying,
  isSettledView,
  currentStepIndex,
  currentLineProgress,
  localMaskStyle,
  localHandwriteMode,
  localHandwriteSeed,
  totalSteps,
})

function onMove(e) {
  if (!props.interactive) return
  const rect = e.currentTarget.getBoundingClientRect()
  const xPct = ((e.clientX - rect.left) / rect.width) * 100
  const yPct = ((e.clientY - rect.top) / rect.height) * 100
  const px = Math.round((xPct / 100) * DESIGN_W)
  const py = Math.round((yPct / 100) * DESIGN_H)
  hover.value = {
    xPct: xPct.toFixed(1),
    yPct: yPct.toFixed(1),
    px,
    py,
  }
}
function onLeave() {
  hover.value = null
}
function onClick() {
  if (!props.interactive || !hover.value) return
  emit('pick-coord', { ...hover.value })
}
</script>

<template>
  <div class="real-board-wrap">
    <div
      ref="boardRef"
      class="board stage-preview"
      :class="[
        `stage-reveal-step-${currentStepIndex}`,
        `stage-mask-mode-${maskMode}`,
        `stage-mask-style-${localMaskStyle}`,
        `handwrite-mode-${localHandwriteMode}`,
        {
          interactive,
          'stage-reveal-all': isSettledView || showFullBoard,
          'stage-reveal-none': totalSteps > 0 && currentStepIndex === 0 && currentLineProgress <= 0 && !isSettledView && !showFullBoard,
          'stage-is-playing': isPlaying,
          'stage-is-settled': isSettledView,
          'stage-line-by-line-active': maskLineByLine && !isSettledView && !showFullBoard,
          'ink-warp-active': localEnableInkWarp || localHandwriteMode === 'c',
        }
      ]"
      data-board-canvas="true"
      data-component="StagePreview"
      :style="{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
    >
      <!-- SVG 墨迹微扰滤镜（feTurbulence + feDisplacementMap 笔画微渗透） -->
      <svg width="0" height="0" style="position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none;" aria-hidden="true">
        <defs>
          <filter id="ink-warp">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <div class="board-layer board-layer-l1" data-board-layer="L1">
        <img class="board-paper" :src="canvasImageUrl" alt="甲方画布" draggable="false" />
      </div>

      <BoardContentLayer
        :problem-text="problemText"
        :board-plan="boardPlan"
        :topic-layout="topicLayout"
        :show-grid="showGrid"
        :show-all-labels="showAllLabels"
        :show-zone-guides="showZoneGuides"
        :source-image-url="sourceImageUrl"
        :keep-original="keepOriginal"
        @topic-measured="emit('topic-measured', $event)"
        @update:topic-layout="emit('update:topic-layout', $event)"
        @layout-change="emit('layout-change', $event)"
        @update:problem-text="emit('update:problem-text', $event)"
      />

      <!-- L3 生成内容播放层：定妆照预排版 + 分步遮罩揭开 (CSS mask-image) -->
      <div class="board-layer board-layer-l3" data-board-layer="L3">
        <svg
          ref="roughSvgRef"
          class="rough-drawing-layer"
          data-board-overlay="rough-drawings"
          :viewBox="`0 0 ${DESIGN_W} ${DESIGN_H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        />

        <div
          v-for="region in ['analysis', 'solution', 'summary']"
          :key="region"
          class="board-region-layer"
          :class="[
            `board-region-layer-${region}`,
            { 'has-multicolumn': region === 'solution' && isSolutionMultiColumn }
          ]"
          :style="regionStyle(region)"
          :data-board-region="region"
        >
          <div
            v-for="item in boardTextRows.filter((entry) => entry.region === region)"
            :key="item.id"
            class="board-text-row-item"
            :class="[
              `row-stage-${item.region}`,
              `mask-style-${localMaskStyle}`,
              {
                'is-answer-row': isAnswerRow(item),
                'is-fully-revealed': item.revealProgress >= 1,
                'is-masked': item.revealProgress <= 0,
                'is-writing': item.revealProgress > 0 && item.revealProgress < 1,
                'mask-revealed': item.revealProgress >= 1,
                'mask-hidden': item.revealProgress <= 0,
                'mask-writing': item.revealProgress > 0 && item.revealProgress < 1,
                'mask-reveal-0': item.revealProgress <= 0,
                'mask-reveal-25': item.revealProgress >= 0.25 && item.revealProgress < 0.5,
                'mask-reveal-50': item.revealProgress >= 0.5 && item.revealProgress < 0.75,
                'mask-reveal-75': item.revealProgress >= 0.75 && item.revealProgress < 1,
                'mask-reveal-100': item.revealProgress >= 1,
              }
            ]"
            :data-board-row-index="item.rowIndex"
            :data-board-stage="item.stage"
            :style="{
              '--row-mask-progress': item.revealProgress,
            }"
          >
            <span
              class="board-text-anchor"
              :class="[
                `anchor-stage-${item.region}`,
                `mask-style-${localMaskStyle}`,
                {
                  'mask-active': maskMode !== 'clip-path',
                  'is-revealed': item.revealProgress >= 1,
                  'is-masked': item.revealProgress <= 0,
                  'is-animating': item.revealProgress > 0 && item.revealProgress < 1,
                }
              ]"
              :style="[
                { fontSize: `${getRowFontSize(item)}px` },
                getMaskStyle(item.revealProgress)
              ]"
              v-html="renderXiaXiaHandwrittenHtml(item.content, { mode: localHandwriteMode, seed: localHandwriteSeed + item.rowIndex * 37 })"
            ></span>

            <!-- 正在书写揭开时的真人运笔笔尖游标（紧随 mask-image 羽化前沿） -->
            <span
              v-if="item.revealProgress > 0 && item.revealProgress < 1"
              class="writing-nib-indicator"
              :class="`nib-stage-${item.region}`"
              :style="{ left: `calc(${getNibLeftPercent(item.revealProgress)}% + 2px)` }"
              aria-hidden="true"
            >
              <span class="nib-glow" />
            </span>
          </div>
        </div>

        <div
          class="annotation-layer"
          data-board-overlay="annotations"
          aria-hidden="true"
        />
        <slot name="playback" />
      </div>

      <!-- L4 用户画笔层 -->
      <div class="board-layer board-layer-l4" data-board-layer="L4" aria-hidden="true" />

      <!-- 演播与遮罩揭开控制浮条 (Dock) -->
      <div
        v-if="showPlaybackControls && totalSteps > 0"
        class="board-playback-dock"
        :class="{ 'is-collapsed': isDockCollapsed }"
        @click.stop
      >
        <button
          class="dock-toggle-btn"
          @click="isDockCollapsed = !isDockCollapsed"
          :title="isDockCollapsed ? '展开演播控制' : '收起'"
        >
          <span v-if="isDockCollapsed">✍️ 演播</span>
          <span v-else>▾</span>
        </button>

        <div v-show="!isDockCollapsed" class="dock-content">
          <!-- 播放 / 暂停 -->
          <button
            class="dock-btn dock-btn-play"
            :class="{ 'is-playing': isPlaying }"
            @click="togglePlay"
            :title="isPlaying ? '暂停演播' : '从当前步开始演播'"
          >
            <span v-if="isPlaying">⏸ 暂停</span>
            <span v-else>▶ 演播</span>
          </button>

          <!-- 上一步 -->
          <button
            class="dock-btn dock-btn-nav"
            :disabled="currentStepIndex <= 0"
            @click="prevStep"
            title="上一行"
          >
            ⏮
          </button>

          <!-- 步数胶囊 -->
          <div class="dock-step-pill" :title="`第 ${currentStepIndex + 1} 步: ${currentStepStageName}`">
            <span class="dock-stage-dot" :class="`stage-${currentStepStageKey}`"></span>
            <span class="dock-stage-name">{{ currentStepStageName }}</span>
            <span class="dock-step-count">{{ currentStepIndex + 1 }}/{{ totalSteps }}</span>
          </div>

          <!-- 下一步 -->
          <button
            class="dock-btn dock-btn-nav"
            :disabled="currentStepIndex >= totalSteps - 1"
            @click="nextStep"
            title="下一行"
          >
            ⏭
          </button>

          <span class="dock-sep"></span>

          <!-- 定妆照全景 vs 手写演播 快速切换 -->
          <button
            class="dock-btn dock-btn-mode"
            :class="{ 'is-active': isSettledView }"
            @click="toggleSettledView"
            :title="isSettledView ? '切换到手写分步演播' : '一键揭开所有遮罩，查看定妆照全景'"
          >
            {{ isSettledView ? '✍️ 手写演播' : '📸 定妆照' }}
          </button>

          <!-- 遮罩风格切换 -->
          <button
            class="dock-btn dock-btn-mask-style"
            @click="cycleMaskStyle"
            :title="`当前遮罩风格: ${activeMaskStyleText}，点击切换 (自然墨水 / 柔和渐隐 / 锐利边缘)`"
          >
            {{ activeMaskStyleText }}
          </button>

          <!-- 手写温度感与微抖动档位 (A工整 / B自然 / C墨迹微扰 / D随性手稿) -->
          <button
            class="dock-btn dock-btn-handwrite-mode"
            @click="cycleHandwriteMode"
            :title="`当前手写感: ${activeHandwriteModeText}，点击切换 (B自然微感 / C墨迹微扰 / D随性手稿 / A工整)`"
          >
            {{ activeHandwriteModeText }}
          </button>

          <!-- 换一批随机微抖动 -->
          <button
            class="dock-btn dock-btn-reshuffle"
            @click="reshuffleJitter"
            title="重新生成随机字距微位移与倾角（B/C/D 档微变）"
          >
            🎲 换微抖
          </button>

          <!-- 倍速 -->
          <button
            class="dock-btn dock-btn-speed"
            @click="cycleSpeed"
            title="点击切换播放速度"
          >
            {{ playbackSpeed }}x
          </button>

          <!-- 重放 -->
          <button
            class="dock-btn dock-btn-replay"
            @click="replayAll"
            title="从头重播整道题"
          >
            ↺
          </button>
        </div>
      </div>

      <div v-if="hover" class="hover-readout">
        画布: ({{ hover.px }}, {{ hover.py }})px · ({{ hover.xPct }}%, {{ hover.yPct }}%)
        <span class="hint">点击复制</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.real-board-wrap { width: 100%; }
.board {
  container-type: inline-size;
  position: relative;
  width: min(100%, var(--board-preview-max, 860px));
  aspect-ratio: 1726 / 980;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04);
  user-select: none;
}
.board.interactive { cursor: crosshair; }
.board-layer {
  position: absolute;
  inset: 0;
}
.board-layer-l1 { z-index: 0; background: #fff; pointer-events: none; }
.board-layer-l3 { z-index: 2; background: transparent; pointer-events: none; }
.board-layer-l4 { z-index: 3; background: transparent; pointer-events: none; }
.board-region-layer {
  position: absolute;
  pointer-events: none;
  overflow: visible;
  white-space: pre-wrap;
}
.board-region-layer-analysis { color: #b42318; }
.board-region-layer-solution,
.board-region-layer-summary { color: #17202a; }

/* 解答区多步骤自动双列网格，紧凑排版防大空洞 */
.board-region-layer-solution.has-multicolumn {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
}
.board-region-layer-solution.has-multicolumn .board-text-row-item.is-answer-row {
  grid-column: 1 / -1;
  margin-top: 6px;
}

/* 保持自然文本段落换行间距，拒绝大片空白空洞：
 * 1. 行高 1.45，紧凑自然、不松散
 * 2. 块段落间距 12px，如同作业纸自然分段
 * 3. 字体栈集成手写体、楷体与平滑 fallback
 */
.board-text-row-item {
  position: relative;
  display: block;
  max-width: 100%;
  margin: 0 0 12px;
  line-height: 1.45;
  letter-spacing: 0.025em;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  transition: opacity 0.15s ease;
}

.board-text-anchor {
  display: inline-block;
  max-width: 100%;
  font-family: "LikeJianJianTi", "Qinghuabu Qiaomu", "KaiTi", "STKaiti", cursive;
  font-weight: normal;
  letter-spacing: 0.02em;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  text-shadow: 0 0 0.5px currentColor;
  transform: translateZ(0);
  transition: opacity 0.12s ease-out;
}

/* 自然遮罩过渡状态 */
.board-text-row-item.is-masked .board-text-anchor,
.board-text-row-item.mask-hidden .board-text-anchor {
  opacity: 0 !important;
  pointer-events: none;
  visibility: hidden;
}

.board-text-row-item.is-writing .board-text-anchor,
.board-text-row-item.mask-writing .board-text-anchor {
  opacity: 1;
  visibility: visible;
}

.board-text-row-item.is-fully-revealed .board-text-anchor,
.board-text-row-item.mask-revealed .board-text-anchor {
  opacity: 1;
  visibility: visible;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  clip-path: none !important;
}

/* 用户通过纯 CSS 类名控制整板或分步遮罩进度 */
.stage-reveal-all [data-board-row-index] .board-text-anchor,
.stage-reveal-all .board-text-anchor {
  --mask-progress: 1 !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  clip-path: none !important;
  opacity: 1 !important;
  visibility: visible !important;
}

.stage-reveal-none [data-board-row-index] .board-text-anchor,
.stage-reveal-none .board-text-anchor {
  --mask-progress: 0 !important;
  opacity: 0 !important;
  visibility: hidden !important;
}

/* 阶梯步数纯 CSS 驱动规则：支持 stage-reveal-step-0 ~ stage-reveal-step-8 */
.stage-reveal-step-0 [data-board-row-index="0"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }
.stage-reveal-step-1 [data-board-row-index="0"] .board-text-anchor,
.stage-reveal-step-1 [data-board-row-index="1"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }
.stage-reveal-step-2 [data-board-row-index="0"] .board-text-anchor,
.stage-reveal-step-2 [data-board-row-index="1"] .board-text-anchor,
.stage-reveal-step-2 [data-board-row-index="2"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }
.stage-reveal-step-3 [data-board-row-index="0"] .board-text-anchor,
.stage-reveal-step-3 [data-board-row-index="1"] .board-text-anchor,
.stage-reveal-step-3 [data-board-row-index="2"] .board-text-anchor,
.stage-reveal-step-3 [data-board-row-index="3"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }
.stage-reveal-step-4 [data-board-row-index="0"] .board-text-anchor,
.stage-reveal-step-4 [data-board-row-index="1"] .board-text-anchor,
.stage-reveal-step-4 [data-board-row-index="2"] .board-text-anchor,
.stage-reveal-step-4 [data-board-row-index="3"] .board-text-anchor,
.stage-reveal-step-4 [data-board-row-index="4"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }
.stage-reveal-step-5 [data-board-row-index="0"] .board-text-anchor,
.stage-reveal-step-5 [data-board-row-index="1"] .board-text-anchor,
.stage-reveal-step-5 [data-board-row-index="2"] .board-text-anchor,
.stage-reveal-step-5 [data-board-row-index="3"] .board-text-anchor,
.stage-reveal-step-5 [data-board-row-index="4"] .board-text-anchor,
.stage-reveal-step-5 [data-board-row-index="5"] .board-text-anchor { --mask-progress: 1; opacity: 1; visibility: visible; }

/* 显式百分比 CSS 类名控制 */
.mask-reveal-100 .board-text-anchor { --mask-progress: 1; opacity: 1 !important; visibility: visible !important; -webkit-mask-image: none !important; mask-image: none !important; }
.mask-reveal-0 .board-text-anchor { --mask-progress: 0; opacity: 0 !important; visibility: hidden !important; }

/* 正在书写时的真人运笔笔尖游标点（贴近 mask-image 羽化前沿） */
.writing-nib-indicator {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 18px;
  background: currentColor;
  border-radius: 2px 2px 1px 1px;
  transform: translate(-50%, -50%) rotate(15deg);
  box-shadow: 0 0 10px currentColor, 0 1px 4px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  opacity: 0.95;
  animation: natural-nib-wobble 0.35s infinite alternate ease-in-out;
  z-index: 6;
}

.nib-glow {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}

@keyframes natural-nib-wobble {
  0% { transform: translate(-50%, -50%) rotate(10deg) scale(0.96); }
  50% { transform: translate(-50%, -46%) rotate(16deg) scale(1.04); }
  100% { transform: translate(-50%, -54%) rotate(13deg) scale(1); }
}

.board-paper {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none;
}
.rough-drawing-layer {
  position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
.annotation-layer {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
}

/* 演播与遮罩揭开底部浮条 (Dock) */
.board-playback-dock {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: auto;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(22, 59, 61, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #f1f5f9;
  padding: 6px 10px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.12);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.board-playback-dock.is-collapsed {
  padding: 4px;
  background: rgba(22, 59, 61, 0.75);
}

.dock-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dock-toggle-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 4px 6px;
  font-size: 12px;
  border-radius: 9999px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.dock-toggle-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

.dock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.dock-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-1px);
}
.dock-btn:active:not(:disabled) {
  transform: translateY(0);
}
.dock-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dock-btn-play {
  background: #10b981;
  border-color: #059669;
  color: #ffffff;
  padding: 0 12px;
  font-weight: 600;
}
.dock-btn-play:hover:not(:disabled) {
  background: #059669;
}
.dock-btn-play.is-playing {
  background: #f59e0b;
  border-color: #d97706;
}

.dock-btn-mode.is-active {
  background: #3b82f6;
  border-color: #2563eb;
  color: #ffffff;
}

.dock-btn-handwrite-mode {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(52, 211, 153, 0.4);
  color: #a7f3d0;
}
.dock-btn-handwrite-mode:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.3);
  border-color: #34d399;
  color: #ffffff;
}

.dock-btn-reshuffle {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(251, 191, 36, 0.4);
  color: #fde68a;
  padding: 0 8px;
}
.dock-btn-reshuffle:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.32);
  border-color: #fbbf24;
  color: #ffffff;
}

.dock-step-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 28px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 9999px;
  font-size: 11px;
  color: #e2e8f0;
}

.dock-stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}
.dock-stage-dot.stage-question { background: #38bdf8; }
.dock-stage-dot.stage-analysis { background: #f87171; }
.dock-stage-dot.stage-solution { background: #34d399; }
.dock-stage-dot.stage-summary { background: #a78bfa; }

.dock-stage-name {
  font-weight: 600;
  color: #ffffff;
}
.dock-step-count {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.dock-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.18);
  margin: 0 2px;
}

.hover-readout {
  position: absolute; z-index: 6; left: 8px; right: 8px; bottom: 8px;
  background: rgba(15,23,42,.88); color: #e2e8f0; font-size: 11px;
  padding: 6px 8px; border-radius: 8px; pointer-events: none;
}
.hover-readout .hint { float: right; color: #93c5fd; }
</style>
