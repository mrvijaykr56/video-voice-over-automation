import { useState, useEffect, useRef } from 'react';
import { 
  UploadCloud, 
  Play, 
  FileText, 
  Sparkles, 
  Settings, 
  Tv, 
  RefreshCw, 
  AlertTriangle, 
  Download, 
  Loader,
  Video,
  Clock,
  Volume2,
  Music,
  Trash2
} from 'lucide-react';

const API_BASE_URL = 'http://127.0.0.1:8000';
const WS_BASE_URL = 'ws://127.0.0.1:8000';

const getStatusClass = (status) => {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'PENDING':
      return 'pending';
    default:
      return 'processing';
  }
};

const formatJobDate = (dateStr) => {
  if (!dateStr) return '';
  let isoStr = dateStr;
  if (!isoStr.endsWith('Z') && !isoStr.includes('+') && !isoStr.includes('-')) {
    if (isoStr.includes(' ')) {
      isoStr = isoStr.replace(' ', 'T');
    }
    isoStr = isoStr + 'Z';
  }
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return new Date(isoStr).toLocaleString();
  }
};

function App() {
  // Navigation tab state
  const [activeTab, setActiveTab] = useState('video_sync');

  // File upload state
  const [videoFile, setVideoFile] = useState(null);
  const [scriptFile, setScriptFile] = useState(null);
  const videoInputRef = useRef(null);

  // Script to MP3 state
  const [scriptText, setScriptText] = useState('');
  const [audioScriptFile, setAudioScriptFile] = useState(null);
  const audioScriptInputRef = useRef(null);

  // Form options state
  const [language, setLanguage] = useState('en');
  const [voiceGender, setVoiceGender] = useState('male');
  const [syncMode, setSyncMode] = useState('scene');
  const [watermarkText] = useState('');
  const [captionStyle, setCaptionStyle] = useState('active_word');
  const [fontName, setFontName] = useState('Arial');
  const [fontSize, setFontSize] = useState(24);
  const [bgmFile, setBgmFile] = useState(null);
  const [bgmName, setBgmName] = useState('none');
  const [bgmVolume, setBgmVolume] = useState(10);
  const [ttsEngine, setTtsEngine] = useState('edge-tts');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [polishScript, setPolishScript] = useState(true);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [azureSpeechKey, setAzureSpeechKey] = useState('');
  const [azureSpeechRegion, setAzureSpeechRegion] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const [voiceStyle, setVoiceStyle] = useState('default');

  // App flow state
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [jobsList, setJobsList] = useState([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  
  // Preview video URL
  const [previewUrl, setPreviewUrl] = useState(null);

  // Storage cleanup state
  const [isClearing, setIsClearing] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState(null);

  const socketRef = useRef(null);

  const fetchJobs = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/jobs`);
      if (response.ok) {
        const data = await response.json();
        setJobsList(data);
      }
    } catch (err) {
      console.error("Error fetching jobs:", err);
    }
  };

  const handleClearTempFiles = async () => {
    const confirmClear = window.confirm(
      "Are you sure you want to clear temporary files? This will delete uploaded files, custom audio files, and synced video files that are no longer active, while keeping all final generated video outputs. This cannot be undone."
    );
    if (!confirmClear) return;

    setIsClearing(true);
    setError(null);
    setCleanupStatus(null);

    try {
      const response = await fetch(`${API_BASE_URL}/cleanup_temp_files`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setCleanupStatus(
          `Successfully deleted ${data.deleted_count} temporary files (${data.freed_space} freed).`
        );
        // Automatically hide the status message after 10 seconds
        setTimeout(() => {
          setCleanupStatus(null);
        }, 10000);
      } else {
        const errText = await response.text();
        setError(`Failed to clear temporary files: ${errText}`);
      }
    } catch (err) {
      console.error("Error clearing temporary files:", err);
      setError("An error occurred while clearing temporary files.");
    } finally {
      setIsClearing(false);
    }
  };

  // Fetch past jobs on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
  }, []);

  // Update default voice name based on language and gender selection
  useEffect(() => {
    if (['azure-tts', 'edge-tts', 'edge-dynamic'].includes(ttsEngine)) {
      if (language === 'hi') {
        if (voiceGender === 'female') {
          if (!['hi-IN-SwaraNeural', 'hi-IN-SapnaNeural', 'hi-IN-AditiNeural', 'hi-IN-NehaNeural'].includes(voiceName)) {
            setVoiceName('hi-IN-SwaraNeural');
          }
        } else {
          setVoiceName('hi-IN-MadhurNeural');
        }
      } else if (language === 'en') {
        setVoiceName(voiceGender === 'female' ? 'en-US-AriaNeural' : 'en-US-GuyNeural');
      } else if (language === 'en-in') {
        setVoiceName(voiceGender === 'female' ? 'en-IN-NeerjaExpressiveNeural' : 'en-IN-PrabhatNeural');
      }
    } else {
      setVoiceName('');
    }
  }, [ttsEngine, language, voiceGender]);

  // Reset style if Swara voice is not selected
  useEffect(() => {
    if (voiceName !== 'hi-IN-SwaraNeural') {
      setVoiceStyle('default');
    }
  }, [voiceName]);

  // Track active job via websocket
  useEffect(() => {
    if (!activeJobId) return;

    // Connect WebSocket
    const wsUrl = `${WS_BASE_URL}/ws/job/${activeJobId}`;
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket update:", data);
        setActiveJob(data);

        // If completed, failed, or cancelled, fetch list and refresh
        if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'CANCELLED') {
          if (data.status === 'COMPLETED') {
            setPreviewUrl(data.final_video_url);
          }
          fetchJobs();
        }
      } catch (err) {
        console.error("Error parsing socket message:", err);
      }
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    socket.onclose = () => {
      console.log("WebSocket closed");
    };

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [activeJobId]);

  const handleVideoDragOver = (e) => {
    e.preventDefault();
  };

  const handleVideoDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setError(null);
      } else {
        setError("Invalid file type. Please upload an MP4 or other video file.");
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setPreviewUrl(null);
    setActiveJob(null);

    if (activeTab === 'video_sync') {
      if (!videoFile || !scriptText.trim()) {
        setError("Please select a video file and enter a script.");
        return;
      }

      setIsUploading(true);
      const formData = new FormData();
      formData.append('video', videoFile);
      const scriptBlob = new Blob([scriptText], { type: 'text/plain' });
      formData.append('script', scriptBlob, scriptFile ? scriptFile.name : 'script.txt');
      formData.append('language', language);
      formData.append('voice_gender', voiceGender);
      formData.append('sync_mode', syncMode);
      formData.append('watermark_text', watermarkText);
      formData.append('caption_style', captionStyle);
      formData.append('font_name', fontName);
      formData.append('font_size', fontSize);
      formData.append('bgm_name', bgmName);
      if (bgmName === 'custom' && bgmFile) {
        formData.append('bgm_file', bgmFile);
      }
      formData.append('bgm_volume', (bgmVolume / 100).toFixed(2));
      formData.append('tts_engine', ttsEngine);
      formData.append('elevenlabs_key', elevenLabsKey);
      formData.append('polish_script', polishScript ? 'true' : 'false');
      formData.append('voice_speed', voiceSpeed);
      formData.append('azure_speech_key', azureSpeechKey);
      formData.append('azure_speech_region', azureSpeechRegion);
      formData.append('voice_name', voiceName);
      formData.append('voice_style', voiceStyle);

      try {
        const response = await fetch(`${API_BASE_URL}/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errDetail = await response.text();
          throw new Error(errDetail || "Failed to start voice-over pipeline.");
        }

        const result = await response.json();
        setActiveJobId(result.job_id);
        setActiveJob({
          job_id: result.job_id,
          status: 'PENDING',
          progress: 0.0,
          job_type: 'video_sync'
        });
        setCurrentPage(1);
        fetchJobs();
        
        // Clear inputs
        setVideoFile(null);
        setScriptFile(null);
        setBgmFile(null);
      } catch (err) {
        setError(err.message || "An unexpected error occurred during upload.");
      } finally {
        setIsUploading(false);
      }
    } else {
      if (!scriptText && !audioScriptFile) {
        setError("Please provide script text or upload a script file.");
        return;
      }

      setIsUploading(true);
      const formData = new FormData();
      if (audioScriptFile) {
        formData.append('script', audioScriptFile);
      }
      if (scriptText) {
        formData.append('script_text', scriptText);
      }
      formData.append('language', language);
      formData.append('voice_gender', voiceGender);
      formData.append('tts_engine', ttsEngine);
      formData.append('elevenlabs_key', elevenLabsKey);
      formData.append('voice_speed', voiceSpeed);
      formData.append('azure_speech_key', azureSpeechKey);
      formData.append('azure_speech_region', azureSpeechRegion);
      formData.append('voice_name', voiceName);
      formData.append('voice_style', voiceStyle);

      try {
        const response = await fetch(`${API_BASE_URL}/upload_audio`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errDetail = await response.text();
          throw new Error(errDetail || "Failed to start audio synthesis.");
        }

        const result = await response.json();
        setActiveJobId(result.job_id);
        setActiveJob({
          job_id: result.job_id,
          status: 'PENDING',
          progress: 0.0,
          job_type: 'audio_only'
        });
        setCurrentPage(1);
        fetchJobs();
        
        // Clear inputs
        setScriptText('');
        setAudioScriptFile(null);
      } catch (err) {
        setError(err.message || "An unexpected error occurred during audio generation.");
      } finally {
        setIsUploading(false);
      }
    }
  };

  const selectJobForPreview = (job) => {
    setPreviewUrl(job.final_video_url);
    setActiveJobId(job.id);
    setActiveJob({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      job_type: job.job_type,
      error_message: job.error_message,
      final_video_url: job.final_video_url
    });
  };

  const handleCancelJob = async (jobId) => {
    if (!window.confirm("Are you sure you want to cancel this job?")) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/job/${jobId}/cancel`, {
        method: 'POST',
      });
      if (response.ok) {
        fetchJobs();
        if (activeJobId === jobId) {
          setActiveJob(prev => prev ? { ...prev, status: 'CANCELLED', progress: 100.0 } : null);
        }
      } else {
        const errDetail = await response.text();
        alert(errDetail || "Failed to cancel the job.");
      }
    } catch (err) {
      console.error("Error cancelling job:", err);
      alert("An error occurred while trying to cancel the job.");
    }
  };

  const renderProgressStepper = () => {
    if (!activeJob) return null;

    const isAudioOnly = activeJob.job_type === 'audio_only' || (jobsList.find(j => j.id === activeJob.job_id)?.job_type === 'audio_only');

    const steps = isAudioOnly ? [
      { key: 'PENDING', title: 'Job Queued', desc: 'Analyzing script and setting up tasks' },
      { key: 'GENERATING_TTS', title: 'TTS Voice-Over Generation', desc: 'Synthesizing script using edge-tts' },
    ] : [
      { key: 'PENDING', title: 'Job Queued', desc: 'Analyzing files and setting up tasks' },
      { key: 'GENERATING_TTS', title: 'TTS Voice-Over Generation', desc: 'Synthesizing script using edge-tts' },
      { key: 'SYNCING', title: 'Synchronization & Alignment', desc: syncMode === 'lipsync' ? 'Executing Wav2Lip lip sync' : 'Adjusting video scene timings to match audio' },
      { key: 'RENDERING', title: 'Final Muxing & Encoding', desc: 'Merging streams with FFmpeg H.264' },
    ];

    let currentStepIndex = 0;
    if (activeJob.status === 'GENERATING_TTS') currentStepIndex = 1;
    else if (activeJob.status === 'SYNCING') currentStepIndex = 2;
    else if (activeJob.status === 'RENDERING') currentStepIndex = 3;
    else if (activeJob.status === 'COMPLETED') currentStepIndex = isAudioOnly ? 2 : 4;
    else if (activeJob.status === 'FAILED' || activeJob.status === 'CANCELLED') {
      if (isAudioOnly) {
        if (activeJob.progress >= 99) currentStepIndex = 2;
        else if (activeJob.progress >= 10) currentStepIndex = 1;
        else currentStepIndex = 0;
      } else {
        if (activeJob.progress >= 99) currentStepIndex = 4;
        else if (activeJob.progress >= 70) currentStepIndex = 3;
        else if (activeJob.progress >= 40) currentStepIndex = 2;
        else if (activeJob.progress >= 10) currentStepIndex = 1;
        else currentStepIndex = 0;
      }
    }

    return (
      <div className="job-monitor-container">
        <h3 className="options-section-title">
          <Clock size={16} /> Job Progress: {Math.round(activeJob.progress)}%
        </h3>

        {activeJob.status === 'FAILED' && (
          <div className="error-banner">
            <AlertTriangle size={18} />
            <div>
              <strong>{isAudioOnly ? 'Synthesis Pipeline Failed' : 'Sync Pipeline Failed'}</strong>
              <div style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>{activeJob.error_message}</div>
            </div>
          </div>
        )}

        {activeJob.status === 'CANCELLED' && (
          <div className="cancel-banner">
            <AlertTriangle size={18} />
            <div>
              <strong>Job Cancelled</strong>
              <div style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>The process was cancelled by the user.</div>
            </div>
          </div>
        )}

        <div className="stepper">
          {steps.map((step, idx) => {
            let stepStatusClass = '';
            if ((activeJob.status === 'FAILED' || activeJob.status === 'CANCELLED') && idx >= currentStepIndex) {
              if (idx === currentStepIndex) {
                stepStatusClass = activeJob.status === 'FAILED' ? 'failed-step' : 'cancelled-step';
              }
            } else if (idx < currentStepIndex) {
              stepStatusClass = 'completed';
            } else if (idx === currentStepIndex) {
              stepStatusClass = 'active';
            }

            return (
              <div key={step.key} className={`step-item ${stepStatusClass}`}>
                <div className="step-indicator">
                  {idx < currentStepIndex ? (
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>✓</span>
                  ) : (activeJob.status === 'FAILED' && idx === currentStepIndex) ? (
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>✗</span>
                  ) : (activeJob.status === 'CANCELLED' && idx === currentStepIndex) ? (
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>✕</span>
                  ) : null}
                </div>
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </div>
            );
          })}
        </div>

        <div className="progress-bar-container">
          <div 
            className="progress-bar-fill" 
            style={{ 
              width: `${activeJob.progress}%`, 
              background: activeJob.status === 'FAILED' 
                ? 'var(--color-error)' 
                : activeJob.status === 'CANCELLED'
                ? 'var(--text-secondary)'
                : undefined 
            }}
          />
        </div>
      </div>
    );
  };

  // Pagination calculations
  const totalPages = Math.ceil(jobsList.length / rowsPerPage);
  const activePage = Math.max(1, Math.min(currentPage, totalPages));
  const indexOfLastRow = activePage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const currentJobsList = jobsList.slice(indexOfFirstRow, indexOfLastRow);

  const handleRowsPerPageChange = (e) => {
    setRowsPerPage(Number(e.target.value));
    setCurrentPage(1);
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (activePage > 3) {
        pages.push('ellipsis-start');
      }
      
      const start = Math.max(2, activePage - 1);
      const end = Math.min(totalPages - 1, activePage + 1);
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      if (activePage < totalPages - 2) {
        pages.push('ellipsis-end');
      }
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="brand-name text-gradient-purple-blue">Voice Sync</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>AI VOICE-OVER SYNC SYSTEM</p>
          </div>
        </div>
        <div className="system-status">
          <div className="system-status-dot"></div>
          Pipeline Status: Idle
        </div>
      </header>

      {/* Main Grid */}
      <main className="dashboard-grid">
        {/* Left Side: Upload Form & Options */}
        <section className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ borderBottom: 'none' }}>
            <h2 className="card-title text-gradient">
              {activeTab === 'video_sync' ? 'Create Sync Job' : 'Script to MP3 Audio'}
            </h2>
            <p className="card-description">
              {activeTab === 'video_sync' 
                ? 'Upload a script and talking video to automatically sync narration audio with visuals.' 
                : 'Convert script text or file to high-quality neural MP3 audio voice-overs.'}
            </p>
          </div>

          <div className="tabs-container">
            <button 
              type="button"
              className={`tab-btn ${activeTab === 'video_sync' ? 'active' : ''}`}
              onClick={() => { setActiveTab('video_sync'); setError(null); }}
            >
              <Video size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              Video-Voice Sync
            </button>
            <button 
              type="button"
              className={`tab-btn ${activeTab === 'audio_only' ? 'active' : ''}`}
              onClick={() => { setActiveTab('audio_only'); setError(null); }}
            >
              <Music size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              Script to MP3
            </button>
          </div>
          
          <form className="card-body" onSubmit={handleSubmit}>
            {error && (
              <div className="error-banner">
                <AlertTriangle size={18} />
                <span>{error}</span>
              </div>
            )}

            {activeTab === 'audio_only' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Script Text</label>
                  <textarea 
                    className="custom-textarea"
                    placeholder="Type or paste your script text here..."
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                  />
                </div>
                
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', margin: '-0.5rem 0' }}>— OR —</div>
                
                <div 
                  className="dropzone-container"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      const file = e.dataTransfer.files[0];
                      if (file.name.endsWith('.txt')) {
                        setAudioScriptFile(file);
                        setError(null);
                      } else {
                        setError("Invalid file type. Please upload a TXT file.");
                      }
                    }
                  }}
                  onClick={() => audioScriptInputRef.current?.click()}
                  style={{ minHeight: '120px', padding: '1.5rem 1rem' }}
                >
                  <input 
                    type="file" 
                    accept=".txt" 
                    className="hidden-input" 
                    ref={audioScriptInputRef}
                    onChange={(e) => setAudioScriptFile(e.target.files[0])}
                  />
                  <UploadCloud className="dropzone-icon" size={24} />
                  <div className="dropzone-text" style={{ fontSize: '0.85rem' }}>
                    {audioScriptFile ? "Script File Selected" : "Upload Script File"}
                  </div>
                  <div className="dropzone-subtext" style={{ fontSize: '0.7rem' }}>Drag & drop script (.txt)</div>
                  {audioScriptFile && (
                    <div className="file-pill" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                      <FileText size={10} /> {audioScriptFile.name}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Dual Upload Zone */
              <div className="upload-row">
                {/* Video Upload Dropzone */}
                <div 
                  className="dropzone-container"
                  onDragOver={handleVideoDragOver}
                  onDrop={handleVideoDrop}
                  onClick={() => videoInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    accept="video/*" 
                    className="hidden-input" 
                    ref={videoInputRef}
                    onChange={(e) => setVideoFile(e.target.files[0])}
                  />
                  <UploadCloud className="dropzone-icon" size={32} />
                  <div className="dropzone-text">
                    {videoFile ? "Video Selected" : "Upload Video"}
                  </div>
                  <div className="dropzone-subtext">Drag & drop talking video (MP4)</div>
                  {videoFile && (
                    <div className="file-pill" style={{ marginTop: '0.75rem' }}>
                      <Video size={12} /> {videoFile.name}
                    </div>
                  )}
                </div>

                {/* Script Upload Dropzone & Text Area */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0 }}>
                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Script Content</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                        <label htmlFor="sync-script-file-upload" style={{ color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <UploadCloud size={14} /> Load .txt file
                        </label>
                        <input 
                          id="sync-script-file-upload"
                          type="file" 
                          accept=".txt" 
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              setScriptFile(file);
                              const reader = new FileReader();
                              reader.onload = (evt) => {
                                setScriptText(evt.target.result);
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                      </span>
                    </label>
                    <textarea 
                      className="custom-textarea"
                      placeholder="Type or paste script content, or load a .txt file..."
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                      style={{ flex: 1, minHeight: '110px', resize: 'vertical' }}
                    />
                  </div>
                  {scriptFile && (
                    <div className="file-pill" style={{ alignSelf: 'flex-start' }}>
                      <FileText size={12} /> Loaded: {scriptFile.name}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Config Options */}
            <div>
              <h3 className="options-section-title">
                <Settings size={16} /> Synthesis Configuration
              </h3>
              
              <div className="options-grid">
                <div className="form-group">
                  <label className="form-label">Target Language</label>
                  <select 
                    className="custom-select" 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="en">English (US)</option>
                    <option value="en-in">English (India)</option>
                    <option value="hi">Hindi (IN)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Voice Gender</label>
                  <select 
                    className="custom-select" 
                    value={voiceGender}
                    onChange={(e) => setVoiceGender(e.target.value)}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Voice Engine</label>
                  <select 
                    className="custom-select" 
                    value={ttsEngine}
                    onChange={(e) => setTtsEngine(e.target.value)}
                  >
                    <option value="edge-tts">Standard (Edge-TTS)</option>
                    <option value="edge-dynamic">Dynamic Free (Edge-TTS Pro)</option>
                    <option value="elevenlabs">Premium Dynamic (ElevenLabs)</option>
                    <option value="azure-tts">Azure Cognitive Services (Azure TTS)</option>
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label className="form-label" style={{ marginBottom: '0.5rem' }}>AI Script Polishing</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', height: '40px', padding: '0 0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px' }}>
                    <input 
                      type="checkbox" 
                      checked={polishScript}
                      onChange={(e) => setPolishScript(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      ✨ Enable AI Polish (Gemini)
                    </span>
                  </label>
                </div>

                <div className="form-group">
                  <label className="form-label">Narration Speed ({voiceSpeed}x)</label>
                  <select 
                    className="custom-select" 
                    value={voiceSpeed}
                    onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                  >
                    <option value={0.8}>0.8x (Slower)</option>
                    <option value={0.9}>0.9x</option>
                    <option value={1.0}>1.0x (Default)</option>
                    <option value={1.1}>1.1x</option>
                    <option value={1.2}>1.2x (Fast)</option>
                    <option value={1.3}>1.3x</option>
                    <option value={1.5}>1.5x (Faster)</option>
                  </select>
                </div>

                {ttsEngine === 'elevenlabs' && (
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">ElevenLabs API Key</label>
                    <input 
                      type="password" 
                      className="custom-input"
                      value={elevenLabsKey}
                      onChange={(e) => setElevenLabsKey(e.target.value)}
                      placeholder="sk_..."
                    />
                  </div>
                )}

                {ttsEngine === 'azure-tts' && (
                  <div className="form-group" style={{ gridColumn: '1 / -1', margin: '0 0 1rem 0' }}>
                    <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(168, 85, 247, 0.25)', background: 'rgba(168, 85, 247, 0.02)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
                      <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                        <span style={{ fontSize: '0.8rem', color: '#c084fc', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Azure Credentials</span>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Azure Speech API Key</label>
                        <input 
                          type="password" 
                          className="custom-input"
                          value={azureSpeechKey}
                          onChange={(e) => setAzureSpeechKey(e.target.value)}
                          placeholder="API Key"
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Azure Speech Region</label>
                        <input 
                          type="text" 
                          className="custom-input"
                          value={azureSpeechRegion}
                          onChange={(e) => setAzureSpeechRegion(e.target.value)}
                          placeholder="e.g., eastus, centralindia"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {['azure-tts', 'edge-tts', 'edge-dynamic'].includes(ttsEngine) && (
                  <>
                    {language === 'hi' && voiceGender === 'female' ? (
                      <div className="form-group">
                        <label className="form-label">Voice Name</label>
                        <select 
                          className="custom-select" 
                          value={voiceName}
                          onChange={(e) => setVoiceName(e.target.value)}
                        >
                          <option value="hi-IN-SwaraNeural">hi-IN-SwaraNeural (Styles Support)</option>
                          <option value="hi-IN-SapnaNeural" disabled={ttsEngine !== 'azure-tts'}>hi-IN-SapnaNeural {ttsEngine !== 'azure-tts' ? '(Azure Only)' : '(Default Style)'}</option>
                          <option value="hi-IN-AditiNeural" disabled={ttsEngine !== 'azure-tts'}>hi-IN-AditiNeural {ttsEngine !== 'azure-tts' ? '(Azure Only)' : '(Default Style)'}</option>
                          <option value="hi-IN-NehaNeural" disabled={ttsEngine !== 'azure-tts'}>hi-IN-NehaNeural {ttsEngine !== 'azure-tts' ? '(Azure Only)' : '(Default Style)'}</option>
                        </select>
                      </div>
                    ) : (
                      <div className="form-group">
                        <label className="form-label">Voice Name</label>
                        <input 
                          type="text"
                          className="custom-input"
                          value={voiceName || (language === 'hi' ? (voiceGender === 'female' ? 'hi-IN-SwaraNeural' : 'hi-IN-MadhurNeural') : language === 'en' ? (voiceGender === 'female' ? 'en-US-AriaNeural' : 'en-US-GuyNeural') : (voiceGender === 'female' ? 'en-IN-NeerjaExpressiveNeural' : 'en-IN-PrabhatNeural'))}
                          disabled
                          title="Auto-mapped based on language and gender settings"
                          style={{ opacity: 0.6, cursor: 'not-allowed' }}
                        />
                      </div>
                    )}

                    {voiceName === 'hi-IN-SwaraNeural' && (
                      <div className="form-group">
                        <label className="form-label">Speaking Style</label>
                        <select 
                          className="custom-select" 
                          value={voiceStyle}
                          onChange={(e) => setVoiceStyle(e.target.value)}
                        >
                          <option value="default">Default</option>
                          <option value="cheerful" disabled={ttsEngine !== 'azure-tts'}>Cheerful {ttsEngine !== 'azure-tts' ? '(Azure Only)' : ''}</option>
                          <option value="empathetic" disabled={ttsEngine !== 'azure-tts'}>Empathetic {ttsEngine !== 'azure-tts' ? '(Azure Only)' : ''}</option>
                          <option value="newscast" disabled={ttsEngine !== 'azure-tts'}>Newscast {ttsEngine !== 'azure-tts' ? '(Azure Only)' : ''}</option>
                        </select>
                        {ttsEngine !== 'azure-tts' && (
                          <span style={{ fontSize: '0.75rem', color: '#a8a29e', marginTop: '0.25rem', display: 'block' }}>
                            💡 Switch to Azure TTS to choose premium speaking styles.
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'video_sync' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Audio-Visual Sync Mode</label>
                      <select 
                        className="custom-select" 
                        value={syncMode}
                        onChange={(e) => setSyncMode(e.target.value)}
                      >
                        <option value="scene">Scene-Based Duration Alignment (Fast)</option>
                        <option value="lipsync">Wav2Lip Neural Sync (CPU Mode)</option>
                      </select>
                    </div>



                     <div className="form-group">
                      <label className="form-label">Caption Highlight Style</label>
                      <select 
                        className="custom-select" 
                        value={captionStyle}
                        onChange={(e) => setCaptionStyle(e.target.value)}
                      >
                        <option value="active_word">Active Word Highlight (Yellow)</option>
                        <option value="bold_outlined">Bold Outline Highlight (Pink)</option>
                        <option value="hormozi_pop">Hormozi Pop (1 Word, Animated)</option>
                        <option value="karaoke_box">Karaoke Box (Dark Background)</option>
                        <option value="neon_glow">Neon Glow (Cyberpunk Cyan)</option>
                        <option value="minimal_white">Minimal Clean (White)</option>
                        <option value="none">No Captions (None)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Caption Font</label>
                      <select 
                        className="custom-select" 
                        value={fontName}
                        onChange={(e) => setFontName(e.target.value)}
                      >
                        <option value="Arial">Arial (Clean)</option>
                        <option value="Roboto">Roboto (Modern)</option>
                        <option value="Montserrat">Montserrat (Stylish)</option>
                        <option value="Open Sans">Open Sans (Friendly)</option>
                        <option value="Impact">Impact (Bold, Bouncy)</option>
                        <option value="Courier New">Courier New (Typewriter)</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Tahoma">Tahoma</option>
                        <option value="Trebuchet MS">Trebuchet MS</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Caption Font Size (px)</label>
                      <input 
                        type="number" 
                        className="custom-input"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        min="12"
                        max="60"
                      />
                    </div>
                    
                    <div className="form-group">
                      <label className="form-label">Background Music</label>
                      <select 
                        className="custom-select" 
                        value={bgmName}
                        onChange={(e) => {
                          setBgmName(e.target.value);
                          if (e.target.value !== 'custom') {
                            setBgmFile(null);
                          }
                        }}
                      >
                        <option value="none">None</option>
                        <option value="Upbeat Track">Upbeat Track (Library)</option>
                        <option value="Cinematic Track">Cinematic Track (Library)</option>
                        <option value="Relaxing Track">Relaxing Track (Library)</option>
                        <option value="custom">Upload Custom File...</option>
                      </select>
                    </div>

                    {bgmName === 'custom' && (
                      <div className="form-group">
                        <label className="form-label">Upload BGM File</label>
                        <input 
                          type="file" 
                          accept="audio/*" 
                          className="custom-input"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setBgmFile(e.target.files[0]);
                            } else {
                              setBgmFile(null);
                            }
                          }}
                        />
                      </div>
                    )}

                    {(bgmName !== 'none' && (bgmName !== 'custom' || bgmFile)) && (
                      <div className="form-group">
                        <label className="form-label">BGM Volume ({bgmVolume}%)</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          style={{ width: '100%', cursor: 'pointer' }}
                          value={bgmVolume}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <button 
              type="submit" 
              className="action-btn"
              disabled={
                isUploading || 
                (activeTab === 'video_sync' && (!videoFile || !scriptText.trim())) ||
                (activeTab === 'audio_only' && (!scriptText && !audioScriptFile))
              }
            >
              {isUploading ? (
                <>
                  <Loader size={18} className="animate-spin" /> {activeTab === 'video_sync' ? 'Uploading assets...' : 'Generating audio...'}
                </>
              ) : (
                <>
                  {activeTab === 'video_sync' ? <Play size={18} /> : <Volume2 size={18} />}
                  {activeTab === 'video_sync' ? 'Generate Sync Video' : 'Convert Script to MP3'}
                </>
              )}
            </button>
          </form>
        </section>

        {/* Right Side: Integrated Output & Stepper Card */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          {/* Video/Audio Preview Card */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <h2 className="card-title text-gradient">
                {activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? 'Audio Output' : 'Visual Output'}
              </h2>
              <p className="card-description">
                {activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? 'Listen and download the high-quality synthesized voice-over.' : 'Watch and download the synced production video clip.'}
              </p>
            </div>
            <div className="card-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {activeJob && !previewUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem', background: 'rgba(255,255,255,0.01)', borderRadius: '12px', border: '1px dashed var(--border-glass)' }}>
                  {renderProgressStepper()}
                  {(activeJob.status !== 'COMPLETED' && activeJob.status !== 'FAILED' && activeJob.status !== 'CANCELLED') && (
                    <button
                      type="button"
                      className="action-btn cancel-job-btn"
                      onClick={() => handleCancelJob(activeJob.job_id)}
                      style={{ 
                        marginTop: '0.5rem', 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        color: 'var(--color-error)', 
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        boxShadow: 'none'
                      }}
                    >
                      Cancel Job
                    </button>
                  )}
                </div>
              ) : (
                <div className="preview-container" style={activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? { aspectRatio: 'auto', padding: '3rem 2rem', background: 'rgba(255,255,255,0.02)' } : undefined}>
                  {previewUrl ? (
                    activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '1.5rem' }}>
                        <div className="audio-wave-anim">
                          <div className="wave-bar"></div>
                          <div className="wave-bar"></div>
                          <div className="wave-bar"></div>
                          <div className="wave-bar"></div>
                          <div className="wave-bar"></div>
                        </div>
                        <audio 
                          className="preview-audio" 
                          src={previewUrl} 
                          controls 
                          autoPlay
                        />
                      </div>
                    ) : (
                      <video 
                        className="preview-video" 
                        src={previewUrl} 
                        controls 
                        autoPlay
                      />
                    )
                  ) : (
                    <div className="preview-placeholder">
                      {activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? <Volume2 size={48} style={{ opacity: 0.3 }} /> : <Tv size={48} style={{ opacity: 0.3 }} />}
                      <div className="preview-placeholder-text">
                        {activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only'
                          ? "No active audio generation. Type or upload a script to compile voice-over."
                          : "No active video render. Create a job to compile output."}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {previewUrl && (
                <a 
                  href={previewUrl} 
                  download 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="action-btn"
                  style={{ textDecoration: 'none', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-glass)' }}
                >
                  <Download size={18} /> {activeJob?.job_type === 'audio_only' || jobsList.find(j => j.id === activeJobId)?.job_type === 'audio_only' ? 'Download MP3 Audio' : 'Download Synced Video'}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom: Past Sync Jobs History */}
      <section className="glass-panel job-list-section">
        <div className="card-header job-list-header">
          <div>
            <h2 className="card-title text-gradient">Sync Job History</h2>
            <p className="card-description">Review previous uploads, durations, and output files.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="action-btn" 
              style={{ 
                width: 'auto', 
                padding: '0.5rem 1rem', 
                background: 'rgba(239, 68, 68, 0.08)', 
                border: '1px solid rgba(239, 68, 68, 0.2)', 
                fontSize: '0.8rem',
                color: '#fca5a5'
              }}
              onClick={handleClearTempFiles}
              disabled={isClearing}
            >
              <Trash2 size={14} /> {isClearing ? 'Clearing...' : 'Clear Temp Files'}
            </button>
            <button 
              className="action-btn" 
              style={{ width: 'auto', padding: '0.5rem 1rem', background: 'none', border: '1px solid var(--border-glass)', fontSize: '0.8rem' }}
              onClick={fetchJobs}
            >
              <RefreshCw size={14} /> Refresh List
            </button>
          </div>
        </div>

        {cleanupStatus && (
          <div style={{ 
            margin: '0 1.5rem 1.25rem 1.5rem', 
            background: 'rgba(16, 185, 129, 0.08)', 
            border: '1px solid rgba(16, 185, 129, 0.2)', 
            color: '#a7f3d0', 
            padding: '0.75rem 1rem', 
            borderRadius: '8px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            fontSize: '0.85rem' 
          }}>
            <Sparkles size={16} style={{ color: '#34d399' }} />
            <span>{cleanupStatus}</span>
            <button 
              style={{ 
                marginLeft: 'auto', 
                background: 'none', 
                border: 'none', 
                color: 'inherit', 
                cursor: 'pointer', 
                fontSize: '1.2rem',
                padding: '0 0.25rem',
                lineHeight: 1
              }} 
              onClick={() => setCleanupStatus(null)}
            >
              &times;
            </button>
          </div>
        )}
        
        <div style={{ overflowX: 'auto', padding: '0 1.5rem 1.5rem 1.5rem' }}>
          <table className="job-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Type</th>
                <th>Created</th>
                <th>Options</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentJobsList.length > 0 ? (
                currentJobsList.map((job) => (
                  <tr key={job.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {job.id.substring(0, 8)}...
                    </td>
                    <td>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 'bold', 
                        padding: '0.2rem 0.5rem', 
                        borderRadius: '4px', 
                        background: job.job_type === 'audio_only' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(168, 85, 247, 0.15)', 
                        color: job.job_type === 'audio_only' ? '#60a5fa' : '#c084fc' 
                      }}>
                        {job.job_type === 'audio_only' ? 'Audio Only' : 'Video Sync'}
                      </span>
                    </td>
                    <td>
                      {formatJobDate(job.created_at)}
                    </td>
                    <td>
                      <span style={{ textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {job.language} | {job.voice_gender} | {job.voice_speed || 1.0}x
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {job.job_type === 'audio_only' ? 'N/A' : job.sync_mode}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${getStatusClass(job.status)}`}>
                        {job.status === 'GENERATING_TTS' ? 'TTS Gen' : job.status}
                      </span>
                    </td>
                    <td>
                      {job.status === 'COMPLETED' ? (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                          <span className="action-link" onClick={() => selectJobForPreview(job)}>
                            {job.job_type === 'audio_only' ? 'Play Audio' : 'Play Visual'}
                          </span>
                          <a href={job.final_video_url} target="_blank" rel="noreferrer" className="action-link">
                            Source Link
                          </a>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <span className="action-link" onClick={() => selectJobForPreview(job)}>
                            Monitor Job
                          </span>
                          {(job.status !== 'FAILED' && job.status !== 'CANCELLED') && (
                            <span 
                              className="action-link cancel-link" 
                              onClick={() => handleCancelJob(job.id)}
                            >
                              Cancel
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No sync jobs recorded. Upload your first assets above to start!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {jobsList.length > 0 && (
          <div className="pagination-container">
            <div className="pagination-left">
              <div className="pagination-size-selector">
                <span>Rows per page:</span>
                <select 
                  className="pagination-select" 
                  value={rowsPerPage} 
                  onChange={handleRowsPerPageChange}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
              <div className="pagination-info">
                Showing {indexOfFirstRow + 1} - {Math.min(indexOfLastRow, jobsList.length)} of {jobsList.length} jobs
              </div>
            </div>
            
            <div className="pagination-buttons">
              <button 
                className="pagination-btn" 
                onClick={() => setCurrentPage(1)} 
                disabled={activePage === 1}
                title="First Page"
              >
                &laquo;
              </button>
              <button 
                className="pagination-btn" 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} 
                disabled={activePage === 1}
                title="Previous Page"
              >
                &lsaquo;
              </button>
              
              {getPageNumbers().map((page, idx) => {
                if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                  return (
                    <span 
                      key={`ellipsis-${idx}`} 
                      style={{ color: 'var(--text-muted)', padding: '0 0.25rem', userSelect: 'none' }}
                    >
                      ...
                    </span>
                  );
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`pagination-btn ${activePage === page ? 'active' : ''}`}
                  >
                    {page}
                  </button>
                );
              })}
              
              <button 
                className="pagination-btn" 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} 
                disabled={activePage === totalPages}
                title="Next Page"
              >
                &rsaquo;
              </button>
              <button 
                className="pagination-btn" 
                onClick={() => setCurrentPage(totalPages)} 
                disabled={activePage === totalPages}
                title="Last Page"
              >
                &raquo;
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
