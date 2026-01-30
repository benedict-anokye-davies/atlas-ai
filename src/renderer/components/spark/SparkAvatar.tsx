/**
 * @fileoverview SparkAvatar - 3D Avatar Component
 * Enhanced with Three.js glowing orb animation
 */

import React, { Suspense } from 'react';
import styles from './SparkAvatar.module.css';

// Lazy load the 3D orb to avoid SSR issues and reduce initial bundle
const AtlasOrb = React.lazy(() => import('./AtlasOrb'));

interface SparkAvatarProps {
  isSpeaking?: boolean;
  isProcessing?: boolean;
  audioLevel?: number;
}

// Fallback while loading Three.js
const LoadingFallback: React.FC<{ isSpeaking: boolean }> = ({ isSpeaking }) => (
  <div className={`${styles.avatarContainer} ${isSpeaking ? styles.speaking : ''}`}>
    <div className={styles.avatarGlow}>
      <div className={styles.avatarInner}>
        <div className={styles.face}>
          <div className={`${styles.eye} ${styles.eyeLeft}`} />
          <div className={`${styles.eye} ${styles.eyeRight}`} />
        </div>
      </div>
    </div>
  </div>
);

export const SparkAvatar: React.FC<SparkAvatarProps> = ({
  isSpeaking = false,
  isProcessing = false,
  audioLevel = 0
}) => {
  return (
    <div className={styles.avatarWrapper}>
      <Suspense fallback={<LoadingFallback isSpeaking={isSpeaking} />}>
        <AtlasOrb
          isSpeaking={isSpeaking}
          isProcessing={isProcessing}
          audioLevel={audioLevel}
        />
      </Suspense>
      {isSpeaking && <div className={styles.speakingIndicator}>Speaking...</div>}
    </div>
  );
};
