# Atlas Desktop - Comprehensive Remediation Plan

**Created:** January 29, 2026  
**Purpose:** Complete audit and action plan to make Atlas work perfectly

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Priority Fixes (Must Fix First)](#critical-priority-fixes)
3. [Build & Compilation Issues](#build--compilation-issues)
4. [Test Failures](#test-failures)
5. [Stub/Placeholder Implementations](#stubplaceholder-implementations)
6. [IPC & Integration Gaps](#ipc--integration-gaps)
7. [Voice Pipeline Fixes](#voice-pipeline-fixes)
8. [Trading System Completion](#trading-system-completion)
9. [Banking System Completion](#banking-system-completion)
10. [Browser Agent Fixes](#browser-agent-fixes)
11. [VM Agent Completion](#vm-agent-completion)
12. [Gateway & Channels Completion](#gateway--channels-completion)
13. [Intelligence Platform Gaps](#intelligence-platform-gaps)
14. [Career Module Completion](#career-module-completion)
15. [UI/Renderer Fixes](#uirenderer-fixes)
16. [Security Hardening](#security-hardening)
17. [Memory & Database Optimization](#memory--database-optimization)
18. [ML System Integration](#ml-system-integration)
19. [Performance Optimization](#performance-optimization)
20. [Code Quality & Lint Fixes](#code-quality--lint-fixes)
21. [Documentation Updates](#documentation-updates)
22. [Testing Coverage](#testing-coverage)
23. [Implementation Priority Order](#implementation-priority-order)

---

## Executive Summary

Atlas Desktop is a massive voice-first AI assistant with 60+ modules. After deep scanning:

- **TypeScript Compilation:** ✅ PASSES (0 errors)
- **Test Suite:** ❌ 30 tests failing across 10 test files
- **Lint Warnings:** ⚠️ 100+ warnings (unused vars, any types)
- **Stub Implementations:** ⚠️ 15+ features with placeholders
- **Integration Gaps:** ⚠️ Many modules not fully wired together

### Key Statistics
- **Main Process Files:** ~200+ modules
- **Renderer Components:** ~100+ components
- **Agent Tools:** 60+ tools defined
- **IPC Channels:** 200+ channels
- **Test Files:** 43 (32 pass, 10 fail + 1 error)

---

## Critical Priority Fixes

### P0: Blocking Issues (Fix Immediately)

#### P0-1: Test Suite Stability
**Files Failing:**
1. `tests/security.test.ts` - SUPPORTED_API_KEYS count mismatch (expects 6, got 8)
2. `tests/personality.test.ts` - 6 failures related to prompt content assertions
3. `tests/startup-profiler.test.ts` - Console spy not working
4. `tests/offline-tts.test.ts` - 5 failures
5. `tests/llm.test.ts` - 1 failure
6. `tests/integration.test.ts` - 16 failures (Transform errors)

**Action Items:**
```
[ ] Update tests/security.test.ts line 786: change 6 to 8 for SUPPORTED_API_KEYS
[ ] Update tests/personality.test.ts assertions to match current prompt content
[ ] Fix tests/startup-profiler.test.ts console spy implementation
[ ] Fix tests/offline-tts.test.ts mock implementations
[ ] Fix tests/integration.test.ts transform issues (likely import/build related)
[ ] Fix memory leak in test runner (heap limit reached)
```

#### P0-2: Memory Leak in Test Suite
**Issue:** Tests fail with "Reached heap limit Allocation failed - JavaScript heap out of memory"
**Action Items:**
```
[ ] Add NODE_OPTIONS=--max-old-space-size=8192 to test script
[ ] Identify memory-leaking tests and add proper cleanup
[ ] Add afterEach cleanup for singleton managers in tests
```

---

## Build & Compilation Issues

### B1: ESLint Warnings (100+)
**Location:** Throughout `src/`

**Categories:**
1. **Unused Variables (~40)** - Prefix with underscore or remove
2. **no-explicit-any (~50)** - Add proper types
3. **no-console (~30 in CLI)** - Expected for CLI, suppress in CLI files
4. **no-case-declarations (~5)** - Wrap case blocks in {}

**Priority Files:**
```
[ ] src/main/agent/browser-agent/*.ts - Many any types
[ ] src/main/agent/autonomous-agent.ts - Unused imports
[ ] src/cli/index.ts - Console statements (add eslint-disable)
[ ] src/cli/utils/gateway-client.ts - Unused 'id' variable
```

### B2: Unused Imports
**Files with unused imports:**
```
[ ] src/main/agent/browser-agent/context-fusion.ts - IndexedElement
[ ] src/main/agent/browser-agent/dom-serializer.ts - Multiple types
[ ] src/main/agent/browser-agent/element-grounding.ts - Multiple types
[ ] src/main/agent/autonomous-agent.ts - ActionResult, AgentTool, screen
```

---

## Test Failures

### T1: Security Test Fix
**File:** `tests/security.test.ts:786`
**Issue:** SUPPORTED_API_KEYS length assertion wrong
**Fix:**
```typescript
// Change from:
expect(SUPPORTED_API_KEYS.length).toBe(6);
// To:
expect(SUPPORTED_API_KEYS.length).toBe(8);
```

### T2: Personality Test Fixes
**File:** `tests/personality.test.ts`
**Issues:** 6 tests failing on prompt content assertions
**Fix:**
```
[ ] Review line 605 - check for 'enthusias' may need update
[ ] Review all toContain assertions against current ATLAS_SYSTEM_PROMPT
[ ] Update expected values to match current personality configuration
```

### T3: Startup Profiler Test Fix
**File:** `tests/startup-profiler.test.ts:119`
**Issue:** Console spy not capturing warnings
**Fix:**
```
[ ] Check if StartupProfiler uses logger instead of console
[ ] Update spy to mock logger.warn instead of console.warn
```

### T4: Offline TTS Tests
**File:** `tests/offline-tts.test.ts`
**Issues:** 5 failures
```
[ ] Check mock implementations for offline TTS
[ ] Ensure Piper model paths are mocked correctly
[ ] Verify audio buffer expectations
```

### T5: LLM Test Fix
**File:** `tests/llm.test.ts`
**Issue:** 1 test failing
```
[ ] Identify failing test and fix expectation or implementation
```

### T6: Integration Tests
**File:** `tests/integration.test.ts`
**Issues:** 16 failures with "Transform failed with 1 error"
```
[ ] Check import paths for ESM/CJS issues
[ ] Verify all mocked modules are correctly set up
[ ] May need to add to external modules in vitest.config.ts
```

---

## Stub/Placeholder Implementations

### S1: Offline STT (CRITICAL)
**File:** `src/main/stt/offline.ts`
**Status:** STUB ONLY - not functional
**Lines:** 5, 150, 174, 207, 341, 349

**Issues:**
- Model download not implemented
- Model loading not implemented
- Transcription returns stub data

**Action Items:**
```
[ ] Implement actual Whisper.cpp integration via ONNX
[ ] Create model download functionality from Hugging Face
[ ] Implement proper transcription pipeline
[ ] Add model caching and version management
[ ] Test with various audio inputs
```

### S2: Vision OCR
**File:** `src/main/vision/screen-analyzer.ts`
**Status:** OCR not implemented
**Lines:** 665, 687

**Issues:**
- UI element detection returns empty array
- OCR returns empty string

**Action Items:**
```
[ ] Integrate Tesseract.js (already in package.json)
[ ] Implement UI element detection using edge detection
[ ] Add caching for repeated screen analysis
```

### S3: Nova Voice Plugins
**File:** `src/main/voice/nova-voice/plugin-system.ts`
**Status:** Three methods throw "Not implemented"
**Lines:** 565, 615, 621

**Issues:**
- OpenAI STT plugin not implemented
- ElevenLabs streaming not implemented
- ElevenLabs list voices not implemented

**Action Items:**
```
[ ] Implement OpenAI Whisper API integration
[ ] Implement ElevenLabs streaming synthesis
[ ] Implement ElevenLabs voice listing
[ ] Add API key validation before use
```

### S4: Update Signature Verification
**File:** `src/main/updater/verifier.ts`
**Status:** Placeholder only
**Lines:** 846, 860, 878, 889

**Issues:**
- Windows signature verification is placeholder
- macOS signature verification is placeholder

**Action Items:**
```
[ ] Implement Windows Authenticode signature verification
[ ] Implement macOS codesign verification
[ ] Add certificate pinning for updates
```

### S5: VM Agent RDP
**File:** `src/main/vm-agent/vm-connector.ts`
**Status:** RDP not implemented
**Line:** 870

**Action Items:**
```
[ ] Implement RDP protocol support using node-rdp or similar
[ ] Or document that VNC should be used instead
```

### S6: Multimodal Processing
**File:** `src/main/multimodal/index.ts`
**Status:** Video/PDF processing throws error
**Line:** 88

**Action Items:**
```
[ ] Implement video frame extraction using ffmpeg
[ ] PDF parsing already has pdf-parse dependency - wire it up
[ ] Add audio transcription for multimodal audio
```

### S7: TTS Dynamic Voice Settings
**File:** `src/main/tts/manager.ts`
**Status:** Not implemented for Cartesia
**Lines:** 858, 874

**Action Items:**
```
[ ] Implement dynamic voice settings for Cartesia provider
[ ] Or disable feature for Cartesia and document limitation
```

### S8: Audit Logger Features
**File:** `src/main/security/audit-logger.ts`
**Status:** Two features return false (not implemented)
**Lines:** 1618, 1620

**Action Items:**
```
[ ] Implement the specific audit features
[ ] Or remove the stubs if not needed
```

---

## IPC & Integration Gaps

### I1: Gateway Not Started by Default
**Issue:** Gateway WebSocket server exists but isn't auto-started

**Action Items:**
```
[ ] Add gateway startup to src/main/index.ts
[ ] Wire gateway events to renderer
[ ] Add IPC handlers for gateway control
[ ] Expose gateway API in preload.ts
```

### I2: Channel Adapters Not Connected
**Files:** `src/main/channels/*.ts`
**Issue:** Telegram, Discord, WhatsApp, Slack adapters exist but aren't wired

**Action Items:**
```
[ ] Add channel manager initialization to index.ts
[ ] Create IPC handlers for channel management
[ ] Add UI for channel connection/pairing
[ ] Wire incoming messages to voice pipeline
```

### I3: VM Agent Not Exposed
**Issue:** VM Agent module complete but not in preload.ts

**Action Items:**
```
[ ] Add VM agent IPC handlers
[ ] Expose VM agent API in preload.ts
[ ] Create VMAgentPanel component for UI
[ ] Wire VM agent tools to agent system
```

### I4: Career Module IPC Incomplete
**Issue:** Career module exists but IPC needs verification

**Action Items:**
```
[ ] Verify all career IPC handlers are registered
[ ] Test career tools through voice commands
[ ] Ensure career panel UI works
```

### I5: Skills System Not Connected
**Files:** `src/main/skills/*`
**Issue:** Skills/ClawdHub system exists but not integrated

**Action Items:**
```
[ ] Add skills manager initialization
[ ] Create IPC handlers for skill install/remove
[ ] Wire skill execution to agent
[ ] Add skills panel to UI
```

### I6: Study System Missing IPC
**File:** `src/main/study/study-system.ts`
**Issue:** Study module exists but no IPC handlers

**Action Items:**
```
[ ] Create src/main/ipc/study-handlers.ts
[ ] Register study handlers in main ipc index
[ ] Expose study API in preload.ts
[ ] Create study UI component
```

---

## Voice Pipeline Fixes

### V1: Barge-in Sensitivity
**File:** `src/main/voice/pipeline.ts`
**Issue:** Needs 400ms sustained speech with 3+ VAD confirmations

**Status:** ✅ Implemented but needs testing

**Action Items:**
```
[ ] Add integration test for barge-in
[ ] Tune thresholds based on real-world testing
[ ] Add user-configurable sensitivity
```

### V2: Prosody Emotion Detection
**File:** `src/main/voice/prosody/`
**Status:** Module exists but may not be fully integrated

**Action Items:**
```
[ ] Verify prosody analyzer is called in voice pipeline
[ ] Test emotion detection with various inputs
[ ] Wire emotion to TTS voice adjustment
```

### V3: Speaker Diarization
**File:** `src/main/ml/speaker-diarization.ts`
**Status:** Module exists

**Action Items:**
```
[ ] Verify integration with voice pipeline
[ ] Test multi-speaker scenarios
[ ] Add speaker profiles UI
```

### V4: Continuous Listening Mode
**Status:** Implemented in voice-pipeline.ts

**Action Items:**
```
[ ] Test hands-free conversation mode
[ ] Add UI toggle for continuous listening
[ ] Ensure proper cleanup on disable
```

---

## Trading System Completion

### TR1: Go Backend Connection
**Issue:** Trading system expects Go backend on localhost:8080

**Action Items:**
```
[ ] Document Go backend setup requirements
[ ] Add connection status indicator
[ ] Handle backend unavailability gracefully
[ ] Add reconnection logic
```

### TR2: Trading Tools Testing
**Files:** `src/main/trading/tools.ts`
**Status:** 30 tools defined

**Action Items:**
```
[ ] Test each trading tool with mock backend
[ ] Verify voice command routing works
[ ] Add error handling for each tool
[ ] Create trading tool integration tests
```

### TR3: Ensemble Trader Integration
**File:** `src/main/trading/ensemble-trader.ts`
**Status:** 7-model voting system exists

**Action Items:**
```
[ ] Wire ensemble trader to autonomous trading loop
[ ] Add backtesting for ensemble strategy
[ ] Create ensemble performance dashboard
```

### TR4: Volatility Sizer Integration
**File:** `src/main/trading/volatility-sizer.ts`
**Status:** ATR-based position sizing exists

**Action Items:**
```
[ ] Wire to order creation flow
[ ] Test with various market conditions
[ ] Add position sizing UI display
```

### TR5: Risk Kill Switches
**File:** `src/main/trading/risk/kill-switches.ts`
**Status:** Module exists

**Action Items:**
```
[ ] Verify kill switch triggers work
[ ] Test daily loss limit enforcement
[ ] Add kill switch status to UI
[ ] Create manual kill switch button
```

---

## Banking System Completion

### BK1: TrueLayer OAuth Flow
**Issue:** OAuth callback handling needs testing

**Action Items:**
```
[ ] Test full OAuth flow with TrueLayer sandbox
[ ] Handle token refresh properly
[ ] Store tokens securely in keychain
```

### BK2: Banking Tools Testing
**File:** `src/main/agent/tools/banking.ts`
**Status:** 27+ tools defined

**Action Items:**
```
[ ] Test each banking tool with sandbox
[ ] Verify correct API method signatures
[ ] Fix any remaining type issues
```

### BK3: Payment Security
**Issue:** PIN protection for payments

**Action Items:**
```
[ ] Test PIN setup flow
[ ] Verify payment confirmation works
[ ] Test spending limit enforcement
```

### BK4: Enhanced Banking Features
**Status:** 10 enhancement modules exist

**Action Items:**
```
[ ] Test transaction categorization accuracy
[ ] Test spending prediction
[ ] Test subscription detection
[ ] Test budget alerts
```

---

## Browser Agent Fixes

### BA1: Type Safety
**Issue:** Many `any` types in browser agent

**Files to fix:**
```
[ ] src/main/agent/browser-agent/index.ts - 12 any types
[ ] src/main/agent/browser-agent/element-grounding.ts - 6 any types
[ ] src/main/agent/browser-agent/dom-serializer.ts - 3 any types
[ ] src/main/agent/browser-agent/context-fusion.ts - 2 any types
[ ] src/main/agent/browser-agent/action-compositor.ts - 4 any types
```

**Action Items:**
```
[ ] Create proper types for CDP responses
[ ] Type the evaluation results properly
[ ] Add generic types where appropriate
```

### BA2: Voice Integration Testing
**File:** `src/main/agent/browser-agent/voice-integration.ts`

**Action Items:**
```
[ ] Test natural language browser commands
[ ] Verify screen understanding works
[ ] Test multi-tab workflows
```

### BA3: Session Persistence
**Issue:** Session encryption needs verification

**Action Items:**
```
[ ] Test session save/restore
[ ] Verify AES-256-GCM encryption works
[ ] Test session expiry handling
```

---

## VM Agent Completion

### VM1: Core Connection Testing
**Action Items:**
```
[ ] Test VNC connection with actual VM
[ ] Test Hyper-V connection on Windows
[ ] Test VirtualBox connection
[ ] Test VMware connection
```

### VM2: Vision System
**Action Items:**
```
[ ] Test screen understanding accuracy
[ ] Verify UI element detection
[ ] Test OCR on VM screens
```

### VM3: Learning System
**Action Items:**
```
[ ] Test demonstration recording
[ ] Test behavior learning
[ ] Test strategy memory persistence
```

### VM4: WorldBox Support
**Action Items:**
```
[ ] Test WorldBox game detection
[ ] Test WorldBox-specific commands
[ ] Create WorldBox workflow examples
```

### VM5: IPC & UI
**Action Items:**
```
[ ] Create src/main/ipc/vm-agent-handlers.ts
[ ] Add VM agent to preload.ts
[ ] Complete VMAgentPanel.tsx component
```

---

## Gateway & Channels Completion

### GW1: Gateway Startup
**Action Items:**
```
[ ] Add startGateway() call to main/index.ts
[ ] Configure default port and host
[ ] Add authentication token support
```

### GW2: Session Manager
**Action Items:**
```
[ ] Test session creation/isolation
[ ] Test conversation history per session
[ ] Test session cleanup
```

### GW3: Telegram Adapter
**Action Items:**
```
[ ] Test bot token connection
[ ] Test message sending/receiving
[ ] Test group message handling
[ ] Test media attachments
```

### GW4: Discord Adapter
**Action Items:**
```
[ ] Test bot connection
[ ] Test server/channel messaging
[ ] Test embed support
```

### GW5: WhatsApp Adapter
**Action Items:**
```
[ ] Test QR pairing flow
[ ] Test message handling
[ ] Test media support
```

### GW6: Slack Adapter
**Action Items:**
```
[ ] Test bot token connection
[ ] Test channel messaging
[ ] Test thread support
```

### GW7: CLI Tool
**File:** `src/cli/index.ts`
**Action Items:**
```
[ ] Test all CLI commands
[ ] Add proper error handling
[ ] Create CLI documentation
```

### GW8: Web UI
**Directory:** `web-ui/`
**Action Items:**
```
[ ] Complete dashboard implementation
[ ] Test WebSocket connection
[ ] Add session management UI
[ ] Add cron job UI
```

---

## Intelligence Platform Gaps

### IP1: Agent Query Routing
**Action Items:**
```
[ ] Test query routing to correct agent
[ ] Verify agent specialization works
[ ] Test multi-agent coordination
```

### IP2: Dynamic Learning
**Action Items:**
```
[ ] Test pattern detection
[ ] Test prediction engine
[ ] Test behavioral modeling feedback
```

### IP3: COP (Common Operating Picture)
**Action Items:**
```
[ ] Test state aggregation
[ ] Test alert system
[ ] Create COP UI component
```

### IP4: Playbooks
**Action Items:**
```
[ ] Test playbook execution
[ ] Test trigger conditions
[ ] Create more built-in playbooks
```

---

## Career Module Completion

### CR1: Skills Gap Analyzer
**Action Items:**
```
[ ] Test against company profiles
[ ] Verify learning roadmap generation
[ ] Test skill matching accuracy
```

### CR2: Job Search Engine
**Action Items:**
```
[ ] Test search across platforms
[ ] Verify filtering works
[ ] Test recommendation engine
```

### CR3: CV Optimizer
**Action Items:**
```
[ ] Test ATS scoring
[ ] Test CV tailoring
[ ] Verify template generation
```

### CR4: Interview Prep
**Action Items:**
```
[ ] Test question generation
[ ] Test STAR story management
[ ] Test practice session tracking
```

---

## UI/Renderer Fixes

### UI1: Component Integration
**Many components exist but may not be visible in UI**

**Action Items:**
```
[ ] Add TradingDashboard to App.tsx routing
[ ] Add BankingPanel toggle
[ ] Add CareerPanel component
[ ] Add IntelligencePanel component
[ ] Add VMAgentPanel component
```

### UI2: State Management
**Action Items:**
```
[ ] Verify Zustand stores are properly typed
[ ] Test state persistence
[ ] Fix any stale state issues
```

### UI3: 3D Orb Performance
**Action Items:**
```
[ ] Test GPU detection accuracy
[ ] Verify particle count scaling
[ ] Test GPGPU system on various hardware
```

### UI4: Accessibility
**Action Items:**
```
[ ] Test screen reader support
[ ] Verify keyboard navigation
[ ] Test color contrast
```

---

## Security Hardening

### SEC1: Input Validation
**Action Items:**
```
[ ] Review all IPC handlers for validation
[ ] Test prompt injection defenses
[ ] Test path traversal prevention
```

### SEC2: API Key Storage
**Action Items:**
```
[ ] Verify keychain storage works on all platforms
[ ] Test encrypted fallback
[ ] Audit key exposure in logs
```

### SEC3: Permission System
**Action Items:**
```
[ ] Test dangerous operation confirmations
[ ] Verify tool risk levels are correct
[ ] Test permission prompts
```

### SEC4: Audit Logging
**Action Items:**
```
[ ] Complete audit logger implementation
[ ] Test log rotation
[ ] Verify sensitive data is masked
```

---

## Memory & Database Optimization

### DB1: LanceDB Performance
**Action Items:**
```
[ ] Test vector search performance
[ ] Optimize index settings
[ ] Add query caching
```

### DB2: SQLite Optimization
**Action Items:**
```
[ ] Review query patterns
[ ] Add indexes where needed
[ ] Test with large datasets
```

### DB3: Memory Cleanup
**Action Items:**
```
[ ] Verify singleton cleanup on shutdown
[ ] Fix memory leaks in long sessions
[ ] Add memory monitoring
```

---

## ML System Integration

### ML1: Tool Prewarmer
**File:** `src/main/ml/tool-prewarmer.ts`
**Action Items:**
```
[ ] Verify prewarmer is active in voice pipeline
[ ] Test prediction accuracy
[ ] Tune prewarming thresholds
```

### ML2: Semantic Cache
**File:** `src/main/ml/semantic-cache.ts`
**Action Items:**
```
[ ] Test cache hit rates
[ ] Tune similarity thresholds
[ ] Add cache statistics UI
```

### ML3: Workflow Detector
**File:** `src/main/ml/workflow-detector.ts`
**Action Items:**
```
[ ] Test pattern detection
[ ] Create workflow suggestion UI
[ ] Tune detection sensitivity
```

---

## Performance Optimization

### PERF1: Startup Time
**Action Items:**
```
[ ] Profile startup sequence
[ ] Optimize lazy loading
[ ] Reduce initial bundle size
```

### PERF2: Voice Latency
**Targets:**
- Wake word → STT: <200ms
- STT → LLM first token: <2s
- LLM → TTS first audio: <300ms

**Action Items:**
```
[ ] Measure current latencies
[ ] Optimize streaming pipeline
[ ] Test pre-warming effectiveness
```

### PERF3: Memory Usage
**Target:** <500MB baseline

**Action Items:**
```
[ ] Profile memory usage
[ ] Fix memory leaks
[ ] Optimize caching
```

---

## Code Quality & Lint Fixes

### CQ1: Remove Unused Imports
**~40 instances across codebase**

### CQ2: Fix any Types
**~50 instances, primarily in:**
- browser-agent modules
- VM agent modules
- Gateway handlers

### CQ3: Add ESLint Disable Comments
**For intentional patterns:**
```typescript
// CLI console statements
/* eslint-disable no-console */

// Intentional while(true) loops in stream readers
// eslint-disable-next-line no-constant-condition
```

### CQ4: Fix Case Block Declarations
**Wrap switch case blocks with lexical declarations in {}**

---

## Documentation Updates

### DOC1: Update README
**Action Items:**
```
[ ] Add all new features
[ ] Update installation instructions
[ ] Add troubleshooting section
```

### DOC2: API Documentation
**Action Items:**
```
[ ] Document all IPC channels
[ ] Add JSDoc to public APIs
[ ] Create API reference
```

### DOC3: Architecture Documentation
**Action Items:**
```
[ ] Update ARCHITECTURE.md with new modules
[ ] Create module dependency diagram
[ ] Document data flow
```

### DOC4: User Guide
**Action Items:**
```
[ ] Add trading system guide
[ ] Add banking setup guide
[ ] Add channel pairing guide
```

---

## Testing Coverage

### TC1: Unit Tests
**Current:** 1717 passing, 30 failing
**Target:** >80% coverage, 0 failures

**Priority test files to fix:**
```
1. tests/integration.test.ts (16 failures)
2. tests/personality.test.ts (6 failures)
3. tests/offline-tts.test.ts (5 failures)
4. tests/security.test.ts (1 failure)
5. tests/startup-profiler.test.ts (1 failure)
6. tests/llm.test.ts (1 failure)
```

### TC2: Integration Tests
**Action Items:**
```
[ ] Add voice pipeline end-to-end tests
[ ] Add trading flow tests
[ ] Add banking flow tests
```

### TC3: E2E Tests
**Action Items:**
```
[ ] Add Playwright tests for UI
[ ] Test full user journeys
[ ] Add visual regression tests
```

---

## Implementation Priority Order

### Week 1: Critical Fixes
1. ✅ Fix all test failures
2. ✅ Fix memory leak in test runner
3. ✅ Remove/fix unused variables
4. ✅ Implement offline STT properly

### Week 2: Core Integration
5. Wire Gateway to main index.ts
6. Wire channel adapters
7. Add VM Agent IPC handlers
8. Complete study system IPC

### Week 3: Trading & Banking
9. Test trading system end-to-end
10. Test banking system end-to-end
11. Fix any type errors in tools
12. Add kill switch UI

### Week 4: Intelligence & Learning
13. Test intelligence platform
14. Wire ML systems properly
15. Test workflow detection
16. Complete COP UI

### Week 5: Polish & Documentation
17. Fix all lint warnings
18. Update documentation
19. Add missing JSDoc
20. Performance optimization

### Week 6: Testing & QA
21. Achieve 80%+ test coverage
22. Run full E2E test suite
23. Security audit
24. Release preparation

---

## Quick Wins (Can Be Done Immediately)

1. **Fix test count in security.test.ts** - 1 line change
2. **Add eslint-disable to CLI** - 1 line at top of file
3. **Prefix unused vars with underscore** - Global find/replace
4. **Fix switch case declarations** - Add {} blocks
5. **Update test script with memory flag** - 1 line in package.json

---

## Files Requiring Most Attention

| File | Issues | Priority |
|------|--------|----------|
| `src/main/stt/offline.ts` | Stub implementation | HIGH |
| `src/main/voice/nova-voice/plugin-system.ts` | Not implemented errors | HIGH |
| `src/main/vision/screen-analyzer.ts` | OCR not implemented | MEDIUM |
| `tests/integration.test.ts` | 16 failures | HIGH |
| `tests/personality.test.ts` | 6 failures | HIGH |
| `src/main/gateway/index.ts` | Not started on boot | HIGH |
| `src/main/vm-agent/index.ts` | Not exposed via IPC | MEDIUM |
| `src/main/agent/browser-agent/*.ts` | Many any types | MEDIUM |

---

## Success Criteria

Atlas is "working perfectly" when:

- [ ] All tests pass (0 failures)
- [ ] All lint warnings resolved or suppressed with reason
- [ ] Voice pipeline works end-to-end
- [ ] All stub implementations replaced with real code
- [ ] All modules properly integrated via IPC
- [ ] Trading system connects to backend
- [ ] Banking system authenticates with TrueLayer
- [ ] Gateway starts and accepts connections
- [ ] Channel adapters can connect to platforms
- [ ] VM Agent can connect to VMs
- [ ] All UI components accessible and functional
- [ ] Memory usage stays under 500MB
- [ ] Voice latency meets targets
- [ ] Documentation is complete and accurate

---

## Estimated Total Effort

| Category | Hours | Priority |
|----------|-------|----------|
| Test Fixes | 8 | P0 |
| Stub Implementations | 40 | P1 |
| IPC/Integration | 24 | P1 |
| Type Safety Fixes | 16 | P2 |
| Gateway/Channels | 16 | P2 |
| Trading/Banking | 16 | P2 |
| VM Agent | 8 | P3 |
| Documentation | 8 | P3 |
| Performance | 8 | P3 |
| **TOTAL** | **144 hours** | |

---

*This plan should be executed in order, with P0 items completed before moving to P1, etc.*
