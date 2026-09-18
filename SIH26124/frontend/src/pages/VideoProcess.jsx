import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';

import {
  Upload,
  Play,
  Video as VideoIcon,
  Camera,
  Film,
  Cpu,
  RefreshCw,
  X,
  AlertTriangle,
  Car,
  ShieldAlert,
  Save,
  Satellite,
  Bus,
  Bike,
  Truck,
  User,
  Activity,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import PageHeader from '../components/PageHeader';

import {
  uploadVideo,
  startProcessingVideo,
  fetchVideoStatus,
  subscribeWebSocket,
  detectLiveFrame,
} from '../api';

import { useSystem } from '../context/SystemContext';


// ============================================================
// HELPERS
// ============================================================

const EMPTY_COUNTS = {
  car: 0,
  bus: 0,
  bike: 0,
  truck: 0,
  pedestrian: 0,
  pothole: 0,
};


function normalizeCounts(counts = {}) {
  return {
    car: Number(counts.car || 0),
    bus: Number(counts.bus || 0),
    bike: Number(counts.bike || 0),
    truck: Number(counts.truck || 0),
    pedestrian: Number(counts.pedestrian || 0),
    pothole: Number(counts.pothole || 0),
  };
}


function getTotalVehicles(counts) {
  return (
    Number(counts.car || 0) +
    Number(counts.bus || 0) +
    Number(counts.bike || 0) +
    Number(counts.truck || 0)
  );
}


function getTotalDetections(counts) {
  return (
    getTotalVehicles(counts) +
    Number(counts.pedestrian || 0) +
    Number(counts.pothole || 0)
  );
}


// ============================================================
// COMPONENT
// ============================================================

export default function VideoProcess() {
  const [mode, setMode] = useState('LIVE');

  // ----------------------------------------------------------
  // Camera
  // ----------------------------------------------------------

  const [cameraActive, setCameraActive] = useState(false);
  const [liveAIActive, setLiveAIActive] = useState(false);
  const [liveAnnotatedImage, setLiveAnnotatedImage] =
    useState(null);

  const [liveCounts, setLiveCounts] =
    useState(EMPTY_COUNTS);

  const [liveTotal, setLiveTotal] =
    useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const liveCanvasRef = useRef(null);
  const liveLoopRef = useRef(null);

  const liveProcessingRef = useRef(false);
  const liveFrameNumberRef = useRef(0);

  // ----------------------------------------------------------
  // Recorded video
  // ----------------------------------------------------------

  const [videoFile, setVideoFile] =
    useState(null);

  const [filePreview, setFilePreview] =
    useState(null);

  const [processedVideoUrl, setProcessedVideoUrl] =
    useState(null);

  const [uploading, setUploading] =
    useState(false);

  const [processing, setProcessing] =
    useState(false);

  const [processingComplete, setProcessingComplete] =
    useState(false);

  const [progress, setProgress] =
    useState(0);

  const [progressDetails, setProgressDetails] =
    useState({
      processed_frames: 0,
      total_frames: 0,
      detections_count: 0,
      incidents_count: 0,
    });

  const [videoCounts, setVideoCounts] =
    useState(EMPTY_COUNTS);

  const [videoId, setVideoId] =
    useState(null);

  // ----------------------------------------------------------
  // Detection feed
  // ----------------------------------------------------------

  const [detections, setDetections] =
    useState([]);

  // ----------------------------------------------------------
  // GPS
  // ----------------------------------------------------------

  const {
    gpsLat,
    gpsLng,
    gpsLocked,
    gpsSource,
    gpsModeLabel,
    getCurrentPosition,
  } = useSystem();

  const [gpsLoading, setGpsLoading] =
    useState(false);


  // ==========================================================
  // LIVE CAMERA
  // ==========================================================

  const startCamera = async () => {
    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        alert(
          'Camera API is not available in this browser.'
        );

        return;
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: {
              ideal: 1280,
            },
            height: {
              ideal: 720,
            },
            frameRate: {
              ideal: 20,
            },
          },
          audio: false,
        });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        streamRef.current = stream;

        setCameraActive(true);

        liveFrameNumberRef.current = 0;

        setLiveAnnotatedImage(null);

        setLiveCounts({
          ...EMPTY_COUNTS,
        });

        setLiveTotal(0);
      }
    } catch (err) {
      console.error(
        'Camera access denied:',
        err
      );

      alert(
        'Camera access denied. Please allow camera permission and try again.'
      );
    }
  };


  const stopCamera = useCallback(() => {
    // Stop AI loop
    if (liveLoopRef.current) {
      clearTimeout(
        liveLoopRef.current
      );

      liveLoopRef.current = null;
    }

    liveProcessingRef.current = false;

    setLiveAIActive(false);

    // Stop camera stream
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);

    setLiveAnnotatedImage(null);
  }, []);


  // ==========================================================
  // CAPTURE ONE CAMERA FRAME
  // ==========================================================

  const captureLiveFrame = useCallback(
    async () => {
      if (
        !videoRef.current ||
        !liveCanvasRef.current
      ) {
        return;
      }

      if (!cameraActive) {
        return;
      }

      if (
        videoRef.current.readyState <
        HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }

      if (liveProcessingRef.current) {
        return;
      }

      liveProcessingRef.current = true;

      try {
        const video =
          videoRef.current;

        const canvas =
          liveCanvasRef.current;

        const width =
          video.videoWidth || 640;

        const height =
          video.videoHeight || 480;

        // Keep live inference reasonably sized.
        const maxWidth = 960;

        let targetWidth = width;
        let targetHeight = height;

        if (width > maxWidth) {
          const scale =
            maxWidth / width;

          targetWidth =
            Math.round(width * scale);

          targetHeight =
            Math.round(height * scale);
        }

        canvas.width =
          targetWidth;

        canvas.height =
          targetHeight;

        const ctx =
          canvas.getContext('2d');

        if (!ctx) {
          return;
        }

        // Draw current camera frame.
        ctx.drawImage(
          video,
          0,
          0,
          targetWidth,
          targetHeight
        );

        // Convert to JPEG.
        const blob =
          await new Promise(
            (resolve) => {
              canvas.toBlob(
                resolve,
                'image/jpeg',
                0.82
              );
            }
          );

        if (!blob) {
          return;
        }

        liveFrameNumberRef.current += 1;

        // Send frame to FastAPI.
        const annotatedBlob =
          await detectLiveFrame(
            blob
          );

        // Convert returned annotated JPEG
        // into a browser URL.
        const imageUrl =
          URL.createObjectURL(
            annotatedBlob
          );

        setLiveAnnotatedImage(
          (previous) => {
            if (
              previous &&
              previous.startsWith(
                'blob:'
              )
            ) {
              URL.revokeObjectURL(
                previous
              );
            }

            return imageUrl;
          }
        );

        // Read detection counts from response headers
        // if available.
        //
        // detectLiveFrame() returns only a Blob,
        // therefore the current API function does not
        // expose headers. Counts are primarily visual
        // in the annotated frame.
      } catch (err) {
        console.error(
          'Live AI frame failed:',
          err
        );
      } finally {
        liveProcessingRef.current = false;
      }
    },
    [cameraActive]
  );


  // ==========================================================
  // START LIVE AI LOOP
  // ==========================================================

  const startLiveAI = useCallback(() => {
    if (!cameraActive) {
      return;
    }

    if (liveAIActive) {
      return;
    }

    setLiveAIActive(true);

    const loop = async () => {
      if (!cameraActive) {
        return;
      }

      await captureLiveFrame();

      // Approximately 5 AI frames/sec.
      liveLoopRef.current =
        setTimeout(
          loop,
          200
        );
    };

    loop();
  }, [
    cameraActive,
    liveAIActive,
    captureLiveFrame,
  ]);


  // Automatically start AI when camera starts.
  useEffect(() => {
    if (
      cameraActive &&
      !liveAIActive
    ) {
      startLiveAI();
    }
  }, [
    cameraActive,
    liveAIActive,
    startLiveAI,
  ]);


  // Stop everything when component unmounts.
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);


  // ==========================================================
  // RECORDED VIDEO — SELECT FILE
  // ==========================================================

  const handleFileSelect = (
    e
  ) => {
    const selected =
      e.target.files?.[0];

    if (!selected) {
      return;
    }

    // Stop live camera if needed.
    stopCamera();

    setVideoFile(
      selected
    );

    setFilePreview(
      URL.createObjectURL(
        selected
      )
    );

    setProcessedVideoUrl(
      null
    );

    setProcessingComplete(
      false
    );

    setProgress(0);

    setVideoCounts({
      ...EMPTY_COUNTS,
    });

    setDetections([]);

    setVideoId(null);
  };


  // ==========================================================
  // UPLOAD + PROCESS
  // ==========================================================

  const handleUploadAndProcess =
    async () => {
      if (!videoFile) {
        alert(
          'Please select a video first.'
        );

        return;
      }

      try {
        setUploading(true);

        setProcessing(false);

        setProcessingComplete(
          false
        );

        setProcessedVideoUrl(
          null
        );

        setProgress(0);

        setVideoCounts({
          ...EMPTY_COUNTS,
        });

        const formData =
          new FormData();

        formData.append(
          'file',
          videoFile
        );

        // Add current GPS when available.
        if (
          gpsLat !== null &&
          gpsLng !== null
        ) {
          formData.append(
            'gps_lat',
            gpsLat.toString()
          );

          formData.append(
            'gps_lng',
            gpsLng.toString()
          );
        }

        const uploaded =
          await uploadVideo(
            formData
          );

        const uploadedId =
          uploaded?.id;

        if (
          uploadedId === undefined ||
          uploadedId === null
        ) {
          throw new Error(
            'Backend did not return a video ID.'
          );
        }

        setVideoId(
          uploadedId
        );

        setUploading(false);

        setProcessing(true);

        await startProcessingVideo(
          uploadedId
        );

      } catch (err) {
        console.error(
          'Video processing error:',
          err
        );

        alert(
          'Processing failed: ' +
          err.message
        );

        setUploading(false);

        setProcessing(false);
      }
    };


  // ==========================================================
  // POLL VIDEO STATUS
  // ==========================================================

  useEffect(() => {
    if (!videoId) {
      return;
    }

    let cancelled =
      false;

    let timer = null;

    const checkStatus =
      async () => {
        try {
          const status =
            await fetchVideoStatus(
              videoId
            );

          if (cancelled) {
            return;
          }

          const job =
            status?.job || {};

          const currentProgress =
            Number(
              job.progress ??
              status.progress ??
              0
            );

          setProgress(
            Math.max(
              0,
              Math.min(
                100,
                currentProgress
              )
            )
          );

          setProgressDetails({
            processed_frames:
              Number(
                job.processed_frames ||
                status.processed_frames ||
                0
              ),

            total_frames:
              Number(
                job.total_frames ||
                status.total_frames ||
                0
              ),

            detections_count:
              Number(
                job.detections_count ||
                job.total_detections ||
                status.detections_count ||
                0
              ),

            incidents_count:
              Number(
                job.incidents_count ||
                status.incidents_count ||
                0
              ),
          });

          if (
            job.counts ||
            status.counts
          ) {
            setVideoCounts(
              normalizeCounts(
                job.counts ||
                status.counts
              )
            );
          }

          const outputUrl =
            status.output_url ||
            job.output_url;

          if (outputUrl) {
            const absoluteUrl =
              outputUrl.startsWith(
                'http'
              )
                ? outputUrl
                : outputUrl;

            setProcessedVideoUrl(
              `${absoluteUrl}${
                absoluteUrl.includes('?')
                  ? '&'
                  : '?'
              }t=${Date.now()}`
            );
          }

          const currentStatus =
            String(
              job.status ||
              status.status ||
              ''
            ).toLowerCase();

          if (
            currentStatus ===
              'completed' ||
            currentStatus ===
              'complete'
          ) {
            setProcessing(
              false
            );

            setProcessingComplete(
              true
            );

            setProgress(
              100
            );

            if (outputUrl) {
              const absoluteUrl =
                outputUrl.startsWith(
                  'http'
                )
                  ? outputUrl
                  : outputUrl;

              setProcessedVideoUrl(
                `${absoluteUrl}?t=${Date.now()}`
              );
            }

            return;
          }

          if (
            currentStatus ===
              'failed' ||
            currentStatus ===
              'error'
          ) {
            setProcessing(
              false
            );

            alert(
              job.error ||
              status.error ||
              'Video processing failed.'
            );

            return;
          }

          timer =
            setTimeout(
              checkStatus,
              1000
            );

        } catch (err) {
          console.error(
            'Video status polling failed:',
            err
          );

          if (!cancelled) {
            timer =
              setTimeout(
                checkStatus,
                2000
              );
          }
        }
      };

    checkStatus();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [videoId]);


  // ==========================================================
  // WEBSOCKET
  // ==========================================================

  useEffect(() => {
    const unsubscribe =
      subscribeWebSocket(
        (msg) => {
          if (
            msg.event ===
            'processing_progress'
          ) {
            const data =
              msg.data || {};

            if (
              videoId &&
              data.video_id &&
              Number(
                data.video_id
              ) !== Number(
                videoId
              )
            ) {
              return;
            }

            setProgress(
              Number(
                data.progress || 0
              )
            );

            setProgressDetails(
              (previous) => ({
                ...previous,
                ...data,
              })
            );
          }

          // Current processor doesn't create
          // detection DB records anymore.
          //
          // Therefore we do not depend on
          // "new_detection" events.
        }
      );

    return () =>
      unsubscribe();
  }, [videoId]);


  // ==========================================================
  // GPS
  // ==========================================================

  const handleGetLocation =
    async () => {
      setGpsLoading(true);

      try {
        await getCurrentPosition();
      } finally {
        setGpsLoading(false);
      }
    };


  // ==========================================================
  // MODE SWITCH
  // ==========================================================

  const switchToLive =
    () => {
      setMode('LIVE');

      // Stop any selected recorded-video
      // processing display.

      setProcessedVideoUrl(
        null
      );

      setProcessingComplete(
        false
      );
    };


  const switchToRecorded =
    () => {
      stopCamera();

      setMode('RECORDED');

      setLiveAnnotatedImage(
        null
      );
    };


  // ==========================================================
  // LIVE DISPLAY COUNTERS
  // ==========================================================

  const liveVehicleCount =
    getTotalVehicles(
      liveCounts
    );

  const liveRoadIssueCount =
    Number(
      liveCounts.pothole || 0
    );


  // ==========================================================
  // VIDEO DISPLAY COUNTERS
  // ==========================================================

  const videoVehicleCount =
    getTotalVehicles(
      videoCounts
    );

  const videoRoadIssueCount =
    Number(
      videoCounts.pothole || 0
    );


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="space-y-5 pb-12">

      {/* ================================================== */}
      {/* HEADER */}
      {/* ================================================== */}

      <PageHeader
        title="Live Detection Monitor"
        badge="AI EDGE PROCESSING"
        description="Real-time multi-class object detection with bounding boxes, confidence values and road intelligence."
      />


      {/* ================================================== */}
      {/* MODE SELECTOR */}
      {/* ================================================== */}

      <div className="flex bg-[var(--bg-elevated)] p-1 rounded-lg border border-[var(--border)] w-fit mb-4">

        <button
          onClick={switchToLive}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            mode === 'LIVE'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'hover:text-[var(--text)]'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          LIVE CAMERA
        </button>

        <button
          onClick={switchToRecorded}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            mode === 'RECORDED'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'hover:text-[var(--text)]'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          ROAD VIDEO
        </button>

      </div>


      {/* ================================================== */}
      {/* MAIN GRID */}
      {/* ================================================== */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">


        {/* ================================================= */}
        {/* VIDEO STAGE */}
        {/* ================================================= */}

        <div className="lg:col-span-8 card p-4 space-y-4">

          {/* Stage Header */}

          <div className="flex items-center justify-between">

            <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <VideoIcon
                className="w-4 h-4"
                style={{
                  color:
                    'var(--accent)',
                }}
              />

              AI Vision Stream
            </h2>


            <div className="flex gap-2">

              {mode === 'LIVE' &&
                cameraActive && (
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">

                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 live-beacon" />

                    {liveAIActive
                      ? 'AI LIVE'
                      : 'LIVE'}
                  </span>
                )}


              <button
                onClick={
                  handleGetLocation
                }
                disabled={
                  gpsLoading
                }
                className={`flex items-center gap-2 px-3 py-1 text-xs font-bold rounded-lg transition-all hover:bg-[var(--bg-elevated)] ${
                  gpsLoading
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >

                {gpsLoading ? (
                  <>
                    <Satellite className="w-3 h-3 animate-spin" />
                    Getting location…
                  </>
                ) : (
                  <>
                    <Satellite className="w-3 h-3" />
                    Current Location
                  </>
                )}

              </button>

            </div>

          </div>


          {/* ================================================= */}
          {/* VIDEO CONTAINER */}
          {/* ================================================= */}

          <div className="w-full aspect-video rounded-xl bg-black border border-[var(--border)] flex items-center justify-center overflow-hidden relative">


            {/* ============================================== */}
            {/* LIVE CAMERA */}
            {/* ============================================== */}

            {mode === 'LIVE' && (
              <>

                {/* Raw camera source.
                    Kept underneath the AI image. */}

                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`w-full h-full object-contain ${
                    liveAnnotatedImage
                      ? 'hidden'
                      : 'block'
                  }`}
                />


                {/* AI ANNOTATED FRAME */}

                {liveAnnotatedImage && (
                  <img
                    src={
                      liveAnnotatedImage
                    }
                    alt="AI live detection"
                    className="w-full h-full object-contain"
                  />
                )}


                {/* Hidden canvas used to capture
                    camera frames. */}

                <canvas
                  ref={
                    liveCanvasRef
                  }
                  className="hidden"
                />


                {/* Start camera button */}

                {!cameraActive && (
                  <button
                    onClick={
                      startCamera
                    }
                    className="absolute btn-primary px-6 py-3 flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />

                    Start Live AI Camera
                  </button>
                )}


                {/* Camera stop */}

                {cameraActive && (
                  <button
                    onClick={
                      stopCamera
                    }
                    className="absolute top-4 right-4 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full z-20"
                    title="Stop camera"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}


                {/* AI status overlay */}

                {cameraActive && (
                  <div className="absolute left-4 top-4 z-20">

                    <div className="px-3 py-2 rounded-lg bg-black/75 border border-cyan-400/40 backdrop-blur-sm">

                      <div className="flex items-center gap-2">

                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />

                        <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">
                          YOLO AI DETECTION
                        </span>

                      </div>

                      <div className="text-[9px] text-white/60 mt-1 font-mono">
                        Bounding boxes · Confidence · Classification
                      </div>

                    </div>

                  </div>
                )}

              </>
            )}


            {/* ================================================= */}
            {/* RECORDED VIDEO */}
            {/* ================================================= */}

            {mode === 'RECORDED' && (
              <>

                {/* FINAL AI ANNOTATED VIDEO */}

                {processedVideoUrl ? (
                  <video
                    key={
                      processedVideoUrl
                    }
                    src={
                      processedVideoUrl
                    }
                    controls
                    autoPlay={false}
                    playsInline
                    className="w-full h-full object-contain bg-black"
                  />
                ) : filePreview ? (
                  /* Original preview while waiting */

                  <video
                    src={
                      filePreview
                    }
                    controls
                    className="w-full h-full object-contain bg-black"
                  />
                ) : (
                  <label className="cursor-pointer text-center space-y-2 p-12">

                    <Upload className="w-10 h-10 mx-auto text-cyan-500/50" />

                    <p className="text-xs">
                      Drop road video or click to upload
                    </p>

                    <p className="text-[10px] text-[var(--text-muted)]">
                      AI will draw boxes directly into the processed video
                    </p>

                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={
                        handleFileSelect
                      }
                    />

                  </label>
                )}


                {/* PROCESSING OVERLAY */}

                {processing && (
                  <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] flex items-center justify-center">

                    <div className="w-[80%] max-w-md p-5 rounded-xl bg-slate-950/95 border border-cyan-400/30">

                      <div className="flex items-center gap-3 mb-4">

                        <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />

                        <div>

                          <div className="text-sm font-bold text-white">
                            AI Processing Video
                          </div>

                          <div className="text-[10px] text-white/50">
                            Detecting objects and drawing bounding boxes...
                          </div>

                        </div>

                      </div>


                      <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">

                        <div
                          className="h-full bg-cyan-400 transition-all duration-300"
                          style={{
                            width: `${progress}%`,
                          }}
                        />

                      </div>


                      <div className="flex justify-between mt-2 text-[10px] font-mono text-white/60">

                        <span>
                          {progressDetails.processed_frames || 0}
                          {' / '}
                          {progressDetails.total_frames || 0}
                          {' frames'}
                        </span>

                        <span>
                          {Math.round(
                            progress
                          )}
                          %
                        </span>

                      </div>

                    </div>

                  </div>
                )}

              </>
            )}

          </div>


          {/* ================================================= */}
          {/* LIVE TELEMETRY */}
          {/* ================================================= */}

          {mode === 'LIVE' &&
            cameraActive && (
              <div className="flex flex-wrap gap-4 text-[11px] font-mono p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">

                <span className="flex items-center gap-2">

                  <Satellite className="w-3.5 h-3.5 text-cyan-400" />

                  GPS:
                  {' '}

                  {gpsSource ===
                  'browser'
                    ? '📍 Live'
                    : gpsSource ===
                      'manual'
                    ? '📍 Manual'
                    : gpsSource ===
                      'denied'
                    ? '🚫 Denied'
                    : '🔍 Seeking'}

                </span>


                <span className="flex items-center gap-2">

                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />

                  AI:
                  {' '}
                  YOLOv8n

                </span>


                <span className="flex items-center gap-2">

                  <Activity className="w-3.5 h-3.5 text-emerald-400" />

                  Detection:
                  {' '}
                  {liveAIActive
                    ? 'ACTIVE'
                    : 'STARTING'}

                </span>


                {gpsLat !== null &&
                  gpsLng !== null && (
                    <span>
                      {gpsLat.toFixed(6)}
                      ,
                      {' '}
                      {gpsLng.toFixed(6)}
                    </span>
                  )}

              </div>
            )}


          {/* ================================================= */}
          {/* RECORDED VIDEO CONTROLS */}
          {/* ================================================= */}

          {mode === 'RECORDED' &&
            videoFile && (
              <>

                <div className="flex flex-wrap gap-4 text-[11px] font-mono p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">

                  <span className="flex items-center gap-2">

                    <Satellite className="w-3 h-3 text-cyan-400" />

                    GPS:

                    {' '}

                    {gpsSource ===
                    'browser'
                      ? '📍 Live'
                      : gpsSource ===
                        'manual'
                      ? '📍 Manual'
                      : gpsLocked
                      ? 'Locked'
                      : 'Seeking'}

                  </span>


                  <span>

                    {gpsLat !== null &&
                    gpsLng !== null
                      ? `${gpsLat.toFixed(
                          4
                        )}, ${gpsLng.toFixed(
                          4
                        )}`
                      : '--'}

                  </span>

                </div>


                <button
                  onClick={
                    handleUploadAndProcess
                  }
                  disabled={
                    uploading ||
                    processing
                  }
                  className={`btn-primary w-full py-3 flex items-center justify-center gap-2 ${
                    uploading ||
                    processing
                      ? 'opacity-60 cursor-not-allowed'
                      : ''
                  }`}
                >

                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : processing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      AI Inference Running...
                    </>
                  ) : processingComplete ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      AI Video Processed
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Process Video with AI
                    </>
                  )}

                </button>


                {processingComplete &&
                  processedVideoUrl && (
                    <div className="flex items-center gap-2 text-[11px] text-emerald-400">

                      <CheckCircle2 className="w-3.5 h-3.5" />

                      Annotated AI video ready

                    </div>
                  )}

              </>
            )}

        </div>


        {/* ================================================= */}
        {/* RIGHT PANEL */}
        {/* ================================================= */}

        <div className="lg:col-span-4 card p-5 space-y-5">

          <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">

            <Cpu
              className="w-4 h-4"
              style={{
                color:
                  'var(--accent)',
              }}
            />

            AI Detection Monitor

          </h2>


          {/* ================================================= */}
          {/* LIVE COUNTERS */}
          {/* ================================================= */}

          {mode === 'LIVE' ? (
            <>

              <div className="grid grid-cols-2 gap-3">

                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border)]">

                  <div className="text-[10px] uppercase text-[var(--text-muted)]">
                    Vehicles
                  </div>

                  <div className="text-lg font-bold font-mono text-cyan-400">
                    {liveVehicleCount}
                  </div>

                </div>


                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border)]">

                  <div className="text-[10px] uppercase text-[var(--text-muted)]">
                    Road Issues
                  </div>

                  <div className="text-lg font-bold font-mono text-orange-400">
                    {liveRoadIssueCount}
                  </div>

                </div>

              </div>


              {/* Detailed object counts */}

              <div className="space-y-2">

                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  Current Frame
                </div>


                {[
                  {
                    label: 'Cars',
                    value:
                      liveCounts.car,
                    icon: Car,
                  },
                  {
                    label: 'Buses',
                    value:
                      liveCounts.bus,
                    icon: Bus,
                  },
                  {
                    label: 'Bikes',
                    value:
                      liveCounts.bike,
                    icon: Bike,
                  },
                  {
                    label: 'Trucks',
                    value:
                      liveCounts.truck,
                    icon: Truck,
                  },
                  {
                    label: 'Pedestrians',
                    value:
                      liveCounts.pedestrian,
                    icon: User,
                  },
                  {
                    label: 'Potholes',
                    value:
                      liveCounts.pothole,
                    icon: AlertTriangle,
                  },
                ].map(
                  (item) => {
                    const Icon =
                      item.icon;

                    return (
                      <div
                        key={
                          item.label
                        }
                        className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
                      >

                        <div className="flex items-center gap-2">

                          <Icon className="w-3.5 h-3.5 text-cyan-400" />

                          <span className="text-[11px]">
                            {item.label}
                          </span>

                        </div>


                        <span className="font-mono font-bold text-cyan-400">
                          {
                            item.value
                          }
                        </span>

                      </div>
                    );
                  }
                )}

              </div>

            </>
          ) : (
            /* ================================================= */
            /* RECORDED COUNTERS */
            /* ================================================= */

            <>

              <div className="grid grid-cols-2 gap-3">

                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border)]">

                  <div className="text-[10px] uppercase text-[var(--text-muted)]">
                    Vehicles
                  </div>

                  <div className="text-lg font-bold font-mono text-cyan-400">
                    {videoVehicleCount}
                  </div>

                </div>


                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border)]">

                  <div className="text-[10px] uppercase text-[var(--text-muted)]">
                    Road Issues
                  </div>

                  <div className="text-lg font-bold font-mono text-orange-400">
                    {videoRoadIssueCount}
                  </div>

                </div>

              </div>


              <div className="space-y-2">

                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  AI Video Results
                </div>


                {[
                  {
                    label: 'Cars',
                    value:
                      videoCounts.car,
                    icon: Car,
                  },
                  {
                    label: 'Buses',
                    value:
                      videoCounts.bus,
                    icon: Bus,
                  },
                  {
                    label: 'Bikes',
                    value:
                      videoCounts.bike,
                    icon: Bike,
                  },
                  {
                    label: 'Trucks',
                    value:
                      videoCounts.truck,
                    icon: Truck,
                  },
                  {
                    label: 'Pedestrians',
                    value:
                      videoCounts.pedestrian,
                    icon: User,
                  },
                  {
                    label: 'Potholes',
                    value:
                      videoCounts.pothole,
                    icon: AlertTriangle,
                  },
                ].map(
                  (item) => {
                    const Icon =
                      item.icon;

                    return (
                      <div
                        key={
                          item.label
                        }
                        className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
                      >

                        <div className="flex items-center gap-2">

                          <Icon className="w-3.5 h-3.5 text-cyan-400" />

                          <span className="text-[11px]">
                            {item.label}
                          </span>

                        </div>


                        <span className="font-mono font-bold text-cyan-400">
                          {
                            item.value
                          }
                        </span>

                      </div>
                    );
                  }
                )}

              </div>

            </>
          )}


          {/* ================================================= */}
          {/* DETECTION EXPLANATION */}
          {/* ================================================= */}

          <div className="border-t border-[var(--border)] pt-4">

            <div className="flex items-center gap-2 mb-2">

              <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />

              <span className="text-[10px] font-bold uppercase">
                AI Vision
              </span>

            </div>


            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">

              Every detected object is highlighted directly in the video with its class name and confidence percentage.

            </p>

          </div>


          {/* ================================================= */}
          {/* RECENT DETECTIONS */}
          {/* ================================================= */}

          <div className="border-t border-[var(--border)] pt-4">

            <div className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-2">

              Detection Status

            </div>


            <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">

              <div className="flex items-center gap-2">

                <div
                  className={`w-2 h-2 rounded-full ${
                    mode === 'LIVE' &&
                    liveAIActive
                      ? 'bg-emerald-400 animate-pulse'
                      : mode ===
                        'RECORDED' &&
                        processing
                      ? 'bg-cyan-400 animate-pulse'
                      : 'bg-slate-500'
                  }`}
                />

                <span className="text-[11px] font-bold">

                  {mode === 'LIVE'
                    ? liveAIActive
                      ? 'LIVE AI ACTIVE'
                      : 'CAMERA READY'
                    : processing
                    ? 'VIDEO PROCESSING'
                    : processingComplete
                    ? 'AI VIDEO READY'
                    : 'VIDEO READY'}

                </span>

              </div>


              {mode === 'LIVE' && (
                <div className="mt-2 text-[9px] font-mono text-[var(--text-muted)]">

                  Total objects in current frame:
                  {' '}
                  {liveTotal}

                </div>
              )}

              {mode ===
                'RECORDED' &&
                processing && (
                  <div className="mt-2 text-[9px] font-mono text-[var(--text-muted)]">

                    Processing:
                    {' '}
                    {Math.round(
                      progress
                    )}
                    %

                  </div>
                )}

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}