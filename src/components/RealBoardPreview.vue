<script setup>
/* @qh-core LANE=SHARED POINT=TRUE_PREVIEW 1726x980 capture source */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import BoardContentLayer from './BoardContentLayer.vue'
import {
  CANVAS_W as DESIGN_W,
  CANVAS_H as DESIGN_H,
} from '../utils/canvasCoords'
import { BOARD_FONT_SIZE } from '../services/stepHandoff.js'
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
})

const emit = defineEmits([
  'pick-coord',
  'topic-measured',
  'update:topic-layout',
  'layout-change',
  'update:problem-text',
  'step-change',
  'play-state-change',
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
 * 手写式自然倾角剪裁（上边缘比下边缘略微超前 2.5%，模拟真人书写划过）
 */
function createRevealClipPath(progress) {
  if (progress >= 1) return 'none'
  if (progress <= 0) return 'polygon(0 0, 0 0, 0 100%, 0 100%)'
  const pct = Math.min(100, Math.max(0, progress * 100))
  const topEdge = Math.min(100, pct + 2.5).toFixed(1)
  const bottomEdge = Math.max(0, pct - 1.5).toFixed(1)
  return `polygon(0 0, ${topEdge}% 0, ${bottomEdge}% 100%, 0 100%)`
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
    if (isSettledView.value || props.showFullBoard) {
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
        if (p < 1) {
          animationFrameId = requestAnimationFrame(animate)
        } else {
          currentLineProgress.value = 1
          resolve()
        }
      }
      animationFrameId = requestAnimationFrame(animate)
    })
  } else {
    currentLineProgress.value = 1
  }

  if (!isPlaying.value) return

  // 2. 如果该行包含动作规范（圈画打勾、下划线、箭头等）：立即在锚点上执行
  if (rowActions.length > 0 && runtime) {
    runtime.enqueueAll(rowActions)
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
    runtime.enqueueAll(rowActions)
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
      runtime.enqueueAll(normalized)
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
      class="board"
      :class="{ interactive }"
      data-board-canvas="true"
      :style="{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
    >
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

      <!-- L3 生成内容播放层：定妆照预排版 + 分步遮罩揭开 -->
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
          :class="`board-region-layer-${region}`"
          :style="regionStyle(region)"
          :data-board-region="region"
        >
          <div
            v-for="item in boardTextRows.filter((entry) => entry.region === region)"
            :key="item.id"
            class="board-text-row-item"
            :class="{
              'is-fully-revealed': item.revealProgress >= 1,
              'is-masked': item.revealProgress <= 0,
              'is-writing': item.revealProgress > 0 && item.revealProgress < 1
            }"
            :data-board-row-index="item.rowIndex"
            :data-board-stage="item.stage"
          >
            <span
              class="board-text-anchor"
              :style="{
                fontSize: `${BOARD_FONT_SIZE}px`,
                clipPath: createRevealClipPath(item.revealProgress),
                opacity: item.revealProgress <= 0 ? 0 : 1
              }"
              v-html="renderXiaXiaHandwrittenHtml(item.content)"
            ></span>

            <!-- 正在书写揭开时的真人运笔笔尖游标 -->
            <span
              v-if="item.revealProgress > 0 && item.revealProgress < 1"
              class="writing-nib-indicator"
              :style="{ left: `${getNibLeftPercent(item.revealProgress)}%` }"
              aria-hidden="true"
            ></span>
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

/* 定妆照板书行项：预先占据精确高宽与边距，杜绝任何回流抖动 */
.board-text-row-item {
  position: relative;
  display: block;
  max-width: 100%;
  margin: 0 0 18px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.board-text-anchor {
  display: inline-block;
  max-width: 100%;
  font-family: "LikeJianJianTi", "KaiTi", "STKaiti", cursive;
  font-weight: normal;
  letter-spacing: 0;
  transform: translateZ(0);
  transition: clip-path 0.05s linear, opacity 0.15s ease-out;
}

.board-text-row-item.is-masked .board-text-anchor {
  opacity: 0 !important;
  pointer-events: none;
}

.board-text-row-item.is-writing .board-text-anchor {
  opacity: 1;
}

.board-text-row-item.is-fully-revealed .board-text-anchor {
  opacity: 1;
  clip-path: none !important;
}

/* 正在书写时的真人运笔笔尖游标点 */
.writing-nib-indicator {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 16px;
  background: currentColor;
  border-radius: 2px;
  transform: translate(-50%, -50%) rotate(15deg);
  box-shadow: 0 0 8px currentColor;
  pointer-events: none;
  opacity: 0.9;
  animation: nib-wobble 0.4s infinite alternate ease-in-out;
}

@keyframes nib-wobble {
  0% { transform: translate(-50%, -50%) rotate(12deg) scale(0.95); }
  100% { transform: translate(-50%, -50%) rotate(18deg) scale(1.1); }
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
