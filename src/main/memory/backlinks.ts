/**
 * Atlas Desktop - Backlinks
 * Extract and manage [[wikilinks]] in Obsidian notes
 */

import * as path from 'path';
import { getAllNotes } from './obsidian-brain';
import { readNote } from './note-writer';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Backlinks');

/**
 * Wikilink regex patterns
 * Matches [[Note]] or [[Note|Display Text]]
 */
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Code block patterns to skip when linkifying
 */
const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`]+`/g;

/**
 * Extracted backlink information
 */
export interface Backlink {
  /** The target note title (what's inside [[ ]]) */
  target: string;
  /** The display text (if using [[Note|Display]]) */
  displayText?: string;
  /** Character position in the original content */
  position: number;
}

/**
 * Extract all backlinks from note content
 *
 * @param content - The markdown content to search
 * @returns Array of backlinks found
 */
export function extractBacklinks(content: string): Backlink[] {
  const backlinks: Backlink[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  WIKILINK_REGEX.lastIndex = 0;

  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    backlinks.push({
      target: match[1].trim(),
      displayText: match[2]?.trim(),
      position: match.index,
    });
  }

  return backlinks;
}

/**
 * Extract just the target names from backlinks
 *
 * @param content - The markdown content to search
 * @returns Array of unique target note titles
 */
export function extractBacklinkTargets(content: string): string[] {
  const backlinks = extractBacklinks(content);
  const targets = backlinks.map((b) => b.target);
  return [...new Set(targets)]; // Remove duplicates
}

/**
 * Check if a word is at a word boundary
 */
function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 || /\s|[.,!?;:'"()[\]{}]/.test(text[start - 1]);
  const after = end >= text.length || /\s|[.,!?;:'"()[\]{}]/.test(text[end]);
  return before && after;
}

/**
 * Find code block positions to avoid linkifying inside them
 */
function getCodeBlockRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let match: RegExpExecArray | null;

  CODE_BLOCK_REGEX.lastIndex = 0;
  while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }

  return ranges;
}

/**
 * Check if a position is inside a code block
 */
function isInCodeBlock(position: number, codeRanges: Array<[number, number]>): boolean {
  return codeRanges.some(([start, end]) => position >= start && position < end);
}

/**
 * Check if text at position is already linked
 */
function isAlreadyLinked(text: string, position: number): boolean {
  // Check if we're inside [[ ]]
  const beforeSlice = text.slice(Math.max(0, position - 50), position);
  const afterSlice = text.slice(position, position + 50);

  const hasOpenBracket = beforeSlice.includes('[[') && !beforeSlice.includes(']]');
  const hasCloseBracket = afterSlice.includes(']]') && !afterSlice.includes('[[');

  return hasOpenBracket && hasCloseBracket;
}

/**
 * Add backlinks to known entities in text
 * Case-insensitive matching, whole words only
 *
 * @param text - The text to process
 * @param knownEntities - Array of entity names to link
 * @returns Text with backlinks added
 */
export function linkifyText(text: string, knownEntities: string[]): string {
  if (knownEntities.length === 0) {
    return text;
  }

  // Get code block positions
  const codeRanges = getCodeBlockRanges(text);

  // Sort entities by length (longest first) to handle overlapping matches
  const sortedEntities = [...knownEntities].sort((a, b) => b.length - a.length);

  // Track replacements to make (we'll apply them in reverse order)
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const entity of sortedEntities) {
    // Create case-insensitive regex for the entity
    const escapedEntity = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const entityRegex = new RegExp(escapedEntity, 'gi');

    let match: RegExpExecArray | null;
    while ((match = entityRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if not at word boundary
      if (!isWordBoundary(text, start, end)) {
        continue;
      }

      // Skip if in code block
      if (isInCodeBlock(start, codeRanges)) {
        continue;
      }

      // Skip if already linked
      if (isAlreadyLinked(text, start)) {
        continue;
      }

      // Skip if this position is already covered by a previous replacement
      const isOverlapping = replacements.some(
        (r) => (start >= r.start && start < r.end) || (end > r.start && end <= r.end)
      );
      if (isOverlapping) {
        continue;
      }

      // Add replacement - use original case from text, link to proper entity name
      const originalText = match[0];
      const replacement =
        originalText.toLowerCase() === entity.toLowerCase()
          ? `[[${entity}]]`
          : `[[${entity}|${originalText}]]`;

      replacements.push({ start, end, replacement });
    }
  }

  // Apply replacements in reverse order to preserve positions
  replacements.sort((a, b) => b.start - a.start);

  let result = text;
  for (const { start, end, replacement } of replacements) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

/**
 * Find all notes that link to a specific note
 *
 * @param targetTitle - The title of the note to find backlinks to
 * @returns Array of note paths that link to the target
 */
export async function findBacklinksTo(targetTitle: string): Promise<string[]> {
  const notes = await getAllNotes();
  const backlinkers: string[] = [];

  for (const notePath of notes) {
    const note = await readNote(notePath);
    if (!note) continue;

    const targets = extractBacklinkTargets(note.content);
    if (targets.some((t) => t.toLowerCase() === targetTitle.toLowerCase())) {
      backlinkers.push(notePath);
    }
  }

  logger.debug('Found backlinks', { target: targetTitle, count: backlinkers.length });

  return backlinkers;
}

/**
 * Get all known entities from the vault
 * These are note titles that can be auto-linked
 */
export async function getKnownEntities(): Promise<string[]> {
  const notes = await getAllNotes();
  const entities: string[] = [];

  for (const notePath of notes) {
    const note = await readNote(notePath);
    if (note?.metadata?.title) {
      entities.push(note.metadata.title);
    } else {
      // Use filename without extension as fallback
      const filename = path.basename(notePath, '.md');
      entities.push(filename.replace(/-/g, ' '));
    }
  }

  return [...new Set(entities)]; // Remove duplicates
}

/**
 * Build a graph of all connections between notes
 */
export async function buildLinkGraph(): Promise<
  Map<string, { outgoing: string[]; incoming: string[] }>
> {
  const notes = await getAllNotes();
  const graph = new Map<string, { outgoing: string[]; incoming: string[] }>();

  // Initialize all notes in the graph
  for (const notePath of notes) {
    const note = await readNote(notePath);
    const title = note?.metadata?.title || path.basename(notePath, '.md');
    graph.set(title, { outgoing: [], incoming: [] });
  }

  // Build connections
  for (const notePath of notes) {
    const note = await readNote(notePath);
    if (!note) continue;

    const title = note.metadata?.title || path.basename(notePath, '.md');
    const targets = extractBacklinkTargets(note.content);

    const nodeData = graph.get(title);
    if (nodeData) {
      nodeData.outgoing = targets;
    }

    // Update incoming links for targets
    for (const target of targets) {
      const targetData = graph.get(target);
      if (targetData && !targetData.incoming.includes(title)) {
        targetData.incoming.push(title);
      }
    }
  }

  logger.info('Built link graph', { nodes: graph.size });

  return graph;
}

/**
 * Find notes that share common connections
 *
 * @param noteTitle - The note to find related notes for
 * @param limit - Maximum number of related notes to return
 * @returns Array of related note titles with scores
 */
export async function findRelatedNotes(
  noteTitle: string,
  limit: number = 10
): Promise<Array<{ title: string; score: number }>> {
  const graph = await buildLinkGraph();
  const noteData = graph.get(noteTitle);

  if (!noteData) {
    return [];
  }

  // Score other notes based on shared connections
  const scores = new Map<string, number>();

  // Notes that link to the same targets get points
  for (const outgoing of noteData.outgoing) {
    const targetData = graph.get(outgoing);
    if (targetData) {
      for (const incoming of targetData.incoming) {
        if (incoming !== noteTitle) {
          scores.set(incoming, (scores.get(incoming) || 0) + 1);
        }
      }
    }
  }

  // Notes that are linked from the same sources get points
  for (const incoming of noteData.incoming) {
    const sourceData = graph.get(incoming);
    if (sourceData) {
      for (const outgoing of sourceData.outgoing) {
        if (outgoing !== noteTitle) {
          scores.set(outgoing, (scores.get(outgoing) || 0) + 1);
        }
      }
    }
  }

  // Direct connections get extra points
  for (const outgoing of noteData.outgoing) {
    scores.set(outgoing, (scores.get(outgoing) || 0) + 2);
  }
  for (const incoming of noteData.incoming) {
    scores.set(incoming, (scores.get(incoming) || 0) + 2);
  }

  // Sort by score and return top results
  const related = Array.from(scores.entries())
    .map(([title, score]) => ({ title, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return related;
}

/**
 * Count total links in the vault
 */
export async function countLinks(): Promise<{
  totalNotes: number;
  totalLinks: number;
  averageLinksPerNote: number;
}> {
  const notes = await getAllNotes();
  let totalLinks = 0;

  for (const notePath of notes) {
    const note = await readNote(notePath);
    if (note) {
      totalLinks += extractBacklinks(note.content).length;
    }
  }

  return {
    totalNotes: notes.length,
    totalLinks,
    averageLinksPerNote: notes.length > 0 ? totalLinks / notes.length : 0,
  };
}
