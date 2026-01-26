// Package adapters provides a Solana DEX adapter for Jupiter aggregator.
package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// SolanaAdapter implements the exchange adapter for Solana DEXs via Jupiter.
type SolanaAdapter struct {
	logger       *zap.Logger
	jupiterURL   string
	rpcURL       string
	privateKey   string
	httpClient   *http.Client
	slippageBPS  int // Slippage in basis points (100 = 1%)
}

// SolanaConfig contains Solana adapter configuration.
type SolanaConfig struct {
	RPCURL       string `json:"rpcUrl"`
	PrivateKey   string `json:"privateKey"`
	SlippageBPS  int    `json:"slippageBps"`
	UseMainnet   bool   `json:"useMainnet"`
}

// JupiterQuote represents a Jupiter swap quote.
type JupiterQuote struct {
	InputMint            string          `json:"inputMint"`
	InAmount             string          `json:"inAmount"`
	OutputMint           string          `json:"outputMint"`
	OutAmount            string          `json:"outAmount"`
	OtherAmountThreshold string          `json:"otherAmountThreshold"`
	SwapMode             string          `json:"swapMode"`
	SlippageBps          int             `json:"slippageBps"`
	PriceImpactPct       string          `json:"priceImpactPct"`
	RoutePlan            []JupiterRoute  `json:"routePlan"`
	ContextSlot          int64           `json:"contextSlot"`
	TimeTaken            float64         `json:"timeTaken"`
}

// JupiterRoute represents a route in Jupiter.
type JupiterRoute struct {
	SwapInfo JupiterSwapInfo `json:"swapInfo"`
	Percent  int             `json:"percent"`
}

// JupiterSwapInfo represents swap info.
type JupiterSwapInfo struct {
	AmmKey     string `json:"ammKey"`
	Label      string `json:"label"`
	InputMint  string `json:"inputMint"`
	OutputMint string `json:"outputMint"`
	InAmount   string `json:"inAmount"`
	OutAmount  string `json:"outAmount"`
	FeeAmount  string `json:"feeAmount"`
	FeeMint    string `json:"feeMint"`
}

// JupiterSwapRequest represents a swap request.
type JupiterSwapRequest struct {
	QuoteResponse             JupiterQuote `json:"quoteResponse"`
	UserPublicKey             string       `json:"userPublicKey"`
	WrapAndUnwrapSOL          bool         `json:"wrapAndUnwrapSol"`
	UseSharedAccounts         bool         `json:"useSharedAccounts"`
	FeeAccount                string       `json:"feeAccount,omitempty"`
	ComputeUnitPriceMicroLamports int64    `json:"computeUnitPriceMicroLamports,omitempty"`
	PrioritizationFeeLamports int64        `json:"prioritizationFeeLamports,omitempty"`
	AsLegacyTransaction       bool         `json:"asLegacyTransaction"`
	UseTokenLedger            bool         `json:"useTokenLedger"`
	DestinationTokenAccount   string       `json:"destinationTokenAccount,omitempty"`
	DynamicComputeUnitLimit   bool         `json:"dynamicComputeUnitLimit"`
}

// JupiterSwapResponse represents the swap response.
type JupiterSwapResponse struct {
	SwapTransaction           string `json:"swapTransaction"`
	LastValidBlockHeight      int64  `json:"lastValidBlockHeight"`
	PrioritizationFeeLamports int64  `json:"prioritizationFeeLamports,omitempty"`
}

// JupiterTokenInfo represents token information.
type JupiterTokenInfo struct {
	Address   string          `json:"address"`
	ChainID   int             `json:"chainId"`
	Decimals  int             `json:"decimals"`
	Name      string          `json:"name"`
	Symbol    string          `json:"symbol"`
	LogoURI   string          `json:"logoURI,omitempty"`
	Price     decimal.Decimal `json:"price,omitempty"`
}

// Common Solana token addresses
const (
	SOLMint     = "So11111111111111111111111111111111111111112"
	USDCMint    = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
	USDTMint    = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
	WSOLMint    = "So11111111111111111111111111111111111111112"
	RAYMint     = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"
	SRMMint     = "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt"
	BONKMint    = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
)

// NewSolanaAdapter creates a new Solana adapter.
func NewSolanaAdapter(logger *zap.Logger, config SolanaConfig) *SolanaAdapter {
	jupiterURL := "https://quote-api.jup.ag/v6"
	
	slippageBPS := config.SlippageBPS
	if slippageBPS == 0 {
		slippageBPS = 50 // Default 0.5%
	}
	
	return &SolanaAdapter{
		logger:      logger.Named("solana"),
		jupiterURL:  jupiterURL,
		rpcURL:      config.RPCURL,
		privateKey:  config.PrivateKey,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		slippageBPS: slippageBPS,
	}
}

// Connect establishes connection.
func (s *SolanaAdapter) Connect(ctx context.Context) error {
	s.logger.Info("Connecting to Solana via Jupiter")
	
	// Test Jupiter API
	_, err := s.GetPrice(ctx, SOLMint, USDCMint)
	if err != nil {
		return fmt.Errorf("failed to connect to Jupiter: %w", err)
	}
	
	s.logger.Info("Successfully connected to Solana")
	return nil
}

// Disconnect closes the connection.
func (s *SolanaAdapter) Disconnect() error {
	return nil
}

// GetQuote gets a swap quote from Jupiter.
func (s *SolanaAdapter) GetQuote(ctx context.Context, inputMint, outputMint string, amount uint64) (*JupiterQuote, error) {
	url := fmt.Sprintf("%s/quote?inputMint=%s&outputMint=%s&amount=%d&slippageBps=%d",
		s.jupiterURL, inputMint, outputMint, amount, s.slippageBPS)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("quote failed: %s", string(body))
	}
	
	var quote JupiterQuote
	if err := json.Unmarshal(body, &quote); err != nil {
		return nil, err
	}
	
	return &quote, nil
}

// GetPrice gets price for a token pair.
func (s *SolanaAdapter) GetPrice(ctx context.Context, inputMint, outputMint string) (decimal.Decimal, error) {
	url := fmt.Sprintf("%s/price?ids=%s,%s&vsToken=%s",
		s.jupiterURL, inputMint, outputMint, USDCMint)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return decimal.Zero, err
	}
	
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return decimal.Zero, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return decimal.Zero, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return decimal.Zero, fmt.Errorf("price failed: %s", string(body))
	}
	
	var priceResp struct {
		Data map[string]struct {
			ID    string  `json:"id"`
			Price float64 `json:"price"`
		} `json:"data"`
	}
	
	if err := json.Unmarshal(body, &priceResp); err != nil {
		return decimal.Zero, err
	}
	
	if data, ok := priceResp.Data[inputMint]; ok {
		return decimal.NewFromFloat(data.Price), nil
	}
	
	return decimal.Zero, fmt.Errorf("price not found for %s", inputMint)
}

// BuildSwapTransaction builds a swap transaction.
func (s *SolanaAdapter) BuildSwapTransaction(ctx context.Context, quote *JupiterQuote, userPublicKey string) (*JupiterSwapResponse, error) {
	swapReq := JupiterSwapRequest{
		QuoteResponse:           *quote,
		UserPublicKey:           userPublicKey,
		WrapAndUnwrapSOL:        true,
		UseSharedAccounts:       true,
		DynamicComputeUnitLimit: true,
	}
	
	reqBody, err := json.Marshal(swapReq)
	if err != nil {
		return nil, err
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", s.jupiterURL+"/swap", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("swap build failed: %s", string(body))
	}
	
	var swapResp JupiterSwapResponse
	if err := json.Unmarshal(body, &swapResp); err != nil {
		return nil, err
	}
	
	return &swapResp, nil
}

// PlaceOrder places a swap order via Jupiter.
func (s *SolanaAdapter) PlaceOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	// Convert symbol to mint addresses
	inputMint, outputMint := s.symbolToMints(order.Symbol, order.Side)
	
	// Calculate input amount (in base units)
	// For SOL, this is lamports (1 SOL = 1e9 lamports)
	amount := order.Quantity.Mul(decimal.NewFromInt(1e9)).BigInt().Uint64()
	
	// Get quote
	quote, err := s.GetQuote(ctx, inputMint, outputMint, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to get quote: %w", err)
	}
	
	s.logger.Info("Got Jupiter quote",
		zap.String("inputMint", inputMint),
		zap.String("outputMint", outputMint),
		zap.String("inAmount", quote.InAmount),
		zap.String("outAmount", quote.OutAmount),
		zap.String("priceImpact", quote.PriceImpactPct))
	
	// Build and sign transaction
	// Note: In production, this would sign and submit the transaction
	// For now, we return the quote details as a "pending" order
	
	outAmount, _ := decimal.NewFromString(quote.OutAmount)
	
	order.ID = fmt.Sprintf("jupiter-%d", time.Now().UnixNano())
	order.Status = types.OrderStatusOpen
	order.FilledQty = outAmount.Div(decimal.NewFromInt(1e9)) // Convert from base units
	order.CreatedAt = time.Now()
	
	return order, nil
}

// CancelOrder cancels an order (not applicable for instant swaps).
func (s *SolanaAdapter) CancelOrder(ctx context.Context, orderID string) error {
	return fmt.Errorf("Jupiter swaps are instant and cannot be cancelled")
}

// GetOrder gets order status (returns completed for Jupiter).
func (s *SolanaAdapter) GetOrder(ctx context.Context, orderID string) (*types.Order, error) {
	// Jupiter orders are instant, so this would check transaction status
	return nil, fmt.Errorf("order lookup not implemented for Jupiter")
}

// GetBalance gets token balance.
func (s *SolanaAdapter) GetBalance(ctx context.Context, asset string) (decimal.Decimal, error) {
	// Would query RPC for token account balance
	return decimal.Zero, fmt.Errorf("balance lookup requires RPC implementation")
}

// GetPositions returns current token balances as positions.
func (s *SolanaAdapter) GetPositions(ctx context.Context) ([]*types.Position, error) {
	// Would query all token accounts
	return nil, fmt.Errorf("positions lookup requires RPC implementation")
}

// symbolToMints converts a trading pair to mint addresses.
func (s *SolanaAdapter) symbolToMints(symbol string, side types.OrderSide) (inputMint, outputMint string) {
	// Common mappings
	mintMap := map[string]string{
		"SOL":  SOLMint,
		"USDC": USDCMint,
		"USDT": USDTMint,
		"RAY":  RAYMint,
		"SRM":  SRMMint,
		"BONK": BONKMint,
	}
	
	// Parse symbol (e.g., "SOL/USDC")
	var base, quote string
	for i, c := range symbol {
		if c == '/' {
			base = symbol[:i]
			quote = symbol[i+1:]
			break
		}
	}
	
	baseMint := mintMap[base]
	quoteMint := mintMap[quote]
	
	if baseMint == "" {
		baseMint = base // Assume it's a mint address
	}
	if quoteMint == "" {
		quoteMint = quote
	}
	
	if side == types.OrderSideBuy {
		return quoteMint, baseMint // Swap quote for base
	}
	return baseMint, quoteMint // Swap base for quote
}

// GetTokenInfo gets information about a token.
func (s *SolanaAdapter) GetTokenInfo(ctx context.Context, mint string) (*JupiterTokenInfo, error) {
	url := fmt.Sprintf("https://token.jup.ag/strict/%s", mint)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token info failed: %s", string(body))
	}
	
	var info JupiterTokenInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, err
	}
	
	return &info, nil
}

// EstimatePriceImpact estimates price impact for a swap.
func (s *SolanaAdapter) EstimatePriceImpact(ctx context.Context, inputMint, outputMint string, amount uint64) (decimal.Decimal, error) {
	quote, err := s.GetQuote(ctx, inputMint, outputMint, amount)
	if err != nil {
		return decimal.Zero, err
	}
	
	impact, err := decimal.NewFromString(quote.PriceImpactPct)
	if err != nil {
		return decimal.Zero, err
	}
	
	return impact, nil
}

// GetRoutes gets available routes for a swap.
func (s *SolanaAdapter) GetRoutes(ctx context.Context, inputMint, outputMint string, amount uint64) ([]JupiterRoute, error) {
	quote, err := s.GetQuote(ctx, inputMint, outputMint, amount)
	if err != nil {
		return nil, err
	}
	
	return quote.RoutePlan, nil
}

// SetSlippage sets the slippage tolerance.
func (s *SolanaAdapter) SetSlippage(bps int) {
	s.slippageBPS = bps
}
