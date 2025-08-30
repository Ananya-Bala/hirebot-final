import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { StepIndicator } from './StepIndicator';
import { FileUpload } from './FileUpload';
import { AnalysisCard } from './AnalysisCard';
import { FileText, Video, Brain, MessageSquare, FileCheck, Award } from 'lucide-react';

interface AnalysisSession {
  sessionId: string;
  status: string;
  mediaType?: 'audio' | 'video';
  results: {
    cvAnalysis?: string;
    transcription?: string;
    faceAnalysis?: string;
    technicalAnalysis?: string;
    communicationAnalysis?: string;
    finalReport?: string;
  };
}

interface Step {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed';
}

const ANALYSIS_STEPS: Step[] = [
  { id: 1, title: 'Upload', description: 'Video & CV Upload', status: 'current' },
  { id: 2, title: 'CV Analysis', description: 'Resume Review', status: 'pending' },
  { id: 3, title: 'Video Transcription', description: 'Audio Extraction', status: 'pending' },
  { id: 4, title: 'Face Analysis', description: 'Visual Assessment', status: 'pending' },
  { id: 5, title: 'Technical Review', description: 'Skills Assessment', status: 'pending' },
  { id: 6, title: 'Communication', description: 'Speaking Style', status: 'pending' },
  { id: 7, title: 'Final Report', description: 'Complete Analysis', status: 'pending' },
];

export const HireBotApp = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [steps, setSteps] = useState(ANALYSIS_STEPS);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [analysisStates, setAnalysisStates] = useState({
    cv: 'pending' as 'pending' | 'processing' | 'completed' | 'error' | 'fallback',
    media: 'pending' as 'pending' | 'processing' | 'completed' | 'error' | 'fallback',
    face: 'pending' as 'pending' | 'processing' | 'completed' | 'error' | 'fallback',
    technical: 'pending' as 'pending' | 'processing' | 'completed' | 'error',
    communication: 'pending' as 'pending' | 'processing' | 'completed' | 'error',
    final: 'pending' as 'pending' | 'processing' | 'completed' | 'error',
  });

  const updateStepStatus = useCallback((stepId: number, status: 'pending' | 'current' | 'completed') => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status } : step
    ));
  }, []);

  const handleInitialize = async () => {
    if (!videoFile || !cvFile || !jobDescription.trim()) {
      toast({
        title: "Missing Information",
        description: "Please upload a video file, CV, and provide a job description.",
        variant: "destructive"
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('cv', cvFile);
      formData.append('jobDescription', jobDescription);

      // Note: Replace with actual API endpoint
      const response = await fetch('http://localhost:3000/api/initialize', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to initialize session');
      }

      const data = await response.json();
      setSession({
        ...data,
        mediaType: 'video',
        results: data.results || {}
      });
      
      // Update step status
      updateStepStatus(1, 'completed');
      updateStepStatus(2, 'current');
      setCurrentStep(2);

      toast({
        title: "Session Initialized",
        description: "Files uploaded successfully. Ready to start analysis.",
      });

    } catch (error) {
      toast({
        title: "Initialization Failed",
        description: "Failed to upload files and initialize session.",
        variant: "destructive"
      });
    }
  };

  const handleAnalysisStep = async (type: keyof typeof analysisStates, endpoint: string) => {
    if (!session) return;

    setAnalysisStates(prev => ({ ...prev, [type]: 'processing' }));

    try {
      const response = await fetch(`${endpoint}/${session.sessionId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Analysis failed');
      }

      const data = await response.json();
      
      // Handle fallback mode
      if (data.processingInfo?.usedFallback) {
        setAnalysisStates(prev => ({ ...prev, [type]: 'fallback' }));
        toast({
          title: "Fallback Mode Used",
          description: data.note || "Using fallback analysis due to API overload.",
          variant: "default"
        });
      } else {
        setAnalysisStates(prev => ({ ...prev, [type]: 'completed' }));
        toast({
          title: "Analysis Complete",
          description: `${type.charAt(0).toUpperCase() + type.slice(1)} analysis completed successfully.`,
        });
      }
      
      // Update session with results
      const resultKey = type === 'cv' ? 'cvAnalysis' : 
                       type === 'media' ? 'transcription' : 
                       type === 'face' ? 'faceAnalysis' :
                       type === 'final' ? 'finalReport' :
                       type + 'Analysis';
      
      setSession(prev => prev ? {
        ...prev,
        results: { 
          ...prev.results, 
          [resultKey]: data[resultKey] || data.result || data.cvAnalysis || data.transcription || data.faceAnalysis || data.finalReport
        }
      } : null);

      // Update step progress - all sessions are now video-based
      const stepMap: Record<string, number> = { cv: 2, media: 3, face: 4, technical: 5, communication: 6, final: 7 };
      
      const currentStepNum = stepMap[type];
      updateStepStatus(currentStepNum, 'completed');
      
      const maxStep = 7;
      if (currentStepNum < maxStep) {
        updateStepStatus(currentStepNum + 1, 'current');
        setCurrentStep(currentStepNum + 1);
      }

    } catch (error) {
      setAnalysisStates(prev => ({ ...prev, [type]: 'error' }));
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : `Failed to complete ${type} analysis.`,
        variant: "destructive"
      });
    }
  };

  const handleRetryStep = async (type: keyof typeof analysisStates) => {
    if (!session) return;

    try {
      const stepName = type === 'cv' ? 'cv_analysis' : 
                      type === 'media' ? 'transcription' : 
                      type === 'face' ? 'face_analysis' :
                      type + '_analysis';
      const response = await fetch(`http://localhost:3000/api/retry/${session.sessionId}/${stepName}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Retry failed');
      }

      toast({
        title: "Retrying Analysis",
        description: `Retrying ${type} analysis...`,
      });

      // The retry endpoint will redirect to the appropriate analysis endpoint
      // so we can just refresh the page or poll for updates
      
    } catch (error) {
      toast({
        title: "Retry Failed",
        description: `Failed to retry ${type} analysis.`,
        variant: "destructive"
      });
    }
  };

  const canProceed = videoFile && cvFile && jobDescription.trim();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <StepIndicator steps={steps} currentStep={currentStep} />

      <div className="mt-12 space-y-8">
        {/* Step 1: File Upload and Job Description */}
        {currentStep >= 1 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-6 h-6 text-primary" />
                <span>Upload Files & Job Description</span>
              </CardTitle>
                <CardDescription>
                 Upload the candidate's video interview, CV/resume, and provide the job description for analysis.
               </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <div className="space-y-3">
                   <Label htmlFor="video-upload" className="text-base font-medium">
                     Video Interview
                   </Label>
                   <p className="text-sm text-muted-foreground">
                     Upload your interview video. Audio will be extracted automatically for transcription and analysis.
                   </p>
                   <FileUpload
                     onFileSelect={setVideoFile}
                     accept="video/mp4,video/avi,video/mov,video/wmv,video/webm,video/mkv,video/flv"
                     maxSize={200 * 1024 * 1024} // 200MB before compression
                     fileType="video"
                     selectedFile={videoFile}
                     onRemove={() => setVideoFile(null)}
                     enableCompression={true}
                   />
                 </div>
                 <div className="space-y-3">
                   <Label htmlFor="cv-upload" className="text-base font-medium">
                     CV/Resume
                   </Label>
                   <FileUpload
                     onFileSelect={setCvFile}
                     accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                     maxSize={10 * 1024 * 1024} // 10MB
                     fileType="document"
                     selectedFile={cvFile}
                     onRemove={() => setCvFile(null)}
                   />
                 </div>
               </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="candidate-name" className="text-base font-medium">
                    Candidate Name (Optional)
                  </Label>
                  <Input
                    id="candidate-name"
                    type="text"
                    placeholder="Enter candidate's name for PDF report"
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                  />
                </div>
                <div className="space-y-3">
                  <Label htmlFor="job-title" className="text-base font-medium">
                    Job Title (Optional)
                  </Label>
                  <Input
                    id="job-title"
                    type="text"
                    placeholder="e.g., Software Engineer, Product Manager"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <Label htmlFor="job-description" className="text-base font-medium">
                  Job Description
                </Label>
                <Textarea
                  id="job-description"
                  placeholder="Paste the complete job description including requirements, responsibilities, and qualifications..."
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  rows={6}
                  className="resize-none"
                />
              </div>
              <Button
                onClick={handleInitialize}
                disabled={!canProceed || !!session}
                size="lg"
                className="w-full"
              >
                {session ? 'Session Initialized' : 'Initialize Analysis'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Analysis Steps */}
        {session && currentStep >= 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AnalysisCard
              title="CV Analysis"
              description="Analyze candidate's background, skills, and experience"
              status={analysisStates.cv}
              result={session.results.cvAnalysis}
              onStart={() => handleAnalysisStep('cv', 'http://localhost:3000/api/analyze-cv')}
              onRetry={() => handleRetryStep('cv')}
              isDisabled={analysisStates.cv === 'processing'}
              processingText="Analyzing CV content..."
            />
            
            <AnalysisCard
              title="Video Transcription"
              description="Extract audio and transcribe interview content"
              status={analysisStates.media}
              result={session.results.transcription}
              onStart={() => handleAnalysisStep('media', 'http://localhost:3000/api/transcribe-media')}
              onRetry={() => handleRetryStep('media')}
              isDisabled={analysisStates.media === 'processing' || (analysisStates.cv !== 'completed' && analysisStates.cv !== 'fallback')}
              processingText="Extracting audio and transcribing content..."
            />

            <AnalysisCard
              title="Face Analysis"
              description="Analyze facial expressions and non-verbal communication"
              status={analysisStates.face}
              result={session.results.faceAnalysis}
              onStart={() => handleAnalysisStep('face', 'http://localhost:3000/api/face-analysis')}
              onRetry={() => handleRetryStep('face')}
              isDisabled={analysisStates.face === 'processing' || (analysisStates.media !== 'completed' && analysisStates.media !== 'fallback')}
              processingText="Analyzing facial expressions..."
            />
            
            <AnalysisCard
              title="Technical Assessment"
              description="Evaluate technical competency and job fit"
              status={analysisStates.technical}
              result={session.results.technicalAnalysis}
              onStart={() => handleAnalysisStep('technical', 'http://localhost:3000/api/technical-analysis')}
              isDisabled={analysisStates.technical === 'processing' || 
                         (analysisStates.face !== 'completed' && analysisStates.face !== 'fallback')}
              processingText="Analyzing technical skills..."
            />
            
            <AnalysisCard
              title="Communication Analysis"
              description="Assess speaking style and communication skills"
              status={analysisStates.communication}
              result={session.results.communicationAnalysis}
              onStart={() => handleAnalysisStep('communication', 'http://localhost:3000/api/communication-analysis')}
              isDisabled={analysisStates.communication === 'processing' || analysisStates.technical !== 'completed'}
              processingText="Analyzing communication style..."
            />
          </div>
        )}

        {/* Final Report */}
        {session && currentStep >= 7 && (
          <Card className="shadow-xl border-accent/50">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-xl">
                <Award className="w-7 h-7 text-accent" />
                <span>Final Report</span>
              </CardTitle>
              <CardDescription>
                Comprehensive interview assessment and hiring recommendation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AnalysisCard
                title="Complete Interview Analysis"
                description="Generate final hiring recommendation with detailed insights"
                status={analysisStates.final}
                result={session.results.finalReport}
                onStart={() => handleAnalysisStep('final', 'http://localhost:3000/api/final-report')}
                isDisabled={analysisStates.final === 'processing' || analysisStates.communication !== 'completed'}
                processingText="Generating final report..."
                showPDFButton={true}
                sessionId={session.sessionId}
                candidateName={candidateName || "Candidate"}
                jobTitle={jobTitle || "Position"}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};