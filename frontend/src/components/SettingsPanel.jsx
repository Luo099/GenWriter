import { useState, useEffect, useCallback } from 'react';
import * as llmApi from '../api/llmProviders';
import * as settingsApi from '../api/settings';
import SelectField from './SelectField';
import PageHeading from './PageHeading';
import ThemeSettings from './ThemeSettings';

const SettingsPanel = () => {
  const [providers, setProviders] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [switchingProvider, setSwitchingProvider] = useState(null);
  const [selectedModels, setSelectedModels] = useState({});
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [outputSettings, setOutputSettings] = useState({
    markdownEnabled: true,
    format: 'markdown',
    ghostwriteApplyMode: 'DIRECT_SNAPSHOT',
  });
  const [savingOutputSettings, setSavingOutputSettings] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providersData, activeData, outputData] = await Promise.all([
        llmApi.getAllProviders(),
        llmApi.getActiveModel(),
        settingsApi.getWritingOutputSettings(),
      ]);
      setProviders(providersData || []);
      setActiveModel(activeData || {});
      setOutputSettings({
        markdownEnabled: outputData?.markdownEnabled ?? true,
        format: outputData?.format || 'markdown',
        ghostwriteApplyMode: outputData?.ghostwriteApplyMode || 'DIRECT_SNAPSHOT',
      });

      // 初始化每个供应商的选中模型
      const models = {};
      (providersData || []).forEach((p) => {
        models[p.type] = p.activeModel;
      });
      setSelectedModels(models);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleModelChange = (providerType, modelName) => {
    setSelectedModels((prev) => ({ ...prev, [providerType]: modelName }));
  };

  const handleSwitchModel = async (providerType) => {
    const modelName = selectedModels[providerType];
    if (!modelName) return;
    setSwitchingProvider(providerType);
    try {
      await llmApi.switchModel(providerType, modelName);
      await fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSwitchingProvider(null);
    }
  };

  const handleTestConnection = async (providerType) => {
    setTestingProvider(providerType);
    setTestResults((prev) => ({ ...prev, [providerType]: null }));
    try {
      const result = await llmApi.testConnection(providerType);
      setTestResults((prev) => ({ ...prev, [providerType]: result }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [providerType]: { success: false, message: e.message },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const handleMarkdownToggle = async () => {
    const nextValue = !outputSettings.markdownEnabled;
    setSavingOutputSettings(true);
    setError(null);
    try {
      const updated = await settingsApi.updateWritingOutputSettings({ markdownEnabled: nextValue });
      setOutputSettings((prev) => ({
        ...prev,
        ...(updated || {}),
        markdownEnabled: updated?.markdownEnabled ?? nextValue,
        format: updated?.format || (nextValue ? 'markdown' : 'plain'),
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingOutputSettings(false);
    }
  };

  const handleGhostwriteModeChange = async (nextMode) => {
    if (!nextMode || nextMode === outputSettings.ghostwriteApplyMode) return;
    setSavingOutputSettings(true);
    setError(null);
    try {
      const updated = await settingsApi.updateWritingOutputSettings({ ghostwriteApplyMode: nextMode });
      setOutputSettings((prev) => ({
        ...prev,
        ...(updated || {}),
        ghostwriteApplyMode: updated?.ghostwriteApplyMode || nextMode,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingOutputSettings(false);
    }
  };


  return (
    <div className="settings-panel">
      <PageHeading title="设置" />
      <ThemeSettings />

      {error && (
        <div className="settings-error">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* 当前激活模型 */}
      {activeModel && (
        <div className="settings-active-bar">
          <div className="settings-active-indicator" />
          <div className="settings-active-info">
            <span className="settings-active-label">当前模型</span>
            <span className="settings-active-value">
              {activeModel.displayName} / {activeModel.modelName}
            </span>
          </div>
        </div>
      )}

      {loading && !providers.length && <p className="settings-model-loading" role="status">加载模型…</p>}
      {/* 供应商列表 */}
      <div className="settings-provider-list">
        <div className="settings-provider-card settings-output-card">
          <div className="settings-provider-header settings-output-header"><span className="settings-provider-name">输出格式</span><span className="settings-runtime-tag">本次运行</span></div>
          <div className="settings-provider-body">
            <div className="settings-toggle-row">
              <div>
                <div className="settings-toggle-title">Markdown</div>

              </div>
              <button
                type="button"
                aria-label="允许 Markdown 格式" className={`settings-toggle ${outputSettings.markdownEnabled ? 'active' : ''}`}
                onClick={handleMarkdownToggle}
                disabled={savingOutputSettings}
                aria-pressed={outputSettings.markdownEnabled}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </div>
        </div>

        <div className="settings-provider-card settings-output-card">
          <div className="settings-provider-header settings-output-header">
            <span className="settings-provider-name">代笔写入策略</span>
            <span className="settings-runtime-tag">互斥选择 · 自动持久化</span>
          </div>
          <div className="settings-provider-body">
            <div className="settings-apply-mode-group" role="radiogroup" aria-label="代笔写入策略">
              <button
                type="button"
                role="radio"
                aria-checked={outputSettings.ghostwriteApplyMode !== 'STAGED_CANDIDATE'}
                disabled={savingOutputSettings}
                className={`settings-apply-mode-option ${outputSettings.ghostwriteApplyMode !== 'STAGED_CANDIDATE' ? 'active' : ''}`}
                onClick={() => handleGhostwriteModeChange('DIRECT_SNAPSHOT')}
              >
                <div className="settings-apply-mode-head">
                  <strong>直接写入并保留版本快照</strong>
                  <span className="settings-provider-badge settings-output-badge">默认 · 实时同步</span>
                </div>
                <p>代笔 Agent 修改或创建章节后立即生成新版本快照并实时刷新工作区，支持整轮一键撤销或版本历史回溯。</p>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={outputSettings.ghostwriteApplyMode === 'STAGED_CANDIDATE'}
                disabled={savingOutputSettings}
                className={`settings-apply-mode-option ${outputSettings.ghostwriteApplyMode === 'STAGED_CANDIDATE' ? 'active' : ''}`}
                onClick={() => handleGhostwriteModeChange('STAGED_CANDIDATE')}
              >
                <div className="settings-apply-mode-head">
                  <strong>暂存为待审变更（Diff 审查）</strong>
                  <span className="settings-provider-badge settings-output-badge">原子采纳</span>
                </div>
                <p>代笔 Agent 在本轮内仅写入待审变更集（同一轮后续阅读/审校可见），完成后查看逐行 Diff 并统一采纳或放弃。</p>
              </button>
            </div>
          </div>
        </div>

        {providers.map((provider) => {
          const isActive = provider.isActive;
          const selectedModel = selectedModels[provider.type] || provider.activeModel;
          const testResult = testResults[provider.type];

          return (
            <div
              key={provider.type}
              className={`settings-provider-card ${isActive ? 'active' : ''}`}
            >
              <div className="settings-provider-header">
                <div className="settings-provider-title-row">
                  <span className="settings-provider-mark" aria-hidden="true">{(provider.displayName || provider.type).slice(0, 1)}</span>
                  <span className="settings-provider-name">{provider.displayName}</span>
                  {isActive && <span className="settings-active-tag">使用中</span>}
                </div>
                <div className="settings-provider-meta">
                  <span className="settings-api-key">
                    密钥： {provider.apiKey}
                  </span>
                  {provider.baseUrl && (
                    <span className="settings-base-url">
                      地址： {provider.baseUrl}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-provider-body">
                <div className="settings-model-select-row">
                  <label className="settings-model-label">选择模型</label>
                  <SelectField className="settings-model-select" aria-label={`选择 ${provider.type} 模型`} value={selectedModel} onChange={(value) => handleModelChange(provider.type, value)}
                    options={(provider.models || []).map((model) => ({ value: model, label: model }))} />
                  <button
                    className="settings-switch-btn"
                    disabled={
                      switchingProvider === provider.type ||
                      (isActive && selectedModel === provider.activeModel)
                    }
                    onClick={() => handleSwitchModel(provider.type)}
                  >
                    {switchingProvider === provider.type ? '切换中...' : '切换'}
                  </button>
                </div>

                <div className="settings-provider-actions">
                  <button
                    className="settings-test-btn"
                    disabled={testingProvider === provider.type}
                    onClick={() => handleTestConnection(provider.type)}
                  >
                    {testingProvider === provider.type ? '测试中...' : '测试连接'}
                  </button>
                  {testResult && (
                    <span
                      className={`settings-test-result ${testResult.success ? 'success' : 'fail'}`}
                    >
                      {testResult.success ? '连接成功' : testResult.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>


    </div>
  );
};

export default SettingsPanel;
