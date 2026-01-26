# Atlas Desktop Launch Checklist

Complete checklist for launching Atlas Desktop v0.2.0 to production.

---

## Pre-Launch (T-7 Days)

### Code Quality

- [ ] All TypeScript errors resolved (`npm run typecheck`)
- [ ] All ESLint warnings addressed (`npm run lint`)
- [ ] All unit tests passing (`npm run test`)
- [ ] Smoke tests passing (`npm run test:smoke`)
- [ ] Code coverage above 70% (`npm run test:coverage`)
- [ ] No known critical bugs in issue tracker
- [ ] Performance benchmarks within targets

### Security

- [ ] Security audit completed
- [ ] No hardcoded secrets in codebase
- [ ] API keys stored securely (keychain integration works)
- [ ] Dependency vulnerabilities checked (`npm audit`)
- [ ] CSP headers configured correctly
- [ ] Sandbox enabled for renderer process

### Documentation

- [ ] README.md is up to date
- [ ] CHANGELOG.md has all changes for release
- [ ] FEATURES.md reflects current capabilities
- [ ] API documentation complete
- [ ] User Guide reviewed and accurate
- [ ] Developer Guide complete
- [ ] Known Issues documented

---

## Pre-Launch (T-3 Days)

### Build & Packaging

- [ ] Windows build succeeds (`npm run dist:win`)
- [ ] macOS build succeeds (`npm run dist:mac`)
- [ ] Linux build succeeds (`npm run dist:linux`)
- [ ] All builds tested on clean machines
- [ ] Installer file sizes reasonable (<150MB)
- [ ] Auto-update mechanism tested

### Signing & Notarization

- [ ] Windows code signing certificate valid
- [ ] Windows builds properly signed
- [ ] macOS code signing certificate valid
- [ ] macOS builds properly signed
- [ ] macOS builds notarized with Apple
- [ ] No Gatekeeper warnings on macOS

### Platform Testing

- [ ] Windows 10 tested
- [ ] Windows 11 tested
- [ ] macOS Intel tested
- [ ] macOS Apple Silicon tested
- [ ] Ubuntu 22.04 tested
- [ ] Fedora 39+ tested
- [ ] QA checklist completed for all platforms

---

## Pre-Launch (T-1 Day)

### Release Assets

- [ ] Release notes finalized
- [ ] Demo video recorded and exported
- [ ] Screenshots captured
- [ ] GIF animations created
- [ ] Social media copy prepared
- [ ] Press release drafted (if applicable)

### Infrastructure

- [ ] Download server ready
- [ ] CDN configured for binaries
- [ ] Website updated with new version
- [ ] Documentation site deployed
- [ ] Analytics tracking configured
- [ ] Error reporting service ready (Sentry, etc.)

### Distribution

- [ ] GitHub Release draft created
- [ ] Binary files uploaded
- [ ] SHA256 checksums generated
- [ ] Release notes attached
- [ ] Pre-release toggle set correctly

---

## Launch Day (T-0)

### Morning (Before Announcement)

#### Final Checks (1 hour before)

- [ ] Download all binaries and verify checksums
- [ ] Quick smoke test on each platform
- [ ] Verify auto-update from previous version works
- [ ] Check website loads correctly
- [ ] Verify documentation links work
- [ ] Confirm API services are operational

#### Release (Announcement Time)

- [ ] Flip GitHub Release from draft to published
- [ ] Verify download links work
- [ ] Update website "Download" button
- [ ] Enable auto-update for existing users (if staged)

### Announcement

#### Social Media

- [ ] Post to Twitter/X
- [ ] Post to LinkedIn
- [ ] Post to relevant Reddit communities
- [ ] Post to Discord/Slack communities
- [ ] Submit to Hacker News (if applicable)
- [ ] Submit to Product Hunt (if scheduled)

#### Email

- [ ] Send newsletter announcement
- [ ] Notify beta testers
- [ ] Send to press contacts (if applicable)

### Monitoring

#### First Hour

- [ ] Monitor download counts
- [ ] Watch for crash reports
- [ ] Check social media for immediate feedback
- [ ] Monitor support channels for issues

#### First Day

- [ ] Track download metrics by platform
- [ ] Review error reports
- [ ] Respond to user feedback
- [ ] Document any reported issues

---

## Post-Launch (T+1 Day)

### Analysis

- [ ] Review download statistics
- [ ] Analyze crash reports
- [ ] Summarize user feedback
- [ ] Identify any patterns in issues
- [ ] Prioritize fixes for patch release

### Follow-Up

- [ ] Thank contributors publicly
- [ ] Respond to reviews/comments
- [ ] Address critical issues immediately
- [ ] Plan patch release if needed
- [ ] Update roadmap based on feedback

### Documentation Updates

- [ ] Add any newly discovered known issues
- [ ] Update FAQ if common questions emerged
- [ ] Improve troubleshooting guide if needed

---

## Post-Launch (T+7 Days)

### Metrics Review

- [ ] Total downloads by platform
- [ ] Active user count (if telemetry enabled)
- [ ] Crash rate percentage
- [ ] Support ticket volume
- [ ] Social media reach/engagement

### Retrospective

- [ ] Document what went well
- [ ] Document what could be improved
- [ ] Update launch checklist for next release
- [ ] Share learnings with team

---

## Rollback Plan

If critical issues are discovered post-launch:

### Severity Assessment

| Severity | Description                                        | Action                         |
| -------- | -------------------------------------------------- | ------------------------------ |
| Critical | App won't start, data loss, security vulnerability | Immediate rollback             |
| High     | Major feature broken for many users                | Hot-fix within 24h or rollback |
| Medium   | Feature degraded but workaround exists             | Fix in patch release           |
| Low      | Minor inconvenience                                | Fix in next release            |

### Rollback Steps

1. **Disable auto-update** - Prevent more users from updating
2. **Post status update** - Acknowledge issue on social media
3. **Revert GitHub Release** - Re-publish previous version as "latest"
4. **Communicate** - Email affected users with rollback instructions
5. **Root cause** - Investigate and fix the issue
6. **Re-release** - After thorough testing, re-release

### Rollback Commands

```bash
# Mark current release as pre-release
gh release edit v0.2.0 --prerelease

# Re-publish previous version as latest
gh release edit v0.1.0 --latest

# Or create a quick patch
git checkout v0.1.0
# Apply minimal fix
npm run dist
gh release create v0.2.1 ...
```

---

## Contact List

### Internal

| Role           | Contact | Availability |
| -------------- | ------- | ------------ |
| Lead Developer |         |              |
| DevOps         |         |              |
| QA Lead        |         |              |
| Marketing      |         |              |

### External

| Service      | Support Contact       | Response Time |
| ------------ | --------------------- | ------------- |
| Picovoice    | support@picovoice.ai  | 24h           |
| Deepgram     | support@deepgram.com  | 24h           |
| ElevenLabs   | support@elevenlabs.io | 24h           |
| Fireworks AI | support@fireworks.ai  | 24h           |
| GitHub       | status.github.com     | N/A           |

---

## Emergency Contacts

### During Launch Window

- Primary: [Name] - [Phone/Slack]
- Backup: [Name] - [Phone/Slack]

### Off-Hours

- On-call rotation: [Details]

---

## Version Information

| Item       | Value      |
| ---------- | ---------- |
| Version    | 0.2.0      |
| Code Name  | (optional) |
| Git Tag    | v0.2.0     |
| Branch     | main       |
| Build Date | YYYY-MM-DD |

---

## Approvals

| Area             | Approver | Date | Status |
| ---------------- | -------- | ---- | ------ |
| Code Quality     |          |      |        |
| Security         |          |      |        |
| Documentation    |          |      |        |
| Platform Testing |          |      |        |
| Marketing        |          |      |        |
| Final Go/No-Go   |          |      |        |

---

## Notes

_Space for any additional notes during the launch process._

---

_Last updated: January 15, 2026_
