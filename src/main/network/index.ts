/**
 * Atlas Desktop - Network Module
 * Centralized network optimization and request management
 */

export {
  NetworkOptimizer,
  NetworkError,
  getNetworkOptimizer,
  shutdownNetworkOptimizer,
  RequestPriority,
  type NetworkRequest,
  type NetworkResponse,
  type NetworkStatus,
  type NetworkOptimizerConfig,
  type ConnectionPoolConfig,
  type ThrottleConfig,
} from './optimizer';
