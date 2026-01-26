/**
 * Atlas ML Trading Module - Exports
 *
 * LSTM-based price prediction models.
 *
 * @module ml/trading
 */

// LSTM Predictor (T5-304)
export {
  LSTMPredictor,
  getLSTMPredictor,
  initializeLSTMPredictor,
  cleanupLSTMPredictor,
  // Types
  type OHLCVData,
  type TechnicalIndicators,
  type Prediction,
  type LSTMModelConfig,
  type LSTMPredictorConfig,
  type LSTMPredictorEvents,
  // Constants
  DEFAULT_PREDICTOR_CONFIG,
} from './lstm-predictor';
