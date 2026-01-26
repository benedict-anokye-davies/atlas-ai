/**
 * File Indexer
 * Indexes files from filesystem and extracts entities and relationships
 */

import { createModuleLogger } from '../../../utils/logger';
import { OntologyEntity, OntologyRelationship, DocumentEntity, ProjectEntity } from '../../types';
import {
  SemanticParser,
  FileParsedOutput,
  FileInput,
  FileTreeNode,
  FileCluster,
} from '../types';

const logger = createModuleLogger('FileIndexer');

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt',
  '.xls', '.xlsx', '.csv', '.ods',
  '.ppt', '.pptx', '.odp',
  '.html', '.htm', '.xml', '.json', '.yaml', '.yml',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r',
  '.sql', '.sh', '.bash', '.ps1', '.bat', '.cmd',
]);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff',
]);

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.config',
  '.eslintrc', '.prettierrc', '.babelrc', '.gitignore',
]);

// ============================================================================
// FILE INDEXER IMPLEMENTATION
// ============================================================================

export class FileIndexer implements SemanticParser<FileInput | FileInput[], FileParsedOutput> {
  readonly name = 'FileIndexer';
  readonly version = '1.0.0';
  readonly sourceTypes = ['filesystem'] as const;

  // --------------------------------------------------------------------------
  // MAIN PARSE
  // --------------------------------------------------------------------------

  async parse(input: FileInput | FileInput[]): Promise<FileParsedOutput> {
    const files = Array.isArray(input) ? input : [input];
    logger.debug('Indexing files', { count: files.length });

    const tree = this.buildFileTree(files);
    const clusters = this.clusterFiles(files);

    // Detect projects
    const projects = this.detectProjects(files);

    // Calculate file statistics
    const typeBreakdown = this.calculateTypeBreakdown(files);
    const recentlyModified = files
      .filter(f => f.modifiedAt)
      .sort((a, b) => new Date(b.modifiedAt!).getTime() - new Date(a.modifiedAt!).getTime())
      .slice(0, 20);

    const output: FileParsedOutput = {
      sourceType: 'filesystem',
      parsedAt: new Date(),
      files,
      tree,
      projects,
      clusters,
      statistics: {
        totalFiles: files.length,
        totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
        typeBreakdown,
        recentlyModified: recentlyModified.map(f => ({
          path: f.path,
          modifiedAt: f.modifiedAt!,
        })),
      },
    };

    logger.info('File indexing completed', {
      fileCount: files.length,
      projectCount: projects.length,
      clusterCount: clusters.length,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // FILE TREE BUILDING
  // --------------------------------------------------------------------------

  private buildFileTree(files: FileInput[]): FileTreeNode {
    const root: FileTreeNode = {
      name: 'root',
      path: '/',
      type: 'directory',
      children: [],
    };

    for (const file of files) {
      const parts = file.path.split(/[/\\]/).filter(Boolean);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        const currentPath = '/' + parts.slice(0, i + 1).join('/');

        let child = current.children?.find(c => c.name === part);

        if (!child) {
          child = {
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
            children: isFile ? undefined : [],
            size: isFile ? file.size : undefined,
            mimeType: isFile ? file.mimeType : undefined,
            modifiedAt: isFile ? file.modifiedAt : undefined,
          };
          current.children = current.children || [];
          current.children.push(child);
        }

        if (!isFile) {
          current = child;
        }
      }
    }

    // Sort children (directories first, then alphabetically)
    this.sortTreeChildren(root);

    return root;
  }

  private sortTreeChildren(node: FileTreeNode): void {
    if (!node.children) return;

    node.children.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of node.children) {
      this.sortTreeChildren(child);
    }
  }

  // --------------------------------------------------------------------------
  // FILE CLUSTERING
  // --------------------------------------------------------------------------

  private clusterFiles(files: FileInput[]): FileCluster[] {
    const clusters: FileCluster[] = [];

    // Cluster by directory
    const dirClusters = new Map<string, FileInput[]>();
    for (const file of files) {
      const dir = this.getDirectoryPath(file.path);
      if (!dirClusters.has(dir)) {
        dirClusters.set(dir, []);
      }
      dirClusters.get(dir)!.push(file);
    }

    for (const [dir, dirFiles] of dirClusters) {
      if (dirFiles.length >= 3) {
        clusters.push({
          name: dir.split(/[/\\]/).pop() || 'root',
          files: dirFiles.map(f => f.path),
          commonTags: this.findCommonTags(dirFiles),
          suggestedProject: this.suggestProjectName(dir, dirFiles),
        });
      }
    }

    // Cluster by file type
    const typeClusters = new Map<string, FileInput[]>();
    for (const file of files) {
      const ext = this.getExtension(file.path);
      const typeCategory = this.getTypeCategory(ext);

      if (!typeClusters.has(typeCategory)) {
        typeClusters.set(typeCategory, []);
      }
      typeClusters.get(typeCategory)!.push(file);
    }

    for (const [type, typeFiles] of typeClusters) {
      if (typeFiles.length >= 5 && type !== 'other') {
        clusters.push({
          name: `${type} files`,
          files: typeFiles.map(f => f.path),
          commonTags: [type],
        });
      }
    }

    return clusters;
  }

  // --------------------------------------------------------------------------
  // PROJECT DETECTION
  // --------------------------------------------------------------------------

  private detectProjects(files: FileInput[]): Array<{ path: string; type: string; name: string }> {
    const projects: Array<{ path: string; type: string; name: string }> = [];
    const projectIndicators = new Map<string, { type: string; file: string }>([
      ['package.json', { type: 'nodejs', file: 'package.json' }],
      ['requirements.txt', { type: 'python', file: 'requirements.txt' }],
      ['Cargo.toml', { type: 'rust', file: 'Cargo.toml' }],
      ['go.mod', { type: 'go', file: 'go.mod' }],
      ['pom.xml', { type: 'java-maven', file: 'pom.xml' }],
      ['build.gradle', { type: 'java-gradle', file: 'build.gradle' }],
      ['Gemfile', { type: 'ruby', file: 'Gemfile' }],
      ['composer.json', { type: 'php', file: 'composer.json' }],
      ['.csproj', { type: 'dotnet', file: '.csproj' }],
      ['tsconfig.json', { type: 'typescript', file: 'tsconfig.json' }],
    ]);

    for (const file of files) {
      const filename = file.path.split(/[/\\]/).pop() || '';

      for (const [indicator, info] of projectIndicators) {
        if (filename === indicator || filename.endsWith(indicator)) {
          const projectPath = this.getDirectoryPath(file.path);
          const projectName = projectPath.split(/[/\\]/).pop() || 'unnamed';

          // Avoid duplicates
          if (!projects.some(p => p.path === projectPath)) {
            projects.push({
              path: projectPath,
              type: info.type,
              name: projectName,
            });
          }
          break;
        }
      }
    }

    return projects;
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  private calculateTypeBreakdown(files: FileInput[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    for (const file of files) {
      const ext = this.getExtension(file.path);
      const category = this.getTypeCategory(ext);
      breakdown[category] = (breakdown[category] || 0) + 1;
    }

    return breakdown;
  }

  // --------------------------------------------------------------------------
  // HELPER METHODS
  // --------------------------------------------------------------------------

  private getExtension(path: string): string {
    const match = path.match(/\.[^./\\]+$/);
    return match ? match[0].toLowerCase() : '';
  }

  private getDirectoryPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts.slice(0, -1).join('/') || '/';
  }

  private getTypeCategory(ext: string): string {
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
    if (CODE_EXTENSIONS.has(ext)) return 'code';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (CONFIG_EXTENSIONS.has(ext)) return 'config';
    return 'other';
  }

  private findCommonTags(files: FileInput[]): string[] {
    const tags: string[] = [];

    // Check for common patterns
    const extensions = new Set(files.map(f => this.getExtension(f.path)));
    if (extensions.size === 1 && extensions.values().next().value) {
      tags.push(extensions.values().next().value.replace('.', ''));
    }

    // Check for project type
    const hasPackageJson = files.some(f => f.path.endsWith('package.json'));
    const hasTsConfig = files.some(f => f.path.endsWith('tsconfig.json'));

    if (hasPackageJson && hasTsConfig) tags.push('typescript');
    else if (hasPackageJson) tags.push('javascript');

    return tags;
  }

  private suggestProjectName(dir: string, files: FileInput[]): string | undefined {
    // Check for package.json with name
    const packageJson = files.find(f => f.path.endsWith('package.json'));
    if (packageJson && packageJson.content) {
      try {
        const pkg = JSON.parse(packageJson.content);
        if (pkg.name) return pkg.name;
      } catch {
        // Ignore parse errors
      }
    }

    // Use directory name
    return dir.split(/[/\\]/).pop();
  }

  // --------------------------------------------------------------------------
  // ENTITY EXTRACTION
  // --------------------------------------------------------------------------

  extractEntities(output: FileParsedOutput): OntologyEntity[] {
    const entities: OntologyEntity[] = [];

    // Create Document entities for each file
    for (const file of output.files) {
      const ext = this.getExtension(file.path);
      const category = this.getTypeCategory(ext);

      const doc: DocumentEntity = {
        id: `doc_${this.hashPath(file.path)}`,
        type: 'Document',
        name: file.path.split(/[/\\]/).pop() || file.path,
        createdAt: file.createdAt ? new Date(file.createdAt) : new Date(),
        updatedAt: file.modifiedAt ? new Date(file.modifiedAt) : new Date(),
        sources: ['filesystem'],
        confidence: 0.95,
        documentType: category,
        path: file.path,
        mimeType: file.mimeType,
        size: file.size,
        tags: [category, ext.replace('.', '')].filter(Boolean),
        mentions: [],
        relatedEntities: [],
        accessLevel: 'private',
      };

      entities.push(doc);
    }

    // Create Project entities for detected projects
    for (const project of output.projects) {
      const proj: ProjectEntity = {
        id: `project_${this.hashPath(project.path)}`,
        type: 'Project',
        name: project.name,
        createdAt: new Date(),
        updatedAt: new Date(),
        sources: ['filesystem'],
        confidence: 0.8,
        status: 'active',
        priority: 'medium',
        startDate: new Date(),
        tags: [project.type],
        technologies: [project.type],
        repositories: [],
        milestones: [],
        teamMembers: [],
      };

      entities.push(proj);
    }

    logger.debug('Extracted entities from files', {
      documentCount: output.files.length,
      projectCount: output.projects.length,
    });

    return entities;
  }

  private hashPath(path: string): string {
    // Simple hash for path-based ID generation
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP EXTRACTION
  // --------------------------------------------------------------------------

  extractRelationships(output: FileParsedOutput): OntologyRelationship[] {
    const relationships: OntologyRelationship[] = [];

    // Link files to their projects
    for (const project of output.projects) {
      const projectId = `project_${this.hashPath(project.path)}`;

      for (const file of output.files) {
        // Check if file is within project directory
        if (file.path.startsWith(project.path) || file.path.includes(project.path)) {
          const docId = `doc_${this.hashPath(file.path)}`;

          relationships.push({
            id: `${projectId}_contains_${docId}`,
            sourceId: projectId,
            sourceType: 'Project',
            targetId: docId,
            targetType: 'Document',
            relationshipType: 'CONTAINS_DOCUMENT',
            createdAt: new Date(),
            strength: 0.9,
            confidence: 0.95,
          });
        }
      }
    }

    // Link related files (same directory)
    const dirFiles = new Map<string, string[]>();
    for (const file of output.files) {
      const dir = this.getDirectoryPath(file.path);
      if (!dirFiles.has(dir)) {
        dirFiles.set(dir, []);
      }
      dirFiles.get(dir)!.push(`doc_${this.hashPath(file.path)}`);
    }

    for (const [_, docIds] of dirFiles) {
      if (docIds.length > 1 && docIds.length <= 20) {
        // Create RELATED_TO relationships for files in same directory
        for (let i = 0; i < docIds.length; i++) {
          for (let j = i + 1; j < docIds.length; j++) {
            relationships.push({
              id: `${docIds[i]}_related_${docIds[j]}`,
              sourceId: docIds[i],
              sourceType: 'Document',
              targetId: docIds[j],
              targetType: 'Document',
              relationshipType: 'RELATED_TO',
              createdAt: new Date(),
              strength: 0.4,
              confidence: 0.6,
              properties: {
                reason: 'same_directory',
              },
            });
          }
        }
      }
    }

    logger.debug('Extracted relationships from files', { count: relationships.length });
    return relationships;
  }

  // --------------------------------------------------------------------------
  // EMBEDDING GENERATION
  // --------------------------------------------------------------------------

  async generateEmbeddings(output: FileParsedOutput): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();

    // Placeholder - would integrate with actual embedding model
    // Could embed file content, names, or paths
    logger.debug('Embedding generation skipped (placeholder)', {
      fileCount: output.files.length,
    });

    return embeddings;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: FileIndexer | null = null;

export function getFileIndexer(): FileIndexer {
  if (!instance) {
    instance = new FileIndexer();
  }
  return instance;
}
