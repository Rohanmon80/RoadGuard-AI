import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Play,
  Video as VideoIcon,
  Camera,
  Film,
  Cpu,
  Layers,
  RefreshCw,
  X,
  AlertTriangle,
  Car,
  ShieldAlert,
  Save,
  Satellite
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  uploadVideo,
  startProcessingVideo,
  fetchVideos,
  fetchDetections,
  subscribeWebSocket
} from '../api';

export default function VideoProcess() {
  const [mode, setMode] = useState('LIVE'); // 'LIVE' | 'RECORDED'
  const [cameraActive, setCameraActive] = useState(false);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressDetails, setProgressDetails] = useState({
    processed_frames: 0,
    total_frames: 0,
    detections_count: 0,
    incidents_count: 0,
  });

  const [detections, setDetections] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // ── LIVE CAMERA LOGIC ────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
        setGpsLocked(true); // Simulate GPS lock for live demo
      }
    } catch (err) {
      console.error('Camera access denied:', err);
      alert('Camera access denied. Please allow permissions or use Recorded Footage mode.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
      setGpsLocked(false);
    }
  };

  // ── RECORDED VIDEO LOGIC ────────────────────────────────
  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setVideoFile(selected);
      setFilePreview(URL.createObjectURL(selected));
    }
  };

  const handleUploadAndProcess = async () => {
    if (!videoFile) return;
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', videoFile);
      const uploaded = await uploadVideo(formData);
      setUploading(false);
      setProcessing(true);
      setProgress(0);
      await startProcessingVideo(uploaded.id);
    } catch (err) {
      alert('Processing failed: ' + err.message);
      setUploading(false);
      setProcessing(false);
    }
  };

  // ── DETECTION MONITOR FEED ──────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeWebSocket((msg) => {
      if (msg.event === 'processing_progress') {
        setProgress(msg.data.progress);
        setProgressDetails(msg.data);
      } else if (msg.event === 'new_detection') {
        setDetections((prev) => [msg.data, ...prev.slice(0, 10)]);
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title="Live Detection Monitor"
        badge="AI EDGE PROCESSING"
        description="Real-time multi-class object detection, incident classification, and telemetry."
      />

      {/* Mode Selector */}
      <div className="flex bg-[var(--bg-elevated)] p-1 rounded-lg border border-[var(--border)] w-fit mb-4">
        <button
          onClick={() => { stopCamera(); setMode('LIVE'); }}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${mode === 'LIVE' ? 'bg-cyan-500 text-slate-950 shadow-sm' : 'hover:text-[var(--text)]'}`}
        >
          <Camera className="w-3.5 h-3.5" /> LIVE CAMERA
        </button>
        <button
          onClick={() => { setMode('RECORDED'); }}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${mode === 'RECORDED' ? 'bg-cyan-500 text-slate-950 shadow-sm' : 'hover:text-[var(--text)]'}`}
        >
          <Film className="w-3.5 h-3.5" /> ROAD VIDEO
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Video Stage */}
        <div className="lg:col-span-8 card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <VideoIcon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              Stream Stage
            </h2>
            <div className="flex gap-2">
              {mode === 'LIVE' && cameraActive && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 live-beacon" /> LIVE
                </span>
              )}
            </div>
          </div>

          <div className="w-full aspect-video rounded-xl bg-slate-950 border border-[var(--border)] flex items-center justify-center overflow-hidden relative">
            {mode === 'LIVE' ? (
              <>
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {!cameraActive && (
                  <button onClick={startCamera} className="absolute btn-primary px-6 py-3 flex items-center gap-2">
                    <Camera className="w-4 h-4" /> Start Live Camera Stream
                  </button>
                )}
                {cameraActive && (
                  <button onClick={stopCamera} className="absolute top-4 right-4 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </>
            ) : (
              filePreview ? (
                <video src={filePreview} controls className="w-full h-full object-contain" />
              ) : (
                <label className="cursor-pointer text-center space-y-2 p-12">
                  <Upload className="w-10 h-10 mx-auto text-cyan-500/50" />
                  <p className="text-xs">Drop video file or click to upload</p>
                  <input type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
                </label>
              )
            )}
          </div>

          {/* Telemetry Footer */}
          {mode === 'LIVE' && cameraActive && (
            <div className="flex gap-6 text-[11px] font-mono p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="flex items-center gap-2"><Satellite className="w-3.5 h-3.5 text-cyan-400" /> GPS Locked</span>
              <span className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-cyan-400" /> AI Engine: YOLOv8n</span>
            </div>
          )}
          {mode === 'RECORDED' && videoFile && (
            <button onClick={handleUploadAndProcess} className="btn-primary w-full py-3">
              {processing ? 'Inference Running...' : uploading ? 'Uploading...' : 'Process Video'}
            </button>
          )}
        </div>

        {/* RIGHT: AI Detection Monitor */}
        <div className="lg:col-span-4 card p-5 space-y-5">
          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
            <Cpu className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            AI Detection Monitor
          </h2>

          {/* Counters */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Vehicles', val: 124 }, { label: 'Pedestrians', val: 8 },
              { label: 'Buses', val: 3 }, { label: 'Bikes', val: 15 },
              { label: 'Trucks', val: 2 }, { label: 'Road Issues', val: 1 }
            ].map((c) => (
              <div key={c.label} className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border)]">
                <div className="text-[10px] uppercase text-[var(--text-muted)]">{c.label}</div>
                <div className="text-lg font-bold font-mono text-cyan-400">{c.val}</div>
              </div>
            ))}
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-y-auto space-y-2 border-t border-[var(--border)] pt-4">
            <div className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-2">Recent Detections</div>
            {detections.map((d, i) => (
              <div key={i} className="flex justify-between items-center bg-[var(--bg-elevated)] p-2 rounded text-[11px]">
                <span className="flex items-center gap-2"><AlertTriangle className="w-3 h-3 text-cyan-400" /> {d.type}</span>
                <span className="font-mono text-[var(--text-muted)]">{Math.round(d.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
