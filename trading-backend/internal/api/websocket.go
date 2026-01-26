// Package api provides WebSocket functionality for real-time updates.
package api

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/atlas-desktop/trading-backend/pkg/types"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// MessageType defines WebSocket message types.
type MessageType string

const (
	// Server -> Client messages
	MsgTypeOrderUpdate    MessageType = "order_update"
	MsgTypePositionUpdate MessageType = "position_update"
	MsgTypeTradeUpdate    MessageType = "trade_update"
	MsgTypeSignalUpdate   MessageType = "signal_update"
	MsgTypeRiskAlert      MessageType = "risk_alert"
	MsgTypeAgentStatus    MessageType = "agent_status"
	MsgTypePnLUpdate      MessageType = "pnl_update"
	MsgTypeError          MessageType = "error"
	MsgTypeHeartbeat      MessageType = "heartbeat"
	
	// Client -> Server messages
	MsgTypeSubscribe   MessageType = "subscribe"
	MsgTypeUnsubscribe MessageType = "unsubscribe"
	MsgTypeCommand     MessageType = "command"
)

// WSMessage is a WebSocket message.
type WSMessage struct {
	Type      MessageType     `json:"type"`
	Channel   string          `json:"channel,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Timestamp int64           `json:"timestamp"`
}

// Client is a WebSocket client connection.
type Client struct {
	id            string
	hub           *Hub
	conn          *websocket.Conn
	send          chan []byte
	subscriptions map[string]bool
	mu            sync.RWMutex
}

// Hub manages WebSocket connections.
type Hub struct {
	logger     *zap.Logger
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	channels   map[string]map[*Client]bool
	mu         sync.RWMutex
}

// NewHub creates a new WebSocket hub.
func NewHub(logger *zap.Logger) *Hub {
	return &Hub{
		logger:     logger,
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		channels:   make(map[string]map[*Client]bool),
	}
}

// Run starts the hub.
func (h *Hub) Run() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.logger.Debug("Client registered", zap.String("id", client.id))
			
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				// Remove from all channels
				for channel := range client.subscriptions {
					if clients, ok := h.channels[channel]; ok {
						delete(clients, client)
						if len(clients) == 0 {
							delete(h.channels, channel)
						}
					}
				}
			}
			h.mu.Unlock()
			h.logger.Debug("Client unregistered", zap.String("id", client.id))
			
		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
			
		case <-ticker.C:
			h.sendHeartbeat()
		}
	}
}

// sendHeartbeat sends heartbeat to all clients.
func (h *Hub) sendHeartbeat() {
	msg := WSMessage{
		Type:      MsgTypeHeartbeat,
		Timestamp: time.Now().UnixMilli(),
	}
	
	data, _ := json.Marshal(msg)
	
	h.mu.RLock()
	for client := range h.clients {
		select {
		case client.send <- data:
		default:
		}
	}
	h.mu.RUnlock()
}

// Subscribe subscribes a client to a channel.
func (h *Hub) Subscribe(client *Client, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if h.channels[channel] == nil {
		h.channels[channel] = make(map[*Client]bool)
	}
	h.channels[channel][client] = true
	
	client.mu.Lock()
	client.subscriptions[channel] = true
	client.mu.Unlock()
	
	h.logger.Debug("Client subscribed to channel",
		zap.String("client", client.id),
		zap.String("channel", channel))
}

// Unsubscribe unsubscribes a client from a channel.
func (h *Hub) Unsubscribe(client *Client, channel string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if clients, ok := h.channels[channel]; ok {
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.channels, channel)
		}
	}
	
	client.mu.Lock()
	delete(client.subscriptions, channel)
	client.mu.Unlock()
}

// PublishToChannel publishes a message to a channel.
func (h *Hub) PublishToChannel(channel string, msgType MessageType, data interface{}) {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		h.logger.Error("Failed to marshal message data", zap.Error(err))
		return
	}
	
	msg := WSMessage{
		Type:      msgType,
		Channel:   channel,
		Data:      dataBytes,
		Timestamp: time.Now().UnixMilli(),
	}
	
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		h.logger.Error("Failed to marshal message", zap.Error(err))
		return
	}
	
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	if clients, ok := h.channels[channel]; ok {
		for client := range clients {
			select {
			case client.send <- msgBytes:
			default:
			}
		}
	}
}

// Broadcast sends a message to all clients.
func (h *Hub) Broadcast(msgType MessageType, data interface{}) {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		h.logger.Error("Failed to marshal broadcast data", zap.Error(err))
		return
	}
	
	msg := WSMessage{
		Type:      msgType,
		Data:      dataBytes,
		Timestamp: time.Now().UnixMilli(),
	}
	
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		h.logger.Error("Failed to marshal broadcast", zap.Error(err))
		return
	}
	
	select {
	case h.broadcast <- msgBytes:
	default:
		h.logger.Warn("Broadcast channel full, dropping message")
	}
}

// BroadcastOrderUpdate broadcasts an order update.
func (h *Hub) BroadcastOrderUpdate(order *types.Order) {
	h.PublishToChannel("orders", MsgTypeOrderUpdate, order)
	h.PublishToChannel("orders:"+order.Symbol, MsgTypeOrderUpdate, order)
}

// BroadcastPositionUpdate broadcasts a position update.
func (h *Hub) BroadcastPositionUpdate(position *types.Position) {
	h.PublishToChannel("positions", MsgTypePositionUpdate, position)
	h.PublishToChannel("positions:"+position.Symbol, MsgTypePositionUpdate, position)
}

// BroadcastTradeUpdate broadcasts a trade update.
func (h *Hub) BroadcastTradeUpdate(trade *types.Trade) {
	h.PublishToChannel("trades", MsgTypeTradeUpdate, trade)
	h.PublishToChannel("trades:"+trade.Symbol, MsgTypeTradeUpdate, trade)
}

// BroadcastSignalUpdate broadcasts a signal update.
func (h *Hub) BroadcastSignalUpdate(signal *types.Signal) {
	h.PublishToChannel("signals", MsgTypeSignalUpdate, signal)
	h.PublishToChannel("signals:"+signal.Symbol, MsgTypeSignalUpdate, signal)
}

// BroadcastRiskAlert broadcasts a risk alert.
func (h *Hub) BroadcastRiskAlert(alert interface{}) {
	h.Broadcast(MsgTypeRiskAlert, alert)
}

// BroadcastAgentStatus broadcasts agent status.
func (h *Hub) BroadcastAgentStatus(status interface{}) {
	h.Broadcast(MsgTypeAgentStatus, status)
}

// BroadcastPnLUpdate broadcasts PnL update.
func (h *Hub) BroadcastPnLUpdate(pnl interface{}) {
	h.PublishToChannel("pnl", MsgTypePnLUpdate, pnl)
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// NewClient creates a new client.
func NewClient(id string, hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		id:            id,
		hub:           hub,
		conn:          conn,
		send:          make(chan []byte, 256),
		subscriptions: make(map[string]bool),
	}
}

// ReadPump pumps messages from the WebSocket to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	
	c.conn.SetReadLimit(65536)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.hub.logger.Error("WebSocket read error", zap.Error(err))
			}
			break
		}
		
		// Parse message
		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			c.hub.logger.Warn("Invalid WebSocket message", zap.Error(err))
			continue
		}
		
		// Handle message
		switch msg.Type {
		case MsgTypeSubscribe:
			c.hub.Subscribe(c, msg.Channel)
		case MsgTypeUnsubscribe:
			c.hub.Unsubscribe(c, msg.Channel)
		case MsgTypeCommand:
			c.handleCommand(msg)
		}
	}
}

// WritePump pumps messages from the hub to the WebSocket.
func (c *Client) WritePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			
			// Batch additional messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}
			
			if err := w.Close(); err != nil {
				return
			}
			
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleCommand handles client commands.
func (c *Client) handleCommand(msg WSMessage) {
	// TODO: Implement command handling
	c.hub.logger.Debug("Received command", zap.String("client", c.id))
}
