const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const pdfParseModule = require('pdf-parse');
const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
const Groq = require('groq-sdk');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopPosition, TabStopType } = require('docx');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;
const API_KEY = process.env.GROQ_API_KEY;

// Groq configuration with optimized settings
const groq = new Groq({ 
  apiKey: API_KEY,
  timeout: 30000,
  maxRetries: 2,
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: ['https://cypherai-interview-prep.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// Multer configuration with optimizations
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// In-memory context cache with TTL (Time To Live)
const contextCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cleanupCacheInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of contextCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      contextCache.delete(key);
    }
  }
}, CACHE_TTL);

// Graceful cleanup on server exit
process.on('exit', () => clearInterval(cleanupCacheInterval));

// Helper function to call Groq API with optimized parameters
const callGroqAPI = async (messages, maxTokens = 1024) => {
  try {
    const response = await groq.chat.completions.create({
      messages,
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: Math.min(maxTokens, 2048), // Cap at 2048 for efficiency
      top_p: 0.9, // Better response quality with less randomness
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Groq API Error:', error.message);
    throw new Error('AI service error: ' + error.message);
  }
};

// Helper function to generate cache key
const getCacheKey = (type, data) => {
  return `${type}:${JSON.stringify(data).substring(0, 100)}`;
};


// Chat conversation endpoint with context optimization
app.post('/generate-content', async (req, res) => {
  try {
    console.log('Bot request')
    const { currentQuery, prevConversation } = req.body;

    if (!currentQuery || typeof currentQuery !== 'string' || !currentQuery.trim()) {
      return res.status(400).json({ error: 'Query is required.' });
    }

    // Optimize context: limit conversation history to last exchanges to reduce API overhead
    let contextSummary = '';
    if (prevConversation && typeof prevConversation === 'string') {
      const conversationLines = prevConversation.split('\n').filter(line => line.trim());
      // Keep last 20 lines (10 user messages + 10 bot messages = 10 full exchanges)
      contextSummary = conversationLines.slice(-20).join('\n');
    }

    // Debug: Print context summary
    console.log('=== CONTEXT SUMMARY ===');
    console.log(contextSummary || 'No context');
    console.log('======================');

    // Check cache - include context in cache key to avoid wrong responses
    const cacheKey = getCacheKey('chat', { query: currentQuery, context: contextSummary });
    if (contextCache.has(cacheKey)) {
      return res.json(contextCache.get(cacheKey).data);
    }
    
    const prompt = `You are CypherAI, a direct career counselor for freshers preparing for jobs. Provide precise, actionable guidance with zero fluff.

${contextSummary ? `=== CONVERSATION CONTEXT ===
${contextSummary}

CRITICAL CONTINUATION RULES:
1. READ THE CONTEXT ABOVE - This is an ONGOING conversation
2. The user's message below is their RESPONSE to YOUR last question/statement
3. NEVER ask the same question twice - check context first
4. UNDERSTAND ABBREVIATIONS: "DA" = Data Analyst, "ML" = Machine Learning, "DS" = Data Science, etc.
5. IF THE USER ALREADY PROVIDED INFO: Don't ask for it again. Use what they gave you.

INTERPRET RESPONSES BASED ON YOUR QUESTION:
- If you asked YES/NO question (e.g., "Do you have X?"):
  * "no" → They don't have it → HELP them get it
  * "yes" → They have it → Move forward
- If you asked "Want more info?":
  * "no" → Not interested → Stop topic, ask what else
  * "yes" → Continue
- "ok", "thanks", "got it" → They're satisfied → Ask "Need anything else?"
- "tell me more", "continue" → They want more details
- Numbers/single words → They're selecting option or answering → Respond accordingly
- Short answers like "DA" or abbreviations → Understand the context and respond appropriately

NEVER REPEAT YOURSELF: Before asking a question, check if you already asked it or if the user already answered it.` : `=== NEW CONVERSATION ===
- Brief greeting: "Hey! What do you need help with?" or "Hi there! Interview prep, resume, or career guidance?"
- NO formal introductions.`}

SCOPE: Interview prep, resumes, career guidance, job search, skills, career planning

RESPONSE RULES:
1. 80-150 words (200 max for complex topics)
2. Professional but friendly, direct
3. Actionable steps, specific examples
4. Don't repeat questions already asked

User: ${currentQuery.trim()}

CypherAI:`;

    const response = await callGroqAPI([{ role: 'user', content: prompt }], 600);

    // Cache the result
    contextCache.set(cacheKey, {
      data: { text: response },
      timestamp: Date.now(),
    });

    res.json({ text: response });
  } catch (error) {
    console.error('Chat generation error:', error);
    res.status(500).json({ error: 'Error generating response: ' + error.message });
  }

});


// Resume analysis endpoint with optimized context handling
app.post('/upload-file', upload.single('file'), async (req, res) => {
  let uploadedFilePath = null;
  try {
    console.log('Resume Analysis request')
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    uploadedFilePath = req.file.path;
    const jobRole = (req.body.jobRole || '').trim();

    if (!jobRole) {
      return res.status(400).json({ error: 'Job role is required.' });
    }

    // Read and parse PDF
    const dataBuffer = await fs.readFile(uploadedFilePath);
    const pdfData = await pdfParse(dataBuffer);
    const fileContent = pdfData.text.trim();

    if (!fileContent || fileContent.length < 50) {
      return res.status(400).json({ error: 'PDF content is too short or empty.' });
    }

    // Check cache first
    const cacheKey = getCacheKey('resume', { jobRole, contentHash: fileContent.substring(0, 100) });
    if (contextCache.has(cacheKey)) {
      return res.json(contextCache.get(cacheKey).data);
    }

    // Optimized prompt for comprehensive resume analysis
    const prompt = `Analyze this resume for the "${jobRole}" role. Provide a detailed, structured analysis.

RESUME CONTENT: ${fileContent.substring(0, 4000)} ${fileContent.length > 4000 ? '...[truncated]' : ''}

Provide analysis in EXACTLY this format:

**SCORE BREAKDOWN:**
ATS Compatibility Score: [0-100]%
Content Relevance Score: [0-100]%
Structure and Formatting Score: [0-100]%
Overall Resume Score: [0-100]%

**STRENGTHS:**
• [Specific strength with context]
• [Specific strength with context]
• [Specific strength with context]
• [Specific strength with context]
• [Specific strength with context]

**AREAS FOR IMPROVEMENT:**
• [Specific improvement with actionable advice]
• [Specific improvement with actionable advice]
• [Specific improvement with actionable advice]
• [Specific improvement with actionable advice]
• [Specific improvement with actionable advice]

**DETAILED ANALYSIS:**

ATS COMPATIBILITY:
[Detailed explanation of ATS friendliness, keywords, formatting issues]

CONTENT ASSESSMENT:
[Analysis of relevance to target role, skills alignment, experience quality]

FORMATTING & STRUCTURE:
[Review of layout, sections, readability, professional appearance]

RECOMMENDATIONS:
[Specific suggestions for improvement prioritized by impact]

**TARGET ROLE ALIGNMENT:**
[How well the resume matches the "${jobRole}" position requirements]

**ACTION PLAN:**
[Step-by-step improvement recommendations]`;

    const response = await callGroqAPI([{ role: 'user', content: prompt }], 1500);

    // Cache the result
    contextCache.set(cacheKey, {
      data: { text: response },
      timestamp: Date.now(),
    });

    res.json({ text: response });
  } catch (error) {
    console.error('Resume analysis error:', error);
    res.status(500).json({ error: 'Error analyzing resume: ' + error.message });
  } finally {
    // Cleanup uploaded file immediately
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath).catch(err => console.error('Cleanup error:', err));
    }
  }

});

// Dynamic resume generation endpoint
app.post('/generate-ideal-resume', upload.single('file'), async (req, res) => {
  console.log('Resume Generation request')
  let uploadedFilePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    uploadedFilePath = req.file.path;
    const jobRole = (req.body.jobRole || '').trim();
    const analysisReport = req.body.analysisReport || '';

    if (!jobRole) {
      return res.status(400).json({ error: 'Job role is required.' });
    }

    // Read and parse PDF
    const dataBuffer = await fs.readFile(uploadedFilePath);
    const pdfData = await pdfParse(dataBuffer);
    const fileContent = pdfData.text.trim();

    if (!fileContent || fileContent.length < 50) {
      return res.status(400).json({ error: 'PDF content is too short or empty.' });
    }

    // Check cache first
    const cacheKey = getCacheKey('ideal-resume', { jobRole, contentHash: fileContent.substring(0, 100), analysis: analysisReport.substring(0, 100) });
    if (contextCache.has(cacheKey)) {
      const cachedData = contextCache.get(cacheKey).data;
      
      // Return the cached Word document buffer
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="Ideal_Resume_${jobRole.replace(/[^a-zA-Z0-9]/g, '_')}.docx"`);
      return res.send(cachedData.buffer);
    }

    // Enhanced prompt for intelligent resume enhancement with analysis data
    const prompt = `You are a professional resume writer. Create an enhanced, ideal resume for the "${jobRole}" role using the original resume and analysis data.

  ORIGINAL RESUME CONTENT:
  ${fileContent}

  ${analysisReport ? `ANALYSIS REPORT:
  ${analysisReport}

  ` : ''}INSTRUCTIONS:
1. Use the original resume as the factual source of truth. You may only add information that the user can realistically claim based on what already exists AND what the analysis report explicitly highlights as an area to address (skills to learn, sections to add, missing metrics, etc.).
2. Treat the analysis report as a to-do list: every "Strength" must be showcased prominently, and every "Area for Improvement" must be implemented (e.g., add a missing certification/skill/metric, but add (in-progress) for all the new data added).
3. Intelligently enrich skills and sections by inferring logical complements (e.g., HTML/CSS → JavaScript/React, Python → Flask/Django) only when they reinforce the analysis guidance. Make new sections (Certifications, Achievements, Publications, etc.) if the analysis indicates they are missing yet feasible.
4. Restructure and optimize sections professionally so the layout mirrors an ATS-friendly single-column resume with horizontal dividers.
5. Craft a compelling Professional Summary tailored to the target role, weaving in top strengths from the analysis.
6. Elevate bullet points with strong action verbs, quantified impact, and any improvement directives (e.g., highlight collaboration if the report called that out).
7. Ensure every addition is ATS-friendly, realistic for a fresher-level candidate, and aligned to the target role requirements.
8. If the analysis suggests new capabilities (courses, tools, soft skills) that are plausible for the user, add them under dedicated sections (e.g., "Emerging Skills", "Training & Workshops") with concise descriptions.

Provide the enhanced resume in EXACTLY this JSON format:

{
  "personalInfo": {
    "name": "[Extract from original]",
    "email": "[Extract from original]",
    "phone": "[Extract from original]",
    "location": "[Extract from original]",
    "linkedin": "[Extract if available]",
    "github": "[Extract if available]"
  },
  "professionalSummary": "[Create 2-3 line summary based on experience and target role]",
  "coreSkills": ["[Enhanced skill list based on existing skills]"],
  "experience": [
    {
      "company": "[Company name]",
      "position": "[Job title]",
      "duration": "[Time period]",
      "achievements": ["[Enhanced bullet points with action verbs and results]"]
    }
  ],
  "education": [
    {
      "degree": "[Degree name]",
      "institution": "[School/University]",
      "year": "[Year]",
      "details": "[GPA, relevant coursework, honors if mentioned]"
    }
  ],
  "projects": [
    {
      "name": "[Project name]",
      "description": "[Enhanced industry oriented technically detailed description]",
      "technologies": ["[Tech stack]"],
      "highlights": ["[Key achievements or features]"]
    }
  ],
  "certifications": ["[Any certifications mentioned plus add if are really required based on user's background and role that they can realistically achieve]"],
  "additionalSections": {
    "languages": ["[If mentioned]"],
    "achievements": ["[Awards, recognitions]"],
    "volunteering": ["[Volunteer work if mentioned]"]
  }
}
  

No extra text, only return the JSON object. [For all the sections, if needed you can add extra data but that must be only relevant and realistic complementary data based on the user's background and strictly add (in-progess) to it]`;

    const response = await callGroqAPI([{ role: 'user', content: prompt }], 2000);
    // Parse the JSON response
    let resumeData;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        resumeData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing resume JSON:', parseError);
      return res.status(500).json({ error: 'Error processing resume enhancement. Please try again.' });
    }

    // Generate Word document
    const doc = createWordResume(resumeData, jobRole);
    const buffer = await Packer.toBuffer(doc);

    // Cache the result
    contextCache.set(cacheKey, {
      data: { buffer },
      timestamp: Date.now(),
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Ideal_Resume_${jobRole.replace(/[^a-zA-Z0-9]/g, '_')}.docx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Ideal resume generation error:', error);
    res.status(500).json({ error: 'Error generating ideal resume: ' + error.message });
  } finally {
    // Cleanup uploaded file immediately
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath).catch(err => console.error('Cleanup error:', err));
    }
  }
});

// Helper function to create Word document from resume data
const createWordResume = (resumeData, jobRole) => {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Header with name
          new Paragraph({
            children: [
              new TextRun({
                text: resumeData.personalInfo.name || '[Your Name]',
                font: 'Calibri',
                size: 32,
                bold: true,
                color: '2563eb',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // Contact Information
          new Paragraph({
            children: [
              new TextRun({
                text: `${resumeData.personalInfo.email || '[Email]'} | ${resumeData.personalInfo.phone || '[Phone]'} | ${resumeData.personalInfo.location || '[Location]'}`,
                font: 'Calibri',
                size: 22,
                color: '6b7280',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),

          // LinkedIn/GitHub if available
          ...(resumeData.personalInfo.linkedin || resumeData.personalInfo.github ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: [resumeData.personalInfo.linkedin, resumeData.personalInfo.github].filter(Boolean).join(' | '),
                  font: 'Calibri',
                  size: 20,
                  color: '2563eb',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            })
          ] : []),

          // Professional Summary
          new Paragraph({
            children: [
              new TextRun({
                text: 'PROFESSIONAL SUMMARY',
                font: 'Calibri',
                size: 24,
                bold: true,
                color: '1f2937',
              }),
            ],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: resumeData.professionalSummary || `Motivated ${jobRole} with relevant experience and skills.`,
                font: 'Calibri',
                size: 22,
              }),
            ],
            spacing: { after: 300 },
          }),

          // Core Skills
          new Paragraph({
            children: [
              new TextRun({
                text: 'CORE COMPETENCIES',
                font: 'Calibri',
                size: 24,
                bold: true,
                color: '1f2937',
              }),
            ],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: (resumeData.coreSkills || []).join(' • '),
                font: 'Calibri',
                size: 22,
              }),
            ],
            spacing: { after: 300 },
          }),

          // Professional Experience
          ...(resumeData.experience && resumeData.experience.length > 0 ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'PROFESSIONAL EXPERIENCE',
                  font: 'Calibri',
                  size: 24,
                  bold: true,
                  color: '1f2937',
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 },
            }),
            ...resumeData.experience.flatMap(exp => [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${exp.company || '[Company]'} | ${exp.position || '[Position]'}`,
                    font: 'Calibri',
                    size: 22,
                    bold: true,
                  }),
                  new TextRun({
                    text: ` | ${exp.duration || '[Duration]'}`,
                    font: 'Calibri',
                    size: 22,
                    italics: true,
                  }),
                ],
                spacing: { before: 100, after: 100 },
              }),
              ...(exp.achievements || []).map(achievement => 
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `• ${achievement}`,
                      font: 'Calibri',
                      size: 20,
                    }),
                  ],
                  indent: { left: 360 },
                  spacing: { after: 100 },
                })
              ),
            ])
          ] : []),

          // Projects
          ...(resumeData.projects && resumeData.projects.length > 0 ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'KEY PROJECTS',
                  font: 'Calibri',
                  size: 24,
                  bold: true,
                  color: '1f2937',
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 },
            }),
            ...resumeData.projects.flatMap(project => [
              new Paragraph({
                children: [
                  new TextRun({
                    text: project.name || '[Project Name]',
                    font: 'Calibri',
                    size: 22,
                    bold: true,
                  }),
                ],
                spacing: { before: 100, after: 100 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: project.description || '[Project description]',
                    font: 'Calibri',
                    size: 20,
                  }),
                ],
                indent: { left: 360 },
                spacing: { after: 100 },
              }),
              ...(project.technologies && project.technologies.length > 0 ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Technologies: ${project.technologies.join(', ')}`,
                      font: 'Calibri',
                      size: 20,
                      italics: true,
                    }),
                  ],
                  indent: { left: 360 },
                  spacing: { after: 100 },
                })
              ] : []),
            ])
          ] : []),

          // Education
          ...(resumeData.education && resumeData.education.length > 0 ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'EDUCATION',
                  font: 'Calibri',
                  size: 24,
                  bold: true,
                  color: '1f2937',
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 },
            }),
            ...resumeData.education.map(edu => 
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${edu.degree || '[Degree]'} | ${edu.institution || '[Institution]'} | ${edu.year || '[Year]'}`,
                    font: 'Calibri',
                    size: 22,
                    bold: true,
                  }),
                ],
                spacing: { after: 200 },
              })
            )
          ] : []),

          // Certifications
          ...(resumeData.certifications && resumeData.certifications.length > 0 ? [
            new Paragraph({
              children: [
                new TextRun({
                  text: 'CERTIFICATIONS',
                  font: 'Calibri',
                  size: 24,
                  bold: true,
                  color: '1f2937',
                }),
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 },
            }),
            ...resumeData.certifications.map(cert => 
              new Paragraph({
                children: [
                  new TextRun({
                    text: `• ${cert}`,
                    font: 'Calibri',
                    size: 20,
                  }),
                ],
                spacing: { after: 100 },
              })
            )
          ] : []),
        ],
      },
    ],
  });

  return doc;
};

// Roadmap generation endpoint with optimized parsing
app.post('/generate-roadmap', async (req, res) => {
  console.log('Roadmap Generation request')

  try {
    const { currentQuery } = req.body;

    if (!currentQuery || typeof currentQuery !== 'string' || !currentQuery.trim()) {
      return res.status(400).json({ error: 'Job role is required.' });
    }

    // Check cache first
    const cacheKey = getCacheKey('roadmap', { role: currentQuery });
    if (contextCache.has(cacheKey)) {
      return res.json(contextCache.get(cacheKey).data);
    }

    const prompt = `Create a proper industry oriented learning roadmap for "${currentQuery.trim()}" role. Start from very basics to advaned level skills, the end user is a fresher.
Format exactly as:
Topic Name - X days
   - YouTube Channel: Channel Name (https://youtube.com/...)
Topic Name - X days
   - YouTube Channel: Channel Name (https://youtube.com/...)
Topic Name - X days
   - YouTube Channel: Channel Name (https://youtube.com/...)

Example [Strictly follow the format, do not deviate or add extra explanations even a single letter. This is just an example, do not copy the same topics.]:
Data Structures - 20 days
   - YouTube Channel: Neso Academy (https://youtube.com/...)
Algorithms - 25 days
   - YouTube Channel: CodeWithHarry (https://youtube.com/...)

[NOTE: Include popular Indian YouTube channels. Keep days realistic for freshers (10+). No additional explanations.]`;

    const response = await callGroqAPI([{ role: 'user', content: prompt }], 900);



    // Clean and normalize the text
    const cleanedText = response
      .split('\n')
      .map(line => line.replace(/\*\*/g, '').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .replace(/\n\s+/g, '\n'); // Remove excessive whitespace


    // Updated regex pattern to handle the actual format more flexibly
    const lines = cleanedText.split('\n');
    const parsedData = [];
    let skillNumber = 1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if line matches the skill format: "Topic - X days"
      const skillMatch = line.match(/^([^-]+?)\s*-\s*(\d+\s*days?)\s*$/i);
      if (skillMatch) {
        const skillName = skillMatch[1].trim();
        const days = skillMatch[2].trim();
        
        // Look for the next line that contains YouTube channel info
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        const channelMatch = nextLine.match(/^-\s*YouTube\s*Channel:\s*([^(]+?)\s*\((https?:\/\/[^)]*)\)?\s*$/i);
        
        if (channelMatch) {
          let channelName = channelMatch[1].trim();
          let channelUrl = channelMatch[2] || '';
          
          // If URL is incomplete, try to reconstruct it
          if (channelUrl && !channelUrl.includes('youtube.com')) {
            channelUrl = `https://youtube.com/${channelName.replace(/\s+/g, '')}`;
          } else if (!channelUrl) {
            channelUrl = `https://youtube.com/${channelName.replace(/\s+/g, '')}`;
          }
          
          parsedData.push({
            skillNumber: skillNumber.toString(),
            skillName: skillName,
            days: days,
            channel: channelName,
            link: channelUrl,
          });
          skillNumber++;
          i++; // Skip the next line since we processed it
        }
      }
    }

    // Validate we got at least some data
    if (parsedData.length === 0) {
      console.warn('No skills parsed, returning raw response');
      return res.json({ parsedData: [], rawResponse: cleanedText });
    }

    const result = { parsedData };

    // Cache the result
    contextCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    console.error('Roadmap generation error:', error);
    res.status(500).json({ error: 'Error generating roadmap: ' + error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    uptime: process.uptime(),
    cacheSize: contextCache.size,
  });
});


// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`CypherAI Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
