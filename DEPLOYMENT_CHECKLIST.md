# Pre-Deployment Checklist

## ✅ Build & Testing

- [ ] Run `npm run build` and verify no errors
- [ ] Test all pages locally: `/bot`, `/resume`, `/roadmap`, `/profile`
- [ ] Test voice input functionality
- [ ] Test file upload for resume analyzer
- [ ] Test resume analysis API calls
- [ ] Test roadmap generation
- [ ] Verify responsive design on mobile/tablet
- [ ] Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Check console for warnings/errors
- [ ] Verify no 404 errors

## 🔐 Security Checks

- [ ] Environment variables configured
- [ ] API URL uses HTTPS in production
- [ ] No sensitive data hardcoded
- [ ] CORS properly configured on backend
- [ ] Security headers enabled in next.config.mjs
- [ ] Error messages don't leak sensitive info
- [ ] API key/tokens not exposed in logs

## ⚡ Performance Checks

- [ ] Lighthouse score > 80
- [ ] First Contentful Paint < 2.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] Total bundle size reasonable (~450KB gzipped)
- [ ] No large unoptimized images
- [ ] CSS/JS properly minified

## 📱 Mobile/Accessibility

- [ ] Works on iOS Safari
- [ ] Works on Android Chrome
- [ ] Touch-friendly button sizes (min 44x44px)
- [ ] Text is readable (18px minimum on mobile)
- [ ] No horizontal scrolling on mobile
- [ ] Keyboard navigation works
- [ ] Tab order is logical
- [ ] Color contrast meets WCAG AA

## 🌐 Deployment

### Pre-Deployment
- [ ] Create `.env.production` with correct API URL
- [ ] Update NEXT_PUBLIC_API_URL with production backend
- [ ] Verify backend API is accessible from production domain
- [ ] Backup current production (if applicable)

### Vercel Deployment
- [ ] Connect GitHub repository
- [ ] Set environment variables in Vercel dashboard
- [ ] Enable automatic deployments
- [ ] Test production URL
- [ ] Set up custom domain (if applicable)

### Docker Deployment
- [ ] Build Docker image: `docker build -t cypher-ai .`
- [ ] Test image locally: `docker run -p 3000:3000 cypher-ai`
- [ ] Push to registry (Docker Hub, ECR, etc.)
- [ ] Update deployment manifests

### Self-Hosted Deployment
- [ ] SSH into server
- [ ] Clone repository
- [ ] Run `npm install --legacy-peer-deps`
- [ ] Run `npm run build`
- [ ] Start with PM2: `pm2 start "npm start" --name cypher-ai`
- [ ] Configure Nginx reverse proxy
- [ ] Set up SSL certificate (Let's Encrypt)
- [ ] Enable auto-restart on reboot

## 📊 Post-Deployment

- [ ] Verify site is accessible
- [ ] Test all features in production
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify analytics/monitoring is working
- [ ] Test email notifications (if applicable)
- [ ] Check API response times
- [ ] Monitor server resources (CPU, memory)
- [ ] Test CDN caching (if applicable)

## 📝 Documentation

- [ ] README.md is up to date
- [ ] PRODUCTION_DEPLOYMENT.md is complete
- [ ] Environment variables documented
- [ ] API endpoints documented
- [ ] Deployment instructions clear
- [ ] Troubleshooting guide provided
- [ ] Contact/support info provided

## 🔄 Monitoring & Maintenance

- [ ] Set up error tracking (Sentry, LogRocket, etc.)
- [ ] Enable performance monitoring
- [ ] Set up uptime monitoring
- [ ] Configure alerts for errors
- [ ] Schedule regular backups
- [ ] Plan for security updates
- [ ] Monitor dependency updates

## 🚨 Rollback Plan

- [ ] Have previous version backed up
- [ ] Know how to revert deployment
- [ ] Document rollback procedure
- [ ] Have contact info for escalations
- [ ] Know how to quickly restart services

---

## Deployment Commands

```bash
# Build for production
npm run build

# Test production build locally
npm start

# Docker build
docker build -t cypher-ai .

# PM2 start
pm2 start "npm start" --name cypher-ai

# Check status
pm2 status

# View logs
pm2 logs cypher-ai
```

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails | `npm install --legacy-peer-deps && npm run build` |
| API not connecting | Verify `NEXT_PUBLIC_API_URL` in production environment |
| Styles not loading | Check CSS file paths, clear `.next` cache |
| Images not displaying | Verify image paths, check public folder permissions |
| High memory usage | Check for memory leaks, restart Node process |

---

**Deployment Ready**: ✅ All systems go!
