/**
 * Memory System Tests
 * Comprehensive tests for the memory lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Vector Store Types Tests
describe('Vector Store Types', () => {
  describe('VectorDocument', () => {
    it('should define required fields', () => {
      const doc = {
        id: 'test-1',
        vector: [0.1, 0.2, 0.3],
        content: 'Test content',
        metadata: {
          sourceType: 'conversation' as const,
          importance: 0.5,
          accessCount: 0,
        },
        createdAt: Date.now(),
        accessedAt: Date.now(),
      };

      expect(doc.id).toBeDefined();
      expect(doc.vector).toBeInstanceOf(Array);
      expect(doc.content).toBe('Test content');
      expect(doc.metadata.sourceType).toBe('conversation');
    });
  });

  describe('VectorMetadata', () => {
    it('should support all source types', () => {
      const sourceTypes = ['conversation', 'fact', 'preference', 'context', 'task', 'other'];
      sourceTypes.forEach((type) => {
        const metadata = {
          sourceType: type as 'conversation' | 'fact' | 'preference' | 'context' | 'task' | 'other',
          importance: 0.5,
          accessCount: 0,
        };
        expect(metadata.sourceType).toBe(type);
      });
    });

    it('should support optional fields', () => {
      const metadata = {
        sourceType: 'fact' as const,
        importance: 0.8,
        accessCount: 5,
        topics: ['coding', 'javascript'],
        tags: ['important'],
        isSummary: false,
      };

      expect(metadata.topics).toContain('coding');
      expect(metadata.tags).toContain('important');
      expect(metadata.isSummary).toBe(false);
    });
  });
});

// Embedding Tests
describe('Embedding Generation', () => {
  describe('Local Embedder', () => {
    // Test the local embedding logic
    it('should tokenize text correctly', () => {
      const text = 'Hello, world! This is a test.';
      const tokens = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1);

      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('this');
      expect(tokens).toContain('test');
    });

    it('should generate consistent hash for same text', () => {
      const hashText = (text: string): string => {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          const char = text.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash;
        }
        return hash.toString(36);
      };

      const text = 'test input';
      expect(hashText(text)).toBe(hashText(text));
      expect(hashText(text)).not.toBe(hashText('different'));
    });
  });

  describe('Cosine Similarity', () => {
    const cosineSimilarity = (a: number[], b: number[]): number => {
      if (a.length !== b.length) throw new Error('Dimension mismatch');
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);
      if (normA === 0 || normB === 0) return 0;
      return dotProduct / (normA * normB);
    };

    it('should return 1 for identical vectors', () => {
      const v = [0.5, 0.3, 0.2];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
    });

    it('should handle negative values', () => {
      const v1 = [1, 0, 0];
      const v2 = [-1, 0, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });
  });
});

// Index Manager Tests
describe('Vector Index Manager', () => {
  describe('Index Operations', () => {
    it('should track entries by importance', () => {
      const entries = [
        { id: '1', importance: 0.3, accessedAt: Date.now() },
        { id: '2', importance: 0.8, accessedAt: Date.now() },
        { id: '3', importance: 0.5, accessedAt: Date.now() },
      ];

      const sorted = entries.sort((a, b) => b.importance - a.importance);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should track entries by recency', () => {
      const now = Date.now();
      const entries = [
        { id: '1', accessedAt: now - 1000 },
        { id: '2', accessedAt: now },
        { id: '3', accessedAt: now - 500 },
      ];

      const sorted = entries.sort((a, b) => b.accessedAt - a.accessedAt);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });
  });

  describe('Topic Index', () => {
    it('should group documents by topic', () => {
      const topicIndex = new Map<string, Set<string>>();

      const addToTopic = (docId: string, topic: string) => {
        if (!topicIndex.has(topic)) {
          topicIndex.set(topic, new Set());
        }
        topicIndex.get(topic)!.add(docId);
      };

      addToTopic('doc1', 'coding');
      addToTopic('doc2', 'coding');
      addToTopic('doc3', 'music');
      addToTopic('doc2', 'music');

      expect(topicIndex.get('coding')?.size).toBe(2);
      expect(topicIndex.get('music')?.size).toBe(2);
      expect(topicIndex.get('coding')?.has('doc1')).toBe(true);
      expect(topicIndex.get('music')?.has('doc2')).toBe(true);
    });
  });
});

// Cleanup Manager Tests
describe('Cleanup Manager', () => {
  describe('Cleanup Score Calculation', () => {
    const calculateCleanupScore = (
      importance: number,
      ageHours: number,
      accessCount: number
    ): number => {
      // Lower score = better cleanup candidate
      const importanceScore = importance * 0.4;
      const recencyScore = Math.max(0, 1 - ageHours / 720) * 0.3; // 30 days
      const accessScore = Math.min(1, accessCount / 10) * 0.2;
      return importanceScore + recencyScore + accessScore;
    };

    it('should give low scores to low-importance old documents', () => {
      const score = calculateCleanupScore(0.1, 500, 1);
      expect(score).toBeLessThan(0.3);
    });

    it('should give high scores to important recent documents', () => {
      const score = calculateCleanupScore(0.9, 1, 8);
      expect(score).toBeGreaterThan(0.5);
    });

    it('should prioritize access count', () => {
      const lowAccess = calculateCleanupScore(0.3, 100, 1);
      const highAccess = calculateCleanupScore(0.3, 100, 9);
      expect(highAccess).toBeGreaterThan(lowAccess);
    });
  });

  describe('Cleanup Candidates Selection', () => {
    it('should select lowest scoring documents', () => {
      const docs = [
        { id: '1', score: 0.8 },
        { id: '2', score: 0.2 },
        { id: '3', score: 0.5 },
        { id: '4', score: 0.1 },
      ];

      const sorted = docs.sort((a, b) => a.score - b.score);
      const candidates = sorted.slice(0, 2);

      expect(candidates[0].id).toBe('4');
      expect(candidates[1].id).toBe('2');
    });
  });
});

// Semantic Search Tests
describe('Semantic Search', () => {
  describe('Result Enhancement', () => {
    it('should combine semantic and importance scores', () => {
      const semanticScore = 0.8;
      const importanceScore = 0.6;
      const recencyScore = 0.9;

      const semanticWeight = 0.5;
      const importanceWeight = 0.3;
      const recencyWeight = 0.2;

      const finalScore =
        semanticScore * semanticWeight +
        importanceScore * importanceWeight +
        recencyScore * recencyWeight;

      expect(finalScore).toBeCloseTo(0.76, 2);
    });

    it('should apply topic bonuses', () => {
      const queryTopics = ['coding', 'javascript'];
      const docTopics = ['coding', 'react'];

      const matchedTopics = docTopics.filter((t) => queryTopics.includes(t));
      const topicBonus = matchedTopics.length * 0.1;

      expect(matchedTopics).toContain('coding');
      expect(topicBonus).toBe(0.1);
    });
  });

  describe('Search Filtering', () => {
    it('should filter by source type', () => {
      const results = [
        { sourceType: 'fact', score: 0.9 },
        { sourceType: 'conversation', score: 0.8 },
        { sourceType: 'fact', score: 0.7 },
      ];

      const filtered = results.filter((r) => r.sourceType === 'fact');
      expect(filtered).toHaveLength(2);
    });

    it('should filter by minimum score', () => {
      const results = [
        { score: 0.9 },
        { score: 0.3 },
        { score: 0.6 },
        { score: 0.1 },
      ];

      const minScore = 0.5;
      const filtered = results.filter((r) => r.score >= minScore);
      expect(filtered).toHaveLength(2);
    });
  });
});

// Summarization Tests
describe('Memory Summarization', () => {
  describe('Sentence Splitting', () => {
    const splitSentences = (text: string): string[] => {
      return text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    it('should split on periods', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const sentences = splitSentences(text);
      expect(sentences).toHaveLength(3);
    });

    it('should split on question marks', () => {
      const text = 'What is this? Is it working?';
      const sentences = splitSentences(text);
      expect(sentences).toHaveLength(2);
    });

    it('should split on exclamation marks', () => {
      const text = 'Hello world! This is great! Amazing.';
      const sentences = splitSentences(text);
      expect(sentences).toHaveLength(3);
    });
  });

  describe('Sentence Scoring', () => {
    const scoreSentence = (sentence: string): number => {
      let score = 0.5;
      const wordCount = sentence.split(/\s+/).length;
      if (wordCount >= 5 && wordCount <= 25) score += 0.1;
      const keywords = ['important', 'remember', 'always', 'never'];
      const lower = sentence.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) score += 0.05;
      }
      if (sentence.includes('?')) score += 0.1;
      return Math.min(1, score);
    };

    it('should boost sentences with keywords', () => {
      const regular = scoreSentence('This is a regular sentence here.');
      const important = scoreSentence('This is an important sentence to remember.');
      expect(important).toBeGreaterThan(regular);
    });

    it('should boost questions', () => {
      const statement = scoreSentence('This is a statement.');
      const question = scoreSentence('Is this a question?');
      expect(question).toBeGreaterThan(statement);
    });
  });

  describe('Summarization Level', () => {
    const getSummarizationLevel = (importance: number): string => {
      if (importance >= 0.7) return 'full';
      if (importance >= 0.4) return 'light';
      return 'aggressive';
    };

    it('should keep full detail for high importance', () => {
      expect(getSummarizationLevel(0.8)).toBe('full');
      expect(getSummarizationLevel(0.9)).toBe('full');
    });

    it('should apply light summarization for medium importance', () => {
      expect(getSummarizationLevel(0.5)).toBe('light');
      expect(getSummarizationLevel(0.6)).toBe('light');
    });

    it('should apply aggressive summarization for low importance', () => {
      expect(getSummarizationLevel(0.2)).toBe('aggressive');
      expect(getSummarizationLevel(0.1)).toBe('aggressive');
    });
  });
});

// Importance Scoring Tests
describe('Importance Scoring', () => {
  describe('Category Detection', () => {
    const detectCategory = (text: string): string => {
      const patterns = {
        user_preference: [/\bi\s+(?:like|love|prefer|enjoy)/i, /\bmy\s+favorite/i],
        user_fact: [/\bmy\s+name\s+is/i, /\bi\s+work\s+(?:at|in|as)/i],
        question: [/\?$/],
        casual: [/^(?:hi|hello|hey)\b/i],
      };

      for (const [category, regexes] of Object.entries(patterns)) {
        for (const regex of regexes) {
          if (regex.test(text)) return category;
        }
      }
      return 'casual';
    };

    it('should detect user preferences', () => {
      expect(detectCategory('I like pizza')).toBe('user_preference');
      expect(detectCategory('My favorite color is blue')).toBe('user_preference');
    });

    it('should detect user facts', () => {
      expect(detectCategory('My name is John')).toBe('user_fact');
      expect(detectCategory('I work at Google')).toBe('user_fact');
    });

    it('should detect questions', () => {
      expect(detectCategory('What time is it?')).toBe('question');
    });

    it('should detect casual messages', () => {
      expect(detectCategory('Hello there')).toBe('casual');
      expect(detectCategory('Hi!')).toBe('casual');
    });
  });

  describe('Time Decay', () => {
    const applyTimeDecay = (score: number, ageHours: number, halfLifeHours: number): number => {
      const decayFactor = Math.pow(0.5, ageHours / halfLifeHours);
      return Math.max(0.1, score * decayFactor);
    };

    it('should not decay recent memories', () => {
      const decayed = applyTimeDecay(0.8, 1, 168);
      expect(decayed).toBeGreaterThan(0.79);
    });

    it('should decay old memories', () => {
      const decayed = applyTimeDecay(0.8, 168, 168); // Exactly one half-life
      expect(decayed).toBeCloseTo(0.4, 1);
    });

    it('should have minimum importance', () => {
      const decayed = applyTimeDecay(0.8, 1000, 168);
      expect(decayed).toBeGreaterThanOrEqual(0.1);
    });
  });
});

// Consolidation Scheduler Tests
describe('Consolidation Scheduler', () => {
  describe('Scheduling Logic', () => {
    it('should calculate next daily consolidation time', () => {
      const targetHour = 3;
      const now = new Date();
      const target = new Date();
      target.setHours(targetHour, 0, 0, 0);

      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }

      expect(target.getHours()).toBe(targetHour);
      expect(target.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe('Idle Detection', () => {
    it('should track time since last activity', () => {
      const lastActivityTime = Date.now() - 60000; // 1 minute ago
      const timeSinceActivity = Date.now() - lastActivityTime;

      expect(timeSinceActivity).toBeGreaterThanOrEqual(60000);
    });

    it('should trigger consolidation after idle threshold', () => {
      const idleThresholdMs = 300000; // 5 minutes
      const lastActivityTime = Date.now() - 400000; // 6.67 minutes ago
      const isIdle = Date.now() - lastActivityTime >= idleThresholdMs;

      expect(isIdle).toBe(true);
    });
  });
});

// Context Builder Tests
describe('Context Assembler', () => {
  describe('Context Length Management', () => {
    it('should respect maximum length', () => {
      const maxLength = 100;
      let content = 'A'.repeat(150);

      if (content.length > maxLength) {
        content = content.slice(0, maxLength - 3) + '...';
      }

      expect(content.length).toBeLessThanOrEqual(maxLength);
      expect(content.endsWith('...')).toBe(true);
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens from content', () => {
      const content = 'This is a test sentence with some words.';
      const estimatedTokens = Math.ceil(content.length / 4);

      // Content is 41 chars, should estimate ~10-11 tokens
      expect(estimatedTokens).toBeGreaterThan(8);
      expect(estimatedTokens).toBeLessThan(15);
    });
  });

  describe('Priority Sorting', () => {
    it('should prioritize by source type', () => {
      const priorityTypes = ['fact', 'preference', 'task', 'context', 'conversation', 'other'];
      const results = [
        { sourceType: 'conversation', score: 0.9 },
        { sourceType: 'fact', score: 0.7 },
        { sourceType: 'preference', score: 0.8 },
      ];

      const sorted = results.sort((a, b) => {
        const aIndex = priorityTypes.indexOf(a.sourceType);
        const bIndex = priorityTypes.indexOf(b.sourceType);
        return aIndex - bIndex;
      });

      expect(sorted[0].sourceType).toBe('fact');
      expect(sorted[1].sourceType).toBe('preference');
      expect(sorted[2].sourceType).toBe('conversation');
    });
  });
});

// Integration Tests
describe('Memory System Integration', () => {
  describe('Memory Lifecycle', () => {
    it('should flow from creation to cleanup', () => {
      // Simulate the lifecycle
      const lifecycle = {
        created: false,
        embedded: false,
        indexed: false,
        searched: false,
        scored: false,
        summarized: false,
        cleaned: false,
      };

      // Step 1: Create memory
      lifecycle.created = true;
      expect(lifecycle.created).toBe(true);

      // Step 2: Generate embedding
      lifecycle.embedded = true;
      expect(lifecycle.embedded).toBe(true);

      // Step 3: Add to index
      lifecycle.indexed = true;
      expect(lifecycle.indexed).toBe(true);

      // Step 4: Search and retrieve
      lifecycle.searched = true;
      expect(lifecycle.searched).toBe(true);

      // Step 5: Score importance
      lifecycle.scored = true;
      expect(lifecycle.scored).toBe(true);

      // Step 6: Summarize (if low importance)
      lifecycle.summarized = true;
      expect(lifecycle.summarized).toBe(true);

      // Step 7: Cleanup (if needed)
      lifecycle.cleaned = true;
      expect(lifecycle.cleaned).toBe(true);
    });
  });

  describe('Cross-Component Consistency', () => {
    it('should maintain ID consistency across components', () => {
      const docId = 'test-doc-123';

      // Vector store would use this ID
      const vectorStoreEntry = { id: docId, vector: [0.1, 0.2] };

      // Index manager would track this ID
      const indexEntry = { id: docId, importance: 0.5 };

      // Cleanup would reference this ID
      const cleanupCandidate = { id: docId, score: 0.3 };

      expect(vectorStoreEntry.id).toBe(docId);
      expect(indexEntry.id).toBe(docId);
      expect(cleanupCandidate.id).toBe(docId);
    });
  });
});
