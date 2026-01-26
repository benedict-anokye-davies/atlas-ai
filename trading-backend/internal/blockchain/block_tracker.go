// Package blockchain provides real-time block tracking across multiple chains.
package blockchain

import (
	"context"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// BlockInfo represents a blockchain block with relevant trading data.
type BlockInfo struct {
	Chain           string          `json:"chain"`
	Number          uint64          `json:"number"`
	Hash            string          `json:"hash"`
	ParentHash      string          `json:"parentHash"`
	Timestamp       time.Time       `json:"timestamp"`
	TransactionCount int            `json:"transactionCount"`
	GasUsed         uint64          `json:"gasUsed"`
	GasLimit        uint64          `json:"gasLimit"`
	BaseFeePerGas   decimal.Decimal `json:"baseFeePerGas,omitempty"`
	
	// Solana-specific
	Slot            uint64          `json:"slot,omitempty"`
	Leader          string          `json:"leader,omitempty"`
	
	// Trading metrics
	DEXTransactions int             `json:"dexTransactions"`
	TotalVolume     decimal.Decimal `json:"totalVolume"`
	LargeTransfers  int             `json:"largeTransfers"`
	MEVDetected     bool            `json:"mevDetected"`
}

// BlockEvent represents an event from block tracking.
type BlockEvent struct {
	Type      BlockEventType `json:"type"`
	Chain     string         `json:"chain"`
	Block     *BlockInfo     `json:"block,omitempty"`
	Reorg     *ReorgInfo     `json:"reorg,omitempty"`
	Error     error          `json:"error,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

// BlockEventType defines the type of block event.
type BlockEventType string

const (
	BlockEventNew       BlockEventType = "new_block"
	BlockEventConfirmed BlockEventType = "confirmed"
	BlockEventReorg     BlockEventType = "reorg"
	BlockEventError     BlockEventType = "error"
	BlockEventGap       BlockEventType = "gap"
)

// ReorgInfo contains information about a chain reorganization.
type ReorgInfo struct {
	Chain         string       `json:"chain"`
	OldHead       uint64       `json:"oldHead"`
	NewHead       uint64       `json:"newHead"`
	Depth         int          `json:"depth"`
	AffectedBlocks []uint64    `json:"affectedBlocks"`
	Timestamp     time.Time    `json:"timestamp"`
}

// ChainState tracks the current state of a blockchain.
type ChainState struct {
	Chain              string          `json:"chain"`
	LatestBlock        uint64          `json:"latestBlock"`
	ConfirmedBlock     uint64          `json:"confirmedBlock"`
	LastBlockTime      time.Time       `json:"lastBlockTime"`
	AvgBlockTime       time.Duration   `json:"avgBlockTime"`
	BlocksPerMinute    float64         `json:"blocksPerMinute"`
	IsHealthy          bool            `json:"isHealthy"`
	LastError          string          `json:"lastError,omitempty"`
	ReorgCount         int             `json:"reorgCount"`
	
	// Gas metrics (EVM)
	CurrentGasPrice    decimal.Decimal `json:"currentGasPrice,omitempty"`
	AvgGasPrice        decimal.Decimal `json:"avgGasPrice,omitempty"`
	GasPricePercentile decimal.Decimal `json:"gasPriceP95,omitempty"`
	
	// Congestion
	CongestionLevel    float64         `json:"congestionLevel"` // 0-1
	PendingTxCount     int             `json:"pendingTxCount"`
}

// BlockTracker tracks blocks across multiple chains in real-time.
type BlockTracker struct {
	logger       *zap.Logger
	
	// Chain clients
	solana       *SolanaClient
	evmClients   map[string]*EVMClient
	
	// State
	chainStates  map[string]*ChainState
	blockHistory map[string][]*BlockInfo // Last N blocks per chain
	
	// Configuration
	config       BlockTrackerConfig
	
	// Channels
	events       chan BlockEvent
	
	// Control
	mu           sync.RWMutex
	running      bool
	cancel       context.CancelFunc
	wg           sync.WaitGroup
}

// BlockTrackerConfig configures the block tracker.
type BlockTrackerConfig struct {
	// Chains to track
	EnableSolana    bool              `json:"enableSolana"`
	EVMChains       []string          `json:"evmChains"` // ethereum, polygon, arbitrum, etc.
	
	// Polling intervals (for chains without WebSocket)
	PollInterval    time.Duration     `json:"pollInterval"`
	
	// Confirmation settings
	Confirmations   map[string]int    `json:"confirmations"` // Chain -> required confirmations
	
	// History
	HistoryDepth    int               `json:"historyDepth"` // Blocks to keep in memory
	
	// Monitoring
	HealthTimeout   time.Duration     `json:"healthTimeout"`
	MaxReorgDepth   int               `json:"maxReorgDepth"`
	
	// Event buffer
	EventBufferSize int               `json:"eventBufferSize"`
}

// DefaultBlockTrackerConfig returns sensible defaults.
func DefaultBlockTrackerConfig() BlockTrackerConfig {
	return BlockTrackerConfig{
		EnableSolana:    true,
		EVMChains:       []string{"ethereum", "polygon", "arbitrum"},
		PollInterval:    time.Second,
		Confirmations: map[string]int{
			"solana":   32,  // ~12 seconds
			"ethereum": 12,  // ~3 minutes
			"polygon":  128, // ~4 minutes
			"arbitrum": 1,   // Near-instant with sequencer
		},
		HistoryDepth:    100,
		HealthTimeout:   30 * time.Second,
		MaxReorgDepth:   10,
		EventBufferSize: 1000,
	}
}

// NewBlockTracker creates a new multi-chain block tracker.
func NewBlockTracker(
	logger *zap.Logger,
	solana *SolanaClient,
	evmClients map[string]*EVMClient,
	config BlockTrackerConfig,
) *BlockTracker {
	return &BlockTracker{
		logger:       logger.Named("block-tracker"),
		solana:       solana,
		evmClients:   evmClients,
		chainStates:  make(map[string]*ChainState),
		blockHistory: make(map[string][]*BlockInfo),
		config:       config,
		events:       make(chan BlockEvent, config.EventBufferSize),
	}
}

// Start begins tracking blocks on all configured chains.
func (bt *BlockTracker) Start(ctx context.Context) error {
	bt.mu.Lock()
	if bt.running {
		bt.mu.Unlock()
		return nil
	}
	bt.running = true
	
	ctx, bt.cancel = context.WithCancel(ctx)
	bt.mu.Unlock()
	
	bt.logger.Info("Starting block tracker",
		zap.Bool("solana", bt.config.EnableSolana),
		zap.Strings("evmChains", bt.config.EVMChains))
	
	// Initialize chain states
	bt.initializeStates()
	
	// Start Solana tracker
	if bt.config.EnableSolana && bt.solana != nil {
		bt.wg.Add(1)
		go bt.trackSolana(ctx)
	}
	
	// Start EVM trackers
	for _, chain := range bt.config.EVMChains {
		if client, ok := bt.evmClients[chain]; ok {
			bt.wg.Add(1)
			go bt.trackEVM(ctx, chain, client)
		}
	}
	
	// Start health monitor
	bt.wg.Add(1)
	go bt.monitorHealth(ctx)
	
	return nil
}

// Stop stops the block tracker.
func (bt *BlockTracker) Stop() {
	bt.mu.Lock()
	defer bt.mu.Unlock()
	
	if !bt.running {
		return
	}
	
	bt.logger.Info("Stopping block tracker")
	bt.cancel()
	bt.wg.Wait()
	bt.running = false
	
	close(bt.events)
}

// Events returns the channel for block events.
func (bt *BlockTracker) Events() <-chan BlockEvent {
	return bt.events
}

// GetChainState returns the current state of a chain.
func (bt *BlockTracker) GetChainState(chain string) *ChainState {
	bt.mu.RLock()
	defer bt.mu.RUnlock()
	
	if state, ok := bt.chainStates[chain]; ok {
		// Return a copy
		stateCopy := *state
		return &stateCopy
	}
	return nil
}

// GetAllChainStates returns states for all tracked chains.
func (bt *BlockTracker) GetAllChainStates() map[string]*ChainState {
	bt.mu.RLock()
	defer bt.mu.RUnlock()
	
	states := make(map[string]*ChainState)
	for chain, state := range bt.chainStates {
		stateCopy := *state
		states[chain] = &stateCopy
	}
	return states
}

// GetRecentBlocks returns recent blocks for a chain.
func (bt *BlockTracker) GetRecentBlocks(chain string, limit int) []*BlockInfo {
	bt.mu.RLock()
	defer bt.mu.RUnlock()
	
	history := bt.blockHistory[chain]
	if len(history) == 0 {
		return nil
	}
	
	if limit > len(history) {
		limit = len(history)
	}
	
	// Return most recent first
	result := make([]*BlockInfo, limit)
	for i := 0; i < limit; i++ {
		result[i] = history[len(history)-1-i]
	}
	return result
}

// WaitForConfirmation waits for a transaction to be confirmed.
func (bt *BlockTracker) WaitForConfirmation(ctx context.Context, chain string, blockNumber uint64) error {
	confirmations := bt.config.Confirmations[chain]
	if confirmations == 0 {
		confirmations = 1
	}
	
	targetBlock := blockNumber + uint64(confirmations)
	
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event := <-bt.events:
			if event.Chain == chain && event.Type == BlockEventNew {
				if event.Block.Number >= targetBlock {
					return nil
				}
			}
		}
	}
}

// initializeStates initializes chain states.
func (bt *BlockTracker) initializeStates() {
	if bt.config.EnableSolana {
		bt.chainStates["solana"] = &ChainState{
			Chain:     "solana",
			IsHealthy: true,
		}
		bt.blockHistory["solana"] = make([]*BlockInfo, 0, bt.config.HistoryDepth)
	}
	
	for _, chain := range bt.config.EVMChains {
		bt.chainStates[chain] = &ChainState{
			Chain:     chain,
			IsHealthy: true,
		}
		bt.blockHistory[chain] = make([]*BlockInfo, 0, bt.config.HistoryDepth)
	}
}

// trackSolana tracks Solana blocks.
func (bt *BlockTracker) trackSolana(ctx context.Context) {
	defer bt.wg.Done()
	
	bt.logger.Info("Starting Solana block tracking")
	
	// Subscribe to slot updates
	slotChan, err := bt.solana.SubscribeSlots(ctx)
	if err != nil {
		bt.logger.Error("Failed to subscribe to Solana slots", zap.Error(err))
		// Fall back to polling
		bt.pollSolana(ctx)
		return
	}
	
	for {
		select {
		case <-ctx.Done():
			return
		case slot := <-slotChan:
			bt.handleSolanaSlot(ctx, slot)
		}
	}
}

// pollSolana polls Solana for new slots.
func (bt *BlockTracker) pollSolana(ctx context.Context) {
	ticker := time.NewTicker(bt.config.PollInterval)
	defer ticker.Stop()
	
	var lastSlot uint64
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			slot, err := bt.solana.GetSlot(ctx)
			if err != nil {
				bt.updateChainHealth("solana", false, err.Error())
				continue
			}
			
			if slot > lastSlot {
				bt.handleSolanaSlot(ctx, slot)
				lastSlot = slot
			}
		}
	}
}

// handleSolanaSlot processes a new Solana slot.
func (bt *BlockTracker) handleSolanaSlot(ctx context.Context, slot uint64) {
	block, err := bt.solana.GetBlock(ctx, slot)
	if err != nil {
		bt.logger.Debug("Failed to get Solana block", zap.Uint64("slot", slot), zap.Error(err))
		return
	}
	
	blockInfo := &BlockInfo{
		Chain:            "solana",
		Number:           slot,
		Slot:             slot,
		Hash:             block.Blockhash,
		ParentHash:       block.PreviousBlockhash,
		Timestamp:        time.Unix(block.BlockTime, 0),
		TransactionCount: len(block.Transactions),
	}
	
	// Analyze transactions for trading metrics
	bt.analyzeSolanaBlock(blockInfo, block)
	
	bt.recordBlock("solana", blockInfo)
	
	bt.emitEvent(BlockEvent{
		Type:      BlockEventNew,
		Chain:     "solana",
		Block:     blockInfo,
		Timestamp: time.Now(),
	})
}

// analyzeSolanaBlock extracts trading-relevant metrics.
func (bt *BlockTracker) analyzeSolanaBlock(info *BlockInfo, block *SolanaBlock) {
	// Count DEX transactions (Raydium, Orca, Jupiter, etc.)
	dexPrograms := map[string]bool{
		"675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": true, // Raydium V4
		"whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc":  true, // Orca Whirlpool
		"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4":  true, // Jupiter V6
		"9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": true, // Orca Token Swap
	}
	
	for _, tx := range block.Transactions {
		for _, instruction := range tx.Transaction.Message.Instructions {
			if dexPrograms[instruction.ProgramId] {
				info.DEXTransactions++
			}
		}
	}
}

// trackEVM tracks blocks on an EVM chain.
func (bt *BlockTracker) trackEVM(ctx context.Context, chain string, client *EVMClient) {
	defer bt.wg.Done()
	
	bt.logger.Info("Starting EVM block tracking", zap.String("chain", chain))
	
	ticker := time.NewTicker(bt.config.PollInterval)
	defer ticker.Stop()
	
	var lastBlock uint64
	recentBlocks := make(map[uint64]string) // block -> hash for reorg detection
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			blockNum, err := client.GetBlockNumber(ctx)
			if err != nil {
				bt.updateChainHealth(chain, false, err.Error())
				continue
			}
			
			// Process new blocks
			if blockNum > lastBlock {
				// Check for gaps
				if lastBlock > 0 && blockNum > lastBlock+1 {
					bt.logger.Warn("Block gap detected",
						zap.String("chain", chain),
						zap.Uint64("from", lastBlock),
						zap.Uint64("to", blockNum))
					
					bt.emitEvent(BlockEvent{
						Type:      BlockEventGap,
						Chain:     chain,
						Timestamp: time.Now(),
					})
				}
				
				for i := lastBlock + 1; i <= blockNum; i++ {
					bt.handleEVMBlock(ctx, chain, client, i, recentBlocks)
				}
				
				lastBlock = blockNum
			}
			
			// Check for reorgs
			bt.detectReorg(ctx, chain, client, recentBlocks)
		}
	}
}

// handleEVMBlock processes a new EVM block.
func (bt *BlockTracker) handleEVMBlock(
	ctx context.Context,
	chain string,
	client *EVMClient,
	blockNum uint64,
	recentBlocks map[uint64]string,
) {
	block, err := client.GetBlock(ctx, blockNum)
	if err != nil {
		bt.logger.Debug("Failed to get EVM block",
			zap.String("chain", chain),
			zap.Uint64("block", blockNum),
			zap.Error(err))
		return
	}
	
	blockInfo := &BlockInfo{
		Chain:            chain,
		Number:           blockNum,
		Hash:             block.Hash,
		ParentHash:       block.ParentHash,
		Timestamp:        time.Unix(int64(block.Timestamp), 0),
		TransactionCount: len(block.Transactions),
		GasUsed:          block.GasUsed,
		GasLimit:         block.GasLimit,
		BaseFeePerGas:    block.BaseFeePerGas,
	}
	
	// Analyze transactions
	bt.analyzeEVMBlock(blockInfo, block, client)
	
	// Track for reorg detection
	recentBlocks[blockNum] = block.Hash
	
	// Clean old entries
	if len(recentBlocks) > bt.config.HistoryDepth {
		minBlock := blockNum - uint64(bt.config.HistoryDepth)
		for b := range recentBlocks {
			if b < minBlock {
				delete(recentBlocks, b)
			}
		}
	}
	
	bt.recordBlock(chain, blockInfo)
	bt.updateChainHealth(chain, true, "")
	
	bt.emitEvent(BlockEvent{
		Type:      BlockEventNew,
		Chain:     chain,
		Block:     blockInfo,
		Timestamp: time.Now(),
	})
	
	// Check if block is now confirmed
	confirmations := bt.config.Confirmations[chain]
	if confirmations > 0 {
		confirmedNum := blockNum - uint64(confirmations)
		if confirmedNum > 0 {
			bt.emitEvent(BlockEvent{
				Type:  BlockEventConfirmed,
				Chain: chain,
				Block: &BlockInfo{
					Chain:  chain,
					Number: confirmedNum,
				},
				Timestamp: time.Now(),
			})
		}
	}
}

// analyzeEVMBlock extracts trading metrics from EVM block.
func (bt *BlockTracker) analyzeEVMBlock(info *BlockInfo, block *EVMBlock, client *EVMClient) {
	largeTransferThreshold := decimal.NewFromInt(10) // 10 ETH/MATIC/etc
	
	for _, tx := range block.Transactions {
		// Check for DEX interactions
		if client.IsDEXRouter(tx.To) {
			info.DEXTransactions++
		}
		
		// Check for large transfers
		value, err := decimal.NewFromString(tx.Value)
		if err == nil {
			// Convert from wei to native (divide by 10^18)
			nativeValue := value.Div(decimal.New(1, 18))
			if nativeValue.GreaterThan(largeTransferThreshold) {
				info.LargeTransfers++
				info.TotalVolume = info.TotalVolume.Add(nativeValue)
			}
		}
		
		// MEV detection
		mevScore := client.CalculateMEVRisk(&tx)
		if mevScore > 0.7 {
			info.MEVDetected = true
		}
	}
}

// detectReorg checks for chain reorganizations.
func (bt *BlockTracker) detectReorg(
	ctx context.Context,
	chain string,
	client *EVMClient,
	recentBlocks map[uint64]string,
) {
	// Check recent blocks haven't changed
	for blockNum, expectedHash := range recentBlocks {
		block, err := client.GetBlock(ctx, blockNum)
		if err != nil {
			continue
		}
		
		if block.Hash != expectedHash {
			bt.logger.Warn("Chain reorganization detected",
				zap.String("chain", chain),
				zap.Uint64("block", blockNum),
				zap.String("expected", expectedHash),
				zap.String("actual", block.Hash))
			
			// Find reorg depth
			depth := bt.findReorgDepth(ctx, chain, client, blockNum, recentBlocks)
			
			bt.mu.Lock()
			if state, ok := bt.chainStates[chain]; ok {
				state.ReorgCount++
			}
			bt.mu.Unlock()
			
			bt.emitEvent(BlockEvent{
				Type:  BlockEventReorg,
				Chain: chain,
				Reorg: &ReorgInfo{
					Chain:     chain,
					OldHead:   blockNum,
					NewHead:   block.Number,
					Depth:     depth,
					Timestamp: time.Now(),
				},
				Timestamp: time.Now(),
			})
			
			// Update our records
			recentBlocks[blockNum] = block.Hash
			
			// Warn if deep reorg
			if depth > bt.config.MaxReorgDepth {
				bt.logger.Error("Deep chain reorganization detected",
					zap.String("chain", chain),
					zap.Int("depth", depth))
			}
		}
	}
}

// findReorgDepth determines how deep a reorg goes.
func (bt *BlockTracker) findReorgDepth(
	ctx context.Context,
	chain string,
	client *EVMClient,
	startBlock uint64,
	recentBlocks map[uint64]string,
) int {
	depth := 1
	
	for blockNum := startBlock - 1; blockNum > 0 && depth < bt.config.MaxReorgDepth; blockNum-- {
		expectedHash, ok := recentBlocks[blockNum]
		if !ok {
			break
		}
		
		block, err := client.GetBlock(ctx, blockNum)
		if err != nil {
			break
		}
		
		if block.Hash == expectedHash {
			break
		}
		
		depth++
	}
	
	return depth
}

// recordBlock records a block in history.
func (bt *BlockTracker) recordBlock(chain string, block *BlockInfo) {
	bt.mu.Lock()
	defer bt.mu.Unlock()
	
	history := bt.blockHistory[chain]
	history = append(history, block)
	
	// Trim to history depth
	if len(history) > bt.config.HistoryDepth {
		history = history[len(history)-bt.config.HistoryDepth:]
	}
	
	bt.blockHistory[chain] = history
	
	// Update chain state
	if state, ok := bt.chainStates[chain]; ok {
		state.LatestBlock = block.Number
		state.LastBlockTime = block.Timestamp
		
		// Calculate average block time
		if len(history) >= 2 {
			firstBlock := history[0]
			lastBlock := history[len(history)-1]
			duration := lastBlock.Timestamp.Sub(firstBlock.Timestamp)
			blockCount := len(history) - 1
			
			if blockCount > 0 && duration > 0 {
				state.AvgBlockTime = duration / time.Duration(blockCount)
				state.BlocksPerMinute = float64(blockCount) / duration.Minutes()
			}
		}
		
		// Update confirmed block
		confirmations := bt.config.Confirmations[chain]
		if block.Number > uint64(confirmations) {
			state.ConfirmedBlock = block.Number - uint64(confirmations)
		}
		
		// Calculate congestion (for EVM chains)
		if block.GasLimit > 0 {
			state.CongestionLevel = float64(block.GasUsed) / float64(block.GasLimit)
		}
		
		state.CurrentGasPrice = block.BaseFeePerGas
	}
}

// updateChainHealth updates the health status of a chain.
func (bt *BlockTracker) updateChainHealth(chain string, healthy bool, errMsg string) {
	bt.mu.Lock()
	defer bt.mu.Unlock()
	
	if state, ok := bt.chainStates[chain]; ok {
		state.IsHealthy = healthy
		if errMsg != "" {
			state.LastError = errMsg
		} else {
			state.LastError = ""
		}
	}
}

// monitorHealth monitors chain health.
func (bt *BlockTracker) monitorHealth(ctx context.Context) {
	defer bt.wg.Done()
	
	ticker := time.NewTicker(bt.config.HealthTimeout / 2)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bt.checkHealth()
		}
	}
}

// checkHealth checks if chains are healthy.
func (bt *BlockTracker) checkHealth() {
	bt.mu.Lock()
	defer bt.mu.Unlock()
	
	now := time.Now()
	
	for chain, state := range bt.chainStates {
		// Check if we've received blocks recently
		if !state.LastBlockTime.IsZero() {
			timeSinceBlock := now.Sub(state.LastBlockTime)
			
			// Expect at least one block within health timeout
			if timeSinceBlock > bt.config.HealthTimeout {
				state.IsHealthy = false
				state.LastError = "No blocks received recently"
				
				bt.logger.Warn("Chain appears unhealthy",
					zap.String("chain", chain),
					zap.Duration("timeSinceBlock", timeSinceBlock))
			}
		}
	}
}

// emitEvent sends an event to subscribers.
func (bt *BlockTracker) emitEvent(event BlockEvent) {
	select {
	case bt.events <- event:
	default:
		bt.logger.Warn("Event buffer full, dropping event",
			zap.String("chain", event.Chain),
			zap.String("type", string(event.Type)))
	}
}

// GetCongestionLevel returns current congestion for a chain.
func (bt *BlockTracker) GetCongestionLevel(chain string) float64 {
	bt.mu.RLock()
	defer bt.mu.RUnlock()
	
	if state, ok := bt.chainStates[chain]; ok {
		return state.CongestionLevel
	}
	return 0
}

// GetOptimalGasPrice suggests optimal gas price based on recent blocks.
func (bt *BlockTracker) GetOptimalGasPrice(chain string, urgency float64) decimal.Decimal {
	bt.mu.RLock()
	defer bt.mu.RUnlock()
	
	history := bt.blockHistory[chain]
	if len(history) == 0 {
		return decimal.Zero
	}
	
	// Collect recent gas prices
	var gasPrices []decimal.Decimal
	for _, block := range history {
		if !block.BaseFeePerGas.IsZero() {
			gasPrices = append(gasPrices, block.BaseFeePerGas)
		}
	}
	
	if len(gasPrices) == 0 {
		return decimal.Zero
	}
	
	// Calculate percentile based on urgency
	// urgency 0.0 = lowest price, 1.0 = highest price
	sortedPrices := make([]decimal.Decimal, len(gasPrices))
	copy(sortedPrices, gasPrices)
	
	// Simple sort
	for i := 0; i < len(sortedPrices); i++ {
		for j := i + 1; j < len(sortedPrices); j++ {
			if sortedPrices[i].GreaterThan(sortedPrices[j]) {
				sortedPrices[i], sortedPrices[j] = sortedPrices[j], sortedPrices[i]
			}
		}
	}
	
	index := int(urgency * float64(len(sortedPrices)-1))
	basePrice := sortedPrices[index]
	
	// Add priority fee based on urgency
	priorityFee := basePrice.Mul(decimal.NewFromFloat(urgency * 0.2))
	
	return basePrice.Add(priorityFee)
}

// IsConfirmed checks if a block is confirmed.
func (bt *BlockTracker) IsConfirmed(chain string, blockNumber uint64) bool {
	state := bt.GetChainState(chain)
	if state == nil {
		return false
	}
	return blockNumber <= state.ConfirmedBlock
}
