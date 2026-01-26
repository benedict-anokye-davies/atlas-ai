/**
 * Video Script Generator
 * T5-103: LLM-based video script creation
 *
 * Generates engaging video scripts optimized for different platforms
 * using LLM with specialized prompts for hooks, content, and CTAs.
 */

import { getLLMManager, LLMManager } from '../../llm';
import { createModuleLogger } from '../../utils/logger';
import type { Script, ScriptSection, VideoStyle } from '../types';

const logger = createModuleLogger('ScriptGenerator');

// Default video styles
export const DEFAULT_STYLES: Record<string, VideoStyle> = {
  faceless: {
    type: 'faceless',
    tone: 'informative',
    pacing: 'medium',
    voiceStyle: 'professional',
  },
  entertaining: {
    type: 'faceless',
    tone: 'entertaining',
    pacing: 'fast',
    voiceStyle: 'energetic',
  },
  educational: {
    type: 'faceless',
    tone: 'informative',
    pacing: 'slow',
    voiceStyle: 'calm',
  },
  dramatic: {
    type: 'reddit-story',
    tone: 'dramatic',
    pacing: 'medium',
    voiceStyle: 'storyteller',
  },
  casual: {
    type: 'faceless',
    tone: 'casual',
    pacing: 'medium',
    voiceStyle: 'friendly',
  },
};

// Words per minute for duration estimation
const WORDS_PER_MINUTE = 150;

/**
 * Script Generator for video content
 */
export class ScriptGenerator {
  private llm: LLMManager;

  constructor(llm?: LLMManager) {
    this.llm = llm || getLLMManager();
  }

  /**
   * Generate a complete video script
   */
  async generate(
    topic: string,
    style: VideoStyle = DEFAULT_STYLES.faceless,
    targetDuration: number = 60 // seconds
  ): Promise<Script> {
    logger.info('Generating script', { topic, style: style.type, targetDuration });

    const targetWords = Math.round((targetDuration / 60) * WORDS_PER_MINUTE);

    const prompt = this.buildScriptPrompt(topic, style, targetWords, targetDuration);

    try {
      const response = await this.llm.chat(prompt);
      const content = response.content;

      // Parse the generated script
      const script = this.parseScriptResponse(content, topic, targetDuration);

      logger.info('Script generated successfully', {
        topic,
        sections: script.sections.length,
        estimatedDuration: script.estimatedDuration,
      });

      return script;
    } catch (error) {
      logger.error('Failed to generate script', { error, topic });
      throw error;
    }
  }

  /**
   * Generate multiple hook options for a topic
   */
  async generateHooks(topic: string, count: number = 5): Promise<string[]> {
    logger.info('Generating hooks', { topic, count });

    const prompt = `Generate ${count} attention-grabbing video hooks for a video about: "${topic}"

Each hook should:
- Be 1-2 sentences maximum
- Create curiosity or urgency
- Stop the scroll within the first 3 seconds
- NOT use clickbait or misleading claims

Format your response as a numbered list (1. 2. 3. etc.)

Examples of good hooks:
- "What if I told you that 90% of people do THIS wrong every single day?"
- "This one trick changed everything for me, and it takes just 30 seconds."
- "Scientists just discovered something that challenges everything we knew about..."`;

    try {
      const response = await this.llm.chat(prompt);
      const hooks = this.parseHooksResponse(response.content);

      logger.info('Hooks generated', { topic, count: hooks.length });
      return hooks;
    } catch (error) {
      logger.error('Failed to generate hooks', { error, topic });
      throw error;
    }
  }

  /**
   * Generate a call-to-action for the video
   */
  async generateCTA(topic: string, platform: 'youtube' | 'tiktok' = 'youtube'): Promise<string> {
    logger.info('Generating CTA', { topic, platform });

    const platformGuidelines =
      platform === 'youtube'
        ? 'Ask viewers to like, subscribe, and comment. Can be 2-3 sentences.'
        : 'Keep it very short (under 5 seconds). Focus on follow or like.';

    const prompt = `Generate a natural, non-pushy call-to-action for the end of a video about: "${topic}"

Platform: ${platform}
Guidelines: ${platformGuidelines}

The CTA should:
- Feel natural, not desperate
- Give viewers a reason to engage
- Optionally tease upcoming content

Provide just the CTA text, no additional explanation.`;

    try {
      const response = await this.llm.chat(prompt);
      const cta = response.content.trim();

      logger.info('CTA generated', { topic, platform });
      return cta;
    } catch (error) {
      logger.error('Failed to generate CTA', { error, topic });
      throw error;
    }
  }

  /**
   * Generate visual notes/B-roll suggestions for a script section
   */
  async generateVisualNotes(sectionContent: string): Promise<string> {
    const prompt = `For this video script section, suggest specific B-roll footage and visual elements:

Script section:
"${sectionContent}"

Provide 3-5 specific visual suggestions that could accompany this narration. Be specific (not just "show something relevant").

Format as a bullet list.`;

    try {
      const response = await this.llm.chat(prompt);
      return response.content.trim();
    } catch (error) {
      logger.warn('Failed to generate visual notes', { error });
      return 'Stock footage relevant to the topic';
    }
  }

  /**
   * Improve an existing script
   */
  async improveScript(script: Script, feedback: string): Promise<Script> {
    logger.info('Improving script', { feedback: feedback.slice(0, 100) });

    const prompt = `Improve this video script based on the feedback provided.

Current Script:
Hook: ${script.hook}

Sections:
${script.sections.map((s, i) => `${i + 1}. ${s.title}\n${s.content}`).join('\n\n')}

CTA: ${script.cta}

Feedback: ${feedback}

Provide the improved script in the same format. Keep the same structure but improve based on the feedback.

Format your response exactly like this:
HOOK: [the hook]
SECTION 1: [title]
[content]
SECTION 2: [title]
[content]
(continue for all sections)
CTA: [call to action]`;

    try {
      const response = await this.llm.chat(prompt);
      const improved = this.parseScriptResponse(
        response.content,
        script.sections[0]?.title || 'Improved Script',
        script.estimatedDuration
      );

      logger.info('Script improved successfully');
      return improved;
    } catch (error) {
      logger.error('Failed to improve script', { error });
      throw error;
    }
  }

  /**
   * Generate a complete script from a Reddit story
   */
  async generateRedditStoryScript(story: string, subreddit: string = 'askreddit'): Promise<Script> {
    logger.info('Generating Reddit story script', { subreddit, storyLength: story.length });

    const prompt = `Convert this Reddit story into an engaging video script for TikTok/YouTube Shorts.

Subreddit: r/${subreddit}
Story: "${story}"

Create a script that:
1. Has a hook that makes people want to hear the full story
2. Builds tension/interest throughout
3. Has a satisfying conclusion
4. Is paced for dramatic effect
5. Total duration: 30-60 seconds

Format your response exactly like this:
HOOK: [attention-grabbing opening]
SECTION 1: Setup
[set the scene]
SECTION 2: Build
[build tension]
SECTION 3: Climax
[the main event]
SECTION 4: Conclusion
[wrap up]
CTA: [simple engagement ask]`;

    try {
      const response = await this.llm.chat(prompt);
      const script = this.parseScriptResponse(response.content, story.slice(0, 50), 45);

      logger.info('Reddit story script generated');
      return script;
    } catch (error) {
      logger.error('Failed to generate Reddit story script', { error });
      throw error;
    }
  }

  /**
   * Generate title and description for a video
   */
  async generateMetadata(
    script: Script,
    platform: 'youtube' | 'tiktok' = 'youtube'
  ): Promise<{
    title: string;
    description: string;
    tags: string[];
  }> {
    const voiceoverPreview = script.voiceoverText.slice(0, 500);

    const prompt = `Generate optimized ${platform} metadata for this video:

Script hook: ${script.hook}
Content preview: ${voiceoverPreview}...

Provide:
1. TITLE: An attention-grabbing title (${platform === 'youtube' ? '50-60 characters' : '100 characters max'})
2. DESCRIPTION: ${platform === 'youtube' ? 'First 2 lines should hook viewers, include a brief summary (150 words)' : 'Short engaging description (150 characters)'}
3. TAGS: 10 relevant ${platform === 'youtube' ? 'tags' : 'hashtags'}

Format exactly as:
TITLE: [title]
DESCRIPTION: [description]
TAGS: tag1, tag2, tag3...`;

    try {
      const response = await this.llm.chat(prompt);
      const metadata = this.parseMetadataResponse(response.content);

      logger.info('Metadata generated', { platform, title: metadata.title.slice(0, 30) });
      return metadata;
    } catch (error) {
      logger.error('Failed to generate metadata', { error });
      throw error;
    }
  }

  // Private helper methods

  private buildScriptPrompt(
    topic: string,
    style: VideoStyle,
    targetWords: number,
    targetDuration: number
  ): string {
    const toneDescriptions: Record<string, string> = {
      informative: 'educational and fact-based, clear explanations',
      entertaining: 'fun, engaging, with humor and personality',
      dramatic: 'building tension, storytelling with emotional hooks',
      casual: 'conversational, like talking to a friend',
    };

    const pacingDescriptions: Record<string, string> = {
      slow: 'Allow pauses, give time to absorb information',
      medium: 'Balanced pace, not rushed but keeps moving',
      fast: 'Quick cuts, rapid information, high energy',
    };

    return `Create a video script about: "${topic}"

Target duration: ${targetDuration} seconds (~${targetWords} words total)
Style: ${style.type}
Tone: ${style.tone} - ${toneDescriptions[style.tone] || style.tone}
Pacing: ${style.pacing} - ${pacingDescriptions[style.pacing] || style.pacing}
Voice style: ${style.voiceStyle}

The script should:
1. Start with an attention-grabbing HOOK (first 3 seconds are crucial)
2. Deliver value quickly - don't waste time
3. Be structured in clear sections with visual notes
4. End with a natural call-to-action
5. Be written for spoken delivery (conversational, not written prose)

Format your response EXACTLY like this:
HOOK: [1-2 sentence hook that stops the scroll]

SECTION 1: [Section Title]
[Content for this section - be specific and valuable]
VISUALS: [Brief notes on what to show]

SECTION 2: [Section Title]
[Content for this section]
VISUALS: [Brief notes on what to show]

(Add more sections as needed for the duration)

CTA: [Natural call-to-action]`;
  }

  private parseScriptResponse(content: string, topic: string, targetDuration: number): Script {
    const lines = content.split('\n').map((l) => l.trim());

    let hook = '';
    const sections: ScriptSection[] = [];
    let cta = '';
    let currentSection: Partial<ScriptSection> | null = null;
    let currentContent: string[] = [];
    let visualNotes: string[] = [];

    for (const line of lines) {
      if (line.startsWith('HOOK:')) {
        hook = line.replace('HOOK:', '').trim();
      } else if (line.match(/^SECTION \d+:/i)) {
        // Save previous section
        if (currentSection?.title) {
          sections.push({
            title: currentSection.title,
            content: currentContent.join(' ').trim(),
            visualNotes: visualNotes.join('\n').trim() || 'Relevant B-roll',
            duration: 0, // Will calculate below
          });
        }
        currentSection = {
          title: line.replace(/^SECTION \d+:\s*/i, '').trim(),
        };
        currentContent = [];
        visualNotes = [];
      } else if (line.startsWith('VISUALS:')) {
        visualNotes.push(line.replace('VISUALS:', '').trim());
      } else if (line.startsWith('CTA:')) {
        // Save last section
        if (currentSection?.title) {
          sections.push({
            title: currentSection.title,
            content: currentContent.join(' ').trim(),
            visualNotes: visualNotes.join('\n').trim() || 'Relevant B-roll',
            duration: 0,
          });
        }
        cta = line.replace('CTA:', '').trim();
      } else if (currentSection && line && !line.startsWith('---')) {
        currentContent.push(line);
      }
    }

    // Handle case where CTA wasn't explicitly marked
    if (currentSection?.title && sections.length === 0) {
      sections.push({
        title: currentSection.title,
        content: currentContent.join(' ').trim(),
        visualNotes: visualNotes.join('\n').trim() || 'Relevant B-roll',
        duration: 0,
      });
    }

    // Calculate durations based on word count
    const totalWords = sections.reduce(
      (sum, s) => sum + s.content.split(/\s+/).length,
      hook.split(/\s+/).length + cta.split(/\s+/).length
    );
    const wordsPerSecond = totalWords / targetDuration;

    for (const section of sections) {
      const sectionWords = section.content.split(/\s+/).length;
      section.duration = Math.round(sectionWords / wordsPerSecond);
    }

    // Build voiceover text
    const voiceoverText = [hook, ...sections.map((s) => s.content), cta].filter((t) => t).join(' ');

    const estimatedDuration = Math.round(
      voiceoverText.split(/\s+/).length / (WORDS_PER_MINUTE / 60)
    );

    return {
      hook: hook || `Let me tell you about ${topic}`,
      sections:
        sections.length > 0
          ? sections
          : [
              {
                title: 'Main Content',
                content: content.replace(/^(HOOK|SECTION|CTA|VISUALS):.*/gim, '').trim(),
                visualNotes: 'Relevant B-roll footage',
                duration: targetDuration,
              },
            ],
      cta: cta || 'Thanks for watching!',
      estimatedDuration,
      voiceoverText,
    };
  }

  private parseHooksResponse(content: string): string[] {
    const hooks: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // Match numbered items (1. 2. etc.) or bullet points
      const match = line.match(/^[\d.\-*]+\s*(.+)$/);
      if (match) {
        const hook = match[1].trim();
        if (hook.length > 10) {
          hooks.push(hook);
        }
      }
    }

    return hooks;
  }

  private parseMetadataResponse(content: string): {
    title: string;
    description: string;
    tags: string[];
  } {
    let title = '';
    let description = '';
    let tags: string[] = [];

    const lines = content.split('\n');
    let inDescription = false;
    const descriptionLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('TITLE:')) {
        title = line.replace('TITLE:', '').trim();
        inDescription = false;
      } else if (line.startsWith('DESCRIPTION:')) {
        description = line.replace('DESCRIPTION:', '').trim();
        inDescription = true;
      } else if (line.startsWith('TAGS:')) {
        inDescription = false;
        const tagsStr = line.replace('TAGS:', '').trim();
        tags = tagsStr.split(',').map((t) => t.trim().replace(/^#/, ''));
      } else if (inDescription && line.trim()) {
        descriptionLines.push(line.trim());
      }
    }

    if (descriptionLines.length > 0) {
      description = [description, ...descriptionLines].filter(Boolean).join('\n');
    }

    return { title, description, tags };
  }
}

// Singleton instance
let scriptGenerator: ScriptGenerator | null = null;

/**
 * Get the script generator singleton
 */
export function getScriptGenerator(): ScriptGenerator {
  if (!scriptGenerator) {
    scriptGenerator = new ScriptGenerator();
  }
  return scriptGenerator;
}

/**
 * Quick access to generate a script
 */
export async function generateVideoScript(
  topic: string,
  style?: VideoStyle,
  duration?: number
): Promise<Script> {
  const generator = getScriptGenerator();
  return generator.generate(topic, style, duration);
}

/**
 * Quick access to generate hooks
 */
export async function generateVideoHooks(topic: string, count?: number): Promise<string[]> {
  const generator = getScriptGenerator();
  return generator.generateHooks(topic, count);
}
