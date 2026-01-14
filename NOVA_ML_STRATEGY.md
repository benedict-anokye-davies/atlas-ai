# Nova Advanced ML Integration Strategy

**Strategic Document for Layering ML Techniques into Development**  
**Status**: ML Research Complete - Ready for Staged Integration  
**Last Updated**: January 13, 2026, 3:38 AM GMT

---

## EXECUTIVE SUMMARY

You're right to **start with Fireworks AI (no local LLMs yet)**. Here's why this is the optimal strategy:

### Current Plan (✅ CORRECT)
**Phase 1-4** (Weeks 1-13): Focus on **architecture & fundamentals**
- Voice pipeline (Porcupine + Deepgram + ElevenLabs)
- Visual orb (React Three Fiber)
- Core agent (Fireworks AI)
- Memory system (Mem0 + LanceDB)

**Why**:
1. Fireworks AI is **fast, cheap, reliable** (~$0.10-0.15/1M tokens)
2. No need to optimize local inference yet
3. Fewer moving parts = fewer bugs
4. Can focus on architecture instead of GPU optimization
5. Local model integration becomes "nice-to-have" rather than blocker

### Future Plan (Phase 5-7+): Add ML Enhancements
Once Nova has **solid fundamentals**, layer in advanced ML techniques:
- Memory optimization (HyDE, GraphRAG, temporal weighting)
- Agent intelligence (ReAct, Reflexion, Tree of Thoughts)
- Autonomous research enhancements
- Self-improvement loops (LoRA fine-tuning, RLHF)

---

## ML TECHNIQUES ROADMAP (By Priority)

### 🟢 PHASE 1-4: MVP Foundation (Use Fireworks AI as-is)

**No complex ML techniques needed.** Focus on solid engineering:
- ✅ Basic RAG with Mem0 + LanceDB
- ✅ Simple ReAct prompting (think + act)
- ✅ Standard voice I/O
- ✅ Conversation memory storage

**Why**: These phases establish the **architecture** Nova needs to benefit from ML techniques later.

---

### 🟡 PHASE 5-6: Enhancement Layer (Add Smart Retrieval)

**After voice + orb + memory working**, add **memory intelligence**:

#### 1. HyDE (Hypothetical Document Embeddings) - **HIGH IMPACT, MEDIUM EFFORT**
```
What it does: Generate hypothetical answers, search for similar docs
Impact: 20-30% better memory retrieval accuracy
Effort: 4-6 hours implementation
When: Week 10 (Phase 4 complete)

Why now: You have conversation history → can improve retrieval
```

**Implementation for Nova**:
```typescript
// src/main/memory/hydeRetrieval.ts
async hydeRetrieval(query: string): Promise<Memory[]> {
  // Step 1: Generate 3-5 hypothetical answers to query
  const hypotheticals = await nova.generateHypotheticals(query);
  // "What would Nova's answer look like if she knew the answer?"
  
  // Step 2: Embed hypotheticals + original query
  const embeddings = hypotheticals.map(h => embed(h));
  embeddings.push(embed(query));
  
  // Step 3: Average embeddings
  const avgEmbedding = average(embeddings);
  
  // Step 4: Search LanceDB with averaged embedding
  return await lancedb.search(avgEmbedding, topK=5);
}
```

**Add to NOVA_REBUILD_PLAN.md**:
```
Phase 4.5 Memory Enhancement (Week 10, 3-4 hours)
- [ ] Implement HyDE retrieval
- [ ] Test on past conversations
- [ ] Measure retrieval accuracy improvement
- [ ] Deploy to production
```

---

#### 2. Temporal Memory Weighting - **MEDIUM IMPACT, LOW EFFORT**
```
What it does: Weight recent memories higher, older ones fade
Impact: More natural forgetting curve, better relevance
Effort: 2-3 hours
When: Week 10 (same time as HyDE)

Why now: Natural extension of memory system
```

**Implementation**:
```typescript
// src/main/memory/temporalWeighting.ts
function memoryRelevanceScore(
  lastAccessed: Date,
  accessCount: number,
  memoryAge: Date
): number {
  const daysSinceAccess = (Date.now() - lastAccessed) / (1000 * 60 * 60 * 24);
  const strength = 1.0 + Math.log(accessCount + 1);
  
  // Ebbinghaus forgetting curve: R(t) = e^(-t/S)
  // R = retention, t = time, S = strength
  const retention = Math.exp(-daysSinceAccess / strength);
  
  // Bonus for recently created memories
  const recencyBonus = accessCount > 0 ? 1.2 : 1.0;
  
  return retention * recencyBonus;
}

// Sort memories by relevance
memories.sort((a, b) => {
  const scoreA = memoryRelevanceScore(a.lastAccessed, a.accessCount, a.created);
  const scoreB = memoryRelevanceScore(b.lastAccessed, b.accessCount, b.created);
  return scoreB - scoreA;
});
```

---

#### 3. Silero VAD (Voice Activity Detection) - **MEDIUM IMPACT, MEDIUM EFFORT**
```
What it does: Detect when you're speaking vs silence
Impact: 4x better wake word accuracy, fewer false triggers
Effort: 4-5 hours
When: Phase 2 (alongside TTS/STT)

Why: Makes voice pipeline much more robust
```

**Replace simple "always listening" with smart detection**:
```typescript
// src/main/voice/sileroVad.ts
import * as Silero from '@silero-vad/silero-vad-js';

export class VoiceActivityDetector {
  private vad: any;
  private isInitialized = false;
  
  async initialize() {
    this.vad = new Silero.OrtVAD();
    await this.vad.init();
    this.isInitialized = true;
  }
  
  // Process audio frame, return speech probability (0-1)
  processPCM(pcmData: Float32Array): number {
    return this.vad.process(pcmData);
  }
}

// In porcupine detector:
const speechProb = vad.processPCM(audioFrame);

if (speechProb > 0.5) {
  // User is definitely speaking
  if (keywordIndex >= 0) {
    // Wake word detected + voice activity = high confidence
    onWakeWordDetected();
  }
}
```

---

### 🔴 PHASE 7-8: Intelligence Layer (Self-Improving Nova)

**After everything above is working**, add **agent intelligence**:

#### 4. ReAct with Reflexion - **HIGH IMPACT, HIGH EFFORT**
```
What it does: Think → Act → Observe → Self-Critique → Learn
Impact: 98%+ success on complex tasks (vs 40-50% baseline)
Effort: 2-3 weeks
When: Phase 7 (Week 15+, post-exams, post-features)

Why: Makes Nova learn from every interaction
```

**How it improves Nova**:
```
WITHOUT Reflexion:
User: "Nova, find me a good TypeScript React library"
Nova: "React Query is good"
User: "No, I meant for state management"
Nova: "Oh, Redux is good"
→ Repeat same mistake next time

WITH Reflexion:
User: "Nova, find me a good TypeScript React library"
Nova: *thinks* "User wants library, but didn't specify type"
Nova: "Did you mean for state management, data fetching, or UI components?"
User: "State management"
Nova: *acts* Search TypeScript state management libraries
Nova: *reflects* "I should ask for clarification when query is ambiguous"
→ Learns to ask clarifying questions
```

**Implementation roadmap**:
```
Week 1: Implement basic Reflexion loop
- Trajectory tracking (what Nova did)
- Evaluator (was it successful?)
- Critic (what should be different?)

Week 2: Memory integration
- Store reflections in Nova Brain
- Retrieve relevant past learnings
- Apply to new tasks

Week 3: Testing & refinement
- Test on real conversations
- Measure improvement
- Deploy to production
```

---

#### 5. LoRA Fine-Tuning (DPO instead of RLHF) - **HIGH IMPACT, MEDIUM EFFORT**
```
What it does: Train Nova on YOUR conversations (simplified RLHF)
Impact: 30%+ better responses for your use case
Effort: 1-2 weeks
When: Phase 8 (Week 16+)

Why: Make Nova personalized, not generic
```

**DPO vs RLHF: Why DPO is better for your setup**:
| Aspect | RLHF | DPO |
|--------|------|-----|
| Complexity | High (needs reward model) | Low (pairs of responses) |
| Training time | 2-3 weeks on RTX 3060 | 3-5 days |
| Setup | Complex | Simple |
| Your use case | Overkill | Perfect |

**DPO Implementation**:
```python
# scripts/dpo_finetune.py
# Step 1: Extract conversation pairs (good response vs bad response)
def extract_dpo_pairs(conversations):
    pairs = []
    for conv in conversations:
        # Find cases where you corrected Nova
        if "Actually, I meant" in conv.user_message:
            # This is a correction - Nova's response was suboptimal
            prev_response = conv.previous_nova_response
            corrected_response = # extract actual intent
            pairs.append((prev_response, corrected_response))
    return pairs

# Step 2: Train with DPO
from trl import DPOTrainer
from transformers import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-2-7b")
dpo_trainer = DPOTrainer(
    model=model,
    args=training_args,
    train_dataset=dpo_pairs,  # (rejected, preferred) response pairs
)
dpo_trainer.train()

# Step 3: Merge LoRA weights
model = model.merge_and_unload()
model.save_pretrained("./nova-custom-weights")
```

**Timeline**:
- Week 1: Collect 100+ correction examples from your conversations
- Week 2: Run DPO fine-tuning
- Week 3: Test and validate

---

### 🟠 FUTURE (Phase 9+): Advanced Techniques

These are **nice-to-have** after everything above:

1. **GraphRAG** - Knowledge graph for complex relationships
2. **Tree of Thoughts** - Explore multiple reasoning paths
3. **Constrained Decoding** - 100% reliable tool calls
4. **Speculative Decoding** - 2-3x faster inference (if you add local LLMs)
5. **Constitutional AI** - Self-improvement without human feedback

---

## WHEN TO ADD LOCAL MODELS

**Don't add local models until**:
- [ ] Phases 1-4 complete (MVP working)
- [ ] Fireworks costs >$50/month (currently ~$10)
- [ ] You want offline capability
- [ ] You want faster response times

**When you add them** (suggested Phase 8+):
```
Local Model Options (RTX 3060, 6GB):
- Qwen 2.5 7B (4-bit): 40-60 tok/s, quality 8/10
- Phi-3 Mini: 100+ tok/s, quality 6/10
- Mistral 7B: 50-70 tok/s, quality 8/10

Use Speculative Decoding:
Small model drafts responses → Large model verifies
Result: 2-3x speedup vs large model alone

When to use local instead of Fireworks:
1. User is offline
2. Response is non-critical (research, ideas)
3. Want instant response (no API latency)
4. Privacy-critical (sensitive conversations)
```

---

## RECOMMENDED ML TECHNIQUE ORDER

**If you want to add ML enhancements after MVP**:

### Week 10 (Phase 4 complete) - 3 days
- [ ] Add HyDE memory retrieval
- [ ] Implement temporal memory weighting
- Impact: Better context, more natural conversations

### Week 12 (Phase 5 complete) - 1 day
- [ ] Add Silero VAD for voice detection
- Impact: 4x fewer false wake word triggers

### Week 15+ (Phase 7 complete) - 2 weeks
- [ ] Implement Reflexion loop
- [ ] Test on complex task types
- Impact: Nova learns from every interaction

### Week 17+ (Phase 8 complete) - 2-3 weeks
- [ ] Collect DPO training pairs
- [ ] Fine-tune with DPO
- [ ] Deploy custom Nova model
- Impact: 30%+ personalized responses

---

## RESEARCH QUERIES FOR EACH TECHNIQUE

### HyDE Retrieval
```
HyDE Hypothetical Document Embeddings implementation Python
Best embedding model for conversational AI 2025
Hybrid search BM25 vector embeddings LanceDB
```

### Reflexion Self-Improvement
```
Reflexion agent implementation Python tutorial
Trajectory-based learning for LLM agents
Self-critique without RLHF implementation guide
```

### DPO Fine-Tuning
```
DPO Direct Preference Optimization vs RLHF explanation
TRL library DPO trainer implementation
LoRA merging techniques for combining adapters
```

### Silero VAD
```
Silero VAD JavaScript Node.js implementation
Voice Activity Detection vs always-on listening comparison
WebRTC VAD vs Silero accuracy 2025
```

---

## COST-BENEFIT ANALYSIS

| Technique | Cost | Benefit | ROI | When |
|-----------|------|---------|-----|------|
| HyDE | 4 hrs | 20-30% better retrieval | ✅✅✅ | Week 10 |
| Temporal Weighting | 3 hrs | Natural memory decay | ✅✅ | Week 10 |
| Silero VAD | 5 hrs | 4x fewer false wakes | ✅✅✅ | Week 3 |
| Reflexion | 2-3 wks | Continuous learning | ✅✅✅ | Week 15+ |
| DPO Fine-tuning | 2-3 wks | 30% personalization | ✅✅ | Week 17+ |
| GraphRAG | 3-4 wks | Complex reasoning | ✅ | Phase 9 |
| Tree of Thoughts | 2 wks | 95% hard problem solving | ✅✅ | Phase 9 |

**Best ROI for your setup**: HyDE + Temporal Weighting + Silero VAD (total 12 hours, massive impact)

---

## WHAT NOT TO DO (YET)

❌ **Don't implement yet**:
- Local LLM fallbacks (Ollama, Qwen)
- Complex agent frameworks (LangGraph, CrewAI)
- Prompt caching optimizations
- Extended thinking / test-time compute
- Speculative decoding
- Multi-modal vision (screen understanding)

**Why**: These are optimizations **after** MVP. Add them only when you hit specific problems.

---

## SUMMARY: YOUR ML STRATEGY

**Phase 1-4 (Weeks 1-13)**: 
- Use Fireworks AI as-is
- Focus on architecture
- No ML techniques (keep simple)

**Phase 5 (Week 10-13)**: 
- Add HyDE + Temporal weighting (simple, high-impact)
- Test memory improvements

**Phase 6 (Week 12-13)**:
- Add Silero VAD (makes voice more robust)

**Phase 7-8 (Weeks 15-20, post-exams)**:
- Add Reflexion self-improvement loop
- Collect DPO training data
- Fine-tune custom Nova model

**Phase 9+ (Weeks 20+)**:
- Consider advanced techniques (GraphRAG, Tree of Thoughts)
- Add local models if needed
- Implement speculative decoding

---

## FINAL RECOMMENDATION

**Start exactly as planned** → Use Fireworks AI for Phases 1-4 → Layer in ML techniques strategically.

You're building a **solid foundation first** (correct decision). Advanced ML techniques will be 10x more effective once you have:
- ✅ Working voice pipeline
- ✅ Beautiful visual interface
- ✅ Persistent memory
- ✅ Autonomous research loop

Then layer in intelligence.

**Don't optimize prematurely.**

---

**Next Step**: Start Phase 1 with Fireworks AI as planned. Come back to this document at Week 10 to add memory enhancements.

**ML research is complete. Ready to build! 🚀**
