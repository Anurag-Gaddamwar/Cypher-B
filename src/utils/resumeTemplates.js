// Enhanced Resume template generator utility functions

const DEFAULT_WIDTH = 80;
const dashedLine = (char = '-', width = DEFAULT_WIDTH) => char.repeat(width);

const centerText = (text = '', width = DEFAULT_WIDTH) => {
  const trimmed = text.trim();
  if (!trimmed) return ''.padStart(width / 2);
  const padding = Math.max(width - trimmed.length, 0);
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${' '.repeat(left)}${trimmed}${' '.repeat(right)}`;
};

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean);
  }
  return [];
};

const bulletBlock = (items = [], bullet = '•') => {
  const list = normalizeList(items);
  return list.length
    ? list.map((item) => `${bullet} ${item}`).join('\n')
    : `${bullet} [Add relevant detail]`;
};

const inlineList = (items = []) => {
  const list = normalizeList(items);
  return list.length ? list.join(' • ') : '[Add relevant skills]';
};

const formatExperienceSection = (experience = []) => {
  if (!experience.length) {
    return '[Add professional experience with quantified bullets]\n';
  }

  return experience
    .map((role) => {
      const headerParts = [role.company, role.position, role.duration].filter(Boolean);
      const header = headerParts.length ? headerParts.join(' | ') : '[Company | Role | Dates]';
      const achievements = bulletBlock(role.achievements);
      const indented = achievements.split('\n').map((line) => `  ${line}`).join('\n');
      return `${header}\n${indented}`;
    })
    .join('\n\n');
};

const deriveProjectTitle = (project = {}) => {
  const base = project.name || '[Project Name]';
  if (!project.description) return base;
  const descriptor = project.description.split(',')[0].trim();
  if (!descriptor || base.toLowerCase().includes(descriptor.toLowerCase())) {
    return base;
  }
  return `${base}: ${descriptor}`;
};

const formatProjectsSection = (projects = []) => {
  if (!projects.length) {
    return '[Add projects with technologies and impact]\n';
  }

  return projects
    .map((project) => {
      const titleLine = deriveProjectTitle(project);
      const description = project.description || '[Project description]';
      const techLine = project.technologies && project.technologies.length
        ? `Technologies: ${project.technologies.join(', ')}`
        : '';
      const highlightBlock = project.highlights && project.highlights.length
        ? project.highlights.map((item) => `  • ${item}`).join('\n')
        : '';

      return [titleLine, description, techLine, highlightBlock].filter(Boolean).join('\n');
    })
    .join('\n\n');
};

const formatEducationSection = (education = []) => {
  if (!education.length) {
    return '[Add education details with institute and score]\n';
  }

  return education
    .map((entry) => {
      const topLine = [entry.degree, entry.institution].filter(Boolean).join(' | ') || '[Degree | Institution]';
      const metaLine = [entry.year, entry.details].filter(Boolean).join(' • ');
      return metaLine ? `${topLine}\n  ${metaLine}` : topLine;
    })
    .join('\n\n');
};

const optionalSection = (title, content) => {
  if (!content) return '';
  return `\n${title}\n${dashedLine()}\n${content}\n`;
};

export const generateResumeTemplate = (resumePayload = {}, analysisData = {}) => {
  const isLegacyCall = typeof resumePayload === 'string';
  const jobRole = isLegacyCall ? resumePayload : (resumePayload.jobRole || 'Professional');
  const resumeData = isLegacyCall ? {} : resumePayload;

  const personalInfo = resumeData.personalInfo || {};
  const nameLine = centerText((personalInfo.name || 'Your Name').toUpperCase());
  const contactLine = [personalInfo.email, personalInfo.phone, personalInfo.location].filter(Boolean).join('   |   ')
    || '[Email]   |   [Phone]   |   [Location]';
  const linkLine = [personalInfo.linkedin, personalInfo.github, personalInfo.portfolio]
    .filter(Boolean)
    .join('   |   ');

  const summaryText = resumeData.professionalSummary
    || `Results-driven ${jobRole} with hands-on expertise in delivering impactful solutions.`;

  const experienceBlock = formatExperienceSection(resumeData.experience || []);
  const projectBlock = formatProjectsSection(resumeData.projects || []);
  const educationBlock = formatEducationSection(resumeData.education || []);

  const strengths = bulletBlock(analysisData.strengths || resumeData.strengths || []);
  const improvements = bulletBlock(analysisData.areasForImprovement || resumeData.areasForImprovement || []);

  const certifications = normalizeList(resumeData.certifications);
  const languages = normalizeList(resumeData?.additionalSections?.languages);
  const volunteering = normalizeList(resumeData?.additionalSections?.volunteering);

  const sections = [
    `${dashedLine('=')}\n${nameLine}\n${dashedLine('=')}`,
    `${contactLine}${linkLine ? `\n${linkLine}` : ''}`,
    dashedLine(),
    optionalSection('PROFESSIONAL SUMMARY', summaryText),
    optionalSection('CORE COMPETENCIES', inlineList(resumeData.coreSkills || [])),
    optionalSection('PROFESSIONAL EXPERIENCE', experienceBlock),
    optionalSection('KEY PROJECTS', projectBlock),
    optionalSection('EDUCATION', educationBlock),
    certifications.length ? optionalSection('CERTIFICATIONS', bulletBlock(certifications)) : '',
    languages.length ? optionalSection('LANGUAGES', bulletBlock(languages)) : '',
    volunteering.length ? optionalSection('VOLUNTEERING', bulletBlock(volunteering)) : '',
    optionalSection('STRENGTH HIGHLIGHTS', strengths),
    optionalSection('AREAS FOR IMPROVEMENT', improvements),
  ].filter(Boolean);

  return sections.join('\n').replace(/\n{3,}/g, '\n\n');
};

export const generateWordDocument = (content, filename) => {
  // Simple text-based Word document generation
  const blob = new Blob([content], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  
  // For better compatibility, we'll generate a Rich Text Format (RTF) file
  const rtfContent = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}} 
    {\\colortbl;\\red0\\green0\\blue0;}
    \\f0\\fs24 ${content.replace(/\n/g, '\\par ')}}`;
    
  const rtfBlob = new Blob([rtfContent], {
    type: 'application/rtf'
  });
  
  return { blob, rtfBlob };
};