# PRD-T4: Communication & Self-Improvement

## Overview

T4 is responsible for implementing communication integrations (Phase 7) and the self-improvement system (Phase 8).

## File Ownership

```
src/main/communication/                # NEW: Communication layer
  ├── gmail.ts
  ├── outlook.ts
  ├── calendar.ts
  ├── twilio.ts
  └── index.ts
src/main/gepa/                         # NEW: Self-improvement system
  ├── eval-framework.ts
  ├── optimizer.ts
  ├── dspy-integration.ts
  ├── scheduler.ts
  └── index.ts
src/main/agent/tools/email.ts          # NEW: Email tools
src/main/agent/tools/calendar.ts       # NEW: Calendar tools
src/main/agent/tools/phone.ts          # NEW: Phone/SMS tools
```

## IPC Channels

Prefix all IPC with `comms:*` or `gepa:*`

---

## Phase 7: Communication

### Dependencies

```bash
npm install googleapis @microsoft/microsoft-graph-client twilio
```

### Tasks

| ID     | Task                  | Description                           | Priority |
| ------ | --------------------- | ------------------------------------- | -------- |
| T4-101 | Gmail OAuth           | Set up Google OAuth for Gmail access  | HIGH     |
| T4-102 | Gmail read/send       | Read inbox, send emails               | HIGH     |
| T4-103 | Gmail search          | Search emails by query                | HIGH     |
| T4-104 | Outlook OAuth         | Set up Microsoft Graph OAuth          | HIGH     |
| T4-105 | Outlook read/send     | Read inbox, send emails               | HIGH     |
| T4-106 | Google Calendar sync  | Read/write calendar events            | HIGH     |
| T4-107 | Outlook Calendar sync | Read/write calendar events            | HIGH     |
| T4-108 | Email summarization   | LLM-based email summarization         | MEDIUM   |
| T4-109 | Email prioritization  | Rank emails by importance             | MEDIUM   |
| T4-110 | Twilio Voice setup    | Configure Twilio for outbound calls   | HIGH     |
| T4-111 | Twilio SMS            | Send/receive SMS                      | HIGH     |
| T4-112 | Voice calls           | Two-way voice conversation via Twilio | HIGH     |
| T4-113 | Unified inbox         | Aggregate emails from all sources     | MEDIUM   |

### Architecture

```typescript
// communication/gmail.ts
export class GmailClient {
  async authorize(): Promise<void>;
  async getMessages(query?: string, maxResults?: number): Promise<Email[]>;
  async getMessage(id: string): Promise<EmailFull>;
  async sendEmail(to: string, subject: string, body: string): Promise<void>;
  async reply(messageId: string, body: string): Promise<void>;
  async markRead(messageId: string): Promise<void>;
  async archive(messageId: string): Promise<void>;
  async getLabels(): Promise<Label[]>;
}

// communication/calendar.ts
export class CalendarManager {
  async getEvents(from: Date, to: Date): Promise<CalendarEvent[]>;
  async createEvent(event: NewEvent): Promise<CalendarEvent>;
  async updateEvent(eventId: string, updates: Partial<NewEvent>): Promise<void>;
  async deleteEvent(eventId: string): Promise<void>;
  async getUpcoming(hours?: number): Promise<CalendarEvent[]>;
  async findFreeSlots(duration: number, within: DateRange): Promise<TimeSlot[]>;
}

// communication/twilio.ts
export class TwilioManager {
  async sendSMS(to: string, message: string): Promise<void>;
  async makeCall(to: string, message: string): Promise<CallSid>;
  async handleIncomingCall(callSid: string): Promise<void>;
  async speakDuringCall(callSid: string, text: string): Promise<void>;
  async listenDuringCall(callSid: string): Promise<string>;
  async endCall(callSid: string): Promise<void>;
}
```

### Communication Tools

| Tool                  | Description                         |
| --------------------- | ----------------------------------- |
| email_get_inbox       | Get recent emails from all accounts |
| email_search          | Search emails by query              |
| email_read            | Read specific email                 |
| email_send            | Send email                          |
| email_reply           | Reply to email                      |
| email_summarize       | Get AI summary of emails            |
| calendar_get_events   | Get upcoming events                 |
| calendar_create_event | Create new event                    |
| calendar_find_free    | Find free time slots                |
| phone_call            | Call user's phone                   |
| phone_sms             | Send SMS to user                    |

### Twilio Voice Flow

```
1. Atlas decides to call user (urgent alert)
2. Twilio initiates outbound call
3. User answers
4. Atlas speaks via ElevenLabs TTS streamed to Twilio
5. User speaks, Twilio streams audio to Atlas
6. Atlas uses STT (Deepgram) to understand
7. Conversation continues
8. Atlas ends call when complete
```

### Test Checklist

```
[ ] Gmail OAuth completes
[ ] Read last 10 emails
[ ] Send test email
[ ] Search emails by keyword
[ ] Outlook OAuth completes
[ ] Read Outlook inbox
[ ] Create calendar event
[ ] Get today's events
[ ] Send SMS via Twilio
[ ] Make outbound call via Twilio
[ ] Two-way voice conversation works
```

---

## Phase 8: Self-Improvement (GEPA)

### Dependencies

```bash
npm install dspy-ts  # If TypeScript port exists, otherwise use Python subprocess
```

### Tasks

| ID     | Task                   | Description                            | Priority |
| ------ | ---------------------- | -------------------------------------- | -------- |
| T4-201 | Eval framework         | Track success/failure/corrections      | HIGH     |
| T4-202 | Metrics collection     | Collect response time, accuracy, etc.  | HIGH     |
| T4-203 | DSPy integration       | Set up DSPy for prompt optimization    | HIGH     |
| T4-204 | GEPA optimizer         | Implement GEPA prompt optimization     | HIGH     |
| T4-205 | Nightly scheduler      | Run optimization overnight             | MEDIUM   |
| T4-206 | Change reporting       | Report optimizations to user           | HIGH     |
| T4-207 | Rollback system        | Revert changes if performance degrades | HIGH     |
| T4-208 | Code self-modification | Allow Atlas to modify its own code     | MEDIUM   |
| T4-209 | A/B testing            | Test prompt variants                   | LOW      |

### Architecture

```typescript
// gepa/eval-framework.ts
export class EvalFramework {
  async recordInteraction(interaction: Interaction): Promise<void>;
  async recordCorrection(interactionId: string, correction: string): Promise<void>;
  async recordSuccess(interactionId: string): Promise<void>;
  async recordFailure(interactionId: string, reason: string): Promise<void>;
  async getMetrics(period: string): Promise<Metrics>;
  async getFailurePatterns(): Promise<FailurePattern[]>;
}

// gepa/optimizer.ts
export class GEPAOptimizer {
  async analyzePerformance(): Promise<AnalysisResult>;
  async generateOptimizations(): Promise<Optimization[]>;
  async applyOptimization(opt: Optimization): Promise<void>;
  async rollback(optimizationId: string): Promise<void>;
  async runNightlyOptimization(): Promise<OptimizationReport>;
}

// gepa/scheduler.ts
export class OptimizationScheduler {
  scheduleNightly(hour: number): void;
  async runNow(): Promise<OptimizationReport>;
  getLastReport(): OptimizationReport | null;
  getHistory(): OptimizationReport[];
}
```

### What GEPA Optimizes

| Target         | Method                                 |
| -------------- | -------------------------------------- |
| System prompts | DSPy signature optimization            |
| Tool selection | Learn which tools work for which tasks |
| Response style | Adapt to user preferences              |
| Error handling | Learn from failures                    |
| Prioritization | Learn what's important to user         |
| Communication  | Match user's communication style       |

### Eval Signals

```typescript
interface EvalSignals {
  taskSuccess: boolean;           // Did the task complete?
  responseTime: number;           // How long did it take?
  userCorrection: string | null;  // Did user correct Atlas?
  userSatisfaction: 1-5 | null;   // Explicit rating if given
  retryCount: number;             // How many attempts?
  toolsUsed: string[];            // Which tools were used?
  errorOccurred: boolean;         // Did an error occur?
}
```

### Safety Rails

1. **Git tracking**: All code changes committed with clear messages
2. **Rollback**: One command to revert any optimization
3. **Approval**: Major changes require user approval
4. **Gradual rollout**: Changes applied incrementally
5. **Performance monitoring**: Automatic rollback if metrics degrade

### Optimization Schedule

```
00:00 - Collect day's metrics
00:30 - Analyze failure patterns
01:00 - Generate optimizations
01:30 - Apply optimizations to staging
02:00 - Run validation tests
02:30 - Promote to production or rollback
03:00 - Generate report for user
```

### Test Checklist

```
[ ] Record interaction with success/failure
[ ] Record user correction
[ ] Calculate daily metrics
[ ] Identify failure patterns
[ ] Generate optimization suggestion
[ ] Apply optimization
[ ] Rollback optimization
[ ] Schedule nightly run
[ ] Generate user report
```

---

## Task Summary

| ID     | Task                   | Phase | Priority |
| ------ | ---------------------- | ----- | -------- |
| T4-101 | Gmail OAuth            | 7     | HIGH     |
| T4-102 | Gmail read/send        | 7     | HIGH     |
| T4-103 | Gmail search           | 7     | HIGH     |
| T4-104 | Outlook OAuth          | 7     | HIGH     |
| T4-105 | Outlook read/send      | 7     | HIGH     |
| T4-106 | Google Calendar sync   | 7     | HIGH     |
| T4-107 | Outlook Calendar sync  | 7     | HIGH     |
| T4-108 | Email summarization    | 7     | MEDIUM   |
| T4-109 | Email prioritization   | 7     | MEDIUM   |
| T4-110 | Twilio Voice setup     | 7     | HIGH     |
| T4-111 | Twilio SMS             | 7     | HIGH     |
| T4-112 | Voice calls            | 7     | HIGH     |
| T4-113 | Unified inbox          | 7     | MEDIUM   |
| T4-201 | Eval framework         | 8     | HIGH     |
| T4-202 | Metrics collection     | 8     | HIGH     |
| T4-203 | DSPy integration       | 8     | HIGH     |
| T4-204 | GEPA optimizer         | 8     | HIGH     |
| T4-205 | Nightly scheduler      | 8     | MEDIUM   |
| T4-206 | Change reporting       | 8     | HIGH     |
| T4-207 | Rollback system        | 8     | HIGH     |
| T4-208 | Code self-modification | 8     | MEDIUM   |
| T4-209 | A/B testing            | 8     | LOW      |

## Quality Gates

Before marking any task DONE:

1. `npm run typecheck` passes
2. `npm run lint` passes
3. OAuth flows work end-to-end
4. Tokens stored securely
5. Added to tool registry
6. IPC handlers added

## Notes

- Gmail and Outlook both use OAuth 2.0
- Twilio requires account with phone number
- DSPy may need Python subprocess if no TS port
- GEPA changes should be conservative initially
- All optimizations must be reversible
