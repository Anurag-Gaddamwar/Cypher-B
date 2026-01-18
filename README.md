# CypherAI - AI-Powered Career Preparation Platform

> Master your career with AI-driven guidance, resume analysis, and personalized skill roadmaps.

![Production Ready](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
![Next.js](https://img.shields.io/badge/Next.js-16.1.3-black?logo=next.js)
![React](https://img.shields.io/badge/React-18.2.0-blue?logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38B2AC?logo=tailwind-css)
![Performance](https://img.shields.io/badge/Performance-Optimized-brightgreen)

## 🎯 Features

### 1. **AI Chat Assistant** 🤖
- Real-time conversational AI guidance
- Voice input and text support
- Career-focused responses
- Interview tips and strategies

### 2. **Resume Analyzer** 📄
- ATS compatibility scoring
- Content relevance analysis
- Structure & formatting evaluation
- AI-powered improvement suggestions
- Visual score breakdown

### 3. **Career Roadmap Generator** 🗺️
- Personalized learning paths
- Skill recommendations
- Resource links & tutorials
- Time estimation per skill
- Beautiful timeline visualization

### 4. **User Profile** 👤
- Profile management
- Settings customization
- (Extensible for future features)

## ⚡ Performance Optimizations

- ✅ **Code Splitting**: Dynamic imports reduce initial bundle by ~60%
- ✅ **System Fonts**: Removed Google Fonts for faster load times
- ✅ **Lazy Loading**: Heavy components load only when needed
- ✅ **Production Build**: Gzip compression, security headers
- ✅ **Mobile First**: Fully responsive across all devices
- ✅ **Smooth Animations**: Hardware-accelerated transitions

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/cypher-ai
cd cypher-ai

# Install dependencies
npm install --legacy-peer-deps

# Create environment file
cp .env.production .env.local

# Start development server
npm run dev
```

Visit `http://localhost:3000`

## 📦 Project Structure

```
src/
├── app/
│   ├── components/
│   │   ├── Navbar.jsx           # Navigation with active route indicator
│   │   ├── Mic.jsx              # Voice input component
│   │   └── ErrorBoundary.jsx    # Production error handling
│   ├── globals.css              # Global styles & animations
│   ├── layout.jsx               # Root layout with SEO
│   └── page.tsx                 # Home page
├── pages/
│   ├── bot.jsx                  # AI Chat interface
│   ├── resume.jsx               # Resume analyzer
│   ├── roadmap.jsx              # Career roadmap
│   ├── profile.jsx              # User profile
│   ├── bot.css                  # Chat styles
│   └── resume.css               # Resume styles
├── public/                       # Static assets
└── middleware.ts                # Next.js middleware (if needed)
```

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (Turbopack) |
| UI Library | React 18 |
| Styling | Tailwind CSS 3 |
| Icons | React Icons, Heroicons |
| HTTP Client | Axios |
| Charts | Chart.js, react-chartjs-2 |
| Markdown | react-markdown |
| Build Tool | Webpack (Turbopack) |

## 🎨 UI/UX Highlights

- **Modern Design**: Dark theme with gradient accents
- **Accessibility**: WCAG 2.1 compliance
- **Responsive**: Mobile-first responsive design
- **Smooth Transitions**: Tailwind animations throughout
- **User Feedback**: Loading states, error messages, success indicators
- **Empty States**: Helpful prompts when no data available

## 📊 API Integration

The application connects to a backend API for:
- `POST /generate-content` - AI chat responses
- `POST /upload-file` - Resume analysis
- `POST /generate-roadmap` - Career roadmap generation

Configure API endpoint in `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 🔐 Security Features

- ✅ XSS Protection headers
- ✅ CSRF Prevention
- ✅ No sensitive data in logs
- ✅ Error boundaries prevent info leakage
- ✅ Secure API communication
- ✅ Environment variable separation

## 📱 Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 🚢 Deployment

### Vercel (Recommended)
```bash
# Connect your GitHub repository to Vercel
# Auto-deploys on push
# Set NEXT_PUBLIC_API_URL in Vercel dashboard
```

### Docker
```bash
docker build -t cypher-ai .
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=https://api.example.com cypher-ai
```

### Self-Hosted
See [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) for detailed instructions.

## 📈 Performance Metrics

After optimization:
- **Initial Load**: ~1.5-2s
- **Time to Interactive**: ~2-3s
- **Largest Contentful Paint**: <2.5s
- **Cumulative Layout Shift**: <0.1
- **Bundle Size**: ~450KB (gzipped)

## 🔧 Development

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run ESLint
```

### Environment Variables

```env
# Required
NEXT_PUBLIC_API_URL=http://localhost:3001

# Optional
NODE_ENV=production
```

## 🐛 Troubleshooting

### "Module not found" errors
```bash
npm install --legacy-peer-deps
rm -rf .next
npm run build
```

### API connection issues
- Verify backend is running
- Check `NEXT_PUBLIC_API_URL` in environment
- Verify CORS settings on backend

### Build errors
```bash
# Clear cache
rm -rf node_modules .next
npm install --legacy-peer-deps
npm run build
```

## 📝 File Upload

Resume analyzer supports:
- **Formats**: PDF, JPG, PNG
- **Max Size**: 10MB
- **Recommended**: PDF (better ATS parsing)

## 🎓 Usage Tips

1. **Chat Interface**
   - Use voice for hands-free interaction
   - Type for specific questions
   - Shift+Enter for new line in message

2. **Resume Analysis**
   - Upload target role-specific resume
   - Review ATS score carefully
   - Follow improvement suggestions

3. **Roadmap**
   - Follow skills in order
   - Allocate time as suggested
   - Click resource links for learning

## 📄 License

MIT License - See LICENSE file for details

## 👤 Author

**Anurag Gaddamwar**
- GitHub: [@Anurag-Gaddamwar](https://github.com/Anurag-Gaddamwar)
- Email: contact@cypheral.com

## 🙏 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Issues**: GitHub Issues
- **Email**: support@cypheral.com
- **Documentation**: See [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)

---

<div align="center">

**[⬆ back to top](#cypheral-ai-powered-career-preparation-platform)**

Made with ❤️ by Anurag Gaddamwar

</div>
