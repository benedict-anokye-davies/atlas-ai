/**
 * Atlas Desktop - Left Navigation Component
 * Collapsible sidebar with view switching
 */
import React from 'react';
import { motion } from 'framer-motion';
import './LeftNav.css';

export type ViewId = 'dashboard' | 'trading' | 'banking' | 'intelligence' | 'projects';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export interface LeftNavProps {
  items: NavItem[];
  activeView: ViewId;
  isExpanded: boolean;
  onViewChange: (view: ViewId) => void;
  onSettingsClick?: () => void;
}

const DEFAULT_ITEMS: NavItem[] = [
  { 
    id: 'dashboard', 
    label: 'Dashboard', 
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 3h6v6H3V3zm0 8h6v6H3v-6zm8-8h6v6h-6V3zm0 8h6v6h-6v-6z"/>
      </svg>
    )
  },
  { 
    id: 'trading', 
    label: 'Trading', 
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 17V7l4 4 4-6 6 8v4H3zm0-12v2l4 4 4-6 6 8V5H3z"/>
      </svg>
    )
  },
  { 
    id: 'banking', 
    label: 'Banking', 
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 2L2 6v2h16V6l-8-4zM4 10v6h3v-6H4zm4.5 0v6h3v-6h-3zM13 10v6h3v-6h-3zM2 18h16v2H2v-2z"/>
      </svg>
    )
  },
  { 
    id: 'intelligence', 
    label: 'Intelligence', 
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
      </svg>
    )
  },
  { 
    id: 'projects', 
    label: 'Projects', 
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 4a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/>
      </svg>
    )
  },
];

export const LeftNav: React.FC<LeftNavProps> = ({
  items = DEFAULT_ITEMS,
  activeView,
  isExpanded,
  onViewChange,
  onSettingsClick,
}) => {
  return (
    <nav className={`left-nav ${isExpanded ? 'left-nav--expanded' : ''}`}>
      <div className="left-nav__items">
        {items.map((item) => (
          <motion.button
            key={item.id}
            className={`left-nav__item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onViewChange(item.id)}
            whileHover={{ backgroundColor: 'var(--atlas-bg-hover)' }}
            whileTap={{ scale: 0.95 }}
            title={!isExpanded ? item.label : undefined}
          >
            <span className="left-nav__icon">{item.icon}</span>
            <motion.span
              className="left-nav__label"
              initial={false}
              animate={{ 
                opacity: isExpanded ? 1 : 0,
                width: isExpanded ? 'auto' : 0 
              }}
              transition={{ duration: 0.15 }}
            >
              {item.label}
            </motion.span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="left-nav__badge">{item.badge}</span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Settings at bottom */}
      <div className="left-nav__footer">
        <motion.button
          className="left-nav__item"
          onClick={onSettingsClick}
          whileHover={{ backgroundColor: 'var(--atlas-bg-hover)' }}
          whileTap={{ scale: 0.95 }}
          title={!isExpanded ? 'Settings' : undefined}
        >
          <span className="left-nav__icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
              <path fillRule="evenodd" d="M9.943 2H10a1 1 0 0 1 1 1v.5a.5.5 0 0 0 .324.467l.894.335a.5.5 0 0 0 .541-.118l.354-.354a1 1 0 0 1 1.414 0l.057.057a1 1 0 0 1 0 1.414l-.354.354a.5.5 0 0 0-.118.541l.335.894A.5.5 0 0 0 14.914 7H15.5a1 1 0 0 1 1 1v.057a1 1 0 0 1-1 1h-.586a.5.5 0 0 0-.467.324l-.335.894a.5.5 0 0 0 .118.541l.354.354a1 1 0 0 1 0 1.414l-.057.057a1 1 0 0 1-1.414 0l-.354-.354a.5.5 0 0 0-.541-.118l-.894.335a.5.5 0 0 0-.324.467v.5a1 1 0 0 1-1 1h-.057a1 1 0 0 1-1-1v-.5a.5.5 0 0 0-.324-.467l-.894-.335a.5.5 0 0 0-.541.118l-.354.354a1 1 0 0 1-1.414 0l-.057-.057a1 1 0 0 1 0-1.414l.354-.354a.5.5 0 0 0 .118-.541l-.335-.894A.5.5 0 0 0 5.086 11H4.5a1 1 0 0 1-1-1v-.057a1 1 0 0 1 1-1h.586a.5.5 0 0 0 .467-.324l.335-.894a.5.5 0 0 0-.118-.541l-.354-.354a1 1 0 0 1 0-1.414l.057-.057a1 1 0 0 1 1.414 0l.354.354a.5.5 0 0 0 .541.118l.894-.335A.5.5 0 0 0 8.5 5.029V4.5a1 1 0 0 1 1-1h.443z"/>
            </svg>
          </span>
          <motion.span
            className="left-nav__label"
            initial={false}
            animate={{ 
              opacity: isExpanded ? 1 : 0,
              width: isExpanded ? 'auto' : 0 
            }}
            transition={{ duration: 0.15 }}
          >
            Settings
          </motion.span>
        </motion.button>
      </div>
    </nav>
  );
};

export default LeftNav;
