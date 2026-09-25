<script setup>
/**
 * StagePreview - 遵循教学演播规范与 cs-board 自然排版哲学的板书预演舞台组件
 *
 * 核心能力：
 * 1. 板书层原生 CSS 遮罩（mask-image / -webkit-mask-image）：
 *    - 采用 102deg 自然书写微倾角（右倾右手笔触）
 *    - 26px 软墨水边缘羽化，模拟白板/黑板上墨水与粉笔扩散吸附
 * 2. 多维度进度控制：
 *    - 状态控制：通过 activeStepIndex, maskProgress, showFullBoard 等 props 或 v-model 控制
 *    - 纯 CSS 类名控制：支持在外部容器添加 .stage-reveal-step-N, .stage-reveal-all, .stage-reveal-none 等类名
 * 3. 教学动画：
 *    - 支持一行一行揭开板书（maskLineByLine），真人运笔笔尖（writing-nib-indicator）随遮罩前沿同步滑动
 * 4. cs-board 自然排版感：
 *    - 楷体/手写体字族排版、1.68 自然行高、呼吸感段落间距与审题/演算/总结三区视觉韵律
 */
import { ref } from 'vue'
import RealBoardPreview from './RealBoardPreview.vue'

const props = defineProps({
  problemText: { type: String, default: '' },
  boardPlan: { type: Object, default: null },
  topicLayout: { type: Object, default: null },
  showGrid: { type: Boolean, default: false },
  showAllLabels: { type: Boolean, default: false },
  showZoneGuides: { type: Boolean, default: false },
  interactive: { type: Boolean, default: true },
  sourceImageUrl: { type: String, default: '' },
  keepOriginal: { type: Boolean, default: false },
  actionSpec: { type: Array, default: () => [] },
  boardRows: { type: Array, default: () => [] },
  autoPlay: { type: Boolean, default: true },
  activeStepIndex: { type: Number, default: null },
  showFullBoard: { type: Boolean, default: false },
  showPlaybackControls: { type: Boolean, default: true },
  /** CSS 遮罩模式：'mask-image' | 'clip-path' | 'both'，默认 'mask-image' */
  maskMode: { type: String, default: 'mask-image' },
  /** 遮罩边缘羽化宽度 (px)，默认 26px */
  maskFeather: { type: Number, default: 26 },
  /** 自然书写微倾角 (度)，默认 102deg */
  maskAngle: { type: Number, default: 102 },
  /** 遮罩风格：'natural' | 'soft' | 'sharp'，默认 'natural' */
  maskStyle: { type: String, default: 'natural' },
  /** 外部直接控制的揭开进度百分比 (0~1) */
  maskProgress: { type: Number, default: null },
  /** 是否启用一行一行的分步教学动画效果 */
  maskLineByLine: { type: Boolean, default: true },
  /** 手写排版与温度感档位：'a'(工整) | 'b'(自然微感，推荐) | 'c'(墨迹微扰) | 'd'(随性手稿) */
  handwriteMode: { type: String, default: 'b' },
  /** 确定性随机抖动种子 */
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

const boardPreviewRef = ref(null)

// 暴露完整的程序化演播与遮罩控制接口
defineExpose({
  play: () => boardPreviewRef.value?.play(),
  pause: () => boardPreviewRef.value?.pause(),
  togglePlay: () => boardPreviewRef.value?.togglePlay(),
  nextStep: () => boardPreviewRef.value?.nextStep(),
  prevStep: () => boardPreviewRef.value?.prevStep(),
  replayAll: () => boardPreviewRef.value?.replayAll(),
  toggleSettledView: () => boardPreviewRef.value?.toggleSettledView(),
  revealAll: () => boardPreviewRef.value?.revealAll(),
  hideAll: () => boardPreviewRef.value?.hideAll(),
  setStep: (step) => boardPreviewRef.value?.setStep(step),
  setMaskProgress: (val) => boardPreviewRef.value?.setMaskProgress(val),
  setMaskStyle: (style) => boardPreviewRef.value?.setMaskStyle(style),
  boardPreviewRef,
})
</script>

<template>
  <div class="stage-preview-root" data-component="StagePreview">
    <RealBoardPreview
      ref="boardPreviewRef"
      :problem-text="problemText"
      :board-plan="boardPlan"
      :topic-layout="topicLayout"
      :show-grid="showGrid"
      :show-all-labels="showAllLabels"
      :show-zone-guides="showZoneGuides"
      :interactive="interactive"
      :source-image-url="sourceImageUrl"
      :keep-original="keepOriginal"
      :action-spec="actionSpec"
      :board-rows="boardRows"
      :auto-play="autoPlay"
      :active-step-index="activeStepIndex"
      :show-full-board="showFullBoard"
      :show-playback-controls="showPlaybackControls"
      :mask-mode="maskMode"
      :mask-feather="maskFeather"
      :mask-angle="maskAngle"
      :mask-style="maskStyle"
      :mask-progress="maskProgress"
      :mask-line-by-line="maskLineByLine"
      @pick-coord="emit('pick-coord', $event)"
      @topic-measured="emit('topic-measured', $event)"
      @update:topic-layout="emit('update:topic-layout', $event)"
      @layout-change="emit('layout-change', $event)"
      @update:problem-text="emit('update:problem-text', $event)"
      @step-change="emit('step-change', $event)"
      @play-state-change="emit('play-state-change', $event)"
      @mask-progress-change="emit('mask-progress-change', $event)"
    >
      <template #playback>
        <slot name="playback" />
      </template>
    </RealBoardPreview>
  </div>
</template>

<style scoped>
.stage-preview-root {
  width: 100%;
  position: relative;
}
</style>
