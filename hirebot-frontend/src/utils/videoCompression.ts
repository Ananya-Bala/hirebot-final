export interface CompressionOptions {
  quality?: number; // 0.1 to 1.0, lower means more compression
  maxWidth?: number;
  maxHeight?: number;
  maxSizeMB?: number;
  targetFormat?: 'webm' | 'mp4';
  bitrate?: number; // Bitrate in bps
}

export interface CompressionProgress {
  progress: number; // 0-100
  stage: 'initializing' | 'analyzing' | 'compressing' | 'finalizing';
}

export const compressVideo = async (
  file: File,
  options: CompressionOptions = {},
  onProgress?: (progress: CompressionProgress) => void
): Promise<File> => {
  const {
    quality = 0.7,
    maxWidth = 1280,
    maxHeight = 720,
    maxSizeMB = 25,
    targetFormat = 'webm',
    bitrate = 800000 // 800 kbps
  } = options;

  try {
    onProgress?.({ progress: 5, stage: 'initializing' });

    // First try simple bitrate compression if the video is already a reasonable size
    if (file.size < maxSizeMB * 2 * 1024 * 1024) {
      // For smaller files, just try simple re-encoding with lower bitrate
      return await simpleVideoCompression(file, options, onProgress);
    }

    // For larger files, use the full compression pipeline
    return await fullVideoCompression(file, options, onProgress);

  } catch (error) {
    console.error('Video compression failed:', error);
    // If compression fails, return original file
    return file;
  }
};

// Simple compression that preserves audio better
const simpleVideoCompression = async (
  file: File,
  options: CompressionOptions,
  onProgress?: (progress: CompressionProgress) => void
): Promise<File> => {
  const { bitrate = 600000 } = options;
  
  onProgress?.({ progress: 20, stage: 'analyzing' });
  
  // Create video element
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = false;
  
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = reject;
  });

  onProgress?.({ progress: 40, stage: 'compressing' });

  // Try to use captureStream for better audio preservation
  let stream: MediaStream;
  try {
    stream = (video as any).captureStream?.() || (video as any).mozCaptureStream?.();
  } catch (error) {
    throw new Error('Browser does not support video capture');
  }

  // Choose codec with audio support
  let mimeType = 'video/webm;codecs=vp9,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8,opus';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 128000
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  return new Promise((resolve, reject) => {
    mediaRecorder.onstop = () => {
      onProgress?.({ progress: 100, stage: 'finalizing' });
      
      const compressedBlob = new Blob(chunks, { type: mimeType });
      const compressedFile = new File(
        [compressedBlob],
        file.name.replace(/\.[^/.]+$/, '.webm'),
        {
          type: 'video/webm',
          lastModified: Date.now(),
        }
      );

      URL.revokeObjectURL(video.src);
      resolve(compressedFile);
    };

    mediaRecorder.onerror = reject;
    
    mediaRecorder.start();
    video.play();
    
    // Stop recording when video ends
    video.onended = () => {
      mediaRecorder.stop();
    };
    
    // Update progress during playback
    video.ontimeupdate = () => {
      if (video.duration > 0) {
        const progress = 40 + (video.currentTime / video.duration) * 50;
        onProgress?.({ progress, stage: 'compressing' });
      }
    };
  });
};

// Full compression with canvas re-encoding
const fullVideoCompression = async (
  file: File,
  options: CompressionOptions,
  onProgress?: (progress: CompressionProgress) => void
): Promise<File> => {
  const {
    maxWidth = 1280,
    maxHeight = 720,
    bitrate = 800000
  } = options;

  try {
    onProgress?.({ progress: 5, stage: 'initializing' });

    // Create video element to analyze the input
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.crossOrigin = 'anonymous';
    
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });

    onProgress?.({ progress: 15, stage: 'analyzing' });

    // Calculate new dimensions maintaining aspect ratio
    const { videoWidth, videoHeight, duration } = video;
    let newWidth = videoWidth;
    let newHeight = videoHeight;

    if (videoWidth > maxWidth || videoHeight > maxHeight) {
      const aspectRatio = videoWidth / videoHeight;
      if (videoWidth > videoHeight) {
        newWidth = Math.min(maxWidth, videoWidth);
        newHeight = newWidth / aspectRatio;
      } else {
        newHeight = Math.min(maxHeight, videoHeight);
        newWidth = newHeight * aspectRatio;
      }
    }

    // Make sure dimensions are even numbers (required for some encoders)
    newWidth = Math.round(newWidth / 2) * 2;
    newHeight = Math.round(newHeight / 2) * 2;

    onProgress?.({ progress: 25, stage: 'compressing' });

    // Create canvas for video processing
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d')!;

    // Create a video element for audio extraction
    const audioVideo = document.createElement('video');
    audioVideo.src = URL.createObjectURL(file);
    audioVideo.muted = false;
    audioVideo.crossOrigin = 'anonymous';
    
    await new Promise((resolve) => {
      audioVideo.onloadedmetadata = resolve;
    });

    // Capture streams
    const videoStream = canvas.captureStream(30);
    
    // Try to capture audio using captureStream from the video element
    let combinedStream: MediaStream;
    try {
      const audioVideoStream = (audioVideo as any).captureStream?.() || audioVideo.srcObject;
      
      if (audioVideoStream && audioVideoStream.getAudioTracks().length > 0) {
        // Combine video and audio streams
        combinedStream = new MediaStream();
        videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
        audioVideoStream.getAudioTracks().forEach((track: MediaStreamTrack) => combinedStream.addTrack(track));
      } else {
        // Fallback: just use video stream
        combinedStream = videoStream;
        console.warn('Could not extract audio, compressing video only');
      }
    } catch (error) {
      console.warn('Audio extraction failed, using video-only compression:', error);
      combinedStream = videoStream;
    }
    
    // Choose the best available codec with audio support
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp9';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 128000 // 128 kbps for audio
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    return new Promise((resolve, reject) => {
      mediaRecorder.onstop = () => {
        onProgress?.({ progress: 95, stage: 'finalizing' });
        
        const compressedBlob = new Blob(chunks, { type: mimeType });
        const compressedFile = new File(
          [compressedBlob],
          file.name.replace(/\.[^/.]+$/, '.webm'),
          {
            type: 'video/webm',
            lastModified: Date.now(),
          }
        );

        onProgress?.({ progress: 100, stage: 'finalizing' });
        
        // Clean up URLs
        URL.revokeObjectURL(video.src);
        URL.revokeObjectURL(audioVideo.src);
        
        resolve(compressedFile);
      };

      mediaRecorder.onerror = (error) => {
        URL.revokeObjectURL(video.src);
        URL.revokeObjectURL(audioVideo.src);
        reject(error);
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms

      // Start audio video playback for audio synchronization
      audioVideo.currentTime = 0;
      audioVideo.play().catch(console.warn);

      // Process video frame by frame
      let currentTime = 0;
      const frameRate = 1 / 30; // 30 fps
      let frameCount = 0;
      const totalFrames = Math.ceil(duration * 30);
      
      const processFrame = () => {
        if (currentTime >= duration) {
          mediaRecorder.stop();
          audioVideo.pause();
          return;
        }

        video.currentTime = currentTime;
        // Sync audio video time
        audioVideo.currentTime = currentTime;
      };

      const onSeeked = () => {
        // Draw current frame to canvas
        ctx.drawImage(video, 0, 0, newWidth, newHeight);
        
        frameCount++;
        const progress = Math.min(90, 25 + (frameCount / totalFrames) * 65);
        onProgress?.({ progress, stage: 'compressing' });
        
        currentTime += frameRate;
        
        // Process next frame after a short delay
        setTimeout(processFrame, 33); // ~30fps
      };

      video.addEventListener('seeked', onSeeked);
      
      // Start processing
      processFrame();
    });

  } catch (error) {
    throw error;
  }
};

export const getVideoMetadata = (file: File): Promise<{
  duration: number;
  width: number;
  height: number;
  size: number;
}> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        size: file.size,
      });
      URL.revokeObjectURL(video.src);
    };

    video.onerror = reject;
    video.src = URL.createObjectURL(file);
  });
};

export const calculateCompressionRatio = (originalSize: number, compressedSize: number): number => {
  return Math.round(((originalSize - compressedSize) / originalSize) * 100);
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
