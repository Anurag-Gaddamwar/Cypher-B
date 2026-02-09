const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const pdfParseModule = require('pdf-parse');
const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
const Groq = require('groq-sdk');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopPosition, TabStopType, ExternalHyperlink } = require('docx');
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

// Normalize PDF text extraction to preserve word spacing
const normalizePdfText = (text) => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])\n([A-Za-z])/g, '$1 $2')
    .replace(/\n{2,}/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ {3,}/g, '  ')
    .trim();
};

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
    // console.log('Bot request')
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


    // Check cache - include context in cache key to avoid wrong responses
    const cacheKey = getCacheKey('chat', { query: currentQuery, context: contextSummary });
    if (contextCache.has(cacheKey)) {
      return res.json(contextCache.get(cacheKey).data);
    }
    
const prompt = `
You are CypherAI, a career counselor for freshers and early professionals.
Your role is to provide clear, practical, career-oriented guidance in a natural, human way — similar to ChatGPT, but strictly focused on careers.

========================
CONVERSATION HISTORY
========================
${contextSummary || 'No prior context. This is a new conversation.'}

IMPORTANT CONTEXT RULES:
1. If context exists, this is an ONGOING conversation.
2. The user message is a response to your last reply.
3. Never repeat questions already asked or answered.
4. If the user has already shared information, use it.
5. Understand abbreviations automatically (DA, DS, ML, SWE, etc.).
6. Short replies (yes / no / role names / numbers) are meaningful inputs, not disengagement by default.
7. - If user says "ok", "thanks", "got it":
  → Acknowledge briefly.
  → Continue the SAME topic only if it is still active.
  → Do NOT introduce a new topic unless the user does.

========================
INTENT INTERPRETATION (CRITICAL)
========================
If the user's intent is obvious from context (especially time-sensitive like interviews),
do NOT ask clarifying questions.
Take initiative and provide relevant guidance immediately.
Before responding, decide:
- Is the user answering a question you asked?
- Or are they disengaging from the conversation?



Rules: [Never use meta-commentary about the user's feelings or intentions.
]
- If the message answers your last question → continue the flow naturally.
- If the message does NOT answer a question and signals low intent
  (e.g., "nothing", "not now", disengaged tone) → close gracefully.
- Never confuse an answer ("no") with disengagement.

========================
RESPONSE DECISION LOGIC
========================
- YES → move forward.
- NO (as an answer) → provide alternatives or next logical step.
- "continue" / "tell me more" → deepen the same topic.
- Role or skill name → assume intent and proceed.
- Unclear input → ask ONE precise clarifying question only.
- A single-word reply ("yes"/"no") without a question before it
  should NOT change the topic or direction.


========================
RESPONSE STYLE RULES
========================
- Match the user's energy level.
- Prefer concise responses when user input is short.
- Default length: concise; expand only when value is added.
- Professional, calm, human — not robotic, not salesy.
- No filler, no forced motivation, no meta commentary.

========================
SCOPE (STRICT)
========================
✔ Career guidance  
✔ Interview preparation  
✔ Resume & ATS  
✔ Skills & roadmaps  
✔ Job search strategy  

❌ No generic life advice  
❌ No unrelated topics  

========================
EXIT & NON-PUSHY BEHAVIOR
========================
- If the user signals disengagement or says bye:
  → Respond once, warmly and briefly.
  → Do not ask questions.
  → Do not redirect topics.
  → Do not continue the conversation.

- Never force continuation.
- Never restart the conversation after exit.
- Default to helping over questioning when time pressure is implied.


========================
USER MESSAGE
========================
${currentQuery.trim()}

========================
YOUR RESPONSE
========================
`;

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
    // console.log('Resume Analysis request')
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
    const fileContent = normalizePdfText(pdfData.text);

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
    // console.log(response)
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
  // console.log('Resume Generation request')
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
    const fileContent = normalizePdfText(pdfData.text);

    if (!fileContent || fileContent.length < 50) {
      return res.status(400).json({ error: 'PDF content is too short or empty.' });
    }
    const normalizeForMatch = (text) => (text || '')
      .toString()
      .toLowerCase()
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizeLoose = (text) => (text || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const stripAddedTags = (text) => (text || '').toString().replace(/\[ADDED\]|\[\/ADDED\]/g, '');
    const IN_PROGRESS_TAG_REGEX = /\(in-progress\)|\(in\-progess\)/gi;
    const normalizeUrlForCompare = (value) => {
      if (!value) return '';
      let cleaned = value.toString().trim().replace(/[)\],.;]+$/g, '');
      cleaned = cleaned.replace(/\[ADDED\]|\[\/ADDED\]/g, '').replace(IN_PROGRESS_TAG_REGEX, '');
      let url = cleaned.toLowerCase();
      url = url.replace(/^https?:\/\//, '');
      url = url.replace(/^www\./, '');
      return url;
    };
    const URL_REGEX = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.(?:com|in|org|net|io|ai|dev|app|edu|gov|co|us)(?:\/[^\s)>,]*)?/gi;
    const extractAllowedUrls = (text) => {
      const matches = (text || '').match(URL_REGEX) || [];
      const set = new Set();
      matches.forEach(match => {
        const normalized = normalizeUrlForCompare(match);
        if (normalized) set.add(normalized);
      });
      return set;
    };
    const originalNormalized = normalizeForMatch(fileContent);
    const allowedUrlSet = extractAllowedUrls(fileContent);

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
1. Use the original resume as the ONLY factual source of truth. Do NOT invent, fabricate, or assume any data.
2. Be CONSERVATIVE with additions. Only add a skill/certification/project if it is a direct, obvious complement to what already exists AND is critical for the target role. Do not add random or tangential items.
3. Restructure and rewrite existing content professionally with strong action verbs and quantified impact where possible.
4. Craft a compelling Professional Summary (3-4 lines) tailored to the target role using ONLY skills and experience already present.
5. Categorize skills from the original resume into logical groups (Programming, Frameworks/Tools, Data/Cloud, Other etc). Only add a new skill if it is an extremely close complement (e.g., user has React → add Next.js). Mark any added skill with [ADDED]...[/ADDED].
6. For certifications: keep all original ones. Only add 1-2 new ones if they are industry-standard for the target role and realistic given the user's background. Mark added ones with [ADDED]...[/ADDED].
7. Do NOT add entirely new projects unless the analysis report explicitly says so. If you must add one, mark its name with [ADDED]...[/ADDED].
8. Do NOT tag or color: professional summary, project descriptions, experience bullets, education details, or any rephrased/reworded text. Only tag newly added entity names.

NAME PARSING (CRITICAL):
- The candidate's name MUST have proper spacing between first name and last name (e.g., "First Last" NOT "FirstLast").
- If the extracted text shows the name without spaces, intelligently split it at the camelCase boundary or logical word boundary.

URL/LINK RULES (CRITICAL):
- ONLY include URLs that are EXPLICITLY written in the original resume text (e.g., linkedin.com/in/..., github.com/... etc).
- If a URL is present in the original resume, copy it EXACTLY as-is. Make sure it starts with https://.
- If NO URL exists for a field (linkedin, github, project url, certification url), set the value to an empty string "".
- NEVER fabricate, guess, or construct URLs. NEVER output file:// paths or local system paths like D:/ or C:/.
- For email: just the email address. For phone: just the number.

Provide the enhanced resume in EXACTLY this JSON format:

{
  "personalInfo": {
    "name": "[Extract from original - MUST have space between first and last name]",
    "email": "[Extract from original - email only, no mailto:]",
    "phone": "[Extract from original - number only]",
    "location": "[Extract from original]",
    "linkedin": "[ONLY if URL exists in original resume, else empty string]",
    "github": "[ONLY if URL exists in original resume, else empty string]"
  },
  "professionalSummary": "[Create 2-3 line summary aligned to target role and original experience]",
  "coreSkills": {
    "Programming": ["[Skills]"],
    "Frameworks/Tools": ["[Skills]"],
    "Data/Cloud": ["[Skills]"],
    "Other": ["[Skills]"]
  },
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
    },
    ..
  ],
  "projects": [
    {
      "name": "[Project name]",
      "url": "[ONLY if URL exists in original resume text, else empty string]",
      "description": "[Enhanced industry oriented technically detailed description]",
      "technologies": ["[Tech stack]"],
      "highlights": ["[Key achievements or features]"]
    },
    ..
  ],
  "certifications": [
    {
      "name": "[Certification name]",
      "url": "[ONLY if URL exists in original resume text, else empty string]"
    },
    ..
  ],
  "additionalSections": {
    "languages": ["[If mentioned]"],
    "achievements": ["[Awards, recognitions]"],
    "volunteering": ["[Volunteer work if mentioned]"]
  }
}
  

No extra text, only return the JSON object. Be VERY conservative — only add items that are critical for the target role and a natural fit for the user's existing background. Mark any added entity with [ADDED]...[/ADDED]. Do NOT add random or unnecessary items.`;

    const response = await callGroqAPI([{ role: 'user', content: prompt }], 2000);
    // console.log(response);
    const extractJson = (text) => {
      const cleaned = (text || '').toString().replace(/```(?:json)?/gi, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      return match ? match[0] : '';
    };
    const tryParseJson = (text) => {
      const jsonText = extractJson(text);
      if (!jsonText) {
        throw new Error('No JSON found in response');
      }
      return JSON.parse(jsonText);
    };
    const repairJsonWithAI = async (raw) => {
      const repairPrompt = `You are a strict JSON repair tool.
Fix the input so it is valid JSON that matches the original structure.
Rules:
- Output ONLY the JSON object (no markdown, no commentary).
- Preserve all keys and values; only fix escaping, quotes, commas, and brackets.
INPUT:
${raw}`;
      return await callGroqAPI([{ role: 'user', content: repairPrompt }], 1500);
    };
    // Parse the JSON response (with one AI repair attempt if needed)
    let resumeData;
    try {
      resumeData = tryParseJson(response);
    } catch (parseError) {
      console.error('Error parsing resume JSON (first attempt):', parseError.message);
      try {
        const repaired = await repairJsonWithAI(response);
        resumeData = tryParseJson(repaired);
      } catch (repairError) {
        console.error('Error parsing resume JSON (after repair):', repairError.message);
        return res.status(500).json({ error: 'Error processing resume enhancement. Please try again.' });
      }
    }

    // Post-process: fix name spacing, enforce added tagging, and sanitize all URLs
    const isLikelyUrl = (value) => {
      if (!value) return false;
      const cleaned = value.toString().trim();
      if (!cleaned) return false;
      if (/\s/.test(cleaned)) return false;
      if (/^[a-zA-Z]:[\\/]/.test(cleaned)) return false;
      if (cleaned.toLowerCase().startsWith('file:')) return false;
      if (cleaned.includes('\\')) return false;
      if (/^https?:\/\//i.test(cleaned)) return true;
      return /\./.test(cleaned);
    };
    const isInOriginal = (value) => {
      const normalized = normalizeForMatch(stripAddedTags(value));
      if (normalized.length === 0) return false;
      if (originalNormalized.includes(normalized)) return true;
      const looseValue = normalizeLoose(normalized);
      if (!looseValue) return false;
      const looseOriginal = normalizeLoose(originalNormalized);
      return looseOriginal.includes(looseValue);
    };
    const tagIfMissing = (value) => {
      const cleaned = stripAddedTags(value).replace(IN_PROGRESS_TAG_REGEX, '').trim();
      if (!cleaned) return cleaned;
      if (isInOriginal(cleaned)) return cleaned;
      return `[ADDED]${cleaned}[/ADDED]`;
    };
    const tagListItems = (list) => (Array.isArray(list)
      ? list.map(item => (typeof item === 'string' ? tagIfMissing(item) : item))
      : []);
    if (resumeData.personalInfo) {
      // Fix name: insert space at camelCase boundaries (e.g., "AnuragGaddamwar" → "Anurag Gaddamwar")
      if (resumeData.personalInfo.name) {
        resumeData.personalInfo.name = resumeData.personalInfo.name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }
      // Sanitize all URL fields — strip local paths, file:// URLs, and non-URLs
      const urlFields = ['linkedin', 'github', 'portfolio', 'website'];
      urlFields.forEach(field => {
        const val = (resumeData.personalInfo[field] || '').trim();
        const normalized = normalizeUrlForCompare(val);
        const isOriginalText = isInOriginal(val);
        if (!val || val.toLowerCase().startsWith('file:') || /^[a-zA-Z]:[\\/]/.test(val) || val.includes('\\') || (!isLikelyUrl(val) && !isOriginalText) || (!normalized && !isOriginalText) || (!allowedUrlSet.has(normalized) && !isOriginalText)) {
          resumeData.personalInfo[field] = '';
        }
      });
    }
    if (resumeData.coreSkills) {
      if (Array.isArray(resumeData.coreSkills)) {
        resumeData.coreSkills = tagListItems(resumeData.coreSkills);
      } else if (typeof resumeData.coreSkills === 'object') {
        Object.keys(resumeData.coreSkills).forEach(category => {
          resumeData.coreSkills[category] = tagListItems(resumeData.coreSkills[category]);
        });
      }
    }
    // Sanitize project URLs
    if (Array.isArray(resumeData.projects)) {
      resumeData.projects.forEach(p => {
        const url = (p.url || p.link || '').trim();
        const normalized = normalizeUrlForCompare(url);
        if (!url || url.toLowerCase().startsWith('file:') || /^[a-zA-Z]:[\\/]/.test(url) || url.includes('\\') || !isLikelyUrl(url) || !normalized || !allowedUrlSet.has(normalized)) {
          p.url = '';
          p.link = '';
        }
        if (p.name) {
          p.name = tagIfMissing(p.name);
        }
        if (Array.isArray(p.technologies)) {
          p.technologies = tagListItems(p.technologies);
        }
      });
    }
    // Sanitize certification URLs
    if (Array.isArray(resumeData.certifications)) {
      resumeData.certifications.forEach(c => {
        if (typeof c === 'object' && c !== null) {
          const url = (c.url || '').trim();
          const normalized = normalizeUrlForCompare(url);
          if (!url || url.toLowerCase().startsWith('file:') || /^[a-zA-Z]:[\\/]/.test(url) || url.includes('\\') || !isLikelyUrl(url) || !normalized || !allowedUrlSet.has(normalized)) {
            c.url = '';
          }
          if (c.name) {
            c.name = tagIfMissing(c.name);
          }
        }
      });
    }
    if (resumeData.additionalSections && typeof resumeData.additionalSections === 'object') {
      ['languages', 'achievements', 'volunteering'].forEach(key => {
        if (Array.isArray(resumeData.additionalSections[key])) {
          resumeData.additionalSections[key] = tagListItems(resumeData.additionalSections[key]);
        }
      });
      Object.keys(resumeData.additionalSections).forEach(key => {
        if (!Array.isArray(resumeData.additionalSections[key]) || resumeData.additionalSections[key].length === 0) {
          delete resumeData.additionalSections[key];
        }
      });
      if (Object.keys(resumeData.additionalSections).length === 0) {
        resumeData.additionalSections = {};
      }
    }
    if (Array.isArray(resumeData.education) && resumeData.education.length > 0) {
      const hasHonorsEntry = resumeData.education.some(edu => /honors/i.test((edu.degree || '')));
      const primaryEdu = resumeData.education[0];
      const details = (primaryEdu.details || '').toString();
      const honorsMatch = details.match(/Honors?\s+in\s+([^,;]+)(?:\s*\((\d{4})\))?/i);
      if (!hasHonorsEntry && honorsMatch) {
        const honorsName = `Honors in ${honorsMatch[1].trim()}`;
        const honorsYear = honorsMatch[2] || '';
        const cgpaMatch = details.match(/(\d+(?:\.\d+)?)\s*CGPA/i);
        const sgpaMatch = details.match(/(\d+(?:\.\d+)?)\s*SGPA/i);
        const btechDetails = (cgpaMatch ? `${cgpaMatch[1]} CGPA` : details)
          .replace(/Honors?\s+in\s+[^,;]+(?:\s*\(\d{4}\))?/i, '')
          .replace(/\s*,\s*/g, ', ')
          .replace(/^,|,$/g, '')
          .trim();
        primaryEdu.details = btechDetails;
        resumeData.education = [
          primaryEdu,
          {
            degree: honorsName,
            institution: primaryEdu.institution || '',
            year: honorsYear || primaryEdu.year || '',
            details: sgpaMatch ? `${sgpaMatch[1]} SGPA` : '',
          },
          ...resumeData.education.slice(1),
        ];
      }
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
  const ADDED_TAG_REGEX = /\[ADDED\]([\s\S]*?)\[\/ADDED\]/g;
  const IN_PROGRESS_REGEX = /\(in-progress\)|\(in\-progess\)/gi;

  const splitAddedSegments = (text) => {
    ADDED_TAG_REGEX.lastIndex = 0;
    const segments = [];
    let lastIndex = 0;
    let match;
    while ((match = ADDED_TAG_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.index), added: false });
      }
      segments.push({ text: match[1], added: true });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), added: false });
    }
    return segments;
  };

  const createTextRunsWithAddedColor = (text, options = {}) => {
    if (!text) return [];
    const normalized = text.toString().replace(IN_PROGRESS_REGEX, '').replace(/ {2,}/g, ' ');
    const segments = splitAddedSegments(normalized);
    if (segments.length === 0) return [];
    const useSegmentColor = segments.some(segment => segment.added);
    if (!useSegmentColor || options.highlightAdded === false) {
      const cleaned = normalized.replace(/\[ADDED\]|\[\/ADDED\]/g, '');
      return [new TextRun({ text: cleaned, ...options, noProof: options.noProof !== undefined ? options.noProof : true, color: options.forceAddedColor ? 'ff0000' : options.color })];
    }
    return segments
      .map(segment => ({
        text: segment.text.replace(/\[ADDED\]|\[\/ADDED\]/g, ''),
        added: segment.added,
      }))
      .filter(segment => segment.text.length > 0)
      .map(segment => {
        const isAdded = segment.added || options.forceAddedColor;
        return new TextRun({ text: segment.text, ...options, noProof: options.noProof !== undefined ? options.noProof : true, color: isAdded ? 'ff0000' : options.color });
      });
  };

  const sanitizeUrlText = (value) => {
    if (!value) return '';
    const cleaned = value.toString()
      .replace(/\[ADDED\]|\[\/ADDED\]/g, '')
      .replace(IN_PROGRESS_REGEX, '')
      .trim();
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    if (lower.startsWith('file:')) return '';
    if (/^[a-zA-Z]:\\/.test(cleaned)) return '';
    if (/^[a-zA-Z]:\//.test(cleaned)) return '';
    if (cleaned.includes('\\')) return '';
    if (/\s/.test(cleaned)) return '';
    if (cleaned.includes('@')) return cleaned;
    if (/^(mailto:|tel:)/i.test(cleaned)) return cleaned;
    if (/^https?:\/\//i.test(cleaned)) {
      return cleaned.replace(/^http:\/\//i, 'https://');
    }
    if (/\./.test(cleaned)) {
      return `https://${cleaned}`;
    }
    return '';
  };

  const createHyperlinkRun = (text, url, options = {}) => {
    if (!url) {
      return createTextRunsWithAddedColor(text, options);
    }
    const hyperlinkRuns = createTextRunsWithAddedColor(text, { ...options, color: options.color || '2563eb', underline: { type: 'single' } });
    return [
      new ExternalHyperlink({
        link: url,
        children: hyperlinkRuns,
      }),
    ];
  };

  const createSectionHeading = (text, options = {}) => new Paragraph({
    children: [
      new TextRun({
        text,
        font: 'Calibri',
        size: 24,
        bold: true,
        color: options.color || '1f2937',
        noProof: options.noProof !== undefined ? options.noProof : true,
      }),
    ],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
  });

  const createBulletParagraph = (text, options = {}) => new Paragraph({
    children: [
      new TextRun({ text: '• ', ...options, noProof: options.noProof !== undefined ? options.noProof : true, color: options.color || '1f2937' }),
      ...createTextRunsWithAddedColor(text, options),
    ],
    indent: { left: 360 },
    spacing: { after: 100 },
  });

  const ensureArray = (value) => (Array.isArray(value) ? value : []);
  const ensureString = (value) => (value ? value.toString() : '');
  const isAddedText = (value) => {
    ADDED_TAG_REGEX.lastIndex = 0;
    return ADDED_TAG_REGEX.test(ensureString(value));
  };
  const formatLink = (value) => ensureString(value).trim();

  const personalInfo = resumeData.personalInfo || {};
  const email = ensureString(personalInfo.email);
  const phone = ensureString(personalInfo.phone);
  const location = ensureString(personalInfo.location);
  const linkedin = ensureString(personalInfo.linkedin);
  const github = ensureString(personalInfo.github);
  const portfolio = ensureString(personalInfo.portfolio || personalInfo.website || '');
  const emailUrl = sanitizeUrlText(email);
  const phoneUrl = sanitizeUrlText(phone).replace(/\s+/g, '');
  const linkedinUrl = sanitizeUrlText(linkedin);
  const githubUrl = sanitizeUrlText(github);
  const portfolioUrl = sanitizeUrlText(portfolio);

  const contactParts = [];
  if (email) contactParts.push({ text: email, url: emailUrl ? `mailto:${emailUrl}` : '' });
  if (phone) contactParts.push({ text: phone, url: phoneUrl ? `tel:${phoneUrl}` : '' });
  if (location) contactParts.push({ text: location, url: '' });
  const contactRuns = [];
  contactParts.forEach((part, index) => {
    if (index > 0) {
      contactRuns.push(new TextRun({ text: ' | ', font: 'Calibri', size: 22, color: '6b7280' }));
    }
    contactRuns.push(...createHyperlinkRun(part.text, part.url, { font: 'Calibri', size: 22, color: '6b7280' }));
  });

  const linkParts = [
    linkedin ? { text: linkedin, url: linkedinUrl } : null,
    github ? { text: github, url: githubUrl } : null,
    portfolio ? { text: portfolio, url: portfolioUrl } : null,
  ].filter(Boolean);
  const linkRuns = [];
  linkParts.forEach((part, index) => {
    if (index > 0) {
      linkRuns.push(new TextRun({ text: ' | ', font: 'Calibri', size: 20, color: '2563eb' }));
    }
    linkRuns.push(...createHyperlinkRun(part.text, part.url, { font: 'Calibri', size: 20, color: '2563eb' }));
  });

  const skillsData = resumeData.coreSkills;
  const skillsSections = [];
  if (Array.isArray(skillsData)) {
    skillsSections.push({ title: 'Skills', values: skillsData });
  } else if (skillsData && typeof skillsData === 'object') {
    Object.entries(skillsData).forEach(([category, values]) => {
      skillsSections.push({ title: category, values: Array.isArray(values) ? values : [] });
    });
  }

  const certifications = resumeData.certifications || [];
  const certificationItems = Array.isArray(certifications) ? certifications : [];
  const normalizedCerts = certificationItems.map(item => {
    if (typeof item === 'string') return { name: item, url: '' };
    if (item && typeof item === 'object') return { name: item.name || '', url: item.url || '' };
    return { name: '', url: '' };
  }).filter(item => item.name);

  const projects = ensureArray(resumeData.projects);
  const experience = ensureArray(resumeData.experience);
  const education = ensureArray(resumeData.education);
  const additionalSections = resumeData.additionalSections || {};

  const CM_TO_TWIP = 567; // 1 cm ≈ 567 twips
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: CM_TO_TWIP,
              bottom: CM_TO_TWIP,
              left: CM_TO_TWIP,
              right: CM_TO_TWIP,
            },
          },
        },
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
            children: contactRuns.length > 0 ? contactRuns : [
              new TextRun({
                text: `${personalInfo.email || '[Email]'} | ${personalInfo.phone || '[Phone]'} | ${personalInfo.location || '[Location]'}`,
                font: 'Calibri',
                size: 22,
                color: '6b7280',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // LinkedIn/GitHub if available
          ...(linkRuns.length > 0 ? [
            new Paragraph({
              children: linkRuns,
              alignment: AlignmentType.CENTER,
              spacing: { after: 300 },
            })
          ] : []),


          // Professional Summary
          createSectionHeading('PROFESSIONAL SUMMARY'),

          new Paragraph({
            children: createTextRunsWithAddedColor(resumeData.professionalSummary || `Motivated ${jobRole} with relevant experience and skills.`, { font: 'Calibri', size: 22, highlightAdded: false }),
            spacing: { after: 200 },
          }),

          // Core Skills
          createSectionHeading('CORE COMPETENCIES'),

          ...skillsSections.flatMap(section => [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${section.title}: `,
                  font: 'Calibri',
                  size: 22,
                  bold: true,
                  color: '1f2937',
                }),
                ...createTextRunsWithAddedColor(section.values.map(ensureString).join(', '), { font: 'Calibri', size: 22, highlightAdded: true }),
              ],
              spacing: { after: 140 },
            })
          ]),

          // Professional Experience
          ...(experience.length > 0 ? [
            createSectionHeading('PROFESSIONAL EXPERIENCE'),
            ...experience.flatMap(exp => {
              const titleLine = `${exp.company || '[Company]'} | ${exp.position || '[Position]'}${exp.duration ? ` | ${exp.duration}` : ''}`;
              return [
                new Paragraph({
                  children: createTextRunsWithAddedColor(titleLine, { font: 'Calibri', size: 22, bold: true }),
                  spacing: { before: 100, after: 60 },
                }),
                ...ensureArray(exp.achievements).map(achievement => createBulletParagraph(ensureString(achievement), { font: 'Calibri', size: 20, highlightAdded: true })),
              ];
            }),
          ] : []),

          // Projects
          ...(projects.length > 0 ? [
            createSectionHeading('KEY PROJECTS'),
            ...projects.flatMap(project => {
              const projectName = ensureString(project.name || '[Project Name]');
              const projectUrl = sanitizeUrlText(formatLink(project.url || project.link || ''));
              const isProjectAdded = isAddedText(projectName);
              return [
                new Paragraph({
                  children: projectUrl
                    ? createHyperlinkRun(projectName, projectUrl, { font: 'Calibri', size: 22, bold: true, highlightAdded: true })
                    : createTextRunsWithAddedColor(projectName, { font: 'Calibri', size: 22, bold: true, highlightAdded: true }),
                  spacing: { before: 100, after: 60 },
                }),
                ...(project.description ? [
                  new Paragraph({
                    children: createTextRunsWithAddedColor(ensureString(project.description), { font: 'Calibri', size: 20, highlightAdded: false }),
                    indent: { left: 360 },
                    spacing: { after: 80 },
                  })
                ] : []),
                ...(ensureArray(project.technologies).length > 0 ? [
                  new Paragraph({
                    children: createTextRunsWithAddedColor(`Technologies: ${ensureArray(project.technologies).join(', ')}`, { font: 'Calibri', size: 20, italics: true, highlightAdded: true }),
                    indent: { left: 360 },
                    spacing: { after: 80 },
                  })
                ] : []),
                ...ensureArray(project.highlights).map(highlight => createBulletParagraph(ensureString(highlight), { font: 'Calibri', size: 20, highlightAdded: true })),
              ];
            }),
          ] : []),

          // Education
          ...(education.length > 0 ? [
            createSectionHeading('EDUCATION'),
            ...education.map(edu => {
              const line = `${edu.degree || '[Degree]'} | ${edu.institution || '[Institution]'} | ${edu.year || '[Year]'}`;
              const details = ensureString(edu.details || '');
              return [
                new Paragraph({
                  children: createTextRunsWithAddedColor(line, { font: 'Calibri', size: 22, bold: true }),
                  spacing: { after: details ? 80 : 200 },
                }),
                ...(details ? [
                  new Paragraph({
                    children: createTextRunsWithAddedColor(details, { font: 'Calibri', size: 20, highlightAdded: true }),
                    indent: { left: 360 },
                    spacing: { after: 200 },
                  })
                ] : []),
              ];
            }).flat(),
          ] : []),

          // Certifications
          ...(normalizedCerts.length > 0 ? [
            createSectionHeading('CERTIFICATIONS'),
            ...normalizedCerts.map(cert => {
              const certName = ensureString(cert.name);
              const certUrl = sanitizeUrlText(formatLink(cert.url));
              if (certUrl) {
                return new Paragraph({
                  children: [
                    new TextRun({ text: '• ', font: 'Calibri', size: 20, color: '1f2937' }),
                    ...createHyperlinkRun(certName, certUrl, { font: 'Calibri', size: 20, highlightAdded: true }),
                  ],
                  spacing: { after: 100 },
                });
              }
              return createBulletParagraph(certName, { font: 'Calibri', size: 20, highlightAdded: true });
            }),
          ] : []),

          ...((ensureArray(additionalSections.languages).length > 0
            || ensureArray(additionalSections.achievements).length > 0
            || ensureArray(additionalSections.volunteering).length > 0) ? [
            createSectionHeading('ADDITIONAL INFORMATION', {
              color: (isAddedText(ensureArray(additionalSections.languages).join(' '))
                || isAddedText(ensureArray(additionalSections.achievements).join(' '))
                || isAddedText(ensureArray(additionalSections.volunteering).join(' ')))
                ? 'ff0000'
                : '1f2937',
            }),
            ...(ensureArray(additionalSections.languages).length > 0 ? [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Languages: ', font: 'Calibri', size: 20, bold: true, color: '1f2937' }),
                  ...createTextRunsWithAddedColor(ensureArray(additionalSections.languages).join(', '), { font: 'Calibri', size: 20, highlightAdded: true }),
                ],
                spacing: { after: 100 },
              })
            ] : []),
            ...(ensureArray(additionalSections.achievements).length > 0 ? [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Achievements: ', font: 'Calibri', size: 20, bold: true, color: '1f2937' }),
                  ...createTextRunsWithAddedColor(ensureArray(additionalSections.achievements).join(', '), { font: 'Calibri', size: 20, highlightAdded: true }),
                ],
                spacing: { after: 100 },
              })
            ] : []),
            ...(ensureArray(additionalSections.volunteering).length > 0 ? [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Volunteering: ', font: 'Calibri', size: 20, bold: true, color: '1f2937' }),
                  ...createTextRunsWithAddedColor(ensureArray(additionalSections.volunteering).join(', '), { font: 'Calibri', size: 20, highlightAdded: true }),
                ],
                spacing: { after: 100 },
              })
            ] : []),
          ] : []),
        ],
      },
    ],
  });

  return doc;
};

// Roadmap generation endpoint with optimized parsing
app.post('/generate-roadmap', async (req, res) => {
  // console.log('Roadmap Generation request')

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
