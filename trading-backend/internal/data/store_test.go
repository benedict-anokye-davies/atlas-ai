// Package data_test provides tests for the data store.
package data_test

import (
	"testing"
	"time"

	"github.com/atlas-desktop/trading-backend/internal/data"
	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

func TestDataStoreCreation(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	if store == nil {
		t.Fatal("Store is nil")
	}
	
	// Verify sample data was generated
	symbols := store.GetSymbols()
	if len(symbols) == 0 {
		t.Error("No symbols available")
	}
	
	t.Logf("Available symbols: %v", symbols)
}

func TestOHLCVStorageAndRetrieval(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	symbol := "TEST/USDT"
	timeframe := types.Timeframe1h
	
	// Create test data
	now := time.Now()
	testBars := []types.OHLCV{
		{
			Timestamp: now.Add(-3 * time.Hour),
			Open:      decimal.NewFromInt(100),
			High:      decimal.NewFromInt(110),
			Low:       decimal.NewFromInt(95),
			Close:     decimal.NewFromInt(105),
			Volume:    decimal.NewFromInt(1000),
		},
		{
			Timestamp: now.Add(-2 * time.Hour),
			Open:      decimal.NewFromInt(105),
			High:      decimal.NewFromInt(115),
			Low:       decimal.NewFromInt(100),
			Close:     decimal.NewFromInt(110),
			Volume:    decimal.NewFromInt(1500),
		},
		{
			Timestamp: now.Add(-1 * time.Hour),
			Open:      decimal.NewFromInt(110),
			High:      decimal.NewFromInt(120),
			Low:       decimal.NewFromInt(108),
			Close:     decimal.NewFromInt(118),
			Volume:    decimal.NewFromInt(2000),
		},
	}
	
	// Store data
	if err := store.StoreOHLCV(symbol, timeframe, testBars); err != nil {
		t.Fatalf("Failed to store OHLCV: %v", err)
	}
	
	// Verify symbol is now available
	symbols := store.GetSymbols()
	found := false
	for _, s := range symbols {
		if s == symbol {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Symbol %s not found after storing", symbol)
	}
	
	// Retrieve data
	retrieved, err := store.GetOHLCV(symbol, timeframe, testBars[0].Timestamp.Add(-time.Hour), now)
	if err != nil {
		t.Fatalf("Failed to retrieve OHLCV: %v", err)
	}
	
	if len(retrieved) != len(testBars) {
		t.Errorf("Retrieved %d bars, expected %d", len(retrieved), len(testBars))
	}
	
	// Verify data integrity
	for i, bar := range retrieved {
		if !bar.Close.Equal(testBars[i].Close) {
			t.Errorf("Bar %d close mismatch: expected %s, got %s",
				i, testBars[i].Close, bar.Close)
		}
	}
}

func TestTimeRangeFiltering(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	symbol := "RANGE/USDT"
	timeframe := types.Timeframe1h
	
	// Create 10 hours of data
	baseTime := time.Now().Add(-10 * time.Hour)
	bars := make([]types.OHLCV, 10)
	for i := 0; i < 10; i++ {
		bars[i] = types.OHLCV{
			Timestamp: baseTime.Add(time.Duration(i) * time.Hour),
			Open:      decimal.NewFromInt(int64(100 + i)),
			High:      decimal.NewFromInt(int64(105 + i)),
			Low:       decimal.NewFromInt(int64(95 + i)),
			Close:     decimal.NewFromInt(int64(102 + i)),
			Volume:    decimal.NewFromInt(int64(1000 * (i + 1))),
		}
	}
	
	if err := store.StoreOHLCV(symbol, timeframe, bars); err != nil {
		t.Fatalf("Failed to store OHLCV: %v", err)
	}
	
	// Query middle 4 hours (hours 3-6)
	startTime := baseTime.Add(3 * time.Hour)
	endTime := baseTime.Add(7 * time.Hour)
	
	retrieved, err := store.GetOHLCV(symbol, timeframe, startTime, endTime)
	if err != nil {
		t.Fatalf("Failed to retrieve OHLCV: %v", err)
	}
	
	if len(retrieved) != 4 {
		t.Errorf("Expected 4 bars in range, got %d", len(retrieved))
	}
	
	// Verify first bar is at hour 3
	if !retrieved[0].Timestamp.Equal(startTime) {
		t.Errorf("First bar timestamp mismatch: expected %v, got %v",
			startTime, retrieved[0].Timestamp)
	}
}

func TestMultipleTimeframes(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	symbol := "MULTI/USDT"
	now := time.Now()
	
	// Store 1h data
	bars1h := []types.OHLCV{
		{Timestamp: now, Open: decimal.NewFromInt(100), High: decimal.NewFromInt(110),
			Low: decimal.NewFromInt(90), Close: decimal.NewFromInt(105), Volume: decimal.NewFromInt(1000)},
	}
	if err := store.StoreOHLCV(symbol, types.Timeframe1h, bars1h); err != nil {
		t.Fatalf("Failed to store 1h data: %v", err)
	}
	
	// Store 1d data
	bars1d := []types.OHLCV{
		{Timestamp: now, Open: decimal.NewFromInt(90), High: decimal.NewFromInt(115),
			Low: decimal.NewFromInt(85), Close: decimal.NewFromInt(110), Volume: decimal.NewFromInt(50000)},
	}
	if err := store.StoreOHLCV(symbol, types.Timeframe1d, bars1d); err != nil {
		t.Fatalf("Failed to store 1d data: %v", err)
	}
	
	// Retrieve and verify they're different
	ret1h, _ := store.GetOHLCV(symbol, types.Timeframe1h, now.Add(-time.Hour), now.Add(time.Hour))
	ret1d, _ := store.GetOHLCV(symbol, types.Timeframe1d, now.Add(-time.Hour), now.Add(time.Hour))
	
	if len(ret1h) == 0 {
		t.Error("1h data not retrieved")
	}
	
	if len(ret1d) == 0 {
		t.Error("1d data not retrieved")
	}
	
	// Verify the volumes are different (distinguishing feature)
	if ret1h[0].Volume.Equal(ret1d[0].Volume) {
		t.Error("1h and 1d data should have different volumes")
	}
}

func TestEmptyRange(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	// Query for non-existent data
	retrieved, err := store.GetOHLCV(
		"NONEXISTENT/USDT",
		types.Timeframe1h,
		time.Now().Add(-24*time.Hour),
		time.Now(),
	)
	
	if err != nil {
		t.Fatalf("Expected empty result, got error: %v", err)
	}
	
	if len(retrieved) != 0 {
		t.Errorf("Expected empty result, got %d bars", len(retrieved))
	}
}

func TestDataPersistence(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	symbol := "PERSIST/USDT"
	timeframe := types.Timeframe1h
	now := time.Now()
	
	testBar := types.OHLCV{
		Timestamp: now,
		Open:      decimal.NewFromInt(123),
		High:      decimal.NewFromInt(130),
		Low:       decimal.NewFromInt(120),
		Close:     decimal.NewFromInt(125),
		Volume:    decimal.NewFromInt(5000),
	}
	
	// Create store, add data, close
	store1, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store 1: %v", err)
	}
	
	if err := store1.StoreOHLCV(symbol, timeframe, []types.OHLCV{testBar}); err != nil {
		t.Fatalf("Failed to store: %v", err)
	}
	
	// Save to disk
	if err := store1.Save(); err != nil {
		t.Fatalf("Failed to save: %v", err)
	}
	
	// Create new store from same directory
	store2, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store 2: %v", err)
	}
	
	// Retrieve data
	retrieved, err := store2.GetOHLCV(symbol, timeframe, now.Add(-time.Hour), now.Add(time.Hour))
	if err != nil {
		t.Fatalf("Failed to retrieve: %v", err)
	}
	
	if len(retrieved) == 0 {
		t.Fatal("No data persisted")
	}
	
	if !retrieved[0].Close.Equal(testBar.Close) {
		t.Errorf("Persisted data mismatch: expected close %s, got %s",
			testBar.Close, retrieved[0].Close)
	}
}

func TestConcurrentAccess(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	symbol := "CONCURRENT/USDT"
	timeframe := types.Timeframe1h
	now := time.Now()
	
	// Store initial data
	initialBar := types.OHLCV{
		Timestamp: now,
		Open:      decimal.NewFromInt(100),
		High:      decimal.NewFromInt(110),
		Low:       decimal.NewFromInt(90),
		Close:     decimal.NewFromInt(105),
		Volume:    decimal.NewFromInt(1000),
	}
	store.StoreOHLCV(symbol, timeframe, []types.OHLCV{initialBar})
	
	// Concurrent reads and writes
	done := make(chan bool)
	
	// Reader goroutines
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				store.GetOHLCV(symbol, timeframe, now.Add(-time.Hour), now.Add(time.Hour))
			}
			done <- true
		}()
	}
	
	// Writer goroutines
	for i := 0; i < 3; i++ {
		go func(id int) {
			for j := 0; j < 50; j++ {
				bar := types.OHLCV{
					Timestamp: now.Add(time.Duration(id*50+j) * time.Minute),
					Open:      decimal.NewFromInt(int64(100 + j)),
					High:      decimal.NewFromInt(int64(110 + j)),
					Low:       decimal.NewFromInt(int64(90 + j)),
					Close:     decimal.NewFromInt(int64(105 + j)),
					Volume:    decimal.NewFromInt(int64(1000 + j)),
				}
				store.StoreOHLCV(symbol, timeframe, []types.OHLCV{bar})
			}
			done <- true
		}(i)
	}
	
	// Wait for all goroutines
	for i := 0; i < 8; i++ {
		<-done
	}
}

func TestSampleDataGeneration(t *testing.T) {
	logger := zap.NewNop()
	tempDir := t.TempDir()
	
	store, err := data.NewStore(logger, tempDir)
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	
	// Generate sample data
	store.GenerateSampleData()
	
	// Verify common symbols are available
	symbols := store.GetSymbols()
	
	expectedSymbols := []string{"SOL/USDT", "BTC/USDT", "ETH/USDT"}
	for _, expected := range expectedSymbols {
		found := false
		for _, s := range symbols {
			if s == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected symbol %s not found", expected)
		}
	}
	
	// Verify we have actual data
	now := time.Now()
	for _, symbol := range expectedSymbols {
		bars, err := store.GetOHLCV(symbol, types.Timeframe1h, now.AddDate(0, -1, 0), now)
		if err != nil {
			t.Errorf("Failed to get data for %s: %v", symbol, err)
			continue
		}
		
		if len(bars) == 0 {
			t.Errorf("No sample data for %s", symbol)
		} else {
			t.Logf("%s: %d bars of sample data", symbol, len(bars))
		}
	}
}
