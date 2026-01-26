// Package data provides market data storage and loading.
package data

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Store provides access to historical market data
type Store struct {
	mu       sync.RWMutex
	logger   *zap.Logger
	dataDir  string
	cache    map[string][]*types.OHLCV
	symbols  []string
	metadata map[string]*SymbolMetadata
}

// SymbolMetadata contains metadata about available data for a symbol
type SymbolMetadata struct {
	Symbol    string    `json:"symbol"`
	StartDate time.Time `json:"startDate"`
	EndDate   time.Time `json:"endDate"`
	BarCount  int       `json:"barCount"`
	Timeframe string    `json:"timeframe"`
}

// NewStore creates a new data store
func NewStore(logger *zap.Logger, dataDir string) (*Store, error) {
	store := &Store{
		logger:   logger,
		dataDir:  dataDir,
		cache:    make(map[string][]*types.OHLCV),
		symbols:  make([]string, 0),
		metadata: make(map[string]*SymbolMetadata),
	}
	
	// Create data directory if it doesn't exist
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}
	
	// Load metadata
	if err := store.loadMetadata(); err != nil {
		logger.Warn("Failed to load metadata", zap.Error(err))
	}
	
	return store, nil
}

// LoadOHLCV loads OHLCV data for a symbol
func (s *Store) LoadOHLCV(ctx context.Context, symbol string, timeframe types.Timeframe, start, end time.Time) ([]*types.OHLCV, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	cacheKey := fmt.Sprintf("%s_%s", symbol, timeframe)
	
	// Check cache
	if cached, ok := s.cache[cacheKey]; ok {
		return s.filterByTimeRange(cached, start, end), nil
	}
	
	// Load from file
	filename := filepath.Join(s.dataDir, fmt.Sprintf("%s_%s.json", symbol, timeframe))
	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			// Generate sample data for testing
			s.logger.Info("Generating sample data", zap.String("symbol", symbol))
			sampleData := s.generateSampleData(symbol, timeframe, start, end)
			s.cache[cacheKey] = sampleData
			return sampleData, nil
		}
		return nil, fmt.Errorf("failed to read data file: %w", err)
	}
	
	var bars []*types.OHLCV
	if err := json.Unmarshal(data, &bars); err != nil {
		return nil, fmt.Errorf("failed to parse data: %w", err)
	}
	
	// Sort by timestamp
	sort.Slice(bars, func(i, j int) bool {
		return bars[i].Timestamp.Before(bars[j].Timestamp)
	})
	
	// Cache the data
	s.cache[cacheKey] = bars
	
	return s.filterByTimeRange(bars, start, end), nil
}

// LoadTicks loads tick data for a symbol
func (s *Store) LoadTicks(ctx context.Context, symbol string, start, end time.Time) ([]*types.Tick, error) {
	// For now, return empty - tick data would be loaded from a separate store
	return nil, nil
}

// GetAvailableSymbols returns all available symbols
func (s *Store) GetAvailableSymbols() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	symbols := make([]string, len(s.symbols))
	copy(symbols, s.symbols)
	return symbols
}

// GetDataRange returns the available data range for a symbol
func (s *Store) GetDataRange(symbol string) (start, end time.Time, err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if meta, ok := s.metadata[symbol]; ok {
		return meta.StartDate, meta.EndDate, nil
	}
	
	return time.Time{}, time.Time{}, fmt.Errorf("no data available for symbol %s", symbol)
}

// SaveOHLCV saves OHLCV data to disk
func (s *Store) SaveOHLCV(symbol string, timeframe types.Timeframe, bars []*types.OHLCV) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	filename := filepath.Join(s.dataDir, fmt.Sprintf("%s_%s.json", symbol, timeframe))
	
	data, err := json.MarshalIndent(bars, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal data: %w", err)
	}
	
	if err := os.WriteFile(filename, data, 0644); err != nil {
		return fmt.Errorf("failed to write data file: %w", err)
	}
	
	// Update cache
	cacheKey := fmt.Sprintf("%s_%s", symbol, timeframe)
	s.cache[cacheKey] = bars
	
	// Update metadata
	if len(bars) > 0 {
		s.metadata[symbol] = &SymbolMetadata{
			Symbol:    symbol,
			StartDate: bars[0].Timestamp,
			EndDate:   bars[len(bars)-1].Timestamp,
			BarCount:  len(bars),
			Timeframe: string(timeframe),
		}
	}
	
	// Save metadata
	s.saveMetadata()
	
	return nil
}

// filterByTimeRange filters OHLCV data by time range
func (s *Store) filterByTimeRange(bars []*types.OHLCV, start, end time.Time) []*types.OHLCV {
	var filtered []*types.OHLCV
	
	for _, bar := range bars {
		if (bar.Timestamp.Equal(start) || bar.Timestamp.After(start)) &&
			(bar.Timestamp.Equal(end) || bar.Timestamp.Before(end)) {
			filtered = append(filtered, bar)
		}
	}
	
	return filtered
}

// generateSampleData generates sample OHLCV data for testing
func (s *Store) generateSampleData(symbol string, timeframe types.Timeframe, start, end time.Time) []*types.OHLCV {
	var bars []*types.OHLCV
	
	// Determine interval
	var interval time.Duration
	switch timeframe {
	case types.Timeframe1m:
		interval = time.Minute
	case types.Timeframe5m:
		interval = 5 * time.Minute
	case types.Timeframe15m:
		interval = 15 * time.Minute
	case types.Timeframe1h:
		interval = time.Hour
	case types.Timeframe4h:
		interval = 4 * time.Hour
	case types.Timeframe1d:
		interval = 24 * time.Hour
	default:
		interval = time.Minute
	}
	
	// Starting price based on symbol
	var price float64
	switch symbol {
	case "SOL/USDT":
		price = 100.0
	case "ETH/USDT":
		price = 2000.0
	case "BTC/USDT":
		price = 40000.0
	default:
		price = 100.0
	}
	
	current := start
	for current.Before(end) || current.Equal(end) {
		// Generate random price movement
		change := (s.random() - 0.5) * 0.02 * price // +/- 1%
		open := decimal.NewFromFloat(price)
		price += change
		close := decimal.NewFromFloat(price)
		
		high := decimal.Max(open, close).Mul(decimal.NewFromFloat(1 + s.random()*0.005))
		low := decimal.Min(open, close).Mul(decimal.NewFromFloat(1 - s.random()*0.005))
		volume := decimal.NewFromFloat(s.random() * 1000000)
		
		bars = append(bars, &types.OHLCV{
			Timestamp: current,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     close,
			Volume:    volume,
		})
		
		current = current.Add(interval)
	}
	
	return bars
}

// random generates a random float64 between 0 and 1
func (s *Store) random() float64 {
	return float64(time.Now().UnixNano()%1000) / 1000.0
}

// loadMetadata loads symbol metadata from disk
func (s *Store) loadMetadata() error {
	filename := filepath.Join(s.dataDir, "metadata.json")
	
	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	
	var metadata map[string]*SymbolMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return err
	}
	
	s.metadata = metadata
	
	// Extract symbols
	s.symbols = make([]string, 0, len(metadata))
	for symbol := range metadata {
		s.symbols = append(s.symbols, symbol)
	}
	
	return nil
}

// saveMetadata saves symbol metadata to disk
func (s *Store) saveMetadata() error {
	filename := filepath.Join(s.dataDir, "metadata.json")
	
	data, err := json.MarshalIndent(s.metadata, "", "  ")
	if err != nil {
		return err
	}
	
	return os.WriteFile(filename, data, 0644)
}

// ClearCache clears the in-memory cache
func (s *Store) ClearCache() {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.cache = make(map[string][]*types.OHLCV)
}

// GetCacheSize returns the number of cached datasets
func (s *Store) GetCacheSize() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return len(s.cache)
}
