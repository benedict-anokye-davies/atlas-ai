/**
 * Atlas Desktop - Audio Module
 * Exports audio recording and playback functionality
 */

export {
  AudioRecorder,
  getAudioRecorder,
  shutdownAudioRecorder,
} from './recorder';

export {
  AudioPlayer,
  getAudioPlayer,
  shutdownAudioPlayer,
} from './player';

export * from '../../shared/types/audio';
