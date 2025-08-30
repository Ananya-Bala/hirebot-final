const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const FormData = require('form-data');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!require('fs').existsSync(uploadDir)) {
      require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for audio, 10MB enforced separately for video
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'audio') {
      const audioMimes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 
        'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/webm',
        'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/m4a'
      ];
      if (audioMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid audio format. Please upload MP3, WAV, AAC, OGG, FLAC, or M4A files.'));
      }
    } else if (file.fieldname === 'video') {
      const videoMimes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'];
      if (videoMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid video format. Please upload MP4, AVI, MOV, WMV, or WebM files.'));
      }
    } else if (file.fieldname === 'cv') {
      const docMimes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
      if (docMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid CV format. Please upload PDF, DOC, DOCX, or TXT files.'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// Gemini API configuration
const GEMINI_API_KEY = 'AIzaSyDFgm0C4tfByDAcEgOPQpEI2vUurDDDzIA';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Helper function to call Gemini API with retry logic and error handling
async function callGeminiAPI(prompt, fileData = null, retries = 3) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Gemini API attempt ${attempt}/${retries}`);
      
      const requestBody = {
        contents: [
          {
            parts: []
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      };

      // Add text prompt
      requestBody.contents[0].parts.push({
        text: prompt
      });

      // Add file data if provided
      if (fileData) {
        // For large files, we might need to handle them differently
        const fileSizeMB = Buffer.byteLength(fileData.data, 'base64') / (1024 * 1024);
        console.log(`Processing file of size: ${fileSizeMB.toFixed(2)} MB`);
        
        if (fileSizeMB > 20) {
          throw new Error('File too large for processing. Please use a smaller file (< 20MB).');
        }
        
        requestBody.contents[0].parts.push({
          inline_data: {
            mime_type: fileData.mimeType,
            data: fileData.data
          }
        });
      }

      const response = await axios.post(GEMINI_API_URL, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY
        },
        timeout: 120000 // 2 minute timeout
      });

      if (response.data.candidates && response.data.candidates[0] && response.data.candidates[0].content) {
        console.log('Gemini API call successful');
        return response.data.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Invalid response format from Gemini API');
      }

    } catch (error) {
      console.error(`Gemini API Error (attempt ${attempt}):`, error.response?.data || error.message);
      
      const errorCode = error.response?.data?.error?.code;
      const errorMessage = error.response?.data?.error?.message || error.message;
      
      // Handle specific error codes
      if (errorCode === 503 || errorMessage.includes('overloaded')) {
        console.log(`API overloaded, waiting before retry ${attempt}/${retries}`);
        if (attempt < retries) {
          // Much longer backoff for overloaded API: 30s, 120s, 300s
          const waitTimes = [30000, 120000, 300000]; // 30s, 2min, 5min
          const waitTime = waitTimes[attempt - 1] || 300000;
          console.log(`Waiting ${waitTime/1000}s before retry...`);
          await delay(waitTime);
          continue;
        }
        throw new Error('OVERLOADED');
      }
      
      if (errorCode === 429) {
        console.log(`Rate limit hit, waiting before retry ${attempt}/${retries}`);
        if (attempt < retries) {
          const waitTime = 30000 * attempt; // 30s, 60s, 90s
          console.log(`Waiting ${waitTime/1000}s before retry...`);
          await delay(waitTime);
          continue;
        }
        throw new Error('RATE_LIMITED');
      }
      
      if (errorCode === 400) {
        // Bad request - don't retry
        throw new Error(`INVALID_REQUEST: ${errorMessage}`);
      }
      
      if (attempt === retries) {
        throw new Error(`FAILED_AFTER_RETRIES: ${errorMessage}`);
      }
      
      // For other errors, wait before retry
      await delay(5000 * attempt);
    }
  }
}

// Helper function to convert file to base64
async function fileToBase64(filePath) {
  try {
    const fileBuffer = await fs.readFile(filePath);
    return fileBuffer.toString('base64');
  } catch (error) {
    throw new Error('Failed to read file');
  }
}

// Helper function to get file mime type
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    // Video formats
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.webm': 'video/webm',
    // Audio formats
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/m4a'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Fallback function for media transcription
function generateFallbackTranscription(fileName, mediaType, jobDescription) {
  return `
# ${mediaType.toUpperCase()} TRANSCRIPTION - FALLBACK MODE

**Note**: This is a fallback response generated because the AI service is currently overloaded. A placeholder transcription has been created to allow you to continue with the analysis workflow.

## Interview Recording Analysis Status
- **File**: ${fileName}
- **Type**: ${mediaType.toUpperCase()} file
- **Status**: Pending AI processing
- **Reason**: AI service temporarily unavailable

## Next Steps
1. You can continue with the technical analysis using your CV and job description
2. Retry the ${mediaType} transcription later when the service is available
3. Upload a smaller ${mediaType} file if the current one is large

## Placeholder Analysis Structure

### Speaker Identification
- **Interviewer**: [To be identified when AI service is available]
- **Candidate**: [To be identified when AI service is available]

### Key Discussion Points
- Technical competency assessment
- Experience and background discussion
- Problem-solving approach
- Cultural fit evaluation

### Interview Summary
This ${mediaType} recording will be analyzed for:
- Communication clarity and style
- Technical knowledge demonstration
- Response quality and depth
- Overall interview performance
${mediaType === 'video' ? '- Facial expressions and body language\n- Visual engagement and confidence' : ''}

**To get the actual transcription${mediaType === 'video' ? ' and face analysis' : ''}, please retry this step when the AI service is available.**
  `;
}

// Fallback function for face analysis
function generateFallbackFaceAnalysis(fileName, jobDescription) {
  return `
# FACE ANALYSIS - FALLBACK MODE

**Note**: This is a fallback response generated because the AI service is currently overloaded. A placeholder face analysis has been created to allow you to continue with the analysis workflow.

## Video Face Analysis Status
- **File**: ${fileName}
- **Status**: Pending AI processing
- **Reason**: AI service temporarily unavailable

## Placeholder Analysis Structure

### Facial Expression Analysis
- **Confidence Indicators**: [To be analyzed when AI service is available]
- **Engagement Level**: [To be analyzed when AI service is available]
- **Emotional State**: [To be analyzed when AI service is available]

### Non-Verbal Communication
- **Eye Contact**: [To be analyzed when AI service is available]
- **Facial Gestures**: [To be analyzed when AI service is available]
- **Overall Demeanor**: [To be analyzed when AI service is available]

### Professional Presence
- **Visual Confidence**: [To be analyzed when AI service is available]
- **Attentiveness**: [To be analyzed when AI service is available]
- **Communication Style**: [To be analyzed when AI service is available]

**To get the actual face analysis, please retry this step when the AI service is available.**
  `;
}

// Enhanced fallback for CV analysis
function generateFallbackCVAnalysis(fileName, jobDescription) {
  return `
# CV ANALYSIS - FALLBACK MODE

**Note**: This is a fallback response generated because the AI service is currently overloaded. A placeholder analysis has been created to allow you to continue with the workflow.

## CV Analysis Status
- **File**: ${fileName}
- **Status**: Pending AI processing
- **Job Role**: ${jobDescription.substring(0, 100)}...

## Placeholder Structure

### Personal Information
- Name: [To be extracted from CV]
- Contact: [To be extracted from CV]
- Title: [To be extracted from CV]

### Key Areas to Analyze
1. **Technical Skills**: Programming languages, frameworks, tools
2. **Experience**: Previous roles and responsibilities
3. **Education**: Degrees, certifications, training
4. **Projects**: Notable work and achievements
5. **Career Growth**: Progression and development

### Analysis Framework
- Skills alignment with job requirements
- Experience relevance assessment
- Growth potential evaluation
- Cultural fit indicators

**To get the detailed CV analysis, please retry this step when the AI service is available.**
  `;
}

// Store analysis sessions in memory (in production, use a database)
const analysisSessions = new Map();

// Route: Initialize analysis session (audio or video support)
app.post('/api/initialize', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'cv', maxCount: 1 }
]), async (req, res) => {
  try {
    // 🔎 Debug logs (add these lines)
    console.log("BODY:", req.body);
    console.log("FILES:", req.files);

    const { jobDescription } = req.body;
    const audioFile = req.files?.audio?.[0];
    const videoFile = req.files?.video?.[0];
    const cvFile = req.files?.cv?.[0];


    // Require either audio or video file, plus CV and job description
    if ((!audioFile && !videoFile) || !cvFile || !jobDescription) {
      return res.status(400).json({ 
        error: 'Missing required fields: (audio OR video), cv, and jobDescription are required' 
      });
    }

    // Check video file size limit (10MB)
    if (videoFile) {
      const videoSizeMB = videoFile.size / (1024 * 1024);
      if (videoSizeMB > 10) {
        return res.status(400).json({ 
          error: 'Video file too large',
          message: 'Video files must be smaller than 10MB. Please compress your video file.',
          currentSize: `${videoSizeMB.toFixed(2)}MB`,
          maxSize: '10MB'
        });
      }
    }

    // Generate session ID
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    // Initialize session data
    const sessionData = {
      sessionId,
      audioPath: audioFile?.path,
      videoPath: videoFile?.path,
      cvPath: cvFile.path,
      jobDescription,
      mediaType: videoFile ? 'video' : 'audio',
      status: 'initialized',
      createdAt: new Date(),
      results: {}
    };

    analysisSessions.set(sessionId, sessionData);

    const mediaFile = videoFile || audioFile;
    
    res.json({
      success: true,
      sessionId,
      message: 'Analysis session initialized successfully',
      files: {
        media: {
          type: sessionData.mediaType,
          name: mediaFile.originalname,
          size: `${(mediaFile.size / (1024 * 1024)).toFixed(2)}MB`
        },
        cv: cvFile.originalname
      }
    });

  } catch (error) {
    console.error('Initialize error:', error);
    res.status(500).json({ error: 'Failed to initialize analysis session' });
  }
});

// Route: Step 1 - CV Analysis with Fallback
app.post('/api/analyze-cv/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'analyzing_cv';

    // Simplified CV analysis prompt
    const cvAnalysisPrompt = `
    Analyze this CV and provide:

    1. **Candidate Overview**: Name, title, key background
    2. **Skills Summary**: Technical and soft skills
    3. **Experience**: Work history and achievements
    4. **Education**: Qualifications and certifications
    5. **Strengths**: Key candidate strengths
    6. **Job Fit**: Alignment with requirements

    Keep the analysis concise and structured.
    `;

    let cvAnalysis;
    let usedFallback = false;

    try {
      // Read CV file and convert to base64
      const cvBase64 = await fileToBase64(session.cvPath);
      const cvMimeType = getMimeType(session.cvPath);

      // Reduced retries for faster fallback
      cvAnalysis = await callGeminiAPI(cvAnalysisPrompt, {
        mimeType: cvMimeType,
        data: cvBase64
      }, 2);

    } catch (error) {
      console.error('CV Analysis error:', error.message);
      
      // Use fallback if API is overloaded
      if (error.message.includes('OVERLOADED') || error.message.includes('503')) {
        console.log('Using fallback CV analysis due to API overload');
        cvAnalysis = generateFallbackCVAnalysis(
          path.basename(session.cvPath),
          session.jobDescription
        );
        usedFallback = true;
        session.status = 'cv_analyzed_fallback';
      } else {
        session.status = 'error';
        return res.status(500).json({ 
          error: 'Failed to analyze CV',
          message: 'CV analysis failed. You can continue with fallback mode.',
          canUseFallback: true
        });
      }
    }

    // Store CV analysis results
    session.results.cvAnalysis = cvAnalysis;
    if (!usedFallback) {
      session.status = 'cv_analyzed';
    }

    res.json({
      success: true,
      sessionId,
      cvAnalysis,
      nextStep: 'media_transcription',
      processingInfo: {
        usedFallback: usedFallback,
        status: usedFallback ? 'fallback_mode' : 'ai_processed'
      },
      note: usedFallback ? 'Fallback analysis used due to API overload. Retry later for AI analysis.' : null
    });

  } catch (error) {
    console.error('CV Analysis route error:', error);
    
    const session = analysisSessions.get(req.params.sessionId);
    if (session) {
      session.status = 'error';
    }
    
    res.status(500).json({ 
      error: 'Failed to analyze CV',
      message: 'An unexpected error occurred. Please try again or use fallback mode.'
    });
  }
});

// Route: Step 2 - Media Transcription (Audio/Video) with Fallback
app.post('/api/transcribe-media/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'transcribing_media';

    // Determine which media file to process
    const mediaPath = session.videoPath || session.audioPath;
    const mediaType = session.mediaType;

    if (!mediaPath) {
      return res.status(400).json({ error: 'No media file found for transcription' });
    }

    // Check file size before processing
    const stats = await fs.stat(mediaPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`Processing ${mediaType} file: ${fileSizeMB.toFixed(2)} MB`);

    // Different size limits for audio vs video
    const maxSize = mediaType === 'audio' ? 25 : 10; // 25MB for audio, 10MB for video
    
    if (fileSizeMB > maxSize) {
      session.status = 'error';
      return res.status(400).json({ 
        error: `${mediaType} file too large for processing`,
        message: `Please upload a ${mediaType} file smaller than ${maxSize}MB. Consider compressing the file.`
      });
    }

    // Optimized prompt based on media type
    const transcriptionPrompt = mediaType === 'video' ? `
    Analyze this video recording of an interview and provide:

    1. **Complete Transcription**: Full text transcription with speaker identification (Interviewer/Candidate)
    2. **Key Discussion Points**: Main topics and themes covered
    3. **Questions & Responses**: Important interview questions and candidate answers
    4. **Communication Style**: Speaking patterns, clarity, and confidence indicators
    5. **Technical Content**: Any technical discussions or problem-solving moments
    6. **Visual Engagement**: Eye contact, attentiveness, and visual confidence
    7. **Interview Summary**: Brief overview of the conversation

    Focus on both audio content and visual behavior. Keep the response well-structured and comprehensive.
    ` : `
    Analyze this audio recording of an interview and provide:

    1. **Complete Transcription**: Full text transcription with speaker identification (Interviewer/Candidate)
    2. **Key Discussion Points**: Main topics and themes covered
    3. **Questions & Responses**: Important interview questions and candidate answers
    4. **Communication Style**: Speaking patterns, clarity, and confidence indicators
    5. **Technical Content**: Any technical discussions or problem-solving moments
    6. **Interview Summary**: Brief overview of the conversation

    Focus on accuracy and clear speaker identification. Keep the response well-structured and comprehensive.
    `;

    let transcriptionResult;
    let usedFallback = false;

    try {
      // Different processing limits based on media type
      const processingSizeLimit = mediaType === 'audio' ? 20 : 8; // 20MB for audio, 8MB for video
      
      if (fileSizeMB > processingSizeLimit) {
        throw new Error(`File too large for current API conditions (${processingSizeLimit}MB limit)`);
      }

      // Read media file and convert to base64
      const mediaBase64 = await fileToBase64(mediaPath);
      const mediaMimeType = getMimeType(mediaPath);

      console.log(`Processing ${mediaType} file with MIME type: ${mediaMimeType}`);

      // Try processing with the API
      transcriptionResult = await callGeminiAPI(transcriptionPrompt, {
        mimeType: mediaMimeType,
        data: mediaBase64
      }, 3); // 3 retries

    } catch (error) {
      console.error(`${mediaType} processing error:`, error.message);
      
      // Check if it's an overload error and use fallback
      if (error.message.includes('OVERLOADED') || error.message.includes('503')) {
        console.log(`Using fallback transcription due to API overload for ${mediaType}`);
        transcriptionResult = generateFallbackTranscription(
          path.basename(mediaPath),
          mediaType,
          session.jobDescription
        );
        usedFallback = true;
        session.status = `${mediaType}_transcribed_fallback`;
      } else {
        session.status = 'error';
        
        // Provide specific error messages
        if (error.message.includes('RATE_LIMITED')) {
          return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please wait 10 minutes before trying again.',
            retryAfter: 600,
            canUseFallback: true
          });
        } else if (error.message.includes('File too large')) {
          return res.status(400).json({ 
            error: 'File too large for current conditions',
            message: `Due to high API load, please use a ${mediaType} file smaller than ${processingSizeLimit}MB.`,
            suggestion: `Compress your ${mediaType} file or try again later.`
          });
        } else {
          return res.status(500).json({ 
            error: `Failed to transcribe ${mediaType}`,
            message: `${mediaType} processing failed. You can continue with a fallback analysis.`,
            canUseFallback: true
          });
        }
      }
    }

    // Store transcription results
    session.results.transcription = transcriptionResult;
    if (!usedFallback) {
      session.status = `${mediaType}_transcribed`;
    }

    res.json({
      success: true,
      sessionId,
      transcription: transcriptionResult,
      nextStep: mediaType === 'video' ? 'face_analysis' : 'technical_analysis',
      processingInfo: {
        mediaType: mediaType,
        fileSizeMB: fileSizeMB.toFixed(2),
        usedFallback: usedFallback,
        status: usedFallback ? 'fallback_mode' : 'ai_processed'
      },
      note: usedFallback ? `Fallback transcription used due to API overload. Retry later for AI analysis.` : null
    });

  } catch (error) {
    console.error('Media transcription route error:', error);
    
    // Update session status
    const session = analysisSessions.get(req.params.sessionId);
    if (session) {
      session.status = 'error';
    }
    
    res.status(500).json({ 
      error: 'Failed to transcribe media',
      message: 'An unexpected error occurred. Please try again or use fallback mode.',
      canRetry: true
    });
  }
});

// Route: Step 3 - Face Analysis (Video Only)
app.post('/api/face-analysis/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only process face analysis for video files
    if (session.mediaType !== 'video' || !session.videoPath) {
      return res.status(400).json({ 
        error: 'Face analysis only available for video files',
        message: 'This session does not contain a video file for face analysis.'
      });
    }

    session.status = 'analyzing_face';

    // Check file size
    const stats = await fs.stat(session.videoPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`Processing video for face analysis: ${fileSizeMB.toFixed(2)} MB`);

    if (fileSizeMB > 10) {
      session.status = 'error';
      return res.status(400).json({ 
        error: 'Video file too large for face analysis',
        message: 'Please upload a video file smaller than 10MB for face analysis.'
      });
    }

    const faceAnalysisPrompt = `
    Analyze the facial expressions and non-verbal communication in this video interview and provide:

    1. **Facial Expression Analysis**:
       - Overall confidence level observed in facial expressions
       - Emotional states throughout the interview (calm, nervous, engaged, etc.)
       - Consistency of expressions with verbal responses

    2. **Eye Contact and Engagement**:
       - Quality and consistency of eye contact with camera/interviewer
       - Level of visual engagement and attentiveness
       - Signs of distraction or focus

    3. **Non-Verbal Communication**:
       - Facial gestures and micro-expressions
       - Head movements and posture (visible portions)
       - Overall body language indicators

    4. **Professional Presence**:
       - Visual confidence and composure
       - Appropriate facial expressions for interview context
       - Professional demeanor assessment

    5. **Communication Synchronization**:
       - Alignment between facial expressions and verbal content
       - Authenticity indicators in expressions
       - Stress or comfort levels visible in face

    6. **Interview Readiness Indicators**:
       - Preparation and alertness visible in expressions
       - Enthusiasm and interest levels
       - Professional presentation

    7. **Recommendations**:
       - Visual communication strengths
       - Areas for improvement in non-verbal communication
       - Overall visual impression score (1-10)

    Focus on professional behavioral analysis suitable for interview assessment. Provide specific observations with timestamps when possible.
    `;

    let faceAnalysisResult;
    let usedFallback = false;

    try {
      // Stricter size limit for face analysis
      if (fileSizeMB > 8) {
        throw new Error('File too large for face analysis processing (8MB limit)');
      }

      // Read video file and convert to base64
      const videoBase64 = await fileToBase64(session.videoPath);
      const videoMimeType = getMimeType(session.videoPath);

      console.log(`Processing video for face analysis with MIME type: ${videoMimeType}`);

      // Try processing with the API
      faceAnalysisResult = await callGeminiAPI(faceAnalysisPrompt, {
        mimeType: videoMimeType,
        data: videoBase64
      }, 3);

    } catch (error) {
      console.error('Face analysis error:', error.message);
      
      // Check if it's an overload error and use fallback
      if (error.message.includes('OVERLOADED') || error.message.includes('503')) {
        console.log('Using fallback face analysis due to API overload');
        faceAnalysisResult = generateFallbackFaceAnalysis(
          path.basename(session.videoPath),
          session.jobDescription
        );
        usedFallback = true;
        session.status = 'face_analyzed_fallback';
      } else {
        session.status = 'error';
        
        if (error.message.includes('RATE_LIMITED')) {
          return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please wait 10 minutes before trying again.',
            retryAfter: 600,
            canUseFallback: true
          });
        } else if (error.message.includes('File too large')) {
          return res.status(400).json({ 
            error: 'File too large for face analysis',
            message: 'Due to high API load, please use a video file smaller than 8MB.',
            suggestion: 'Compress your video file or try again later.'
          });
        } else {
          return res.status(500).json({ 
            error: 'Failed to analyze face',
            message: 'Face analysis failed. You can continue with technical analysis.',
            canUseFallback: true
          });
        }
      }
    }

    // Store face analysis results
    session.results.faceAnalysis = faceAnalysisResult;
    if (!usedFallback) {
      session.status = 'face_analyzed';
    }

    res.json({
      success: true,
      sessionId,
      faceAnalysis: faceAnalysisResult,
      nextStep: 'technical_analysis',
      processingInfo: {
        fileSizeMB: fileSizeMB.toFixed(2),
        usedFallback: usedFallback,
        status: usedFallback ? 'fallback_mode' : 'ai_processed'
      },
      note: usedFallback ? 'Fallback face analysis used due to API overload. Retry later for AI analysis.' : null
    });

  } catch (error) {
    console.error('Face analysis route error:', error);
    
    const session = analysisSessions.get(req.params.sessionId);
    if (session) {
      session.status = 'error';
    }
    
    res.status(500).json({ 
      error: 'Failed to analyze face',
      message: 'An unexpected error occurred. Please try again or use fallback mode.'
    });
  }
});

// Route: Force fallback mode for any step
app.post('/api/fallback/:sessionId/:step', async (req, res) => {
  try {
    const { sessionId, step } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log(`Using fallback mode for step: ${step}`);

    let result;
    let nextStep;

    switch (step) {
      case 'cv_analysis':
        result = generateFallbackCVAnalysis(
          path.basename(session.cvPath),
          session.jobDescription
        );
        session.results.cvAnalysis = result;
        session.status = 'cv_analyzed_fallback';
        nextStep = 'media_transcription';
        break;

      case 'transcription':
        result = generateFallbackTranscription(
          path.basename(session.videoPath || session.audioPath),
          session.mediaType,
          session.jobDescription
        );
        session.results.transcription = result;
        session.status = `${session.mediaType}_transcribed_fallback`;
        nextStep = session.mediaType === 'video' ? 'face_analysis' : 'technical_analysis';
        break;

      case 'face_analysis':
        if (session.mediaType !== 'video') {
          return res.status(400).json({ 
            error: 'Face analysis not available',
            message: 'Face analysis is only available for video files.'
          });
        }
        result = generateFallbackFaceAnalysis(
          path.basename(session.videoPath),
          session.jobDescription
        );
        session.results.faceAnalysis = result;
        session.status = 'face_analyzed_fallback';
        nextStep = 'technical_analysis';
        break;

      default:
        return res.status(400).json({ 
          error: 'Fallback not available for this step',
          availableSteps: ['cv_analysis', 'transcription', 'face_analysis']
        });
    }

    res.json({
      success: true,
      sessionId,
      result,
      nextStep,
      mode: 'fallback',
      note: 'Fallback mode activated. Retry with AI when service is available.'
    });

  } catch (error) {
    console.error('Fallback error:', error);
    res.status(500).json({ error: 'Failed to generate fallback response' });
  }
});

// Route: Step 4 - Technical Analysis
app.post('/api/technical-analysis/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.results.transcription || !session.results.cvAnalysis) {
      return res.status(400).json({ error: 'Previous analysis steps not completed' });
    }

    session.status = 'analyzing_technical';

    // Include face analysis in prompt if available
    const faceAnalysisSection = session.results.faceAnalysis ? `
    **Face Analysis:**
    ${session.results.faceAnalysis}
    ` : '';

    const technicalAnalysisPrompt = `
    Based on the following information, provide a comprehensive technical analysis:

    **Job Description:**
    ${session.jobDescription}

    **CV Analysis:**
    ${session.results.cvAnalysis}

    **Interview Transcription:**
    ${session.results.transcription}
    ${faceAnalysisSection}

    Please provide analysis on:

    1. **Technical Competency Assessment**:
       - Evaluation of technical skills demonstrated
       - Knowledge depth in relevant technologies
       - Problem-solving approach
       - Technical communication clarity

    2. **Job Fit Analysis**:
       - How well the candidate matches job requirements
       - Skills alignment with job description
       - Experience relevance
       - Gap analysis

    3. **Technical Strengths**:
       - Key technical strengths observed
       - Areas of expertise
       - Innovative thinking or approaches

    4. **Areas for Improvement**:
       - Technical knowledge gaps
       - Skills that need development
       - Areas for growth

    5. **Technical Interview Performance**:
       - Quality of technical responses
       - Depth of understanding
       - Ability to explain complex concepts
       - Problem-solving methodology

    6. **Recommendations**:
       - Overall technical fit score (1-10)
       - Hiring recommendation
       - Suggested next steps
       - Training or development needs

    Please provide detailed analysis with specific examples from the interview${session.results.faceAnalysis ? ' and visual observations' : ''}.
    `;

    const technicalAnalysis = await callGeminiAPI(technicalAnalysisPrompt);

    // Store technical analysis results
    session.results.technicalAnalysis = technicalAnalysis;
    session.status = 'technical_analyzed';

    res.json({
      success: true,
      sessionId,
      technicalAnalysis,
      nextStep: 'communication_analysis'
    });

  } catch (error) {
    console.error('Technical Analysis error:', error);
    res.status(500).json({ error: 'Failed to perform technical analysis' });
  }
});

// Route: Step 5 - Communication & Speaking Style Analysis
app.post('/api/communication-analysis/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.results.transcription) {
      return res.status(400).json({ error: 'Transcription not available' });
    }

    session.status = 'analyzing_communication';

    // Include face analysis in prompt if available
    const faceAnalysisSection = session.results.faceAnalysis ? `
    **Face Analysis:**
    ${session.results.faceAnalysis}
    ` : '';

    const communicationAnalysisPrompt = `
    Based on the following interview data, provide a detailed analysis of the candidate's communication and speaking style:

    **Interview Transcription:**
    ${session.results.transcription}
    ${faceAnalysisSection}

    Please analyze and provide insights on:

    1. **Communication Clarity**:
       - How clearly the candidate expresses ideas
       - Use of appropriate terminology
       - Structure and organization of responses

    2. **Speaking Style**:
       - Confidence level
       - Pace and rhythm of speech
       - Tone and professionalism
       - Enthusiasm and engagement

    3. **Language Proficiency**:
       - Grammar and vocabulary usage
       - Fluency and articulation
       - Technical language appropriateness

    4. **Interpersonal Skills**:
       - Active listening demonstrated
       - Responsiveness to questions
       - Ability to build rapport
       - Collaborative communication style

    5. **Non-verbal Communication Indicators**${session.results.faceAnalysis ? ' (from speech patterns and visual analysis)' : ' (from speech patterns)'}:
       - Confidence indicators in speech${session.results.faceAnalysis ? ' and expressions' : ''}
       - Hesitation or uncertainty patterns
       - Enthusiasm and energy levels
       - Stress or nervousness indicators

    6. **Professional Communication**:
       - Appropriateness for business environment
       - Ability to explain complex topics simply
       - Question-asking and curiosity
       - Follow-up and clarification skills

    7. **Communication Strengths**:
       - Key communication strengths observed
       - Notable positive aspects

    8. **Areas for Communication Improvement**:
       - Specific areas needing development
       - Suggestions for improvement

    9. **Overall Communication Assessment**:
       - Communication effectiveness score (1-10)
       - Suitability for team collaboration
       - Client-facing capability assessment

    Please provide specific examples from the interview${session.results.faceAnalysis ? ' and visual observations' : ''} to support your analysis.
    `;

    const communicationAnalysis = await callGeminiAPI(communicationAnalysisPrompt);

    // Store communication analysis results
    session.results.communicationAnalysis = communicationAnalysis;
    session.status = 'communication_analyzed';

    res.json({
      success: true,
      sessionId,
      communicationAnalysis,
      nextStep: 'final_report'
    });

  } catch (error) {
    console.error('Communication Analysis error:', error);
    res.status(500).json({ error: 'Failed to perform communication analysis' });
  }
});

// Route: Step 6 - Generate Final Report
app.post('/api/final-report/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const requiredAnalyses = ['cvAnalysis', 'transcription', 'technicalAnalysis', 'communicationAnalysis'];
    const missingAnalyses = requiredAnalyses.filter(analysis => !session.results[analysis]);

    if (missingAnalyses.length > 0) {
      return res.status(400).json({ 
        error: 'Incomplete analysis', 
        missing: missingAnalyses 
      });
    }

    session.status = 'generating_final_report';

    // Include face analysis in final report if available
    const faceAnalysisSection = session.results.faceAnalysis ? `
    **Face Analysis:**
    ${session.results.faceAnalysis}
    ` : '';

    const finalReportPrompt = `
    Based on all the analyses conducted, please generate a comprehensive final interview assessment report:

    **Job Description:**
    ${session.jobDescription}

    **CV Analysis:**
    ${session.results.cvAnalysis}

    **Interview Transcription & Summary:**
    ${session.results.transcription}

    **Technical Analysis:**
    ${session.results.technicalAnalysis}

    **Communication Analysis:**
    ${session.results.communicationAnalysis}
    ${faceAnalysisSection}

    Please generate a comprehensive final report with the following structure:

    # INTERVIEW ASSESSMENT REPORT

    ## EXECUTIVE SUMMARY
    - Overall recommendation (Hire/No Hire/Consider)
    - Key strengths and concerns
    - Overall fit score (1-10)

    ## CANDIDATE PROFILE
    - Background summary from CV
    - Key qualifications and experience
    - Career progression assessment

    ## INTERVIEW PERFORMANCE ANALYSIS
    - Technical competency evaluation
    - Communication effectiveness
    - Problem-solving approach
    - Cultural fit indicators${session.results.faceAnalysis ? '\n    - Visual presence and non-verbal communication' : ''}

    ## STRENGTHS
    - Top 5 candidate strengths
    - Specific examples from interview

    ## AREAS FOR DEVELOPMENT
    - Key development areas
    - Skills gaps identified
    - Improvement recommendations

    ## JOB FIT ASSESSMENT
    - Alignment with job requirements
    - Skills match analysis
    - Experience relevance
    - Growth potential

    ## RECOMMENDATIONS
    - Hiring recommendation with rationale
    - Onboarding suggestions (if hired)
    - Training and development needs
    - Next steps in the hiring process

    ## SCORING BREAKDOWN
    - Technical Skills: X/10
    - Communication: X/10${session.results.faceAnalysis ? '\n    - Visual Presence: X/10' : ''}
    - Experience Fit: X/10
    - Cultural Fit: X/10
    - Overall Score: X/10

    ## ADDITIONAL NOTES
    - Any other relevant observations
    - Special considerations
    - Reference check suggestions

    Please make this report professional, detailed, and actionable for hiring managers.
    `;

    const finalReport = await callGeminiAPI(finalReportPrompt);

    // Store final report
    session.results.finalReport = finalReport;
    session.status = 'completed';
    session.completedAt = new Date();

    res.json({
      success: true,
      sessionId,
      finalReport,
      status: 'completed',
      message: 'Interview analysis completed successfully',
      analysisTypes: {
        cv: true,
        transcription: true,
        faceAnalysis: !!session.results.faceAnalysis,
        technical: true,
        communication: true
      }
    });

  } catch (error) {
    console.error('Final Report error:', error);
    res.status(500).json({ error: 'Failed to generate final report' });
  }
});

// Route: Get session status and results
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = analysisSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId: session.sessionId,
    status: session.status,
    mediaType: session.mediaType,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    results: session.results,
    jobDescription: session.jobDescription,
    analysisTypes: {
      cv: !!session.results.cvAnalysis,
      transcription: !!session.results.transcription,
      faceAnalysis: !!session.results.faceAnalysis,
      technical: !!session.results.technicalAnalysis,
      communication: !!session.results.communicationAnalysis,
      finalReport: !!session.results.finalReport
    }
  });
});

// Route: Get all available analysis steps
app.get('/api/steps', (req, res) => {
  res.json({
    steps: [
      {
        step: 1,
        name: 'initialize',
        description: 'Upload audio/video, CV, and job description',
        endpoint: '/api/initialize',
        method: 'POST'
      },
      {
        step: 2,
        name: 'cv_analysis',
        description: 'Analyze CV content',
        endpoint: '/api/analyze-cv/:sessionId',
        method: 'POST'
      },
      {
        step: 3,
        name: 'media_transcription',
        description: 'Transcribe and summarize audio/video',
        endpoint: '/api/transcribe-media/:sessionId',
        method: 'POST'
      },
      {
        step: 4,
        name: 'face_analysis',
        description: 'Analyze facial expressions (video only)',
        endpoint: '/api/face-analysis/:sessionId',
        method: 'POST',
        conditional: 'Video files only'
      },
      {
        step: 5,
        name: 'technical_analysis',
        description: 'Perform technical competency analysis',
        endpoint: '/api/technical-analysis/:sessionId',
        method: 'POST'
      },
      {
        step: 6,
        name: 'communication_analysis',
        description: 'Analyze communication and speaking style',
        endpoint: '/api/communication-analysis/:sessionId',
        method: 'POST'
      },
      {
        step: 7,
        name: 'final_report',
        description: 'Generate comprehensive final report',
        endpoint: '/api/final-report/:sessionId',
        method: 'POST'
      }
    ]
  });
});

// Route: Add retry endpoint for failed operations
app.post('/api/retry/:sessionId/:step', async (req, res) => {
  try {
    const { sessionId, step } = req.params;
    const session = analysisSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log(`Retrying step: ${step} for session: ${sessionId}`);

    // Reset status to allow retry
    switch (step) {
      case 'cv_analysis':
        session.status = 'initialized';
        delete session.results.cvAnalysis;
        return res.redirect(307, `/api/analyze-cv/${sessionId}`);
      
      case 'transcription':
        session.status = 'cv_analyzed';
        delete session.results.transcription;
        return res.redirect(307, `/api/transcribe-media/${sessionId}`);
      
      case 'face_analysis':
        session.status = `${session.mediaType}_transcribed`;
        delete session.results.faceAnalysis;
        return res.redirect(307, `/api/face-analysis/${sessionId}`);
      
      case 'technical_analysis':
        const techStatus = session.results.faceAnalysis ? 'face_analyzed' : `${session.mediaType}_transcribed`;
        session.status = techStatus;
        delete session.results.technicalAnalysis;
        return res.redirect(307, `/api/technical-analysis/${sessionId}`);
      
      case 'communication_analysis':
        session.status = 'technical_analyzed';
        delete session.results.communicationAnalysis;
        return res.redirect(307, `/api/communication-analysis/${sessionId}`);
      
      case 'final_report':
        session.status = 'communication_analyzed';
        delete session.results.finalReport;
        return res.redirect(307, `/api/final-report/${sessionId}`);
      
      default:
        return res.status(400).json({ 
          error: 'Invalid step',
          availableSteps: ['cv_analysis', 'transcription', 'face_analysis', 'technical_analysis', 'communication_analysis', 'final_report']
        });
    }

  } catch (error) {
    console.error('Retry error:', error);
    res.status(500).json({ error: 'Failed to retry operation' });
  }
});

// Route: Get API status and health
app.get('/api/status', async (req, res) => {
  try {
    // Test Gemini API connectivity
    const testPrompt = "Please respond with 'API Working' to test connectivity.";
    
    const startTime = Date.now();
    await callGeminiAPI(testPrompt, null, 1); // Single attempt for health check
    const responseTime = Date.now() - startTime;

    res.json({
      status: 'healthy',
      geminiApi: {
        status: 'connected',
        responseTime: `${responseTime}ms`
      },
      server: {
        uptime: process.uptime(),
        activeSessions: analysisSessions.size,
        timestamp: new Date()
      }
    });

  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      geminiApi: {
        status: 'error',
        error: error.message
      },
      server: {
        uptime: process.uptime(),
        activeSessions: analysisSessions.size,
        timestamp: new Date()
      }
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Interview Analysis Server running on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/api/status`);
  console.log(`API steps info at: http://localhost:${PORT}/api/steps`);
});

module.exports = app;