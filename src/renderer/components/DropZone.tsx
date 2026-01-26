/**
 * DropZone
 * Drag-and-drop interface for file and image analysis
 */

import React, { useState, useCallback, useRef } from 'react';
import './DropZone.css';

interface ProcessedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: FileAnalysisResult;
  error?: string;
}

interface FileAnalysisResult {
  type: 'image' | 'document' | 'code' | 'other';
  summary: string;
  details: Record<string, unknown>;
  extractedText?: string;
  entities?: Array<{ type: string; value: string; confidence: number }>;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  image: '\ud83d\uddbc\ufe0f',
  pdf: '\ud83d\udcc4',
  document: '\ud83d\udcc3',
  code: '\ud83d\udcbb',
  archive: '\ud83d\udce6',
  audio: '\ud83c\udfa7',
  video: '\ud83c\udfac',
  other: '\ud83d\udcc1'
};

function getFileTypeIcon(mimeType: string, fileName: string): string {
  if (mimeType.startsWith('image/')) return FILE_TYPE_ICONS.image;
  if (mimeType === 'application/pdf') return FILE_TYPE_ICONS.pdf;
  if (mimeType.includes('word') || mimeType.includes('document')) return FILE_TYPE_ICONS.document;
  if (mimeType.startsWith('audio/')) return FILE_TYPE_ICONS.audio;
  if (mimeType.startsWith('video/')) return FILE_TYPE_ICONS.video;
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('archive')) return FILE_TYPE_ICONS.archive;
  
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['ts', 'js', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'tsx', 'jsx'].includes(ext || '')) {
    return FILE_TYPE_ICONS.code;
  }
  
  return FILE_TYPE_ICONS.other;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DropZone: React.FC = () => {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File): Promise<FileAnalysisResult> => {
    // Simulate file analysis - in production this would call the multimodal API
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    const isImage = file.type.startsWith('image/');
    const isCode = ['.ts', '.js', '.py', '.java', '.tsx', '.jsx'].some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );
    const isPdf = file.type === 'application/pdf';
    
    if (isImage) {
      return {
        type: 'image',
        summary: `Image file: ${file.name}`,
        details: {
          dimensions: 'Analysis pending',
          format: file.type.split('/')[1]?.toUpperCase(),
          colorSpace: 'RGB'
        },
        entities: [
          { type: 'object', value: 'Detected objects pending', confidence: 0 }
        ]
      };
    }
    
    if (isCode) {
      return {
        type: 'code',
        summary: `Source code file: ${file.name}`,
        details: {
          language: file.name.split('.').pop()?.toUpperCase(),
          lines: 'Count pending'
        },
        extractedText: '// Code content analysis pending'
      };
    }
    
    if (isPdf) {
      return {
        type: 'document',
        summary: `PDF document: ${file.name}`,
        details: {
          pages: 'Unknown',
          hasText: true
        },
        extractedText: 'Document text extraction pending'
      };
    }
    
    return {
      type: 'other',
      summary: `File: ${file.name}`,
      details: {
        mimeType: file.type || 'unknown'
      }
    };
  }, []);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const newFiles: ProcessedFile[] = Array.from(fileList).map(file => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      type: file.type,
      size: file.size,
      status: 'pending' as const
    }));
    
    setFiles(prev => [...prev, ...newFiles]);
    
    // Process files
    for (let i = 0; i < newFiles.length; i++) {
      const pf = newFiles[i];
      const file = Array.from(fileList)[i];
      
      setFiles(prev => prev.map(f => 
        f.id === pf.id ? { ...f, status: 'processing' } : f
      ));
      
      try {
        const result = await processFile(file);
        
        setFiles(prev => prev.map(f =>
          f.id === pf.id ? { ...f, status: 'completed', result } : f
        ));
      } catch (error) {
        setFiles(prev => prev.map(f =>
          f.id === pf.id ? { ...f, status: 'error', error: String(error) } : f
        ));
      }
    }
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  }, [addFiles]);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    if (selectedFile === id) setSelectedFile(null);
  }, [selectedFile]);

  const clearAll = useCallback(() => {
    setFiles([]);
    setSelectedFile(null);
  }, []);

  const selectedFileData = files.find(f => f.id === selectedFile);

  return (
    <div className="drop-zone-container">
      <div className="drop-zone-header">
        <h3>File Analysis</h3>
        <div className="header-actions">
          <button 
            className="browse-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse Files
          </button>
          {files.length > 0 && (
            <button className="clear-btn" onClick={clearAll}>
              Clear All
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      <div 
        className={`drop-area ${isDragging ? 'dragging' : ''} ${files.length > 0 ? 'has-files' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length === 0 ? (
          <div className="drop-placeholder">
            <span className="drop-icon">\ud83d\udce5</span>
            <p className="drop-text">
              Drag & drop files here
            </p>
            <p className="drop-subtext">
              Images, documents, code files, and more
            </p>
          </div>
        ) : (
          <div className="files-grid">
            {files.map(file => (
              <div 
                key={file.id}
                className={`file-card ${file.status} ${selectedFile === file.id ? 'selected' : ''}`}
                onClick={() => setSelectedFile(file.id)}
              >
                <div className="file-icon">
                  {getFileTypeIcon(file.type, file.name)}
                </div>
                <div className="file-info">
                  <span className="file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="file-size">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                <div className="file-status">
                  {file.status === 'pending' && <span className="status-pending">Pending</span>}
                  {file.status === 'processing' && (
                    <span className="status-processing">
                      <span className="spinner" />
                      Analyzing
                    </span>
                  )}
                  {file.status === 'completed' && <span className="status-completed">Done</span>}
                  {file.status === 'error' && <span className="status-error">Error</span>}
                </div>
                <button 
                  className="remove-btn"
                  onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFileData && selectedFileData.result && (
        <div className="analysis-panel">
          <div className="analysis-header">
            <span className="analysis-icon">
              {getFileTypeIcon(selectedFileData.type, selectedFileData.name)}
            </span>
            <h4>{selectedFileData.name}</h4>
          </div>
          
          <div className="analysis-content">
            <div className="analysis-section">
              <label>Summary</label>
              <p>{selectedFileData.result.summary}</p>
            </div>

            <div className="analysis-section">
              <label>Details</label>
              <div className="details-grid">
                {Object.entries(selectedFileData.result.details).map(([key, value]) => (
                  <div key={key} className="detail-item">
                    <span className="detail-key">{key}</span>
                    <span className="detail-value">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {selectedFileData.result.extractedText && (
              <div className="analysis-section">
                <label>Extracted Text</label>
                <pre className="extracted-text">
                  {selectedFileData.result.extractedText}
                </pre>
              </div>
            )}

            {selectedFileData.result.entities && selectedFileData.result.entities.length > 0 && (
              <div className="analysis-section">
                <label>Detected Entities</label>
                <div className="entities-list">
                  {selectedFileData.result.entities.map((entity, idx) => (
                    <div key={idx} className="entity-item">
                      <span className="entity-type">{entity.type}</span>
                      <span className="entity-value">{entity.value}</span>
                      {entity.confidence > 0 && (
                        <span className="entity-confidence">
                          {Math.round(entity.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DropZone;
