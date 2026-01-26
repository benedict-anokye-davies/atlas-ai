/**
 * TerminalInput - Command line style input field
 * Provides a hacker-aesthetic text input with history and autocomplete
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './TerminalInput.css';

interface TerminalInputProps {
  onSubmit: (command: string) => void;
  placeholder?: string;
  prefix?: string;
  suggestions?: string[];
  history?: string[];
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export const TerminalInput: React.FC<TerminalInputProps> = ({
  onSubmit,
  placeholder = 'Enter command...',
  prefix = '>',
  suggestions = [],
  history = [],
  disabled = false,
  autoFocus = false,
  className = '',
}) => {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter suggestions based on input
  const filteredSuggestions = suggestions.filter(s =>
    s.toLowerCase().startsWith(value.toLowerCase()) && value.length > 0
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Enter - submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showSuggestions && filteredSuggestions[selectedSuggestion]) {
        setValue(filteredSuggestions[selectedSuggestion]);
        setShowSuggestions(false);
      } else if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
        setHistoryIndex(-1);
      }
    }

    // Tab - autocomplete
    if (e.key === 'Tab' && filteredSuggestions.length > 0) {
      e.preventDefault();
      setValue(filteredSuggestions[selectedSuggestion]);
      setShowSuggestions(false);
    }

    // Arrow Up - history / suggestions
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestion(prev => Math.max(0, prev - 1));
      } else if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] || '');
      }
    }

    // Arrow Down - history / suggestions  
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestion(prev => Math.min(filteredSuggestions.length - 1, prev + 1));
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setValue('');
      }
    }

    // Escape - close suggestions
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }, [value, history, historyIndex, showSuggestions, filteredSuggestions, selectedSuggestion, onSubmit]);

  useEffect(() => {
    setShowSuggestions(filteredSuggestions.length > 0 && value.length > 0);
    setSelectedSuggestion(0);
  }, [value, filteredSuggestions.length]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className={`terminal-input ${disabled ? 'disabled' : ''} ${className}`}>
      <span className="terminal-input__prefix">{prefix}</span>
      
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setShowSuggestions(filteredSuggestions.length > 0)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="terminal-input__field"
        spellCheck={false}
        autoComplete="off"
      />

      <span className="terminal-input__cursor" />

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <motion.div
            className="terminal-input__suggestions"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {filteredSuggestions.slice(0, 5).map((suggestion, index) => (
              <div
                key={suggestion}
                className={`terminal-input__suggestion ${index === selectedSuggestion ? 'selected' : ''}`}
                onClick={() => {
                  setValue(suggestion);
                  setShowSuggestions(false);
                  inputRef.current?.focus();
                }}
              >
                <span className="terminal-input__suggestion-prefix">{prefix}</span>
                {suggestion}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TerminalInput;
