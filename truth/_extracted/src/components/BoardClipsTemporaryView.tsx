// @cleanroom-component: BoardClipsTemporaryView
// @domain: teaching-timeline/board-clips-debug
// @slot: center-timeline/temp-board-clips-view
// @depends: TeachingProject.timeline.clips(kind=board), TeachingProject.timeline.clips(kind=audio)
// @boundary: read-only inspector for board clips duration deviation against voiceAudio track

import {
  AimOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  SoundOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Badge, Button, Card, Empty, Space, Tag, Typography, message } from 'antd';
import { useCallback, useMemo } from 'react';
import type { TimelineClip } from '../domain/teachingProject';

const { Text } = Typography;

export interface BoardClipsTemporaryViewProps {
  clips: TimelineClip[];
  playheadMs?: number;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string | null) => void;
  onSetPlayhead?: (playheadMs: number) => void;
  onUpdateBoardTiming?: (clipId: string, patch: Partial<Pick<TimelineClip, 'startMs' | 'endMs'>>) => void;
}

interface ClipDeviationInfo {
  clip: TimelineClip;
  startTimeSec: string;
  durationSec: string;
  durationMs: number;
  matchedAudio: TimelineClip | null;
  matchReason: string;
  audioDurationSec: string | null;
  audioDurationMs: number | null;
  deviationMs: number | null;
  deviationSec: string | null;
  status: 'aligned' | 'longer' | 'shorter' | 'unmatched';
}

export function BoardClipsTemporaryView({
  clips,
  playheadMs = 0,
  selectedClipId = null,
  onSelectClip,
  onSetPlayhead,
  onUpdateBoardTiming,
}: BoardClipsTemporaryViewProps) {
  // 1. 过滤所有 board 类型的 Clip
  const boardClips = useMemo(() => {
    return clips
      .filter((clip) => clip.kind === 'board')
      .sort((a, b) => a.startMs - b.startMs);
  }, [clips]);

  // 2. 过滤所有 A 轨 voiceAudio Clips
  const audioClips = useMemo(() => {
    return clips
      .filter((clip) => clip.kind === 'audio' || clip.trackId === 'track-voice')
      .sort((a, b) => a.startMs - b.startMs);
  }, [clips]);

  // 3. 当前播放头或选中的 A 轨 voiceAudio（作为时间轴活跃音频参考）
  const activeVoiceAudio = useMemo(() => {
    if (audioClips.length === 0) return null;
    const currentAtPlayhead = audioClips.find(
      (a) => playheadMs >= a.startMs && playheadMs < a.endMs,
    );
    if (currentAtPlayhead) return currentAtPlayhead;
    const currentSelected = audioClips.find((a) => a.id === selectedClipId);
    if (currentSelected) return currentSelected;
    return audioClips[0];
  }, [audioClips, playheadMs, selectedClipId]);

  // 4. 计算每个 board Clip 与对应 A 轨 voiceAudio 的时长偏差
  const comparisonList = useMemo<ClipDeviationInfo[]>(() => {
    return boardClips.map((boardClip) => {
      const startTimeSec = (boardClip.startMs / 1000).toFixed(2);
      const durationMs = Math.max(0, boardClip.endMs - boardClip.startMs);
      const durationSec = (durationMs / 1000).toFixed(2);

      // 匹配关联的 A 轨 voiceAudio
      let matchedAudio: TimelineClip | null = null;
      let matchReason = '';

      // (1) chainKey 匹配
      if (boardClip.chainKey) {
        matchedAudio =
          audioClips.find((a) => a.chainKey && a.chainKey === boardClip.chainKey) ?? null;
        if (matchedAudio) matchReason = 'chainKey 关联';
      }

      // (2) sourceRef 匹配
      if (!matchedAudio && boardClip.sourceRef) {
        matchedAudio =
          audioClips.find(
            (a) => a.id === boardClip.sourceRef || a.sourceRef === boardClip.sourceRef,
          ) ?? null;
        if (matchedAudio) matchReason = 'sourceRef 关联';
      }

      // (3) 时间区间包含匹配
      if (!matchedAudio) {
        matchedAudio =
          audioClips.find(
            (a) =>
              (boardClip.startMs >= a.startMs - 50 && boardClip.startMs < a.endMs + 50) ||
              (boardClip.endMs > a.startMs + 50 && boardClip.endMs <= a.endMs + 50),
          ) ?? null;
        if (matchedAudio) matchReason = '时间区间重叠';
      }

      // 提取 A 轨音频时长
      let audioDurationMs: number | null = null;
      if (matchedAudio) {
        audioDurationMs = Math.max(0, matchedAudio.endMs - matchedAudio.startMs);
      } else if (
        typeof boardClip.sourceStartMs === 'number' &&
        typeof boardClip.sourceEndMs === 'number' &&
        boardClip.sourceEndMs >= boardClip.sourceStartMs
      ) {
        audioDurationMs = boardClip.sourceEndMs - boardClip.sourceStartMs;
        matchReason = '板书记录原始 A 轨时序';
      }

      const audioDurationSec =
        audioDurationMs !== null ? (audioDurationMs / 1000).toFixed(2) : null;

      // 计算时长偏差 (boardDuration - audioDuration)
      let deviationMs: number | null = null;
      let deviationSec: string | null = null;
      let status: 'aligned' | 'longer' | 'shorter' | 'unmatched' = 'unmatched';

      if (audioDurationMs !== null) {
        deviationMs = durationMs - audioDurationMs;
        deviationSec = (deviationMs / 1000).toFixed(2);
        if (Math.abs(deviationMs) <= 30) {
          status = 'aligned';
        } else if (deviationMs > 30) {
          status = 'longer';
        } else {
          status = 'shorter';
        }
      }

      return {
        clip: boardClip,
        startTimeSec,
        durationSec,
        durationMs,
        matchedAudio,
        matchReason,
        audioDurationSec,
        audioDurationMs,
        deviationMs,
        deviationSec,
        status,
      };
    });
  }, [boardClips, audioClips]);

  // 统计概览
  const stats = useMemo(() => {
    let aligned = 0;
    let longer = 0;
    let shorter = 0;
    let unmatched = 0;
    comparisonList.forEach((item) => {
      if (item.status === 'aligned') aligned++;
      else if (item.status === 'longer') longer++;
      else if (item.status === 'shorter') shorter++;
      else unmatched++;
    });
    return {
      total: comparisonList.length,
      aligned,
      longer,
      shorter,
      unmatched,
    };
  }, [comparisonList]);

  // 融合 cs-board 音画吸附：单条对齐
  const handleAlignSingle = useCallback(
    (item: ClipDeviationInfo) => {
      if (!item.matchedAudio || !onUpdateBoardTiming) return;
      onUpdateBoardTiming(item.clip.id, {
        startMs: item.matchedAudio.startMs,
        endMs: item.matchedAudio.endMs,
      });
      message.success(`已将板书 [${item.clip.label || item.clip.id}] 精准吸附对齐至 A 轨音频时序`);
    },
    [onUpdateBoardTiming],
  );

  // 融合 cs-board 音画吸附：全量一键纠偏
  const handleAlignAll = useCallback(() => {
    if (!onUpdateBoardTiming) return;
    let count = 0;
    comparisonList.forEach((item) => {
      if (item.matchedAudio && (item.status === 'longer' || item.status === 'shorter')) {
        onUpdateBoardTiming(item.clip.id, {
          startMs: item.matchedAudio.startMs,
          endMs: item.matchedAudio.endMs,
        });
        count++;
      }
    });
    if (count > 0) {
      message.success(`已融合 cs-board 音画对齐：成功将 ${count} 个板书 Clip 批量校准吸附至真实音频！`);
    } else {
      message.info('当前所有板书 Clip 均已与音频对齐');
    }
  }, [comparisonList, onUpdateBoardTiming]);

  return (
    <div
      className="board-clips-temporary-view"
      id="cleanroom-board-clips-temporary-view"
      style={{
        marginTop: '16px',
        background: '#ffffff',
        border: '1.5px dashed #ffa39e',
        borderRadius: '12px',
        padding: '14px 16px',
        boxShadow: '0 4px 16px rgba(255, 77, 79, 0.06)',
      }}
    >
      {/* 视图顶栏 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          borderBottom: '1px solid rgba(126, 151, 186, 0.16)',
          paddingBottom: '10px',
          marginBottom: '12px',
        }}
      >
        <Space align="center" size={8}>
          <Tag color="#ff4d4f" style={{ fontWeight: 700, padding: '2px 8px', fontSize: '12px' }}>
            临时视图
          </Tag>
          <Text strong style={{ fontSize: '14px', color: '#1f2d3d' }}>
            板书 (board) Clip 时序与 A 轨 voiceAudio 时长偏差清单
          </Text>
        </Space>

        <Space wrap size={6}>
          <Tag color="default">共 {stats.total} 个 board Clip</Tag>
          <Tag color="success">✔ 对齐: {stats.aligned}</Tag>
          <Tag color="error">▲ 偏长: {stats.longer}</Tag>
          <Tag color="processing">▼ 偏短: {stats.shorter}</Tag>
          {stats.unmatched > 0 ? <Tag color="warning">未关联: {stats.unmatched}</Tag> : null}
          {onUpdateBoardTiming && (stats.longer > 0 || stats.shorter > 0) ? (
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={handleAlignAll}
              style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 600 }}
              title="融合 cs-board 音画同步机制：将存在偏差的板书一键全部校准吸附至真实音频时序"
            >
              一键全量吸附 A 轨真实音频
            </Button>
          ) : null}
          {activeVoiceAudio ? (
            <Tag color="cyan" icon={<SoundOutlined />}>
              当前 A 轨 voiceAudio: {activeVoiceAudio.label || activeVoiceAudio.id} (
              {((activeVoiceAudio.endMs - activeVoiceAudio.startMs) / 1000).toFixed(2)}s)
            </Tag>
          ) : (
            <Tag color="default">A 轨暂无音频</Tag>
          )}
        </Space>
      </div>

      {/* 列表主体 */}
      {comparisonList.length === 0 ? (
        <Empty
          description="暂无 board 类型的 Clip（可在生成讲稿与板书后查看）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ margin: '18px 0' }}
        />
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {comparisonList.map((item, index) => {
            const isSelected = item.clip.id === selectedClipId;
            const isCurrentPlayhead =
              playheadMs >= item.clip.startMs && playheadMs <= item.clip.endMs;

            return (
              <div
                key={item.clip.id}
                onClick={() => onSelectClip?.(item.clip.id)}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: isSelected
                    ? '2px solid #1677ff'
                    : isCurrentPlayhead
                      ? '1px solid #52c41a'
                      : '1px solid #f0f0f0',
                  background: isSelected
                    ? 'rgba(22, 119, 255, 0.05)'
                    : isCurrentPlayhead
                      ? 'rgba(82, 196, 26, 0.04)'
                      : '#fafafa',
                }}
              >
                {/* 左侧：序号、Label、ID、时间点与时长 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 360px', minWidth: 0 }}>
                  <Badge
                    count={index + 1}
                    style={{
                      backgroundColor: isSelected ? '#1677ff' : '#8c8c8c',
                      fontWeight: 600,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Text
                        ellipsis
                        strong
                        style={{
                          fontSize: '13px',
                          color: '#262626',
                          maxWidth: '240px',
                        }}
                        title={item.clip.label}
                      >
                        {item.clip.label || '板书片段'}
                      </Text>
                      <Tag color="geekblue" style={{ fontSize: '11px', margin: 0 }}>
                        {item.clip.id}
                      </Tag>
                      {item.clip.chainKey ? (
                        <Tag color="purple" style={{ fontSize: '11px', margin: 0 }}>
                          {item.clip.chainKey}
                        </Tag>
                      ) : null}
                      {isCurrentPlayhead ? (
                        <Tag color="success" icon={<EyeOutlined />} style={{ fontSize: '11px', margin: 0, fontWeight: 700 }}>
                          当前讲解聚焦 (Active Cue)
                        </Tag>
                      ) : null}
                    </div>

                    {/* 关键信息：startTime 与 duration */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginTop: '4px',
                        fontSize: '12px',
                        color: '#595959',
                      }}
                    >
                      <span>
                        <FieldTimeOutlined style={{ marginRight: '3px', color: '#1677ff' }} />
                        <strong>startTime:</strong> {item.startTimeSec}s ({item.clip.startMs}ms)
                      </span>
                      <span>
                        <ClockCircleOutlined style={{ marginRight: '3px', color: '#fa8c16' }} />
                        <strong>duration:</strong> {item.durationSec}s ({item.durationMs}ms)
                      </span>
                    </div>
                  </div>
                </div>

                {/* 中间：对应 A 轨 voiceAudio 信息 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e8e8e8',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                    }}
                  >
                    <SoundOutlined style={{ marginRight: '4px', color: '#0958d9' }} />
                    <Text type="secondary">对应 A 轨 voiceAudio: </Text>
                    {item.audioDurationSec !== null ? (
                      <Text strong style={{ color: '#0958d9' }}>
                        {item.audioDurationSec}s ({item.audioDurationMs}ms)
                      </Text>
                    ) : (
                      <Text type="warning">暂无 A 轨音频</Text>
                    )}
                    {item.matchReason ? (
                      <span style={{ fontSize: '11px', color: '#8c8c8c', marginLeft: '6px' }}>
                        ({item.matchReason})
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* 右侧：醒目颜色标注偏差数值 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 auto' }}>
                  {item.status === 'aligned' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 12px',
                        background: '#f6ffed',
                        border: '1.5px solid #52c41a',
                        borderRadius: '6px',
                        color: '#237804',
                        fontWeight: 700,
                        fontSize: '13px',
                      }}
                    >
                      <CheckCircleOutlined />
                      <span>偏差: 0.00s (对齐)</span>
                    </div>
                  )}

                  {item.status === 'longer' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 12px',
                        background: '#fff1f0',
                        border: '2px solid #ff4d4f',
                        borderRadius: '6px',
                        color: '#cf1322',
                        fontWeight: 800,
                        fontSize: '13px',
                        boxShadow: '0 2px 8px rgba(245, 34, 45, 0.15)',
                      }}
                    >
                      <ExclamationCircleOutlined />
                      <span>偏差: +{item.deviationSec}s (偏长 +{item.deviationMs}ms)</span>
                    </div>
                  )}

                  {item.status === 'shorter' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 12px',
                        background: '#e6f4ff',
                        border: '2px solid #1677ff',
                        borderRadius: '6px',
                        color: '#0958d9',
                        fontWeight: 800,
                        fontSize: '13px',
                        boxShadow: '0 2px 8px rgba(22, 119, 255, 0.15)',
                      }}
                    >
                      <ExclamationCircleOutlined />
                      <span>偏差: {item.deviationSec}s (偏短 {item.deviationMs}ms)</span>
                    </div>
                  )}

                  {item.status === 'unmatched' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '5px 10px',
                        background: '#fffbe6',
                        border: '1px solid #ffe58f',
                        borderRadius: '6px',
                        color: '#d48806',
                        fontSize: '12px',
                      }}
                    >
                      未关联 A 轨音频
                    </div>
                  )}

                  {/* 融合 cs-board 音画吸附：单条吸附对齐按钮 */}
                  {onUpdateBoardTiming &&
                  item.matchedAudio &&
                  (item.status === 'longer' || item.status === 'shorter') ? (
                    <Button
                      icon={<ThunderboltOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAlignSingle(item);
                      }}
                      size="small"
                      type="dashed"
                      style={{ color: '#722ed1', borderColor: '#d3adf7', fontWeight: 600 }}
                      title="融合 cs-board 音画同步：将该板书时序纠正为对应 A 轨音频起止点"
                    >
                      吸附对齐
                    </Button>
                  ) : null}

                  {/* 快捷跳转播放头按钮 */}
                  {onSetPlayhead ? (
                    <Button
                      icon={<AimOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetPlayhead(item.clip.startMs);
                      }}
                      size="small"
                      title="跳转播放头至该 board Clip 起始点"
                      type="text"
                    >
                      定位
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
