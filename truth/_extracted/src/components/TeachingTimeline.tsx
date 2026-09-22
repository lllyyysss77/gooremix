// @cleanroom-component: TeachingTimeline
// @domain: teaching-timeline
// @slot: center-timeline
// @depends: TeachingProject.timeline
// @io-input: tracks, clips, selectedClipId, onSelectClip
// @io-output: onSelectClip(clipId)
// @route: App shell / center timeline
// @fields: TeachingProject.timeline.tracks, TeachingProject.timeline.clips, selectedClipId
// @boundary: timeline playback UI, selection, and global playback progress only; does not parse TTS or request API, does not control B/C timing
// @route-impact: App shell only, future route: task-review

// ID: cleanroom-timeline-root-001
// 💾 数据: TeachingProject.timeline.tracks + TeachingProject.timeline.clips
// 🔌 事件: clip click -> selectClip -> InspectorPanel
// 📦 后续转换: BoardEvent[] -> timeline.clips(kind=board)
// ⚠️ 边界: 时间轴展示不解析 TTS，不请求外部 API；B 寿命控制委托 VoiceTrack，右侧只编辑 C 素材属性
// @b-director-anchor: VoiceTrack owns .voice-track-b-timing and .voice-track-b-timing-controls inside TeachingTimeline.
// @b-director-copy: B 寿命 / 显示开始 ms / 显示结束 ms / 超过 A 后只静态留场
// @b-track-ownership: B 寿命轨 / 语音时序 / note: '时间轴'
// @b-track-generation: 等待按 C 素材候选和 A 轨时序生成 B 寿命。生成 B 寿命后自动出现图层

import { PauseCircleOutlined, PlayCircleOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Button, Card, Slider, Space, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../domain/teachingProject';
import { useVoiceTrackAudio } from '../modules/audioPlayback/useVoiceTrackAudio';
import { TimelineTrackRow } from './TimelineTrackRow';
import { VoiceTrack } from './VoiceTrack';
import { BoardClipsTemporaryView } from './BoardClipsTemporaryView';

const { Text } = Typography;

export function TeachingTimeline({
  tracks,
  clips,
  boardTimingClips,
  isPlaying,
  selectedClipId,
  playheadMs,
  onSelectClip,
  onSetPlaying,
  onSetLivePlayhead,
  onSetPlayhead,
  onUpdateBoardTiming,
}: {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  boardTimingClips: TimelineClip[];
  isPlaying: boolean;
  selectedClipId: string | null;
  playheadMs: number;
  onSelectClip: (clipId: string | null) => void;
  onSetPlaying: (playing: boolean) => void;
  onSetLivePlayhead: (playheadMs: number | null) => void;
  onSetPlayhead: (playheadMs: number) => void;
  onUpdateBoardTiming: (clipId: string, patch: Partial<Pick<TimelineClip, 'startMs' | 'endMs'>>) => void;
}) {
  const timelineDurationMs = Math.max(1000, ...clips.map((clip) => clip.endMs));
  const stopPlayback = useCallback(() => onSetPlaying(false), [onSetPlaying]);
  const audioStatus = useVoiceTrackAudio({
    clips,
    isPlaying,
    onSetPlayhead: onSetLivePlayhead,
    onStop: stopPlayback,
    playheadMs,
  });

  /** 防抖：200ms 内快速双击不触发重复 toggle，保护 AudioContext 状态机 */
  const togglePendingRef = useRef(false);
  const togglePlayback = () => {
    if (!audioStatus.hasPlayableAudio || togglePendingRef.current) {
      return;
    }
    togglePendingRef.current = true;
    onSetPlaying(!isPlaying);
    setTimeout(() => {
      togglePendingRef.current = false;
    }, 200);
  };

  const [zoom, setZoom] = useState(1);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  const minZoom = 1;
  const maxZoom = 6;
  const zoomStep = 0.2;

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(maxZoom, Number((prev + zoomStep).toFixed(1))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(minZoom, Number((prev - zoomStep).toFixed(1))));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  /** 支持滚轮缩放：Ctrl / Cmd / Alt + 滚轮实现平滑缩放，方便细粒度对齐短片段 */
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;

    const handleWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom((prev) => Math.max(minZoom, Math.min(maxZoom, Number((prev + delta).toFixed(1)))));
      }
    };

    el.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheelZoom);
    };
  }, []);

  /** 缩放状态下拖动或播放时自动将播放头滚动至可视区域 */
  useEffect(() => {
    if (!timelineScrollRef.current || zoom <= 1) return;
    const container = timelineScrollRef.current;
    const ratio = Math.min(1, Math.max(0, playheadMs / timelineDurationMs));
    const playheadPx = ratio * container.scrollWidth;
    if (playheadPx < container.scrollLeft || playheadPx > container.scrollLeft + container.clientWidth) {
      container.scrollTo({
        left: Math.max(0, playheadPx - container.clientWidth / 2),
        behavior: 'smooth',
      });
    }
  }, [playheadMs, timelineDurationMs, zoom]);

  const handlePlayheadChange = (nextPlayheadMs: number) => {
    onSetLivePlayhead(null);
    onSetPlayhead(nextPlayheadMs);
  };

  return (
    <Card className="zone-card zone-timeline" title="播放时间轴">
      <div className="timeline-playbar">
        <Space align="center" size={10}>
          <Tooltip title={audioStatus.hasPlayableAudio ? '播放讲解音频' : '请先生成讲解音频'}>
            <Button
              className="timeline-play-button"
              disabled={!audioStatus.hasPlayableAudio}
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={togglePlayback}
              shape="circle"
              type="primary"
            />
          </Tooltip>
          <Text strong>播放位置</Text>
          <Text type="secondary">{formatMs(playheadMs)} / {formatMs(timelineDurationMs)}</Text>
          <Tag color={audioStatus.hasPlayableAudio ? 'green' : 'orange'}>
            {audioStatus.hasPlayableAudio ? '可播放' : '待生成音频'}
          </Tag>
          {audioStatus.error ? <Text type="danger">{audioStatus.error}</Text> : null}
        </Space>
        <Slider
          className="timeline-play-slider"
          max={timelineDurationMs}
          min={0}
          onChange={handlePlayheadChange}
          step={50}
          tooltip={{ formatter: (value) => formatMs(value ?? 0) }}
          value={playheadMs}
        />
      </div>
      <div className="timeline-zoom-bar">
        <Space align="center" size={8} wrap>
          <Text strong style={{ fontSize: '12px' }}>时间轴缩放</Text>
          <Tooltip title="缩小时间轴 (Ctrl + 滚轮向下)">
            <Button
              disabled={zoom <= minZoom}
              icon={<ZoomOutOutlined />}
              onClick={handleZoomOut}
              size="small"
            />
          </Tooltip>
          <Slider
            className="timeline-zoom-slider"
            max={maxZoom}
            min={minZoom}
            onChange={(val) => setZoom(val)}
            step={0.1}
            tooltip={{ formatter: (val) => `${Math.round((val ?? 1) * 100)}%` }}
            value={zoom}
          />
          <Tooltip title="放大时间轴 (Ctrl + 滚轮向上)">
            <Button
              disabled={zoom >= maxZoom}
              icon={<ZoomInOutlined />}
              onClick={handleZoomIn}
              size="small"
            />
          </Tooltip>
          <Button
            disabled={zoom === 1}
            onClick={handleResetZoom}
            size="small"
          >
            100%
          </Button>
          <Tag color={zoom > 1 ? 'blue' : 'default'} style={{ margin: 0 }}>
            {Math.round(zoom * 100)}%
          </Tag>
          <Text type="secondary" style={{ fontSize: '11px' }}>
            (滑块拖动或 Ctrl/Cmd + 滚轮缩放，便捷微调细粒度片段时长)
          </Text>
        </Space>
      </div>
      <div className="timeline-scroll-container" ref={timelineScrollRef}>
        <div
          className="timeline"
          style={{
            minWidth: zoom > 1 ? `${zoom * 100}%` : '100%',
            transition: 'min-width 0.12s ease-out',
          }}
        >
          {tracks.map((track) => {
            const trackClips = clips.filter((clip) => clip.trackId === track.id);
            return track.kind === 'voice' ? (
              <VoiceTrack
                clips={trackClips}
                boardTimingClips={boardTimingClips}
                durationMs={timelineDurationMs}
                key={track.id}
                onSelectClip={onSelectClip}
                playheadMs={playheadMs}
                selectedClipId={selectedClipId}
                track={track}
                onUpdateBoardTiming={onUpdateBoardTiming}
              />
            ) : (
              <TimelineTrackRow
                clips={trackClips}
                durationMs={timelineDurationMs}
                key={track.id}
                onSelectClip={onSelectClip}
                onUpdateBoardTiming={onUpdateBoardTiming}
                playheadMs={playheadMs}
                selectedClipId={selectedClipId}
                track={track}
              />
            );
          })}
        </div>
      </div>
      <BoardClipsTemporaryView
        clips={clips}
        onSelectClip={onSelectClip}
        onSetPlayhead={onSetPlayhead}
        onUpdateBoardTiming={onUpdateBoardTiming}
        playheadMs={playheadMs}
        selectedClipId={selectedClipId}
      />
    </Card>
  );
}

function formatMs(value: number) {
  return `${(value / 1000).toFixed(1)}s`;
}
