import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Video, Music, X, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { compressVideo, CompressionProgress, formatFileSize, calculateCompressionRatio } from '@/utils/videoCompression';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept: string;
  maxSize: number;
  fileType: 'video' | 'audio' | 'document';
  selectedFile?: File | null;
  onRemove?: () => void;
  enableCompression?: boolean;
}

export const FileUpload = ({ 
  onFileSelect, 
  accept, 
  maxSize, 
  fileType, 
  selectedFile,
  onRemove,
  enableCompression = true
}: FileUploadProps) => {
  const [error, setError] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [originalSize, setOriginalSize] = useState<number | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: any[]) => {
    setError(null);
    
    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.errors[0]?.code === 'file-too-large') {
        setError(`File size must be less than ${maxSize / (1024 * 1024)}MB`);
      } else {
        setError('Invalid file type');
      }
      return;
    }

    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setOriginalSize(file.size);

      // If it's a video file and compression is enabled, compress it
      if (fileType === 'video' && enableCompression) {
        try {
          setIsCompressing(true);
          setCompressionProgress({ progress: 0, stage: 'analyzing' });

          const compressedFile = await compressVideo(
            file,
            {
              quality: 0.7, // More aggressive compression
              maxWidth: 1280,
              maxHeight: 720,
              maxSizeMB: 25, // Target smaller file size
              bitrate: 800000 // 800 kbps for better compression
            },
            (progress) => {
              setCompressionProgress(progress);
            }
          );

          setIsCompressing(false);
          setCompressionProgress(null);
          onFileSelect(compressedFile);
        } catch (compressionError) {
          console.error('Compression failed:', compressionError);
          setIsCompressing(false);
          setCompressionProgress(null);
          setError('Video compression failed. Using original file.');
          onFileSelect(file);
        }
      } else {
        onFileSelect(file);
      }
    }
  }, [onFileSelect, maxSize, fileType, enableCompression]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept.split(',').reduce((acc, type) => ({ ...acc, [type.trim()]: [] }), {}),
    maxSize,
    multiple: false,
    disabled: isCompressing
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getCompressionInfo = () => {
    if (originalSize && selectedFile && originalSize !== selectedFile.size) {
      const ratio = calculateCompressionRatio(originalSize, selectedFile.size);
      return {
        originalSize: formatFileSize(originalSize),
        compressedSize: formatFileSize(selectedFile.size),
        ratio: ratio
      };
    }
    return null;
  };

  const getFileIcon = () => {
    if (fileType === 'video') return Video;
    if (fileType === 'audio') return Music;
    return FileText;
  };

  const FileIcon = getFileIcon();
  const compressionInfo = getCompressionInfo();

  // Show compression progress
  if (isCompressing && compressionProgress) {
    return (
      <div className="border-2 border-dashed border-primary bg-primary-light rounded-lg p-6">
        <div className="flex flex-col items-center space-y-4">
          <div className="p-4 bg-primary rounded-full">
            <Loader2 className="w-8 h-8 text-primary-foreground animate-spin" />
          </div>
          <div className="text-center w-full">
            <p className="font-medium text-foreground mb-2">
              Compressing Video...
            </p>
            <Progress value={compressionProgress.progress} className="w-full mb-2" />
            <p className="text-sm text-muted-foreground capitalize">
              {compressionProgress.stage === 'initializing' && 'Loading compression engine...'}
              {compressionProgress.stage === 'analyzing' && 'Analyzing video...'}
              {compressionProgress.stage === 'compressing' && 'Compressing video...'}
              {compressionProgress.stage === 'finalizing' && 'Finalizing...'}
              {' '}{compressionProgress.progress}%
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedFile) {
    return (
      <div className="border-2 border-dashed border-accent bg-accent-light rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent rounded-lg">
              <FileIcon className="w-6 h-6 text-accent-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatFileSize(selectedFile.size)}
              </p>
              {compressionInfo && (
                <div className="text-xs text-muted-foreground mt-1">
                  <p>Original: {compressionInfo.originalSize}</p>
                  <p className="text-green-600">Reduced by {compressionInfo.ratio}%</p>
                </div>
              )}
            </div>
            <CheckCircle className="w-5 h-5 text-accent ml-2" />
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200",
          isDragActive 
            ? "border-primary bg-primary-light" 
            : "border-border hover:border-primary hover:bg-muted/50",
          error && "border-destructive bg-destructive/5",
          isCompressing && "pointer-events-none opacity-50"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-4">
          <div className={cn(
            "p-4 rounded-full transition-colors",
            isDragActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}>
            <Upload className="w-8 h-8" />
          </div>
          <div>
            <p className="font-medium text-foreground">
              {isDragActive ? (
                `Drop your ${fileType} file here`
              ) : (
                `Upload ${fileType} file`
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Drag and drop or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Max size: {maxSize / (1024 * 1024)}MB
              {fileType === 'video' && enableCompression && (
                <span className="block text-primary">Auto-compression enabled</span>
              )}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
};