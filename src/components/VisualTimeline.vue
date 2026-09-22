<template>
  <div class="visual-timeline-root">
    <!-- 顶部状态栏与操作栏 -->
    <div class="timeline-header">
      <div class="timeline-title-area">
        <span class="timeline-main-icon">🎬</span>
        <div>
          <div class="title-with-badge">
            <span class="timeline-title">时序全景时间轴与电视彩排台</span>
            <span class="canvas-spec-badge">1726×980 · 16:9</span>
          </div>
          <span class="timeline-subtitle">Row 组音频时长与板书落笔起手点映射 · 逐行彩排与定妆照联动</span>
        </div>
      </div>

      <div class="timeline-summary-stats">
        <span class="summary-pill">
          <span class="pill-dot total-dot"></span>
          共 <strong>{{ rows.length }}</strong> 组 Row
        </span>
        <span class="summary-pill">
          <span class="pill-dot audio-dot"></span>
          音频总长 <strong>{{ totalDurationSec }}s</strong>
        </span>
        <span class="summary-pill" v-if="boardRowCount > 0">
          <span class="pill-dot board-dot"></span>
          板书 <strong>{{ boardRowCount }}</strong> 处（平均起手 <strong>+{{ avgStartDelay }}s</strong>）
        </span>
        <!-- 音频缓存统计药丸：回填成功显示小勾勾 -->
        <span
          class="summary-pill audio-cache-pill"
          :class="{ 'has-cache': cachedAudioCount > 0, 'all-cached': cachedAudioCount === rows.length && rows.length > 0 }"
          title="已成功匹配并回填音频缓存的 Row 数量"
        >
          <span class="pill-dot cache-dot"></span>
          已回填音频 <strong>{{ cachedAudioCount }}/{{ rows.length }}</strong>
          <span v-if="cachedAudioCount > 0" class="header-check-badge">✓</span>
        </span>
      </div>

      <!-- 操作按钮与缩放控制 -->
      <div class="timeline-header-actions">
        <button
          type="button"
          class="header-act-btn backfill-btn"
          title="一键检索本地与已生成音频，自动回填实测时长与小勾勾"
          @click="emit('batch-backfill-cache')"
        >
          <span class="btn-icon">✓</span> 检索回填音频缓存
        </button>
        <button
          type="button"
          class="header-act-btn batch-btn"
          title="为未生成语音的行一键批量合成 TTS 并回填"
          @click="emit('batch-synthesize')"
        >
          <span class="btn-icon">⚡</span> 批量合成音频
        </button>
        <button
          type="button"
          class="header-act-btn monitor-toggle-btn"
          :class="{ active: showMonitor }"
          title="展开/收起左侧电视彩排微缩画布监视器"
          @click="showMonitor = !showMonitor"
        >
          <span class="btn-icon">📺</span> {{ showMonitor ? '收起微缩彩排' : '展开微缩彩排' }}
        </button>

        <!-- 时间轴缩放滑块与交互栏 -->
        <div class="timeline-zoom-bar">
          <span class="zoom-title">🔍 缩放:</span>
          <button class="zoom-btn" :disabled="zoom <= 1" @click="zoomOut" title="缩小">−</button>
          <input
            type="range"
            min="1"
            max="3.5"
            step="0.1"
            v-model.number="zoom"
            class="zoom-slider"
            title="时间轴缩放滑块"
          />
          <button class="zoom-btn" :disabled="zoom >= 3.5" @click="zoomIn" title="放大">+</button>
          <button class="zoom-reset-btn" :disabled="zoom === 1" @click="resetZoom">100%</button>
          <span class="zoom-tag">{{ Math.round(zoom * 100) }}%</span>
        </div>
      </div>
    </div>

    <!-- 核心电视彩排台（左侧微缩预览画布 + 右侧时间轴横向轨道） -->
    <div class="rehearsal-theater-layout" :class="{ 'no-monitor': !showMonitor }">
      <!-- 左侧：微缩彩排画布 (电视彩排监视器) -->
      <div v-if="showMonitor" class="rehearsal-monitor-panel">
        <div class="monitor-chrome-header">
          <div class="monitor-tag-group">
            <span class="broadcast-live-badge" :class="{ 'on-air': isPlayingThisAudio(activeRehearsalIndex) }">
              <span class="live-indicator-dot"></span>
              {{ isPlayingThisAudio(activeRehearsalIndex) ? 'ON AIR 正在彩排' : '彩排监视器' }}
            </span>
            <span class="monitor-ratio-label">16:9 标准画布</span>
          </div>

          <div class="monitor-mode-switch">
            <button
              type="button"
              class="mon-switch-btn"
              :class="{ active: isSettledView }"
              :title="isSettledView ? '切换为逐行动态彩排' : '查看完整定妆照'"
              @click="isSettledView = !isSettledView"
            >
              {{ isSettledView ? '📸 定妆照' : '✍️ 逐行' }}
            </button>
          </div>
        </div>

        <!-- 微缩视口：16:9 比例锁定，内嵌 RealBoardPreview 矢量缩放 -->
        <div class="rehearsal-screen-viewport" ref="miniViewportRef">
          <div
            class="rehearsal-canvas-scaler"
            :style="{
              width: '1726px',
              height: '980px',
              transform: `scale(${miniScale})`,
              transformOrigin: 'top left',
            }"
          >
            <RealBoardPreview
              :problem-text="problemText"
              :topic-layout="topicLayout"
              :board-plan="boardPlan"
              :source-image-url="sourceImageUrl"
              :keep-original="keepOriginal"
              :board-rows="rows"
              :action-spec="actionSpec"
              :active-step-index="isSettledView ? null : activeRehearsalIndex"
              :show-full-board="isSettledView"
              :interactive="false"
              :show-playback-controls="false"
            />
          </div>

          <!-- 彩排播放状态下的小角标 -->
          <div v-if="isPlayingThisAudio(activeRehearsalIndex)" class="rehearsal-air-watermark">
            <span class="air-pulse-ring"></span>
            <span>♫ 彩排声画同步中</span>
          </div>
        </div>

        <!-- 监视器下方彩排播放与快速步进控制条 -->
        <div class="rehearsal-dock-footer">
          <div class="rehearsal-step-meta">
            <span class="step-num-badge">Row {{ activeRehearsalIndex + 1 }}</span>
            <span class="step-stage-pill" :class="`stage-${currentRehearsalStageKey}`">
              {{ currentRehearsalStage }}
            </span>
            <!-- 缓存回填状态小勾勾 -->
            <span
              v-if="hasRowAudio(activeRehearsalIndex)"
              class="step-cached-check"
              title="该行音频缓存已成功回填！"
            >
              <span class="check-mark">✓</span> 实测音频
            </span>
            <span v-else class="step-est-label" title="暂无音频，为语速预估时长">
              ⏱ 预估时长
            </span>
          </div>

          <div class="rehearsal-action-group">
            <button
              type="button"
              class="rh-nav-btn"
              :disabled="activeRehearsalIndex <= 0"
              @click="goToStep(activeRehearsalIndex - 1)"
              title="上一个 Row"
            >
              ⏮
            </button>

            <button
              type="button"
              class="rh-play-btn"
              :class="{ 'is-playing': isPlayingThisAudio(activeRehearsalIndex) }"
              @click="togglePlayCurrentStep"
              :title="isPlayingThisAudio(activeRehearsalIndex) ? '暂停音频' : (hasRowAudio(activeRehearsalIndex) ? '播放真实音频并同步彩排板书' : '点击试听/合成')"
            >
              <span v-if="isPlayingThisAudio(activeRehearsalIndex)">⏸ 暂停</span>
              <span v-else-if="hasRowAudio(activeRehearsalIndex)">▶ 听音频彩排</span>
              <span v-else>▶ 彩排此步</span>
            </button>

            <button
              type="button"
              class="rh-nav-btn"
              :disabled="activeRehearsalIndex >= rows.length - 1"
              @click="goToStep(activeRehearsalIndex + 1)"
              title="下一个 Row"
            >
              ⏭
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧：横向滚动时间轴轨道 -->
      <div class="rehearsal-track-pane">
        <div class="timeline-track-container" ref="trackRef" @wheel="handleWheelZoom">
          <div class="timeline-track">
            <div
              v-for="(row, idx) in rows"
              :key="row._rowKey || idx"
              :class="[
                'timeline-row-block',
                `stage-theme-${row.stage || '分析'}`,
                {
                  'is-active': activeRehearsalIndex === idx,
                  'has-board': hasBoard(row),
                  'has-real-audio': hasRowAudio(idx),
                  'is-playing-audio': isPlayingThisAudio(idx)
                }
              ]"
              :style="{ flexBasis: getBlockWidth(row) }"
              @click="onBlockClick(idx)"
            >
              <!-- 块顶部：序号与环节 -->
              <div class="block-top-bar">
                <div class="index-left-group">
                  <span class="block-index-badge">Row {{ idx + 1 }}</span>
                  <!-- 小勾勾交互标识 -->
                  <span
                    v-if="hasRowAudio(idx)"
                    class="audio-success-check-badge"
                    title="音频缓存回填成功！已匹配真实 MP3"
                  >
                    ✓ 已缓存
                  </span>
                </div>
                <span :class="['block-stage-pill', `stage-${row.stage || '分析'}`]">
                  {{ row.stage || '分析' }}
                </span>
              </div>

              <!-- 核心指标1：MP3 音频时长（实测 vs 预估虚的，支持点击直接播放） -->
              <div
                :class="[
                  'block-metric-row',
                  'audio-row',
                  hasRowAudio(idx) ? 'is-real-audio-row' : 'is-estimated-audio-row',
                  { 'is-playing-now': isPlayingThisAudio(idx) }
                ]"
                :title="hasRowAudio(idx) ? '已回填真实音频缓存，点击直接播放试听！' : '暂无音频缓存（当前为虚的预估时长），点击可生成语音'"
                @click.stop="togglePlayAudio(row, idx)"
              >
                <div class="metric-label-group">
                  <span class="metric-icon">🎵</span>
                  <span class="metric-name">MP3时长</span>
                  <span v-if="hasRowAudio(idx)" class="metric-check-pill" title="音频缓存回填成功！">✓ 实测</span>
                  <span v-else class="metric-est-pill" title="根据中文字数与语速估算">预估</span>
                </div>

                <div class="metric-audio-ctrl">
                  <span class="metric-val audio-val" :class="{ 'val-real': hasRowAudio(idx) }">
                    {{ getDisplayDurationSec(row, idx) }}s
                  </span>
                  <!-- 播放触发小按钮 -->
                  <button
                    type="button"
                    class="row-audio-trigger-btn"
                    :class="{ 'btn-playing': isPlayingThisAudio(idx), 'btn-has-audio': hasRowAudio(idx) }"
                    :title="isPlayingThisAudio(idx) ? '暂停播放' : (hasRowAudio(idx) ? '直接播放此音频缓存' : '生成试听音频')"
                    @click.stop="togglePlayAudio(row, idx)"
                  >
                    <span v-if="isPlayingThisAudio(idx)">⏸</span>
                    <span v-else>▶</span>
                  </button>
                </div>
              </div>

              <!-- 正在播放当前音频时的微型音频波动动画 -->
              <div v-if="isPlayingThisAudio(idx)" class="audio-equalizer-bar" title="正在播放中...">
                <span class="eq-col eq1"></span>
                <span class="eq-col eq2"></span>
                <span class="eq-col eq3"></span>
                <span class="eq-col eq4"></span>
                <span class="eq-text">正在播放音频缓存</span>
              </div>

              <!-- 核心指标2：板书动画起手延时 -->
              <div
                :class="['block-metric-row', 'offset-row', { 'no-board-offset': !hasBoard(row) }]"
                :title="hasBoard(row) ? `口播进行到 +${getStartDelay(row).toFixed(1)}s 时，右手开始落笔书写` : '本 Row 仅朗读，无板书书写'"
              >
                <div class="metric-label-group">
                  <span class="metric-icon">✍️</span>
                  <span class="metric-name">板书起手</span>
                </div>
                <div class="offset-adjust-box">
                  <span v-if="!hasBoard(row)" class="metric-val zero-offset">0.0s (无板书)</span>
                  <span v-else class="metric-val highlight-offset">+{{ getStartDelay(row).toFixed(1) }}s</span>
                </div>
              </div>

              <!-- 块内部微观时序分段条：口播铺垫期 vs 落笔书写期 -->
              <div class="mini-timeline-track" :title="getMiniTimelineTitle(row)">
                <div
                  class="mini-bar-audio-prelude"
                  :style="{ width: getPreludePercent(row) + '%' }"
                >
                  <span v-if="getPreludePercent(row) > 20" class="mini-bar-label">纯口播</span>
                </div>
                <div
                  v-if="hasBoard(row)"
                  class="mini-board-start-pin"
                  :style="{ left: getPreludePercent(row) + '%' }"
                  title="板书开始落笔时间点"
                >
                  <span class="pin-marker">✍️</span>
                </div>
                <div
                  class="mini-bar-board-writing"
                  :style="{ width: (100 - getPreludePercent(row)) + '%' }"
                >
                  <span v-if="(100 - getPreludePercent(row)) > 25" class="mini-bar-label">
                    {{ hasBoard(row) ? '板书书写' : '朗读进行' }}
                  </span>
                </div>
              </div>

              <!-- 口播文案微缩预览 -->
              <div class="block-speech-preview" :title="row.speech">
                {{ row.speech || '（无口播）' }}
              </div>

              <!-- 块底部：起止时间戳 -->
              <div class="block-footer-time">
                <span>{{ (getEstimatedStart(idx) / 1000).toFixed(1) }}s</span>
                <span class="arrow-sep">➔</span>
                <span>{{ ((getEstimatedStart(idx) + getDuration(row) * 1000) / 1000).toFixed(1) }}s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const RealBoardPreview = defineAsyncComponent(() => import('./RealBoardPreview.vue'))

const props = defineProps({
  rows: {
    type: Array,
    default: () => [],
  },
  activeIndex: {
    type: Number,
    default: -1,
  },
  problemText: {
    type: String,
    default: '',
  },
  topicLayout: {
    type: Object,
    default: null,
  },
  boardPlan: {
    type: Object,
    default: null,
  },
  sourceImageUrl: {
    type: String,
    default: '',
  },
  keepOriginal: {
    type: Boolean,
    default: false,
  },
  actionSpec: {
    type: Array,
    default: () => [],
  },
  rowAudioCache: {
    type: Object,
    default: () => ({}),
  },
  playingAudioIndex: {
    type: Number,
    default: null,
  },
})

const emit = defineEmits([
  'select-row',
  'play-audio',
  'batch-backfill-cache',
  'batch-synthesize',
])

const trackRef = ref(null)
const miniViewportRef = ref(null)

// 监视器展开状态与定妆照视图
const showMonitor = ref(true)
const isSettledView = ref(false)
const activeRehearsalIndex = ref(0)
const miniScale = ref(0.22)
let resizeObserver = null

// 响应父组件 activeIndex 同步
watch(
  () => props.activeIndex,
  (newVal) => {
    if (typeof newVal === 'number' && newVal >= 0 && newVal < props.rows.length) {
      activeRehearsalIndex.value = newVal
    }
  },
  { immediate: true }
)

// 响应 rows 长度变化时边界守护
watch(
  () => props.rows.length,
  (len) => {
    if (len > 0 && activeRehearsalIndex.value >= len) {
      activeRehearsalIndex.value = len - 1
    }
  }
)

function updateMiniScale() {
  if (miniViewportRef.value) {
    const w = miniViewportRef.value.clientWidth
    if (w > 0) {
      // 1726 是 RealBoardPreview 内部标准坐标系基准宽
      miniScale.value = w / 1726
    }
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    if (window.ResizeObserver && miniViewportRef.value) {
      resizeObserver = new ResizeObserver(() => updateMiniScale())
      resizeObserver.observe(miniViewportRef.value)
    }
    window.addEventListener('resize', updateMiniScale)
  }
  updateMiniScale()
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateMiniScale)
  }
})

// 时间轴缩放状态（1.0x - 3.5x）
const zoom = ref(1)

function zoomIn() {
  zoom.value = Math.min(3.5, Number((zoom.value + 0.2).toFixed(2)))
}

function zoomOut() {
  zoom.value = Math.max(1, Number((zoom.value - 0.2).toFixed(2)))
}

function resetZoom() {
  zoom.value = 1
}

// 滚轮缩放：Ctrl / Cmd / Alt + 滚轮平滑缩放
function handleWheelZoom(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    zoom.value = Math.max(1, Math.min(3.5, Number((zoom.value + delta).toFixed(2))))
  }
}

// 判断某行是否有音频缓存
function hasRowAudio(index) {
  const row = props.rows[index]
  if (!row) return false
  if (row.audioUrl && typeof row.audioUrl === 'string' && row.audioUrl.trim()) return true
  if (props.rowAudioCache && props.rowAudioCache[index]) return true
  if (row.audioDurationMs && row.audioDurationMs > 0) return true
  return false
}

// 获取某行的音频 URL
function getRowAudioUrl(index) {
  const row = props.rows[index]
  if (!row) return ''
  if (row.audioUrl && typeof row.audioUrl === 'string' && row.audioUrl.trim()) return row.audioUrl
  if (props.rowAudioCache && props.rowAudioCache[index]) return props.rowAudioCache[index]
  return ''
}

// 格式化展示秒数（优先使用实测音频时长）
function getDisplayDurationSec(row, _index) {
  if (row.audioDurationMs && row.audioDurationMs > 0) {
    return (row.audioDurationMs / 1000).toFixed(1)
  }
  if (row.audioDuration && row.audioDuration > 0) {
    return Number(row.audioDuration).toFixed(1)
  }
  return getDuration(row).toFixed(1)
}

function isPlayingThisAudio(index) {
  return props.playingAudioIndex === index
}

// 提取 row 的基准时长（单位：秒）
function getDuration(row) {
  if (row.audioDurationMs && row.audioDurationMs > 0) return row.audioDurationMs / 1000
  if (row.audioDuration && row.audioDuration > 0) return row.audioDuration
  if (row.estimatedDurationMs && row.estimatedDurationMs > 0) return row.estimatedDurationMs / 1000
  if (row.rowTimeline?.rowTotalDurationMs && row.rowTimeline.rowTotalDurationMs > 0) {
    return row.rowTimeline.rowTotalDurationMs / 1000
  }
  const textLen = (row.speech || '').length
  return Math.max(2.5, Number((textLen / 2.8).toFixed(1)))
}

// 提取板书内容是否存在
function hasBoard(row) {
  const target = row.board ?? row.boards ?? row.boardSlice ?? null
  if (!target) return false
  if (typeof target === 'string') return Boolean(target.trim())
  if (Array.isArray(target)) {
    return target.some((item) => {
      if (!item) return false
      if (typeof item === 'string') return Boolean(item.trim())
      const c = item.content || item.text || item.boardSlice || item.boardText || ''
      return Boolean(c.trim())
    })
  }
  if (typeof target === 'object') {
    const content = target.content || target.text || target.boardSlice || target.boardText || ''
    return Boolean(content.trim())
  }
  return false
}

// 提取 board.startDelay（单位：秒）
function getStartDelay(row) {
  if (!hasBoard(row)) return 0
  const board = row.board ?? row.boards ?? row.boardSlice
  if (Array.isArray(board)) {
    for (const item of board) {
      if (item && typeof item === 'object') {
        if (typeof item.startDelay === 'number' && Number.isFinite(item.startDelay) && item.startDelay >= 0) {
          return Number(item.startDelay.toFixed(1))
        }
        if (typeof item.startDelay === 'string') {
          const m = item.startDelay.match(/[\d.]+/)
          if (m) {
            const val = parseFloat(m[0])
            if (Number.isFinite(val) && val >= 0) return Number(val.toFixed(1))
          }
        }
      }
    }
  } else if (board && typeof board === 'object') {
    if (typeof board.startDelay === 'number' && Number.isFinite(board.startDelay) && board.startDelay >= 0) {
      return Number(board.startDelay.toFixed(1))
    }
    if (typeof board.startDelay === 'string') {
      const m = board.startDelay.match(/[\d.]+/)
      if (m) {
        const val = parseFloat(m[0])
        if (Number.isFinite(val) && val >= 0) return Number(val.toFixed(1))
      }
    }
  }
  if (row.rowTimeline?.boardStartDelayMs != null) {
    return Number((row.rowTimeline.boardStartDelayMs / 1000).toFixed(1))
  }
  const dur = getDuration(row)
  return Number(Math.min(2.2, Math.max(1.0, dur * 0.2)).toFixed(1))
}

// 计算板书前纯口播铺垫百分比
function getPreludePercent(row) {
  const dur = getDuration(row)
  if (dur <= 0) return 0
  if (!hasBoard(row)) return 100
  const delay = getStartDelay(row)
  const pct = (delay / dur) * 100
  return Math.min(85, Math.max(5, Math.round(pct)))
}

// 估算累计起始时间点
function getEstimatedStart(targetIdx) {
  let accMs = 0
  for (let i = 0; i < targetIdx; i++) {
    const d = getDuration(props.rows[i]) * 1000
    accMs += d + 1500
  }
  return accMs
}

// 计算块宽度弹性基准
function getBlockWidth(row) {
  const dur = getDuration(row)
  const basePx = Math.max(160, Math.min(260, Math.round(dur * 24))) * zoom.value
  return `${Math.round(basePx)}px`
}

// 统计值
const totalDurationSec = computed(() => {
  if (!props.rows.length) return '0.0'
  const total = props.rows.reduce((sum, r) => sum + getDuration(r), 0)
  return total.toFixed(1)
})

const boardRowCount = computed(() => {
  return props.rows.filter(hasBoard).length
})

const avgStartDelay = computed(() => {
  const boardRows = props.rows.filter(hasBoard)
  if (!boardRows.length) return '0.0'
  const sum = boardRows.reduce((acc, r) => acc + getStartDelay(r), 0)
  return (sum / boardRows.length).toFixed(1)
})

const cachedAudioCount = computed(() => {
  return props.rows.filter((_, idx) => hasRowAudio(idx)).length
})

const currentRehearsalStage = computed(() => {
  const row = props.rows[activeRehearsalIndex.value]
  return row?.stage || '分析'
})

const currentRehearsalStageKey = computed(() => {
  const stage = currentRehearsalStage.value
  if (stage.includes('读题') || stage.includes('题目')) return 'question'
  if (stage.includes('分析')) return 'analysis'
  if (stage.includes('解答')) return 'solution'
  if (stage.includes('总结')) return 'summary'
  return 'analysis'
})

function getMiniTimelineTitle(row) {
  const dur = getDuration(row).toFixed(1)
  const delay = getStartDelay(row).toFixed(1)
  if (!hasBoard(row)) return `总音频时长 ${dur}s（本行无板书）`
  return `总音频时长 ${dur}s | 0s~+${delay}s 纯口播铺垫 | +${delay}s 开始落笔书写板书`
}

function scrollBlockIntoView(index) {
  if (!trackRef.value) return
  const blocks = trackRef.value.querySelectorAll('.timeline-row-block')
  if (blocks && blocks[index]) {
    blocks[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }
}

function goToStep(idx) {
  if (idx < 0 || idx >= props.rows.length) return
  activeRehearsalIndex.value = idx
  emit('select-row', idx)
  scrollBlockIntoView(idx)
}

function togglePlayCurrentStep() {
  const idx = activeRehearsalIndex.value
  const row = props.rows[idx]
  if (!row) return
  togglePlayAudio(row, idx)
}

function togglePlayAudio(row, idx) {
  activeRehearsalIndex.value = idx
  emit('select-row', idx)
  scrollBlockIntoView(idx)
  const url = getRowAudioUrl(idx)
  emit('play-audio', { row, index: idx, url })
}

function onBlockClick(index) {
  activeRehearsalIndex.value = index
  emit('select-row', index)
  const url = getRowAudioUrl(index)
  if (url) {
    emit('play-audio', { row: props.rows[index], index, url })
  }
}
</script>

<style scoped>
.visual-timeline-root {
  background: var(--surface, #fffdf7);
  border: 1px solid var(--line, #d7ded5);
  border-radius: var(--card-radius, 18px);
  padding: 14px 16px 14px;
  margin-bottom: 14px;
  box-shadow: var(--card-shadow, 0 4px 12px rgba(22, 59, 61, 0.05));
}

/* 顶部信息栏 */
.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line, #d7ded5);
}

.timeline-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
}
.timeline-main-icon {
  font-size: 20px;
}
.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}
.timeline-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--ink-deep, #163b3d);
  letter-spacing: 0.2px;
}
.canvas-spec-badge {
  font-size: 10.5px;
  font-family: monospace;
  font-weight: 700;
  color: var(--brand, #16856f);
  background: rgba(22, 133, 111, 0.09);
  border: 1px solid rgba(22, 133, 111, 0.2);
  padding: 1px 6px;
  border-radius: 4px;
}
.timeline-subtitle {
  font-size: 11.5px;
  color: var(--muted, #708786);
}

/* 统计药丸 */
.timeline-summary-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.summary-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--surface-soft, #edf7f0);
  border: 1px solid var(--line, #d7ded5);
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 11.5px;
  color: var(--ink, #31595a);
}
.summary-pill strong {
  color: var(--ink-deep, #163b3d);
  font-family: monospace;
}
.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.total-dot { background: var(--blue, #5c88b8); }
.audio-dot { background: var(--positive, #16856f); }
.board-dot { background: var(--warning, #9a6a18); }
.cache-dot { background: #10b981; }

.audio-cache-pill.has-cache {
  border-color: #10b981;
  background: #ecfdf5;
  color: #065f46;
}
.audio-cache-pill.all-cached {
  border-color: #059669;
  background: #d1fae5;
  color: #064e3b;
  font-weight: 600;
}
.header-check-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #10b981;
  color: #ffffff;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  margin-left: 2px;
}

/* 顶部操作与缩放 */
.timeline-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.header-act-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}
.backfill-btn {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #047857;
}
.backfill-btn:hover {
  background: #d1fae5;
  border-color: #10b981;
  transform: translateY(-1px);
}
.batch-btn {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.batch-btn:hover {
  background: #dbeafe;
  border-color: #3b82f6;
  transform: translateY(-1px);
}
.monitor-toggle-btn {
  background: #f3f4f6;
  border-color: #d1d5db;
  color: #374151;
}
.monitor-toggle-btn:hover,
.monitor-toggle-btn.active {
  background: #f0fdf4;
  border-color: #86efac;
  color: #15803d;
}

/* 缩放栏 */
.timeline-zoom-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-soft, #edf7f0);
  border: 1px solid var(--line, #d7ded5);
  padding: 3px 8px;
  border-radius: 9999px;
  font-size: 11.5px;
}
.zoom-title {
  font-weight: 600;
  color: var(--ink-deep, #163b3d);
}
.zoom-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-strong, #b9cdc5);
  background: #ffffff;
  color: var(--ink-deep, #163b3d);
  font-size: 13px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.zoom-btn:hover:not(:disabled) {
  border-color: var(--positive, #16856f);
  color: var(--positive, #16856f);
}
.zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.zoom-slider {
  width: 75px;
  height: 4px;
  accent-color: var(--positive, #16856f);
  cursor: pointer;
}
.zoom-reset-btn {
  background: transparent;
  border: 1px solid var(--line-strong, #b9cdc5);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10.5px;
  color: var(--ink, #31595a);
  cursor: pointer;
}
.zoom-reset-btn:hover:not(:disabled) {
  background: #ffffff;
  color: var(--positive, #16856f);
}
.zoom-reset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.zoom-tag {
  font-weight: 700;
  font-family: monospace;
  color: var(--positive, #16856f);
  min-width: 32px;
}

/* 核心电视彩排剧场布局：左侧微缩监视器 + 右侧时间轴 */
.rehearsal-theater-layout {
  display: flex;
  gap: 14px;
  align-items: stretch;
  margin-top: 12px;
}
.rehearsal-theater-layout.no-monitor {
  display: block;
}

/* 左侧微缩彩排监视器面板 */
.rehearsal-monitor-panel {
  flex: 0 0 380px;
  width: 380px;
  max-width: 380px;
  background: #ffffff;
  border: 1.5px solid var(--line-strong, #b9cdc5);
  border-radius: 14px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 14px rgba(22, 59, 61, 0.08);
  position: relative;
}

.monitor-chrome-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.monitor-tag-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.broadcast-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  color: #4b5563;
  padding: 2px 7px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 700;
  transition: all 0.2s ease;
}
.broadcast-live-badge.on-air {
  background: #fee2e2;
  border-color: #ef4444;
  color: #b91c1c;
}
.live-indicator-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
}
.broadcast-live-badge.on-air .live-indicator-dot {
  background: #ef4444;
  box-shadow: 0 0 6px #ef4444;
  animation: pulse-dot 1.2s infinite ease-in-out;
}
@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.6; }
}
.monitor-ratio-label {
  font-size: 10.5px;
  color: var(--muted, #708786);
}
.mon-switch-btn {
  background: var(--surface-soft, #edf7f0);
  border: 1px solid var(--line, #d7ded5);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink, #31595a);
  cursor: pointer;
}
.mon-switch-btn.active {
  background: #ecfdf5;
  border-color: #10b981;
  color: #047857;
}

/* 微缩视口：锁定 1726:980 比例，裁剪内部超大画布 */
.rehearsal-screen-viewport {
  width: 100%;
  aspect-ratio: 1726 / 980;
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
}
.rehearsal-canvas-scaler {
  pointer-events: none;
}
.rehearsal-air-watermark {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(220, 38, 38, 0.88);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(220, 38, 38, 0.35);
  backdrop-filter: blur(2px);
  z-index: 10;
}
.air-pulse-ring {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffffff;
  animation: pulse-dot 1s infinite ease-in-out;
}

/* 监视器底部状态与操作栏 */
.rehearsal-dock-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--line, #d7ded5);
}
.rehearsal-step-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.step-num-badge {
  font-weight: 800;
  color: var(--ink-deep, #163b3d);
}
.step-stage-pill {
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 10px;
}
.step-stage-pill.stage-question { background: rgba(92, 136, 184, 0.15); color: #2b5680; }
.step-stage-pill.stage-analysis { background: rgba(246, 201, 95, 0.25); color: #8a6200; }
.step-stage-pill.stage-solution { background: rgba(22, 133, 111, 0.15); color: #0d5f4f; }
.step-stage-pill.stage-summary { background: rgba(217, 95, 95, 0.15); color: #9c2727; }

.step-cached-check {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #059669;
  font-weight: 700;
  font-size: 10.5px;
}
.step-cached-check .check-mark {
  font-weight: 900;
}
.step-est-label {
  color: var(--muted, #708786);
  font-size: 10.5px;
}

.rehearsal-action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rh-nav-btn {
  width: 26px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--line-strong, #b9cdc5);
  background: #ffffff;
  color: var(--ink-deep, #163b3d);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.rh-nav-btn:hover:not(:disabled) {
  border-color: var(--brand, #16856f);
  color: var(--brand, #16856f);
  background: #f0fdf4;
}
.rh-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rh-play-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--brand, #16856f);
  background: var(--brand, #16856f);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.rh-play-btn:hover {
  background: #116b59;
  box-shadow: 0 2px 6px rgba(22, 133, 111, 0.3);
}
.rh-play-btn.is-playing {
  background: #dc2626;
  border-color: #dc2626;
}

/* 右侧时间轴横向轨道面板 */
.rehearsal-track-pane {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 核心横向时间轴轨道 */
.timeline-track-container {
  overflow-x: auto;
  padding-top: 2px;
  padding-bottom: 8px;
  scrollbar-width: thin;
}
.timeline-track-container::-webkit-scrollbar {
  height: 6px;
}
.timeline-track-container::-webkit-scrollbar-thumb {
  background: var(--line-strong, #b9cdc5);
  border-radius: 3px;
}

.timeline-track {
  display: flex;
  gap: 12px;
  align-items: stretch;
  min-width: 100%;
}

/* 单个 Row 组映射的独立区块 */
.timeline-row-block {
  flex: 1 0 auto;
  background: var(--surface, #fffdf7);
  border: 1.5px solid var(--line, #d7ded5);
  border-radius: var(--control-radius, 12px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;
  position: relative;
}

.timeline-row-block:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(22, 59, 61, 0.08);
  border-color: var(--brand, #16856f);
}

.timeline-row-block.is-active {
  border-color: var(--brand, #16856f) !important;
  box-shadow: 0 0 0 2px rgba(22, 133, 111, 0.2), 0 6px 18px rgba(22, 133, 111, 0.15);
  background: var(--surface-soft, #edf7f0);
}

.timeline-row-block.is-playing-audio {
  border-color: #10b981 !important;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3), 0 8px 20px rgba(16, 185, 129, 0.18);
}

/* 环节主题特色色彩边框 */
.stage-theme-题目 { border-top: 3.5px solid var(--blue, #5c88b8); }
.stage-theme-分析 { border-top: 3.5px solid var(--sun, #f6c95f); }
.stage-theme-解答 { border-top: 3.5px solid var(--positive, #16856f); }
.stage-theme-总结 { border-top: 3.5px solid var(--danger, #d95f5f); }

/* 块顶部条 */
.block-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.index-left-group {
  display: flex;
  align-items: center;
  gap: 5px;
}
.block-index-badge {
  font-size: 12px;
  font-weight: 800;
  color: var(--ink-deep, #163b3d);
}
.audio-success-check-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #10b981;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 9999px;
  line-height: 1.4;
}
.block-stage-pill {
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 9999px;
}
.stage-题目 { background: rgba(92, 136, 184, 0.15); color: #2b5680; }
.stage-分析 { background: rgba(246, 201, 95, 0.25); color: #8a6200; }
.stage-解答 { background: rgba(22, 133, 111, 0.15); color: #0d5f4f; }
.stage-总结 { background: rgba(217, 95, 95, 0.15); color: #9c2727; }

/* 核心指标行 */
.block-metric-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border: 1px solid var(--line, #d7ded5);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  transition: all 0.15s ease;
}
.metric-label-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.metric-icon {
  font-size: 12px;
}
.metric-name {
  font-weight: 600;
  color: var(--ink, #31595a);
}

/* 核心指标1：音频时长样式（实测 vs 预估） */
.audio-row {
  background: #ffffff;
}
.audio-row.is-real-audio-row {
  border-color: #a7f3d0;
  background: #f0fdf4;
}
.audio-row.is-real-audio-row:hover {
  border-color: #10b981;
  background: #ecfdf5;
}
.audio-row.is-estimated-audio-row {
  border-style: dashed;
  border-color: #d1d5db;
  background: #f9fafb;
}
.audio-row.is-playing-now {
  border-color: #10b981;
  background: #d1fae5;
}

.metric-check-pill {
  background: #10b981;
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 800;
  padding: 0 4px;
  border-radius: 4px;
  line-height: 1.4;
}
.metric-est-pill {
  background: #e5e7eb;
  color: #6b7280;
  font-size: 9.5px;
  padding: 0 4px;
  border-radius: 4px;
  line-height: 1.4;
}

.metric-audio-ctrl {
  display: flex;
  align-items: center;
  gap: 5px;
}
.metric-val {
  font-family: monospace;
  font-weight: 700;
  font-size: 11.5px;
}
.metric-val.audio-val {
  color: var(--ink, #31595a);
}
.metric-val.audio-val.val-real {
  color: #047857;
  font-weight: 800;
}

.row-audio-trigger-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--line-strong, #b9cdc5);
  background: #ffffff;
  color: var(--ink-deep, #163b3d);
  font-size: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.row-audio-trigger-btn:hover {
  border-color: var(--brand, #16856f);
  color: var(--brand, #16856f);
  background: #f0fdf4;
}
.row-audio-trigger-btn.btn-has-audio {
  border-color: #10b981;
  color: #047857;
  background: #ecfdf5;
}
.row-audio-trigger-btn.btn-playing {
  background: #10b981;
  border-color: #10b981;
  color: #ffffff;
}

/* 音频波动指示条 */
.audio-equalizer-bar {
  display: flex;
  align-items: center;
  gap: 3px;
  background: #d1fae5;
  border: 1px solid #a7f3d0;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
  color: #065f46;
}
.eq-col {
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: #10b981;
  animation: eq-anim 0.8s infinite ease-in-out alternate;
}
.eq1 { animation-delay: 0.1s; height: 6px; }
.eq2 { animation-delay: 0.3s; height: 11px; }
.eq3 { animation-delay: 0.2s; height: 8px; }
.eq4 { animation-delay: 0.4s; height: 10px; }
@keyframes eq-anim {
  0% { transform: scaleY(0.3); }
  100% { transform: scaleY(1); }
}
.eq-text {
  font-size: 9.5px;
  font-weight: 600;
  margin-left: 3px;
}

/* 核心指标2：板书起手 */
.offset-row {
  background: #ffffff;
}
.no-board-offset {
  opacity: 0.6;
}
.offset-adjust-box {
  display: flex;
  align-items: center;
}
.zero-offset {
  color: var(--muted, #708786);
  font-size: 10.5px;
}
.highlight-offset {
  color: var(--warning, #9a6a18);
  font-weight: 800;
}

/* 块内部微观时序分段条 */
.mini-timeline-track {
  height: 18px;
  background: var(--surface-soft, #edf7f0);
  border: 1px solid var(--line, #d7ded5);
  border-radius: 4px;
  display: flex;
  position: relative;
  overflow: hidden;
}
.mini-bar-audio-prelude {
  background: rgba(92, 136, 184, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px dashed var(--line, #d7ded5);
  transition: width 0.2s ease;
}
.mini-board-start-pin {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--warning, #9a6a18);
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pin-marker {
  font-size: 9px;
  position: absolute;
  top: -2px;
}
.mini-bar-board-writing {
  background: rgba(22, 133, 111, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.2s ease;
}
.mini-bar-label {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--ink-deep, #163b3d);
  white-space: nowrap;
}

/* 口播文案微缩预览 */
.block-speech-preview {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ink, #31595a);
  background: rgba(255, 255, 255, 0.7);
  border-radius: 4px;
  padding: 4px 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: 34px;
}

/* 块底部起止时间戳 */
.block-footer-time {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-family: monospace;
  color: var(--muted, #708786);
  padding-top: 2px;
  border-top: 1px dashed var(--line, #d7ded5);
}
.arrow-sep {
  opacity: 0.6;
}

/* 响应式断点适配 */
@media (max-width: 992px) {
  .rehearsal-theater-layout {
    flex-direction: column;
  }
  .rehearsal-monitor-panel {
    width: 100%;
    max-width: 100%;
    flex: none;
  }
}
</style>
