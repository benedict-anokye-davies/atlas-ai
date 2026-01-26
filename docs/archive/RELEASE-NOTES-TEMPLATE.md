# Release Notes Template

Use this template when creating release notes for new Atlas versions.

---

## Release Notes: Atlas Desktop v{VERSION}

**Release Date:** {DATE}
**Release Type:** {Major|Minor|Patch}

---

### Highlights

> Brief 2-3 sentence summary of the most important changes in this release.

{HIGHLIGHT_1}
{HIGHLIGHT_2}
{HIGHLIGHT_3}

---

### New Features

#### {Feature Category 1}

- **{Feature Name}** - {Brief description}
  - {Detail 1}
  - {Detail 2}

#### {Feature Category 2}

- **{Feature Name}** - {Brief description}

---

### Improvements

- {Improvement 1}
- {Improvement 2}
- {Improvement 3}

---

### Bug Fixes

- Fixed {issue description} ([#{issue_number}](link))
- Fixed {issue description}
- Fixed {issue description}

---

### Breaking Changes

> Only include this section if there are breaking changes

- **{Breaking Change}** - {Description of what changed and how to migrate}

---

### Deprecations

> Only include this section if there are deprecations

- `{deprecated_feature}` - Will be removed in v{version}. Use `{replacement}` instead.

---

### Performance

| Metric     | Previous | Current | Change |
| ---------- | -------- | ------- | ------ |
| {Metric 1} | {value}  | {value} | {+/-}% |
| {Metric 2} | {value}  | {value} | {+/-}% |

---

### Known Issues

- {Known issue 1}
- {Known issue 2}

---

### Upgrade Instructions

```bash
# If upgrading from v{previous_version}
npm install

# Clear any cached data if needed
rm -rf ~/.atlas/cache
```

---

### Downloads

| Platform              | Download                                   | SHA256   |
| --------------------- | ------------------------------------------ | -------- |
| Windows (x64)         | [atlas-{version}-win-x64.exe](link)        | `{hash}` |
| macOS (Intel)         | [atlas-{version}-mac-x64.dmg](link)        | `{hash}` |
| macOS (Apple Silicon) | [atlas-{version}-mac-arm64.dmg](link)      | `{hash}` |
| Linux (x64)           | [atlas-{version}-linux-x64.AppImage](link) | `{hash}` |
| Linux (deb)           | [atlas-{version}-linux-amd64.deb](link)    | `{hash}` |

---

### Contributors

Thanks to everyone who contributed to this release:

- @{contributor1}
- @{contributor2}

---

### Full Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the complete list of changes.

---

## Example Release Notes

Below is an example of filled-in release notes:

---

## Release Notes: Atlas Desktop v0.2.0

**Release Date:** January 15, 2026
**Release Type:** Minor

---

### Highlights

This release introduces the stunning 3D particle orb visualization, comprehensive git integration, and a powerful memory system. Atlas now remembers your conversations, learns your preferences, and can help manage your code repositories.

---

### New Features

#### Visual Orb

- **3D Particle Visualization** - Beautiful strange attractor animation with 35,000 particles
  - State-based color transitions (idle, listening, thinking, speaking)
  - Audio-reactive particle behavior
  - Dynamic LOD for 60fps on any hardware

#### Git Tools

- **Complete Git Integration** - Manage repositories via voice
  - Status, add, commit, push operations
  - Branch creation, switching, and merging
  - AI-assisted conflict resolution

#### Memory System

- **Conversation Memory** - Atlas remembers what you talked about
  - Semantic chunking for intelligent context
  - Importance scoring for memory retention
  - User preference learning

---

### Improvements

- Improved wake word detection reliability with adaptive thresholding
- Enhanced VAD with "still listening" state for natural pauses
- Added echo cancellation with NLMS adaptive filtering
- Connection warmup reduces first-response latency

---

### Bug Fixes

- Fixed wake word triggering during TTS playback
- Fixed memory leak in audio pipeline
- Fixed circuit breaker state not persisting across restarts
- Fixed high CPU usage during idle state

---

### Performance

| Metric              | v0.1.0 | v0.2.0 | Change |
| ------------------- | ------ | ------ | ------ |
| Wake word latency   | 250ms  | 150ms  | -40%   |
| Total response time | 4.5s   | 2.5s   | -44%   |
| Memory usage        | 650MB  | 450MB  | -31%   |
| Orb frame rate      | 45fps  | 60fps  | +33%   |

---

### Known Issues

- Custom wake words not yet supported
- Offline LLM mode limited to cached responses

---

### Downloads

| Platform              | Download                                   |
| --------------------- | ------------------------------------------ |
| Windows (x64)         | [atlas-0.2.0-win-x64.exe](releases)        |
| macOS (Intel)         | [atlas-0.2.0-mac-x64.dmg](releases)        |
| macOS (Apple Silicon) | [atlas-0.2.0-mac-arm64.dmg](releases)      |
| Linux (AppImage)      | [atlas-0.2.0-linux-x64.AppImage](releases) |

---

### Contributors

Thanks to everyone who contributed to this release:

- @atlas-team
- @terminal-1
- @terminal-2
- @terminal-3
- @claude

---

## Automation

The release notes can be partially auto-generated using the release script:

```bash
# Generate release notes from git history
npm run release:notes

# This will:
# 1. Parse commits since last tag
# 2. Group by type (feat, fix, perf, etc.)
# 3. Generate markdown template
# 4. Output to releases/v{version}.md
```

You can then edit the generated file to add highlights and polish the content.
