import {
  AlertOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  ClockCircleFilled,
  DownloadOutlined,
  ExclamationCircleFilled,
  FieldTimeOutlined,
  MessageOutlined,
  SettingOutlined,
  SoundOutlined,
  VideoCameraOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { Button, ConfigProvider, Layout, Modal, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppSettingsDrawer } from './components/AppSettingsDrawer';
import { AssetPanel } from './components/AssetPanel';
import { FloatingToolDock } from './components/FloatingToolDock';
import { InspectorPanel } from './components/InspectorPanel';
import { ProjectArchiveActions } from './components/ProjectArchiveActions';
import { StagePreview } from './components/StagePreview';
import { TeachingTimeline } from './components/TeachingTimeline';
import type { ScriptAgentDraft } from './domain/teachingProject';
import type { VisibleWorkflowStepKey } from './workflow/assetWorkflowFlow';
import {
  downloadTeachingProjectJson,
  importProjectFromLocalTaskFolder,
  saveProjectToLocalTaskFolder,
  selectDefaultLocalTaskFolder,
  type LocalTaskArchiveResult,
} from './modules/localTaskArchive/localTaskArchive';
import {
  loadCurrentProjectSnapshot,
  loadLocalTaskSnapshot,
  loadRecentTaskSnapshots,
  saveCurrentProjectSnapshot,
  saveNamedProjectSnapshot,
  type LocalTaskSnapshot,
} from './modules/localTaskArchive/localTaskDb';
import { useTeachingEditorStore } from './store/useTeachingEditorStore';
import { appTheme } from './ui/theme';

// @@COMP_APP @@COMP_PLAYBACK_WS
// ID: cleanroom-shell-layout-root-001
// 💾 数据: TeachingProject / defaultConfig through useTeachingEditorStore
// 🔌 事件: header actions -> Drawer open state / selected clip state
// 🧩 复用: AssetPanel + StagePreview + TeachingTimeline + InspectorPanel
// @c-candidate-waiting-copy: 等待 Agent 生成 C 素材候选
// ⚠️ BREAKPOINT: PlaybackWorkspace selector 曾触发无限更新，已拆为多个稳定 selector（d7d1936）

const { Header } = Layout;
const { Text, Title } = Typography;
const ScriptAgentWorkspace = lazy(() =>
  import('./components/ScriptAgentWorkspace').then((module) => ({
    default: module.ScriptAgentWorkspace,
  })),
);

export function App() {
  return (
    <ConfigProvider theme={appTheme}>
      <EditorShell />
    </ConfigProvider>
  );
}

function EditorShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scriptAgentOpen, setScriptAgentOpen] = useState(false);
  const [scriptAgentOpenMode, setScriptAgentOpenMode] = useState<'chat' | 'generate'>('chat');
  const [scriptAgentGenerateRequestId, setScriptAgentGenerateRequestId] = useState(0);
  const [requestedWorkflowKey, setRequestedWorkflowKey] = useState<VisibleWorkflowStepKey | null>(null);
  const [requestedWorkflowRequestId, setRequestedWorkflowRequestId] = useState(0);
  const [isAssetPanelCollapsed, setIsAssetPanelCollapsed] = useState(false);
  const [isRecordingFocusMode, setIsRecordingFocusMode] = useState(false);
  const [recentTaskSnapshots, setRecentTaskSnapshots] = useState<LocalTaskSnapshot[]>([]);
  const assetPanelAutoCollapsedRef = useRef(false);
  const project = useTeachingEditorStore((state) => state.project);
  const pendingProject = useTeachingEditorStore((state) => state.pendingProject);
  const scriptAgentCandidateDraft = useTeachingEditorStore((state) => state.scriptAgentCandidateDraft);
  const layoutPreviewDraft = useTeachingEditorStore((state) => state.layoutPreviewDraft);
  const config = useTeachingEditorStore((state) => state.config);
  const updateConfig = useTeachingEditorStore((state) => state.updateConfig);
  const automationConfig = config.automation;
  const recognitionConfig = config.recognition;
  const ttsConfig = config.tts;
  const updateSelectedBoardClip = useTeachingEditorStore((state) => state.updateSelectedBoardClip);
  const updateStageCanvas = useTeachingEditorStore((state) => state.updateStageCanvas);

  const workflowProject = pendingProject ?? project;
  const workflowAssets = workflowProject.assets;
  const problemText = project.assets.find((asset) => asset.kind === 'problemText');
  const workflowProblemText = workflowAssets.find((asset) => asset.kind === 'problemText');
  const workflowScriptText = workflowAssets.find((asset) => asset.kind === 'scriptText');
  const workflowBoardLayout = workflowAssets.find((asset) => asset.kind === 'boardLayout');
  const voiceAudio = project.assets.find((asset) => asset.kind === 'voiceAudio');
  const selectedClip = useTeachingEditorStore((state) => {
    const { clips } = state.project.timeline;
    return clips.find((clip) => clip.id === state.selectedClipId);
  });
  const isProblemConfirmed = problemText?.status === 'ready' && Boolean(problemText.summary.trim());
  const isWorkflowProblemConfirmed = workflowProblemText?.status === 'ready' && Boolean(workflowProblemText.summary.trim());
  const isScriptBoardReady =
    workflowScriptText?.status === 'ready' &&
    Boolean(workflowScriptText.summary.trim()) &&
    workflowBoardLayout?.status === 'ready' &&
    Boolean(workflowBoardLayout.summary.trim());
  const isVoiceReady = voiceAudio?.status === 'ready';
  const boardTimingClipCount = useTeachingEditorStore((state) => state.project.timeline.clips.filter((clip) => clip.kind === 'board').length);
  const isBTrackOnRail = isVoiceReady && boardTimingClipCount > 0;
  const importProblemImage = useTeachingEditorStore((state) => state.importProblemImage);
  const updateProblemText = useTeachingEditorStore((state) => state.updateProblemText);
  const applyRecognizedProblemText = useTeachingEditorStore((state) => state.applyRecognizedProblemText);
  const confirmProblemText = useTeachingEditorStore((state) => state.confirmProblemText);
  const applyScriptAgentDraft = useTeachingEditorStore((state) => state.applyScriptAgentDraft);
  const updateScriptAgentCandidateDraft = useTeachingEditorStore((state) => state.updateScriptAgentCandidateDraft);
  const applyBoardEventsToTimeline = useTeachingEditorStore((state) => state.applyBoardEventsToTimeline);
  const applyTtsSentenceResults = useTeachingEditorStore((state) => state.applyTtsSentenceResults);
  const syncCAssetPrewarmQueue = useTeachingEditorStore((state) => state.syncCAssetPrewarmQueue);
  const syncLayoutPreviewDraft = useTeachingEditorStore((state) => state.syncLayoutPreviewDraft);
  const restoreProjectSnapshot = useTeachingEditorStore((state) => state.restoreProjectSnapshot);
  const snapshotReadyRef = useRef(false);
  const refreshRecentTaskSnapshots = useCallback(async () => {
    setRecentTaskSnapshots(await loadRecentTaskSnapshots());
  }, []);

  useEffect(() => {
    let isActive = true;

    void loadCurrentProjectSnapshot().then(async (snapshot) => {
      if (!isActive) {
        return;
      }

      if (snapshot) {
        restoreProjectSnapshot(snapshot.project, { preservePendingProject: true, preserveScriptAgentCandidateDraft: true });
      }
      setRecentTaskSnapshots(await loadRecentTaskSnapshots());
      snapshotReadyRef.current = true;
    });

    return () => {
      isActive = false;
    };
  }, [refreshRecentTaskSnapshots, restoreProjectSnapshot]);

  useEffect(() => {
    if (!snapshotReadyRef.current) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      void saveCurrentProjectSnapshot(project);
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [project]);

  useEffect(() => {
    if (!pendingProject) {
      return;
    }

    assetPanelAutoCollapsedRef.current = false;
    setIsAssetPanelCollapsed(false);
  }, [pendingProject]);

  useEffect(() => {
    if (!isBTrackOnRail || assetPanelAutoCollapsedRef.current) {
      return;
    }

    assetPanelAutoCollapsedRef.current = true;
    setIsAssetPanelCollapsed(true);
  }, [isBTrackOnRail]);

  const handleApplyScriptAgentDraft = (draft: ScriptAgentDraft) => {
    // Trace point 8b: Trigger TTS workflow for A-track generation
    applyScriptAgentDraft(draft);
    syncLayoutPreviewDraft(null);

    // 静默异步中间格式过滤层 - 用户不可见
    import('./modules/ttsPreprocessor/index').then(({ createTtsFormatFilterLayer }) => {
      createTtsFormatFilterLayer(draft).then((filterResult: any) => {
        // 前端显示干净的板书内容（通过现有的applyScriptAgentDraft已经处理）
        // 后台静默处理阿里云TTS格式，用户看不到处理过程
        // ⚡ Trace point 8c: TTS格式过滤完成（静默处理，不输出用户数据到控制台）
        void filterResult.displayContent;
        void filterResult.ttsContent.units.length;
      }).catch((error: any) => {
        console.error('中间格式过滤层处理失败:', error);
        // 失败不影响正常流程，继续使用原有逻辑
      });
    }).catch((error: any) => {
      console.error('加载中间格式过滤层失败:', error);
    });

    setRequestedWorkflowKey('voiceAudio');
    setRequestedWorkflowRequestId((current) => current + 1);
    setScriptAgentOpen(false);
  };
  const handleOpenScriptAgentChat = () => {
    setScriptAgentOpenMode('chat');
    setScriptAgentOpen(true);
  };
  const handleGenerateScriptAgentDraft = () => {
    setScriptAgentOpenMode('generate');
    setScriptAgentGenerateRequestId((current) => current + 1);
    setScriptAgentOpen(true);
  };
  const handleSaveLocalTaskArchive = useCallback(async (): Promise<LocalTaskArchiveResult> => {
    const result = await saveProjectToLocalTaskFolder(project);
    if (result.rootDirectoryName && result.rootDirectoryName !== config.output.defaultSaveDirectoryLabel) {
      updateConfig({
        ...config,
        output: {
          ...config.output,
          defaultSaveDirectoryLabel: result.rootDirectoryName,
        },
      });
    }
    await saveCurrentProjectSnapshot(project);
    await saveNamedProjectSnapshot(project, result.folderName, {
      editRecords: result.archivePackage.editRecords,
      productManifest: result.archivePackage.productManifest,
    });
    await refreshRecentTaskSnapshots();
    return result;
  }, [config, project, refreshRecentTaskSnapshots, updateConfig]);
  const handleSetDefaultSaveDirectory = useCallback(async () => {
    const result = await selectDefaultLocalTaskFolder();
    updateConfig({
      ...config,
      output: {
        ...config.output,
        defaultSaveDirectoryLabel: result.directoryName,
      },
    });
    return result;
  }, [config, updateConfig]);
  const handleImportLocalTaskArchive = useCallback(async () => {
    const result = await importProjectFromLocalTaskFolder();
    restoreProjectSnapshot(result.project);
    await saveCurrentProjectSnapshot(result.project);
    await saveNamedProjectSnapshot(result.project, result.folderName, {
      editRecords: result.archivePackage.editRecords,
      productManifest: result.archivePackage.productManifest,
    });
    await refreshRecentTaskSnapshots();
    return result;
  }, [refreshRecentTaskSnapshots, restoreProjectSnapshot]);
  const handleRestoreLocalTaskSnapshot = useCallback(async (snapshotId: string) => {
    const snapshot = await loadLocalTaskSnapshot(snapshotId);
    if (!snapshot) {
      return false;
    }

    restoreProjectSnapshot(snapshot.project);
    await saveCurrentProjectSnapshot(snapshot.project);
    await refreshRecentTaskSnapshots();
    return true;
  }, [refreshRecentTaskSnapshots, restoreProjectSnapshot]);
  const handleExportProjectJson = useCallback(() => {
    try {
      const fileName = downloadTeachingProjectJson(project);
      message.success(`已成功导出项目数据到本地：${fileName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出项目失败');
    }
  }, [project]);

  return (
    <Layout className={isRecordingFocusMode ? 'app-shell app-shell--recording-focus' : 'app-shell'}>
      <Header className="app-header">
        <div className="app-title-block">
          <Text className="eyebrow">Teaching AutoCut Cleanroom</Text>
          <Title level={2}>{project.title}</Title>
          <div className="studio-status-strip">
            <StatusPill isDone label="配置" />
            <StatusPill isDone={isProblemConfirmed} label="题文" />
            <StatusPill isDone={isScriptBoardReady} label="文稿/C素材候选" />
            <StatusPill isDone={isVoiceReady} label="A轨" />
          </div>
        </div>
        <Space className="app-command-bar" wrap>
          <Tag color="blue">轻量工作台</Tag>
          <Button disabled={!isWorkflowProblemConfirmed} onClick={handleOpenScriptAgentChat} type={isWorkflowProblemConfirmed && !isScriptBoardReady ? 'primary' : 'default'}>
            文稿与 C 素材 Agent
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            配置
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportProjectJson}>
            导出项目
          </Button>
          <ProjectArchiveActions
            defaultSaveDirectoryLabel={config.output.defaultSaveDirectoryLabel}
            onImportLocalTaskArchive={handleImportLocalTaskArchive}
            onRefreshLocalTaskSnapshots={refreshRecentTaskSnapshots}
            onRestoreLocalTaskSnapshot={handleRestoreLocalTaskSnapshot}
            onSaveLocalTaskArchive={handleSaveLocalTaskArchive}
            onSetDefaultSaveDirectory={handleSetDefaultSaveDirectory}
            recentTaskSnapshots={recentTaskSnapshots}
          />
          <Tooltip title="完成播放检查后开放">
            <Button disabled icon={<VideoCameraOutlined />} type="primary">
              录屏交付
            </Button>
          </Tooltip>
        </Space>
      </Header>

      <section className={isAssetPanelCollapsed ? 'workspace-grid workspace-grid--assets-collapsed' : 'workspace-grid'}>
        {/* ID: cleanroom-assets-room-mount-001 | 💾 TeachingProject.assets | 🔌 import/edit/next */}
        <aside className="workspace-sider workspace-sider--assets">
          <Button
            aria-label={isAssetPanelCollapsed ? '展开流程面板' : '收起流程面板'}
            className="asset-panel-collapse-button"
            onClick={() => setIsAssetPanelCollapsed((current) => !current)}
            shape="circle"
            size="small"
          >
            {isAssetPanelCollapsed ? '展' : '收'}
          </Button>
          {isAssetPanelCollapsed ? null : (
            <AssetPanel
              assets={workflowAssets}
              automationConfig={automationConfig}
              recognitionConfig={recognitionConfig}
              ttsConfig={ttsConfig}
              scriptAgentConfig={config.scriptAgent}
              scriptAgentCandidateDraft={scriptAgentCandidateDraft}
              layoutPreviewDraft={layoutPreviewDraft}
              onImportProblemImage={importProblemImage}
              onApplyBoardEventsToTimeline={applyBoardEventsToTimeline}
              onSyncCAssetPrewarmQueue={syncCAssetPrewarmQueue}
              onApplyTtsSentenceResults={applyTtsSentenceResults}
              onSyncLayoutPreviewDraft={syncLayoutPreviewDraft}
              onApplyRecognizedProblemText={applyRecognizedProblemText}
              onConfirmProblemText={confirmProblemText}
              onGenerateScriptAgent={handleGenerateScriptAgentDraft}
              onOpenScriptAgent={handleOpenScriptAgentChat}
              onUpdateProblemText={updateProblemText}
              stageCanvas={project.stage.canvas}
              requestedWorkflowKey={requestedWorkflowKey}
              requestedWorkflowRequestId={requestedWorkflowRequestId}
            />
          )}
        </aside>

        {/* ID: cleanroom-stage-timeline-room-mount-001 | 💾 TeachingProject.timeline | 🔌 selectClip */}
        <main className="workspace-main">
          <PlaybackWorkspace onRecordingActiveChange={setIsRecordingFocusMode} problemText={problemText} />
        </main>

        {/* ID: cleanroom-inspector-room-mount-001 | 💾 selectedClip | 🎨 selected/empty state */}
        {/* Trace point 3e: Inspector panel for selected clips */}
        <aside className="workspace-sider workspace-sider--inspector">
          <InspectorPanel
            canvas={project.stage.canvas}
            onUpdateBoardClip={updateSelectedBoardClip}
            onUpdateCanvas={updateStageCanvas}
            selectedClip={selectedClip}
          />
        </aside>
      </section>

      <FloatingToolDock />
      <Button
        className="agent-chat-launcher"
        disabled={!isProblemConfirmed}
        icon={<MessageOutlined />}
        onClick={handleOpenScriptAgentChat}
        type="primary"
      >
        打开文稿与 C 素材
      </Button>

      {/* ID: cleanroom-agent-script-popup-001 | 🔌 open/close/apply | 💾 scriptText + boardLayout */}
      <Modal
        footer={null}
        mask={{ blur: true, closable: true, enabled: true }}
        onCancel={() => setScriptAgentOpen(false)}
        open={scriptAgentOpen}
        title="文稿与 C 素材 Agent"
        width="92vw"
        wrapClassName="agent-chat-modal-wrap"
      >
        <div className="agent-chat-modal-body">
          <Suspense
            fallback={
              <div className="agent-drawer-loading">
                <Spin />
                <Text type="secondary">正在打开文稿与 C 素材 Agent...</Text>
              </div>
            }
          >
            <ScriptAgentWorkspace
              autoApplyDraft={automationConfig.mode === 'unattended'}
              autoRunRequestId={scriptAgentOpen && scriptAgentOpenMode === 'generate' ? scriptAgentGenerateRequestId : 0}
              assets={workflowAssets}
              candidateDraft={scriptAgentCandidateDraft}
              scriptAgentConfig={config.scriptAgent}
              onCandidateDraftChange={updateScriptAgentCandidateDraft}
              onApplyDraft={handleApplyScriptAgentDraft}
            />
          </Suspense>
        </div>
      </Modal>
      <AppSettingsDrawer config={config} onClose={() => setSettingsOpen(false)} onSaveConfig={updateConfig} open={settingsOpen} />
    </Layout>
  );
}

function PlaybackWorkspace({
  onRecordingActiveChange,
  problemText,
}: {
  onRecordingActiveChange: (isRecording: boolean) => void;
  problemText: ReturnType<typeof useTeachingEditorStore.getState>['project']['assets'][number] | undefined;
}) {
  const canvas = useTeachingEditorStore((state) => state.project.stage.canvas);
  const clips = useTeachingEditorStore((state) => state.project.timeline.clips);
  const tracks = useTeachingEditorStore((state) => state.project.timeline.tracks);
  const assets = useTeachingEditorStore((state) => state.project.assets);
  const selectedClipId = useTeachingEditorStore((state) => state.selectedClipId);
  const playheadMs = useTeachingEditorStore((state) => state.project.timeline.playheadMs);
  const livePlayheadMs = useTeachingEditorStore((state) => state.livePlayheadMs);
  const isPlaying = useTeachingEditorStore((state) => state.isPlaying);
  const setLiveTimelinePlayhead = useTeachingEditorStore((state) => state.setLiveTimelinePlayhead);
  const setPlayingState = useTeachingEditorStore((state) => state.setPlayingState);
  const setTimelinePlayhead = useTeachingEditorStore((state) => state.setTimelinePlayhead);
  const updateBoardClip = useTeachingEditorStore((state) => state.updateBoardClip);
  const updateBoardTiming = useTeachingEditorStore((state) => state.updateBoardTiming);
  const selectClip = useTeachingEditorStore((state) => state.selectClip);
  // ⚠️ BREAKPOINT: 播放时每帧触发 → boardClips/selectedBoardClipId 已 useMemo 化避免重建引用
  // ⚠️ BREAKPOINT: 卡顿热路径起点 — livePlayheadMs 变化 → 全链路重渲染 → CStickerFrame clip-path 每帧重绘
  // 详见 .codex/stutter-c-interaction-analysis.md
  const boardClips = useMemo(() => clips.filter((clip) => clip.kind === 'board'), [clips]);
  const selectedBoardClipId = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId && clip.kind === 'board')?.id ?? null,
    [clips, selectedClipId],
  );
  const visiblePlayheadMs = livePlayheadMs ?? playheadMs;

  // 1. voiceAudio 资产与 A 轨 Clips 时长获取
  const voiceAudioAsset = useMemo(() => assets.find((asset) => asset.kind === 'voiceAudio'), [assets]);
  const voiceAudioClips = useMemo(
    () => clips.filter((clip) => clip.kind === 'audio' || clip.trackId === 'track-voice'),
    [clips],
  );
  const voiceClipsDurationMs = useMemo(
    () => voiceAudioClips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0),
    [voiceAudioClips],
  );
  const voiceMaxEndMs = useMemo(
    () => (voiceAudioClips.length > 0 ? Math.max(...voiceAudioClips.map((clip) => clip.endMs)) : 0),
    [voiceAudioClips],
  );
  const parsedSummaryDurationMs = useMemo(() => {
    if (!voiceAudioAsset?.summary) return 0;
    const match = voiceAudioAsset.summary.match(/(?:总时长约|时长\s*)(\d+(?:\.\d+)?)\s*秒/);
    return match ? Math.round(parseFloat(match[1]) * 1000) : 0;
  }, [voiceAudioAsset?.summary]);
  const totalVoiceDurationMs = voiceClipsDurationMs > 0 ? voiceClipsDurationMs : parsedSummaryDurationMs;

  // 2. 所有 board 类型 clip 的总时长与最晚落点
  const totalBoardDurationMs = useMemo(
    () => boardClips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0),
    [boardClips],
  );
  const boardMaxEndMs = useMemo(
    () => (boardClips.length > 0 ? Math.max(...boardClips.map((clip) => clip.endMs)) : 0),
    [boardClips],
  );

  // 3. 时长偏差与时序溢出判定
  const deviationMs = totalVoiceDurationMs > 0 ? totalBoardDurationMs - totalVoiceDurationMs : null;
  const isOverflow =
    totalVoiceDurationMs > 0 &&
    (totalBoardDurationMs > totalVoiceDurationMs || (voiceMaxEndMs > 0 && boardMaxEndMs > voiceMaxEndMs));
  const overflowDurationMs = useMemo(() => {
    if (!isOverflow || totalVoiceDurationMs <= 0) return 0;
    return Math.max(
      totalBoardDurationMs - totalVoiceDurationMs,
      voiceMaxEndMs > 0 ? boardMaxEndMs - voiceMaxEndMs : 0,
      0,
    );
  }, [isOverflow, totalVoiceDurationMs, totalBoardDurationMs, voiceMaxEndMs, boardMaxEndMs]);

  return (
    <>
      <StagePreview
        boardClips={boardClips}
        canvas={canvas}
        playheadMs={visiblePlayheadMs}
        problemText={problemText}
        selectedBoardClipId={selectedBoardClipId}
        onRecordingActiveChange={onRecordingActiveChange}
        onSelectBoardClip={selectClip}
        onUpdateBoardClip={updateBoardClip}
      />
      <PlaybackTimingDeviationIndicator
        voiceDurationMs={totalVoiceDurationMs}
        boardDurationMs={totalBoardDurationMs}
        deviationMs={deviationMs}
        isOverflow={isOverflow}
        overflowDurationMs={overflowDurationMs}
        voiceClipCount={voiceAudioClips.length}
        boardClipCount={boardClips.length}
        boardMaxEndMs={boardMaxEndMs}
        voiceMaxEndMs={voiceMaxEndMs}
        isVoiceReady={voiceAudioAsset?.status === 'ready'}
      />
      <TeachingTimeline
        boardTimingClips={boardClips}
        clips={clips}
        isPlaying={isPlaying}
        onSelectClip={selectClip}
        onSetPlaying={setPlayingState}
        onSetLivePlayhead={setLiveTimelinePlayhead}
        onSetPlayhead={setTimelinePlayhead}
        onUpdateBoardTiming={updateBoardTiming}
        playheadMs={visiblePlayheadMs}
        selectedClipId={selectedClipId}
        tracks={tracks}
      />
    </>
  );
}

function PlaybackTimingDeviationIndicator({
  voiceDurationMs,
  boardDurationMs,
  deviationMs,
  isOverflow,
  overflowDurationMs,
  voiceClipCount,
  boardClipCount,
  boardMaxEndMs,
  voiceMaxEndMs,
  isVoiceReady,
}: {
  voiceDurationMs: number;
  boardDurationMs: number;
  deviationMs: number | null;
  isOverflow: boolean;
  overflowDurationMs: number;
  voiceClipCount: number;
  boardClipCount: number;
  boardMaxEndMs: number;
  voiceMaxEndMs: number;
  isVoiceReady: boolean;
}) {
  const deviationSec = deviationMs !== null ? (Math.abs(deviationMs) / 1000).toFixed(1) : null;
  const isAligned = deviationMs !== null && Math.abs(deviationMs) <= 50;
  const isShorter = deviationMs !== null && deviationMs < -50;
  const cardClassName = isOverflow
    ? 'playback-timing-indicator-card is-overflow'
    : isAligned
    ? 'playback-timing-indicator-card is-aligned'
    : isShorter
    ? 'playback-timing-indicator-card is-shorter'
    : 'playback-timing-indicator-card';

  // 计算视觉进度比例
  const maxRefMs = Math.max(voiceDurationMs, boardDurationMs, 1000);
  const voiceWidthPct = voiceDurationMs > 0 ? Math.min(100, (voiceDurationMs / maxRefMs) * 100) : 0;
  const boardNormalWidthPct =
    voiceDurationMs > 0
      ? Math.min(voiceWidthPct, (boardDurationMs / maxRefMs) * 100)
      : Math.min(100, (boardDurationMs / maxRefMs) * 100);
  const overflowWidthPct =
    voiceDurationMs > 0 ? Math.max(0, ((boardDurationMs - voiceDurationMs) / maxRefMs) * 100) : 0;

  return (
    <div className={cardClassName}>
      <div className="timing-bar-header">
        <Space size="middle" wrap className="timing-metrics-row">
          <Space size="small">
            <FieldTimeOutlined style={{ color: isOverflow ? '#ff4d4f' : '#1890ff', fontSize: 16 }} />
            <Text strong style={{ fontSize: 13, color: isOverflow ? '#cf1322' : undefined }}>
              时序联动指示器
            </Text>
          </Space>

          <Tooltip title={`语音资产 (voiceAudio) 共 ${voiceClipCount} 句音频片段，为视频主时钟`}>
            <Tag color={isVoiceReady ? 'blue' : 'default'} className="timing-badge-tag">
              <SoundOutlined /> 语音: {(voiceDurationMs / 1000).toFixed(1)}s ({voiceClipCount} 句)
            </Tag>
          </Tooltip>

          <Tooltip title={`当前时间轴共有 ${boardClipCount} 个板书 (board) 动作与停留片段`}>
            <Tag color="cyan" className="timing-badge-tag">
              ✍️ 板书: {(boardDurationMs / 1000).toFixed(1)}s ({boardClipCount} 片段)
            </Tag>
          </Tooltip>

          {deviationMs !== null && (
            <Tooltip
              title={
                isOverflow
                  ? `板书时长超出语音主时钟 ${(deviationMs / 1000).toFixed(2)}s，超出部分无对应口播！`
                  : isAligned
                  ? '板书与语音总时长严格吻合'
                  : `板书在语音结束前 ${(Math.abs(deviationMs) / 1000).toFixed(2)}s 提前完成书写，随后静态留场`
              }
            >
              {isOverflow ? (
                <Tag color="error" icon={<WarningFilled />} className="timing-badge-tag" style={{ fontWeight: 600 }}>
                  偏差: +{deviationSec}s (时序溢出)
                </Tag>
              ) : isAligned ? (
                <Tag color="success" icon={<CheckCircleFilled />} className="timing-badge-tag">
                  偏差: ±0.0s (已对齐)
                </Tag>
              ) : (
                <Tag color="processing" icon={<CheckCircleOutlined />} className="timing-badge-tag">
                  偏差: -{deviationSec}s (留场)
                </Tag>
              )}
            </Tooltip>
          )}
        </Space>

        <Space size="small">
          {isOverflow ? (
            <span
              style={{
                color: '#cf1322',
                fontWeight: 600,
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertOutlined /> 存在时序溢出风险
            </span>
          ) : isVoiceReady ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              音频主时钟运转正常
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              等待生成语音音频
            </Text>
          )}
        </Space>
      </div>

      {/* 视觉对比比例条 */}
      {voiceDurationMs > 0 && (
        <div
          className="timing-progress-strip"
          title={`语音: ${(voiceDurationMs / 1000).toFixed(1)}s / 板书: ${(boardDurationMs / 1000).toFixed(1)}s`}
        >
          <div className="timing-progress-fill-board" style={{ width: `${boardNormalWidthPct}%` }} />
          {overflowWidthPct > 0 && (
            <div className="timing-progress-fill-overflow" style={{ width: `${overflowWidthPct}%` }} />
          )}
        </div>
      )}

      {/* 出现时序溢出时的醒目提示 Banner */}
      {isOverflow && (
        <div className="timing-overflow-alert-box">
          <span className="overflow-tag-badge">时序溢出警告</span>
          <div className="overflow-message-content">
            <strong>
              ⚠️ 检测到 timeline 板书总时长超出语音 (voiceAudio) 资产 +{(overflowDurationMs / 1000).toFixed(1)}s！
            </strong>
            {boardMaxEndMs > voiceMaxEndMs && (
              <span style={{ marginLeft: 6 }}>
                （最晚板书在 {(boardMaxEndMs / 1000).toFixed(1)}s 结束，超出语音终点 {(voiceMaxEndMs / 1000).toFixed(1)}s）
              </span>
            )}
            <div style={{ marginTop: 2, fontSize: 12, opacity: 0.95 }}>
              微课生成规范中以 A 轨语音为主时钟。板书超时会导致画面静止或播放延后，请在下方时间轴微调板书片段的起止时间或书写速度。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ isDone, label }: { isDone: boolean; label: string }) {
  return (
    <span className={isDone ? 'studio-status-pill is-done' : 'studio-status-pill'}>
      {isDone ? <CheckCircleFilled /> : <ClockCircleFilled />}
      {label}
    </span>
  );
}

