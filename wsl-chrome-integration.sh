#!/usr/bin/env bash
# =============================================================================
# wsl-chrome-integration.sh
# Version: 1.0 (2026-02-01)
# =============================================================================
#
# Purpose: Validate and setup Chrome integration from WSL
# Architecture: WSL (this script) -> Windows Host (Chrome on :9225)
#
# Usage:
#   bash wsl-chrome-integration.sh validate  # Check Chrome accessibility
#   bash wsl-chrome-integration.sh proxy     # Start proxy service
#   bash wsl-chrome-integration.sh test      # Run integration tests
#   bash wsl-chrome-integration.sh all       # Full workflow
#
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
CHROME_PORT="${CHROME_PORT:-9225}"
PROXY_PORT="${PROXY_PORT:-9224}"
WINDOWS_HOST="host.docker.internal"  # Docker Desktop DNS name for Windows host
CHROME_ENDPOINT="http://${WINDOWS_HOST}:${CHROME_PORT}"
PROXY_HOST="0.0.0.0"  # Container proxy binds to all interfaces

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# =============================================================================
# Validation Functions
# =============================================================================

validate_chrome() {
    print_header "VALIDATING CHROME ON WINDOWS HOST"

    log_info "Checking Chrome accessibility from WSL..."
    log_info "Endpoint: ${CHROME_ENDPOINT}/json/version"

    if ! command -v curl >/dev/null 2>&1; then
        log_error "curl not found. Install: sudo apt-get install curl"
        return 1
    fi

    local max_retries=5
    local retry_delay=2

    for ((i=1; i<=max_retries; i++)); do
        log_info "Attempt $i/$max_retries..."

        # Docker Desktop requires Host: localhost header
        if curl -sf -H "Host: localhost" --connect-timeout 3 "${CHROME_ENDPOINT}/json/version" >/dev/null 2>&1; then
            log_success "Chrome is accessible from Docker!"

            echo ""
            log_info "Chrome Details:"
            curl -s -H "Host: localhost" "${CHROME_ENDPOINT}/json/version" | jq '.' 2>/dev/null || curl -s -H "Host: localhost" "${CHROME_ENDPOINT}/json/version"
            echo ""

            return 0
        fi

        if [ $i -lt $max_retries ]; then
            log_warn "Chrome not accessible, retrying in ${retry_delay}s..."
            sleep $retry_delay
        fi
    done

    log_error "Chrome is NOT accessible from WSL"
    echo ""
    log_error "TROUBLESHOOTING:"
    log_error "1. Start Chrome on Windows Host:"
    log_error "   START-CHROME-SIMPLE.bat"
    log_error ""
    log_error "2. Validate from Windows cmd:"
    log_error "   curl http://localhost:9225/json/version"
    log_error ""
    log_error "3. Check WSL networking:"
    log_error "   cat /etc/resolv.conf  # Check nameserver (Windows host IP)"
    log_error "   ping \$(grep nameserver /etc/resolv.conf | awk '{print \$2}')"
    log_error ""
    log_error "4. Check Windows Firewall:"
    log_error "   - Allow port 9225 for WSL access"
    log_error ""

    return 1
}

validate_node() {
    print_header "VALIDATING NODE.JS ENVIRONMENT"

    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js not found"
        return 1
    fi

    local node_version=$(node --version)
    log_success "Node.js: $node_version"

    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm not found"
        return 1
    fi

    local npm_version=$(npm --version)
    log_success "npm: $npm_version"

    if [ ! -f "package.json" ]; then
        log_error "package.json not found (wrong directory?)"
        return 1
    fi

    log_success "package.json found"

    if [ ! -d "node_modules" ]; then
        log_warn "node_modules not found"
        log_info "Run: npm install"
    else
        log_success "node_modules exists"
    fi

    return 0
}

validate_config() {
    print_header "VALIDATING CONFIGURATION"

    if [ ! -f "config.json" ]; then
        log_error "config.json not found"
        return 1
    fi

    log_success "config.json found"

    # Validate Chrome Proxy settings
    local proxy_enabled=$(jq -r '.CHROME_PROXY_ENABLED // false' config.json)
    local chrome_port=$(jq -r '.CHROME_PORT // 9225' config.json)
    local proxy_port=$(jq -r '.CHROME_PROXY_PORT // 9224' config.json)

    log_info "CHROME_PROXY_ENABLED: $proxy_enabled"
    log_info "CHROME_PORT: $chrome_port"
    log_info "CHROME_PROXY_PORT: $proxy_port"

    if [ "$proxy_enabled" != "true" ]; then
        log_warn "Chrome Proxy is DISABLED in config.json"
        log_info "Set CHROME_PROXY_ENABLED: true for production use"
    fi

    return 0
}

# =============================================================================
# Service Functions
# =============================================================================

start_proxy() {
    print_header "STARTING CHROME PROXY SERVICE"

    # Validate Chrome first
    if ! validate_chrome; then
        log_error "Cannot start proxy: Chrome not accessible"
        return 1
    fi

    log_info "Starting proxy on ${PROXY_HOST}:${PROXY_PORT}..."

    if [ ! -f "scripts/chrome-proxy-service.js" ]; then
        log_error "scripts/chrome-proxy-service.js not found"
        return 1
    fi

    # Set environment variables for WSL
    export CHROME_PORT="${CHROME_PORT}"
    export CHROME_PROXY_PORT="${PROXY_PORT}"
    export PUBLIC_IP="0.0.0.0"  # Bind to all interfaces in WSL

    log_info "Environment:"
    log_info "  CHROME_PORT=${CHROME_PORT}"
    log_info "  CHROME_PROXY_PORT=${PROXY_PORT}"
    log_info "  PUBLIC_IP=${PUBLIC_IP}"

    node scripts/chrome-proxy-service.js
}

run_tests() {
    print_header "RUNNING INTEGRATION TESTS"

    # Validate Chrome first
    if ! validate_chrome; then
        log_error "Cannot run tests: Chrome not accessible"
        return 1
    fi

    log_info "Running test_chrome_proxy_integration.js..."

    if [ ! -f "tests/test_chrome_proxy_integration.js" ]; then
        log_error "tests/test_chrome_proxy_integration.js not found"
        return 1
    fi

    node tests/test_chrome_proxy_integration.js
}

# =============================================================================
# Main Workflow
# =============================================================================

run_all() {
    print_header "WSL CHROME INTEGRATION - FULL VALIDATION"

    local exit_code=0

    # Step 1: Validate Node.js
    if ! validate_node; then
        log_error "Node.js validation failed"
        exit_code=1
    fi

    # Step 2: Validate config
    if ! validate_config; then
        log_error "Configuration validation failed"
        exit_code=1
    fi

    # Step 3: Validate Chrome
    if ! validate_chrome; then
        log_error "Chrome validation failed"
        exit_code=1
    fi

    if [ $exit_code -eq 0 ]; then
        echo ""
        print_header "✅ ALL VALIDATIONS PASSED"
        echo ""
        log_success "WSL environment is ready!"
        log_success "Chrome is accessible from WSL!"
        echo ""
        log_info "Next steps:"
        log_info "1. Start proxy: bash wsl-chrome-integration.sh proxy"
        log_info "2. Run tests:   bash wsl-chrome-integration.sh test"
        log_info "3. Start system: npm run daemon:start"
        echo ""
    else
        echo ""
        print_header "❌ VALIDATION FAILED"
        echo ""
        log_error "Fix errors above and try again"
        echo ""
    fi

    return $exit_code
}

show_help() {
    cat << EOF

WSL Chrome Integration Script

USAGE:
    bash wsl-chrome-integration.sh <command>

COMMANDS:
    validate    Validate Chrome accessibility from WSL
    node        Validate Node.js environment
    config      Validate configuration files
    proxy       Start Chrome Proxy Service
    test        Run integration tests
    all         Run all validations
    help        Show this help

EXAMPLES:
    # Quick validation
    bash wsl-chrome-integration.sh validate

    # Full setup check
    bash wsl-chrome-integration.sh all

    # Start proxy (Chrome must be running on Windows)
    bash wsl-chrome-integration.sh proxy

ARCHITECTURE:
    Windows Host: Chrome (localhost:9225)
         ↓
    WSL:          Chrome Proxy (0.0.0.0:9224)
         ↓
    WSL:          Node.js System

PREREQUISITES:
    1. Chrome running on Windows Host (START-CHROME-SIMPLE.bat)
    2. Node.js installed in WSL
    3. npm dependencies installed (npm install)

EOF
}

# =============================================================================
# Main Entry Point
# =============================================================================

main() {
    local command="${1:-help}"

    case "$command" in
        validate)
            validate_chrome
            ;;
        node)
            validate_node
            ;;
        config)
            validate_config
            ;;
        proxy)
            start_proxy
            ;;
        test)
            run_tests
            ;;
        all)
            run_all
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Execute main
main "$@"
