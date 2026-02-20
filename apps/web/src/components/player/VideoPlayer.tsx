import { useRef, useEffect } from "react";
import { Play, Pause, Maximize, Volume2, VolumeX, AlertCircle } from "lucide-react";
import { useMediaSource } from "../../hooks/useMediaSource";

interface VideoPlayerProps {
  mimeType: string;
  autoPlay?: boolean;
  onReady?: () => void;
  onError?: (error: string) => void;
}

export function VideoPlayer({ mimeType, autoPlay = true, onReady, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isReady, error, appendChunk } = useMediaSource({ mimeType, videoRef });
  
  useEffect(() => {
    if (isReady && onReady) onReady();
  }, [isReady, onReady]);

  useEffect(() => {
    if (error && onError) onError(error);
  }, [error, onError]);

  return (
    <div className="relative group w-full bg-black rounded-xl overflow-hidden aspect-video">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls={false}
        autoPlay={autoPlay}
      />
      
      {/* Overlay controls - simplified for now */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
        <PlayerControls videoRef={videoRef} />
      </div>

      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-500/90 text-white p-3 rounded-lg flex items-center gap-3 backdrop-blur-sm">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
    </div>
  );
}

function PlayerControls({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
  };

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
        {videoRef.current?.paused ? <Play size={24} /> : <Pause size={24} />}
      </button>
      
      <div className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer overflow-hidden relative">
        {/* Seek bar track */}
        <div className="absolute top-0 left-0 h-full bg-primary w-1/3" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={toggleMute} className="text-white hover:text-primary transition-colors">
          {videoRef.current?.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <button onClick={toggleFullscreen} className="text-white hover:text-primary transition-colors">
          <Maximize size={20} />
        </button>
      </div>
    </div>
  );
}
