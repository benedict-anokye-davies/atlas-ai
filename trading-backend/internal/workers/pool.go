// Package workers provides high-performance parallel execution.
// Target: 1M+ ticks/second throughput with bounded memory.
// Based on research: "Go 1.21+ achieves 1M+ ticks/second with goroutine pools"
package workers

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

// Task represents a unit of work to be processed
type Task interface {
	Execute() error
}

// TaskFunc is a function that can be used as a Task
type TaskFunc func() error

func (f TaskFunc) Execute() error { return f() }

// Pool manages a pool of worker goroutines
type Pool struct {
	logger *zap.Logger
	config *PoolConfig

	// Worker management
	taskQueue chan Task
	workers   []*worker
	wg        sync.WaitGroup

	// State
	running atomic.Bool
	ctx     context.Context
	cancel  context.CancelFunc

	// Metrics
	metrics *PoolMetrics
}

// PoolConfig configures the worker pool
type PoolConfig struct {
	Name            string        // Pool name for logging
	NumWorkers      int           // Number of worker goroutines
	QueueSize       int           // Size of the task queue
	TaskTimeout     time.Duration // Timeout for individual tasks
	ShutdownTimeout time.Duration // Timeout for graceful shutdown
	PanicRecovery   bool          // Enable panic recovery in workers
}

// DefaultPoolConfig returns sensible defaults
func DefaultPoolConfig(name string) *PoolConfig {
	numCPU := runtime.NumCPU()
	return &PoolConfig{
		Name:            name,
		NumWorkers:      numCPU * 2, // 2x CPUs for I/O bound tasks
		QueueSize:       100000,     // 100K task buffer
		TaskTimeout:     30 * time.Second,
		ShutdownTimeout: 10 * time.Second,
		PanicRecovery:   true,
	}
}

// HighThroughputPoolConfig for maximum throughput
func HighThroughputPoolConfig(name string) *PoolConfig {
	numCPU := runtime.NumCPU()
	return &PoolConfig{
		Name:            name,
		NumWorkers:      numCPU * 4, // 4x CPUs for CPU bound
		QueueSize:       500000,     // 500K buffer
		TaskTimeout:     10 * time.Second,
		ShutdownTimeout: 5 * time.Second,
		PanicRecovery:   true,
	}
}

// PoolMetrics tracks pool performance
type PoolMetrics struct {
	mu sync.RWMutex

	TasksSubmitted int64
	TasksCompleted int64
	TasksFailed    int64
	TasksTimeout   int64
	PanicRecovered int64

	// Latency tracking
	latencies   []int64
	latencyIdx  int
	latencySize int

	// Throughput
	startTime      time.Time
	lastCheckpoint time.Time
	lastCompleted  int64
}

// NewPoolMetrics creates a new metrics tracker
func NewPoolMetrics() *PoolMetrics {
	return &PoolMetrics{
		latencies:      make([]int64, 10000),
		latencySize:    10000,
		startTime:      time.Now(),
		lastCheckpoint: time.Now(),
	}
}

// RecordLatency records task execution latency
func (m *PoolMetrics) RecordLatency(ns int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.latencies[m.latencyIdx] = ns
	m.latencyIdx = (m.latencyIdx + 1) % m.latencySize
}

// GetP99Latency returns the 99th percentile latency
func (m *PoolMetrics) GetP99Latency() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Find filled portion
	filled := m.latencySize
	if m.latencyIdx < m.latencySize {
		for i := m.latencyIdx; i < m.latencySize; i++ {
			if m.latencies[i] == 0 {
				filled = m.latencyIdx
				break
			}
		}
	}

	if filled == 0 {
		return 0
	}

	// Copy and sort
	sorted := make([]int64, filled)
	copy(sorted, m.latencies[:filled])

	// Quickselect for P99 (simple sort for now)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j] < sorted[i] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	idx := int(float64(len(sorted)) * 0.99)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}

	return time.Duration(sorted[idx])
}

// GetThroughput returns tasks per second
func (m *PoolMetrics) GetThroughput() float64 {
	elapsed := time.Since(m.startTime).Seconds()
	if elapsed == 0 {
		return 0
	}
	return float64(atomic.LoadInt64((*int64)(&m.TasksCompleted))) / elapsed
}

// GetCurrentThroughput returns recent throughput
func (m *PoolMetrics) GetCurrentThroughput() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(m.lastCheckpoint).Seconds()
	if elapsed < 1 {
		return 0
	}

	currentCompleted := atomic.LoadInt64((*int64)(&m.TasksCompleted))
	delta := currentCompleted - m.lastCompleted

	m.lastCheckpoint = now
	m.lastCompleted = currentCompleted

	return float64(delta) / elapsed
}

// GetStats returns current metrics
func (m *PoolMetrics) GetStats() PoolStats {
	return PoolStats{
		TasksSubmitted: atomic.LoadInt64((*int64)(&m.TasksSubmitted)),
		TasksCompleted: atomic.LoadInt64((*int64)(&m.TasksCompleted)),
		TasksFailed:    atomic.LoadInt64((*int64)(&m.TasksFailed)),
		TasksTimeout:   atomic.LoadInt64((*int64)(&m.TasksTimeout)),
		PanicRecovered: atomic.LoadInt64((*int64)(&m.PanicRecovered)),
		P99Latency:     m.GetP99Latency(),
		Throughput:     m.GetThroughput(),
		Uptime:         time.Since(m.startTime),
	}
}

// PoolStats contains pool statistics
type PoolStats struct {
	TasksSubmitted int64         `json:"tasks_submitted"`
	TasksCompleted int64         `json:"tasks_completed"`
	TasksFailed    int64         `json:"tasks_failed"`
	TasksTimeout   int64         `json:"tasks_timeout"`
	PanicRecovered int64         `json:"panic_recovered"`
	P99Latency     time.Duration `json:"p99_latency"`
	Throughput     float64       `json:"throughput"`
	Uptime         time.Duration `json:"uptime"`
}

// worker represents a single worker goroutine
type worker struct {
	id     int
	pool   *Pool
	logger *zap.Logger
}

// NewPool creates a new worker pool
func NewPool(logger *zap.Logger, config *PoolConfig) *Pool {
	if config == nil {
		config = DefaultPoolConfig("default")
	}

	ctx, cancel := context.WithCancel(context.Background())

	p := &Pool{
		logger:    logger,
		config:    config,
		taskQueue: make(chan Task, config.QueueSize),
		workers:   make([]*worker, config.NumWorkers),
		ctx:       ctx,
		cancel:    cancel,
		metrics:   NewPoolMetrics(),
	}

	return p
}

// Start initializes and starts all workers
func (p *Pool) Start() {
	if p.running.Swap(true) {
		return // Already running
	}

	p.logger.Info("starting worker pool",
		zap.String("name", p.config.Name),
		zap.Int("workers", p.config.NumWorkers),
		zap.Int("queue_size", p.config.QueueSize),
	)

	for i := 0; i < p.config.NumWorkers; i++ {
		w := &worker{
			id:     i,
			pool:   p,
			logger: p.logger.With(zap.Int("worker_id", i)),
		}
		p.workers[i] = w
		p.wg.Add(1)
		go w.run()
	}
}

// run is the worker's main loop
func (w *worker) run() {
	defer w.pool.wg.Done()

	for {
		select {
		case <-w.pool.ctx.Done():
			return

		case task, ok := <-w.pool.taskQueue:
			if !ok {
				return // Queue closed
			}
			w.executeTask(task)
		}
	}
}

// executeTask executes a single task with timeout and panic recovery
func (w *worker) executeTask(task Task) {
	startTime := time.Now()

	// Setup timeout context
	ctx, cancel := context.WithTimeout(w.pool.ctx, w.pool.config.TaskTimeout)
	defer cancel()

	// Channel for task completion
	done := make(chan error, 1)

	// Execute task in goroutine for timeout support
	go func() {
		var err error

		// Panic recovery
		if w.pool.config.PanicRecovery {
			defer func() {
				if r := recover(); r != nil {
					atomic.AddInt64((*int64)(&w.pool.metrics.PanicRecovered), 1)
					w.logger.Error("worker recovered from panic",
						zap.Any("panic", r),
					)
					err = &PanicError{Recovered: r}
				}
				done <- err
			}()
		}

		err = task.Execute()
		if !w.pool.config.PanicRecovery {
			done <- err
		}
	}()

	// Wait for completion or timeout
	select {
	case err := <-done:
		elapsed := time.Since(startTime)
		w.pool.metrics.RecordLatency(elapsed.Nanoseconds())

		if err != nil {
			atomic.AddInt64((*int64)(&w.pool.metrics.TasksFailed), 1)
			w.logger.Debug("task failed", zap.Error(err))
		} else {
			atomic.AddInt64((*int64)(&w.pool.metrics.TasksCompleted), 1)
		}

	case <-ctx.Done():
		atomic.AddInt64((*int64)(&w.pool.metrics.TasksTimeout), 1)
		w.logger.Warn("task timed out",
			zap.Duration("timeout", w.pool.config.TaskTimeout),
		)
	}
}

// Submit adds a task to the queue
func (p *Pool) Submit(task Task) error {
	if !p.running.Load() {
		return ErrPoolStopped
	}

	select {
	case p.taskQueue <- task:
		atomic.AddInt64((*int64)(&p.metrics.TasksSubmitted), 1)
		return nil
	default:
		return ErrQueueFull
	}
}

// SubmitWait submits a task and waits for completion
func (p *Pool) SubmitWait(task Task) error {
	if !p.running.Load() {
		return ErrPoolStopped
	}

	done := make(chan error, 1)
	wrapper := TaskFunc(func() error {
		err := task.Execute()
		done <- err
		return err
	})

	if err := p.Submit(wrapper); err != nil {
		return err
	}

	return <-done
}

// SubmitFunc submits a function as a task
func (p *Pool) SubmitFunc(fn func() error) error {
	return p.Submit(TaskFunc(fn))
}

// SubmitBatch submits multiple tasks
func (p *Pool) SubmitBatch(tasks []Task) (submitted int, err error) {
	for _, task := range tasks {
		if err := p.Submit(task); err != nil {
			return submitted, err
		}
		submitted++
	}
	return submitted, nil
}

// Stop gracefully shuts down the pool
func (p *Pool) Stop() error {
	if !p.running.Swap(false) {
		return nil // Already stopped
	}

	p.logger.Info("stopping worker pool", zap.String("name", p.config.Name))

	// Signal workers to stop
	p.cancel()

	// Wait with timeout
	done := make(chan struct{})
	go func() {
		p.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		p.logger.Info("worker pool stopped gracefully",
			zap.String("name", p.config.Name),
		)
		return nil

	case <-time.After(p.config.ShutdownTimeout):
		p.logger.Warn("worker pool shutdown timed out",
			zap.String("name", p.config.Name),
			zap.Duration("timeout", p.config.ShutdownTimeout),
		)
		return ErrShutdownTimeout
	}
}

// QueueLength returns the current number of queued tasks
func (p *Pool) QueueLength() int {
	return len(p.taskQueue)
}

// IsRunning returns whether the pool is running
func (p *Pool) IsRunning() bool {
	return p.running.Load()
}

// Metrics returns the pool metrics
func (p *Pool) Metrics() *PoolMetrics {
	return p.metrics
}

// Stats returns current pool statistics
func (p *Pool) Stats() PoolStats {
	return p.metrics.GetStats()
}

// Errors
var (
	ErrPoolStopped     = &PoolError{Message: "pool is stopped"}
	ErrQueueFull       = &PoolError{Message: "task queue is full"}
	ErrShutdownTimeout = &PoolError{Message: "shutdown timed out"}
)

// PoolError represents a pool error
type PoolError struct {
	Message string
}

func (e *PoolError) Error() string { return e.Message }

// PanicError represents a recovered panic
type PanicError struct {
	Recovered interface{}
}

func (e *PanicError) Error() string {
	return "panic recovered"
}

// BatchProcessor provides batch processing utilities
type BatchProcessor struct {
	pool      *Pool
	batchSize int
	logger    *zap.Logger
}

// NewBatchProcessor creates a batch processor
func NewBatchProcessor(pool *Pool, batchSize int) *BatchProcessor {
	return &BatchProcessor{
		pool:      pool,
		batchSize: batchSize,
		logger:    pool.logger,
	}
}

// ProcessBatch processes items in parallel batches
func (bp *BatchProcessor) ProcessBatch(items []interface{}, processor func(item interface{}) error) error {
	var wg sync.WaitGroup
	errChan := make(chan error, len(items))

	for i := 0; i < len(items); i += bp.batchSize {
		end := i + bp.batchSize
		if end > len(items) {
			end = len(items)
		}

		batch := items[i:end]
		wg.Add(len(batch))

		for _, item := range batch {
			item := item // Capture
			if err := bp.pool.SubmitFunc(func() error {
				defer wg.Done()
				if err := processor(item); err != nil {
					errChan <- err
					return err
				}
				return nil
			}); err != nil {
				wg.Done()
				return err
			}
		}

		// Wait for batch to complete before next batch
		wg.Wait()
	}

	close(errChan)

	// Collect errors
	var errors []error
	for err := range errChan {
		errors = append(errors, err)
	}

	if len(errors) > 0 {
		return &BatchError{Errors: errors}
	}

	return nil
}

// BatchError contains multiple errors from batch processing
type BatchError struct {
	Errors []error
}

func (e *BatchError) Error() string {
	return "batch processing errors occurred"
}

// Pipeline provides a multi-stage processing pipeline
type Pipeline struct {
	stages []*Stage
	logger *zap.Logger
}

// Stage represents a pipeline stage
type Stage struct {
	Name    string
	Pool    *Pool
	Process func(input interface{}) (output interface{}, err error)
}

// NewPipeline creates a new processing pipeline
func NewPipeline(logger *zap.Logger) *Pipeline {
	return &Pipeline{
		stages: make([]*Stage, 0),
		logger: logger,
	}
}

// AddStage adds a processing stage
func (p *Pipeline) AddStage(name string, pool *Pool, processor func(interface{}) (interface{}, error)) {
	p.stages = append(p.stages, &Stage{
		Name:    name,
		Pool:    pool,
		Process: processor,
	})
}

// Execute runs the pipeline on input
func (p *Pipeline) Execute(input interface{}) (interface{}, error) {
	current := input

	for _, stage := range p.stages {
		resultChan := make(chan interface{}, 1)
		errChan := make(chan error, 1)

		item := current // Capture
		if err := stage.Pool.SubmitFunc(func() error {
			result, err := stage.Process(item)
			if err != nil {
				errChan <- err
				return err
			}
			resultChan <- result
			return nil
		}); err != nil {
			return nil, err
		}

		select {
		case result := <-resultChan:
			current = result
		case err := <-errChan:
			return nil, err
		}
	}

	return current, nil
}

// Start starts all pipeline stages
func (p *Pipeline) Start() {
	for _, stage := range p.stages {
		stage.Pool.Start()
	}
}

// Stop stops all pipeline stages
func (p *Pipeline) Stop() {
	for _, stage := range p.stages {
		stage.Pool.Stop()
	}
}
