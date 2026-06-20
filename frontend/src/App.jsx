import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  FileCode,
  Folder,
  Play,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  Copy,
  Check,
  Loader2,
  FileText
} from 'lucide-react';

const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:5001' : window.location.origin;

export default function App() {
  // Status and connection state
  const [statusChecked, setStatusChecked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [ollamaHost, setOllamaHost] = useState('');
  const [workspaceDir, setWorkspaceDir] = useState('');
  
  // Models state
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState({ status: '', percentage: 0, completed: 0, total: 0 });
  const [pullError, setPullError] = useState('');
  const [selectedModelToDownload, setSelectedModelToDownload] = useState('qwen2.5-coder:1.5b');
  const [customModelToDownload, setCustomModelToDownload] = useState('');

  // Generation state
  const [prompt, setPrompt] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [logs, setLogs] = useState([]);
  const [project, setProject] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [copied, setCopied] = useState(false);

  const consoleEndRef = useRef(null);

  // Auto scroll console logs
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Initial setup check
  useEffect(() => {
    checkBackendStatus();
  }, []);

  const checkBackendStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/status`);
      const data = await res.json();
      setConnected(data.connected);
      setOllamaHost(data.ollamaHost);
      setWorkspaceDir(data.workspaceDir);
      setStatusChecked(true);
      
      if (data.connected) {
        fetchModels();
      }
    } catch (err) {
      setConnected(false);
      setStatusChecked(true);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/models`);
      const data = await res.json();
      if (data.success) {
        setModels(data.models);
        if (data.models.length > 0 && !selectedModel) {
          // Look for qwen coder or llama, otherwise default to first
          const coderModel = data.models.find(m => m.name.includes('qwen2.5-coder') || m.name.includes('qwen'));
          setSelectedModel(coderModel ? coderModel.name : data.models[0].name);
        }
      }
    } catch (err) {
      addLog('Failed to fetch models list.', 'error');
    }
  };

  const addLog = (content, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, content, type }]);
  };

  const handlePullModel = async (modelName) => {
    if (!modelName) return;
    setIsPulling(true);
    setPullError('');
    setPullProgress({ status: 'Starting download...', percentage: 0, completed: 0, total: 0 });
    addLog(`Initiating download for model: ${modelName}`, 'status');

    try {
      const es = new EventSource(`${BACKEND_URL}/api/pull/${encodeURIComponent(modelName)}`);
      
      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.error) {
          setPullError(data.error);
          addLog(`Download error: ${data.error}`, 'error');
          es.close();
          setIsPulling(false);
        } else if (data.status === 'success') {
          addLog(`Successfully pulled and loaded model: ${modelName}`, 'success');
          es.close();
          setIsPulling(false);
          setPullProgress({ status: 'Completed', percentage: 100, completed: 0, total: 0 });
          fetchModels();
        } else {
          let percentage = 0;
          if (data.total) {
            percentage = Math.round((data.completed / data.total) * 100);
          }
          setPullProgress({
            status: data.status,
            percentage,
            completed: data.completed || 0,
            total: data.total || 0
          });
        }
      };

      es.onerror = () => {
        setPullError('Lost connection to backend server while pulling model.');
        es.close();
        setIsPulling(false);
      };
    } catch (err) {
      setPullError(err.message);
      setIsPulling(false);
    }
  };

  const handleDeleteModel = async (modelName) => {
    if (!window.confirm(`Are you sure you want to delete model '${modelName}'?`)) return;
    addLog(`Deleting model: ${modelName}`, 'status');
    try {
      const res = await fetch(`${BACKEND_URL}/api/delete-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Successfully deleted model: ${modelName}`, 'success');
        fetchModels();
        setSelectedModel('');
      } else {
        addLog(`Failed to delete model: ${data.message}`, 'error');
      }
    } catch (err) {
      addLog(`Error deleting model: ${err.message}`, 'error');
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || !selectedModel || isGenerating) return;

    setIsGenerating(true);
    setLogs([]);
    setProject(null);
    setActiveFile(null);
    addLog(`Starting project generation using model: ${selectedModel}`, 'status');
    addLog(`User prompt: "${prompt}"`, 'info');

    try {
      const response = await fetch(`${BACKEND_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: selectedModel, outputPath })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Server returned an error');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.trim()) continue;

          const lines = part.split('\n');
          let eventName = '';
          let eventData = null;

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventName = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                eventData = JSON.parse(line.substring(6).trim());
              } catch (e) {
                // Ignore incomplete line parse
              }
            }
          }

          if (eventName && eventData) {
            handleServerEvent(eventName, eventData);
          }
        }
      }
    } catch (err) {
      addLog(err.message, 'error');
      setIsGenerating(false);
    }
  };

  const handleServerEvent = (event, data) => {
    switch (event) {
      case 'status':
        addLog(data.message, 'status');
        break;
      case 'plan':
        addLog(`Planned project structure: ${data.projectTitle}`, 'info');
        setProject({
          title: data.projectTitle,
          description: data.description,
          files: data.files.map(filePath => ({
            path: filePath,
            content: '',
            status: 'pending'
          }))
        });
        break;
      case 'file_written':
        addLog(`[File Written] ${data.path}`, 'success');
        setProject(prev => {
          if (!prev) return null;
          const updated = prev.files.map(f => {
            if (f.path === data.path) {
              return { ...f, content: data.content, status: 'completed' };
            }
            return f;
          });
          return { ...prev, files: updated };
        });
        // Set this file as active so user can preview it immediately
        setActiveFile({ path: data.path, content: data.content });
        break;
      case 'completed':
        addLog(`✨ Generation completed. Files written to workspace.`, 'success');
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            slug: data.projectSlug,
            path: data.projectPath
          };
        });
        setIsGenerating(false);
        break;
      case 'error':
        addLog(`Generation Failed: ${data.message}`, 'error');
        setIsGenerating(false);
        break;
      default:
        break;
    }
  };

  const copyToClipboard = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectFile = (file) => {
    if (file.status === 'completed') {
      setActiveFile(file);
    }
  };

  // Helper formatting for bytes
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="app-container">
      {/* Header bar */}
      <header>
        <div className="logo-section">
          <span className="logo-icon"><Cpu size={24} strokeWidth={2.5} /></span>
          <h1 className="logo-title">DevAssist Engine</h1>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
          <span>{connected ? 'Ollama Online' : 'Ollama Offline'}</span>
          <button onClick={checkBackendStatus} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem', marginLeft: '8px' }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <div className="main-workspace">
        {/* Left Sidebar */}
        <div className="sidebar">
          {/* Section 1: Model Manager */}
          <div className="sidebar-section">
            <h2 className="sidebar-title">LLM Configuration</h2>
            <div className="card model-selection-box">
              {connected ? (
                <>
                <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                  Active Generation Model
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    className="select-dropdown"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isGenerating || isPulling}
                    style={{ flexGrow: 1 }}
                  >
                    {models.length === 0 ? (
                      <option value="">No models installed</option>
                    ) : (
                      models.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({formatBytes(m.size)})
                        </option>
                      ))
                    )}
                  </select>
                  {selectedModel && (
                    <button
                      onClick={() => handleDeleteModel(selectedModel)}
                      className="btn btn-secondary"
                      style={{ padding: '10px 12px', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                      title="Delete Model"
                      disabled={isGenerating || isPulling}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

                  {models.length === 0 && !isPulling && (
                    <div style={{ padding: '8px', background: 'var(--color-warning-alpha)', border: '1px dashed var(--color-warning)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                      <AlertTriangle size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      No local LLM model found. Download a model to enable generation.
                    </div>
                  )}

                  {!isPulling ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <button
                        onClick={() => handlePullModel('qwen2.5-coder:1.5b')}
                        className="btn btn-primary"
                        disabled={isGenerating}
                      >
                        <Download size={14} /> Pull qwen2.5-coder (1.5B)
                      </button>
                      
                      <div style={{ borderTop: '1px solid var(--border-color)', margin: '8px 0' }}></div>
                      
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          className="select-dropdown"
                          placeholder="Or search other (e.g. llama3.2)"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          style={{ flexGrow: 1 }}
                        />
                        <button
                          onClick={() => handlePullModel(customModel)}
                          className="btn btn-secondary"
                          style={{ padding: '8px 12px' }}
                          disabled={!customModel || isGenerating}
                        >
                          Pull
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="download-progress">
                      <div className="progress-text">
                        <span style={{ fontWeight: '500' }}>{pullProgress.status}</span>
                        <span>{pullProgress.percentage}%</span>
                      </div>
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${pullProgress.percentage}%` }}></div>
                      </div>
                      {pullProgress.total > 0 && (
                        <div className="progress-text" style={{ color: 'var(--text-dark)' }}>
                          <span>Loaded: {formatBytes(pullProgress.completed)}</span>
                          <span>Total: {formatBytes(pullProgress.total)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {pullError && (
                    <div style={{ color: 'var(--color-error)', fontSize: '0.75rem', marginTop: '6px' }}>
                      Failed to pull: {pullError}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '10px 0' }}>
                  <AlertTriangle size={24} style={{ color: 'var(--color-warning)', marginBottom: '8px' }} />
                  <p>Cannot reach Ollama server.</p>
                  <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>Please check connection using the status bar.</p>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: File Tree Explorer */}
          {project && (
            <div className="sidebar-section file-explorer">
              <h2 className="sidebar-title">Project File Explorer</h2>
              <div className="card" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Folder size={14} className="log-status" /> {project.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '2px', wordBreak: 'break-all' }}>
                    {project.slug || 'generating...'}
                  </div>
                </div>
                <div className="file-tree-container">
                  {project.files.map((file) => (
                    <div
                      key={file.path}
                      className={`file-item ${activeFile?.path === file.path ? 'active' : ''} ${file.status === 'pending' ? 'pending' : ''}`}
                      onClick={() => handleSelectFile(file)}
                      style={{ cursor: file.status === 'completed' ? 'pointer' : 'default', opacity: file.status === 'completed' ? 1 : 0.5 }}
                    >
                      {file.status === 'completed' ? (
                        <FileCode size={14} />
                      ) : (
                        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                      )}
                      <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.path}
                      </span>
                      {file.status === 'completed' && <span style={{ fontSize: '0.7rem', color: 'var(--color-success)' }}>Ready</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Dashboard Workspace Grid */}
        <div className="main-panel">
          {connected && models.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
              <div style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)', padding: '20px', borderRadius: '50%', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Cpu size={48} strokeWidth={1.5} />
              </div>
              <h2 style={{ fontSize: '1.75rem', fontWeight: '700', marginBottom: '12px', letterSpacing: '-0.02em' }}>Download a Local LLM Model</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '0.9rem', lineHeight: '1.6' }}>
                DevAssist runs entirely offline. We couldn't find any downloaded models on your Ollama server. 
                Please choose a model below to pull and unlock the codebase generator.
              </p>
              
              {!isPulling ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'left' }}>
                    <div 
                      className="card"
                      onClick={() => setSelectedModelToDownload('qwen2.5-coder:1.5b')}
                      style={{ 
                        cursor: 'pointer', 
                        border: selectedModelToDownload === 'qwen2.5-coder:1.5b' ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', 
                        background: selectedModelToDownload === 'qwen2.5-coder:1.5b' ? 'var(--color-primary-alpha)' : 'var(--bg-input)',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      <h3 style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyItems: 'center', gap: '8px' }}>
                        qwen2.5-coder:1.5b {selectedModelToDownload === 'qwen2.5-coder:1.5b' && <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>✔</span>}
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>Recommended. 1.6 GB. Blazing fast coding model with great accuracy.</p>
                    </div>
                    
                    <div 
                      className="card"
                      onClick={() => setSelectedModelToDownload('llama3.2:1b')}
                      style={{ 
                        cursor: 'pointer', 
                        border: selectedModelToDownload === 'llama3.2:1b' ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', 
                        background: selectedModelToDownload === 'llama3.2:1b' ? 'var(--color-primary-alpha)' : 'var(--bg-input)',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      <h3 style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyItems: 'center', gap: '8px' }}>
                        llama3.2:1b {selectedModelToDownload === 'llama3.2:1b' && <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>✔</span>}
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>Ultra-lightweight. 1.3 GB. Fits perfectly on 8GB machines.</p>
                    </div>

                    <div 
                      className="card"
                      onClick={() => setSelectedModelToDownload('llama3.2:3b')}
                      style={{ 
                        cursor: 'pointer', 
                        border: selectedModelToDownload === 'llama3.2:3b' ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', 
                        background: selectedModelToDownload === 'llama3.2:3b' ? 'var(--color-primary-alpha)' : 'var(--bg-input)',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      <h3 style={{ fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyItems: 'center', gap: '8px' }}>
                        llama3.2:3b {selectedModelToDownload === 'llama3.2:3b' && <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>✔</span>}
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>Balanced standard. 2.0 GB. Better reasoning and output syntax.</p>
                    </div>

                    <div 
                      className="card"
                      onClick={() => setSelectedModelToDownload('custom')}
                      style={{ 
                        cursor: 'pointer', 
                        border: selectedModelToDownload === 'custom' ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', 
                        background: selectedModelToDownload === 'custom' ? 'var(--color-primary-alpha)' : 'var(--bg-input)',
                        transition: 'all var(--transition-fast)'
                      }}
                    >
                      <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '4px' }}>Custom Model</h3>
                      <input 
                        type="text" 
                        placeholder="e.g. qwen2.5-coder:7b" 
                        value={customModelToDownload} 
                        onChange={(e) => {
                          setCustomModelToDownload(e.target.value);
                          setSelectedModelToDownload('custom');
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedModelToDownload('custom');
                        }}
                        style={{ 
                          width: '100%', 
                          background: 'var(--bg-card)', 
                          color: 'var(--text-main)', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: 'var(--radius-sm)', 
                          padding: '6px 8px', 
                          fontSize: '0.8rem',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      const target = selectedModelToDownload === 'custom' ? customModelToDownload : selectedModelToDownload;
                      if (target) handlePullModel(target);
                    }}
                    className="btn btn-primary"
                    style={{ padding: '14px 28px', fontSize: '1rem', width: '100%', borderRadius: 'var(--radius-md)', gap: '8px' }}
                    disabled={selectedModelToDownload === 'custom' && !customModelToDownload}
                  >
                    <Download size={18} /> Pull selected model
                  </button>
                </div>
              ) : (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-input)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div className="progress-text" style={{ fontSize: '0.9rem', fontWeight: '600' }}>
                    <span>{pullProgress.status}</span>
                    <span>{pullProgress.percentage}%</span>
                  </div>
                  <div className="progress-bar-bg" style={{ height: '8px' }}>
                    <div className="progress-bar-fill" style={{ width: `${pullProgress.percentage}%` }}></div>
                  </div>
                  {pullProgress.total > 0 && (
                    <div className="progress-text" style={{ color: 'var(--text-muted)' }}>
                      <span>Downloaded: {formatBytes(pullProgress.completed)}</span>
                      <span>Total size: {formatBytes(pullProgress.total)}</span>
                    </div>
                  )}
                </div>
              )}
              {pullError && (
                <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginTop: '16px', background: 'var(--color-error-alpha)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-sm)', padding: '8px 16px', width: '100%' }}>
                  Failed to download: {pullError}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Top prompt input */}
              <div className="generator-input-container">
                <form onSubmit={handleGenerate} className="prompt-form">
                  <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <input
                      type="text"
                      className="select-dropdown"
                      placeholder="Project Destination Directory (Optional. Default: auto-created subfolder in workspace)"
                      value={outputPath}
                      onChange={(e) => setOutputPath(e.target.value)}
                      style={{ width: '100%', fontSize: '0.85rem', padding: '10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', outline: 'none' }}
                      disabled={isGenerating}
                    />
                  </div>
                  <div className="prompt-textarea-wrapper">
                    <textarea
                      className="prompt-textarea"
                      placeholder="Ask DevAssist to generate a project (e.g. 'Create a full node.js express app with basic authentication and database storage using a local json file')"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={!connected || isGenerating || isPulling || models.length === 0}
                    />
                    <button
                      type="submit"
                      className="prompt-submit-btn"
                      disabled={!connected || isGenerating || !prompt.trim() || isPulling || models.length === 0}
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    </button>
                  </div>
                </form>
              </div>

              {/* Bottom output console/editor split */}
              <div className="output-workspace">
                {/* Terminal console logger */}
                <div className="terminal-console">
                  <div className="console-header">
                    <span className="console-title">
                      <TerminalIcon size={14} /> Log Terminal Console
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                      {isGenerating ? 'Generating...' : 'Idle'}
                    </span>
                  </div>
                  <div className="console-body">
                    {logs.length === 0 && (
                      <div style={{ color: 'var(--text-dark)', fontStyle: 'italic', padding: '10px 0' }}>
                        &gt; Console ready. Enter a prompt above to start generating code...
                      </div>
                    )}
                    {logs.map((log, idx) => (
                      <div key={idx} className="log-entry">
                        <span className="log-timestamp">[{log.timestamp}]</span>
                        <span className={`log-content log-${log.type}`}>
                          {log.type === 'status' ? '⚙️ ' : ''}
                          {log.type === 'success' ? '✔ ' : ''}
                          {log.type === 'error' ? '✖ ' : ''}
                          {log.content}
                        </span>
                      </div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                </div>

                {/* Code Viewer Panel */}
                <div className="code-viewer-panel">
                  <div className="code-viewer-header">
                    <div className="code-file-info">
                      <FileText size={14} className="log-status" />
                      <span className="code-file-name">
                        {activeFile ? activeFile.path : 'Preview Code File'}
                      </span>
                    </div>
                    {activeFile && (
                      <button onClick={copyToClipboard} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }}>
                        {copied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                  <div className="code-viewer-body">
                    {activeFile ? (
                      <pre className="code-pre">
                        <code>{activeFile.content}</code>
                      </pre>
                    ) : (
                      <div className="empty-state">
                        <FileCode size={48} className="empty-state-icon" />
                        <h3>No file selected</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-dark)', marginTop: '6px', maxWidth: '300px' }}>
                          Select a file from the explorer tree or submit a prompt to generate files.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
