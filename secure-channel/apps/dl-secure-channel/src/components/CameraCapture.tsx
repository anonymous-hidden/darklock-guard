import { useEffect, useRef, useState } from 'react';
import { Camera, X, Refresh } from './Icons';
import './CameraCapture.css';

interface Props {
  onCapture: (file: File) => void;
  onClose:   () => void;
}

export function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError]     = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [flash, setFlash]     = useState(false);

  const startCamera = async (facing: 'user' | 'environment') => {
    // Stop any existing stream
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError('');
    } catch {
      setError('Camera not available. Check permissions.');
    }
  };

  useEffect(() => {
    startCamera(facingMode);
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flipCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startCamera(next);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
      onClose();
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="camera-overlay" onClick={onClose}>
      <div className="camera-modal" onClick={e => e.stopPropagation()}>
        <div className="camera-modal__header">
          <span>Camera</span>
          <button className="camera-modal__close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="camera-modal__viewfinder">
          {error ? (
            <p className="camera-modal__error">{error}</p>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="camera-modal__video" />
          )}
          {flash && <div className="camera-modal__flash" />}
        </div>
        <div className="camera-modal__controls">
          <button className="camera-modal__flip" onClick={flipCamera} title="Flip camera">
            <Refresh size={18} />
          </button>
          <button className="camera-modal__shutter" onClick={capture} title="Take photo" disabled={!!error}>
            <Camera size={22} />
          </button>
          <div style={{ width: 40 }} />
        </div>
      </div>
    </div>
  );
}
