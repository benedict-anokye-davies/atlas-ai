.PHONY: all build test test-unit test-integration test-short run clean lint fmt deps tidy coverage help

# Build settings
BINARY_NAME=trading-backend
BUILD_DIR=./build
CMD_DIR=./cmd/server

# Go settings
GOFLAGS=-v
LDFLAGS=-s -w

# Default target
all: deps build

# Download dependencies
deps:
	@echo "Downloading dependencies..."
	go mod download

# Tidy dependencies
tidy:
	@echo "Tidying dependencies..."
	go mod tidy

# Build the binary
build: deps
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME) $(CMD_DIR)
	@echo "Build complete: $(BUILD_DIR)/$(BINARY_NAME)"

# Build for all platforms
build-all: deps
	@echo "Building for all platforms..."
	@mkdir -p $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe $(CMD_DIR)
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 $(CMD_DIR)
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 $(CMD_DIR)
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 $(CMD_DIR)
	@echo "Cross-platform build complete"

# Run the server
run: build
	@echo "Starting server..."
	$(BUILD_DIR)/$(BINARY_NAME) -port 8080 -log-level debug

# Run server with hot reload (requires air: go install github.com/cosmtrek/air@latest)
dev:
	@which air > /dev/null || (echo "Installing air..." && go install github.com/cosmtrek/air@latest)
	air

# Run all tests
test:
	@echo "Running all tests..."
	go test $(GOFLAGS) ./...

# Run unit tests only (skip integration and network tests)
test-unit:
	@echo "Running unit tests..."
	go test -short $(GOFLAGS) ./internal/... ./pkg/...

# Run integration tests
test-integration:
	@echo "Running integration tests..."
	go test $(GOFLAGS) ./tests/...

# Run tests with race detection
test-race:
	@echo "Running tests with race detection..."
	go test -race $(GOFLAGS) ./...

# Run tests with coverage
coverage:
	@echo "Running tests with coverage..."
	@mkdir -p $(BUILD_DIR)
	go test -coverprofile=$(BUILD_DIR)/coverage.out ./...
	go tool cover -html=$(BUILD_DIR)/coverage.out -o $(BUILD_DIR)/coverage.html
	@echo "Coverage report: $(BUILD_DIR)/coverage.html"
	go tool cover -func=$(BUILD_DIR)/coverage.out

# Run short tests (no network)
test-short:
	@echo "Running short tests..."
	go test -short $(GOFLAGS) ./...

# Benchmark tests
bench:
	@echo "Running benchmarks..."
	go test -bench=. -benchmem ./...

# Lint the code (requires golangci-lint)
lint:
	@which golangci-lint > /dev/null || (echo "Installing golangci-lint..." && go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
	golangci-lint run ./...

# Format the code
fmt:
	@echo "Formatting code..."
	go fmt ./...
	goimports -w .

# Vet the code
vet:
	@echo "Vetting code..."
	go vet ./...

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf $(BUILD_DIR)
	go clean -testcache

# Generate mocks (requires mockgen)
mocks:
	@which mockgen > /dev/null || (echo "Installing mockgen..." && go install github.com/golang/mock/mockgen@latest)
	go generate ./...

# Security scan (requires gosec)
security:
	@which gosec > /dev/null || (echo "Installing gosec..." && go install github.com/securego/gosec/v2/cmd/gosec@latest)
	gosec ./...

# Check for vulnerabilities
vuln:
	@echo "Checking for vulnerabilities..."
	go install golang.org/x/vuln/cmd/govulncheck@latest
	govulncheck ./...

# Print help
help:
	@echo "Trading Backend Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  all            Build with dependencies (default)"
	@echo "  deps           Download dependencies"
	@echo "  tidy           Tidy go.mod"
	@echo "  build          Build the binary"
	@echo "  build-all      Build for all platforms"
	@echo "  run            Build and run the server"
	@echo "  dev            Run with hot reload (air)"
	@echo "  test           Run all tests"
	@echo "  test-unit      Run unit tests only"
	@echo "  test-integration Run integration tests"
	@echo "  test-short     Run tests without network"
	@echo "  test-race      Run tests with race detection"
	@echo "  coverage       Run tests with coverage report"
	@echo "  bench          Run benchmarks"
	@echo "  lint           Lint code (golangci-lint)"
	@echo "  fmt            Format code"
	@echo "  vet            Vet code"
	@echo "  clean          Clean build artifacts"
	@echo "  mocks          Generate mocks"
	@echo "  security       Security scan (gosec)"
	@echo "  vuln           Check for vulnerabilities"
	@echo "  help           Print this help"
