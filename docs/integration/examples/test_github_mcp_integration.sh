#!/bin/bash
# Test script for GitHub MCP + Our MCP Integration
# Tests both servers working together

set -e

BASE_URL="http://localhost:3008/api/mcp"
ROOT_URL="${BASE_URL%/api/mcp}"

echo "========================================="
echo "MCP Integration Test: Local + GitHub"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function for section header
section() {
    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Helper function for test result
check_result() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $1"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $1"
        ((FAILED++))
    fi
}

# Test 1: Our MCP Server - Discovery
section "[1/7] Testing Our MCP Server - Discovery"
curl -sf "$BASE_URL" | jq -e '.name == "chatgpt-docker-unified"' > /dev/null
check_result "Discovery endpoint returns correct server name"

# Test 2: Our MCP Server - List Tools
section "[2/7] Testing Our MCP Server - List Tools"
TOOL_COUNT=$(curl -sf -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq -r '.result.tools | length')

if [ "$TOOL_COUNT" -ge 5 ]; then
    echo -e "${GREEN}✓ PASS${NC}: Found $TOOL_COUNT tools (expected >= 5)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}: Found only $TOOL_COUNT tools (expected >= 5)"
    ((FAILED++))
fi

# Test 3: Our MCP Server - RAG Search
section "[3/7] Testing Our MCP Server - rag_search tool"
RAG_RESULT=$(curl -sf -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "rag_search",
      "arguments": {
        "query": "MCP",
        "topK": 3
      }
    }
  }' | jq -r '.result.content[0].text')

if echo "$RAG_RESULT" | grep -q "Search Results"; then
    echo -e "${GREEN}✓ PASS${NC}: rag_search executed successfully"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}: rag_search failed or returned unexpected format"
    ((FAILED++))
fi

# Test 4: Our MCP Server - Ollama Models
section "[4/7] Testing Our MCP Server - ollama_models tool"
OLLAMA_RESULT=$(curl -sf -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "ollama_models",
      "arguments": {}
    }
  }' | jq -r '.result.content[0].text')

if echo "$OLLAMA_RESULT" | grep -q "Available Ollama Models"; then
    echo -e "${GREEN}✓ PASS${NC}: ollama_models executed successfully"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}: ollama_models failed or returned unexpected format"
    ((FAILED++))
fi

# Test 5: Check if GitHub MCP Server is Installed
section "[5/7] Testing GitHub MCP Server - Installation"
if command -v npx &> /dev/null; then
    echo -e "${GREEN}✓ PASS${NC}: npx is available"
    ((PASSED++))

    # Test if GitHub MCP package exists
    if npx -y @modelcontextprotocol/server-github --version 2>&1 | grep -q "version"; then
        echo -e "${GREEN}✓ INFO${NC}: GitHub MCP Server is installed"
    else
        echo -e "${YELLOW}⚠ WARN${NC}: GitHub MCP Server not found. Install with:"
        echo "  npm install -g @modelcontextprotocol/server-github"
    fi
else
    echo -e "${RED}✗ FAIL${NC}: npx not available"
    ((FAILED++))
fi

# Test 6: Check GitHub Token Configuration
section "[6/7] Testing GitHub Token Configuration"
if [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
    TOKEN_LEN=${#GITHUB_PERSONAL_ACCESS_TOKEN}
    if [ $TOKEN_LEN -gt 20 ]; then
        echo -e "${GREEN}✓ PASS${NC}: GITHUB_PERSONAL_ACCESS_TOKEN is set (length: $TOKEN_LEN)"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠ WARN${NC}: GITHUB_PERSONAL_ACCESS_TOKEN seems invalid (too short)"
        ((FAILED++))
    fi
else
    echo -e "${YELLOW}⚠ SKIP${NC}: GITHUB_PERSONAL_ACCESS_TOKEN not set"
    echo "  Generate token at: https://github.com/settings/tokens/new"
    echo "  Required scopes: repo, read:org, user"
fi

# Test 7: Check Upstream Configuration
section "[7/7] Testing MCP Upstream Configuration"
GITHUB_PROXY_ENABLED_ENV="${MCP_GITHUB_PROXY_ENABLED:-}"
GITHUB_TOOL_PREFIX_ENV="${MCP_GITHUB_TOOL_PREFIX:-}"

GITHUB_PROXY_ENABLED_FILE=$(grep -E "^MCP_GITHUB_PROXY_ENABLED=" .env.development 2>/dev/null | cut -d'=' -f2)
GITHUB_TOOL_PREFIX_FILE=$(grep -E "^MCP_GITHUB_TOOL_PREFIX=" .env.development 2>/dev/null | cut -d'=' -f2)
UPSTREAMS_JSON_FILE=$(grep -E "^MCP_UPSTREAMS_JSON=" .env.development 2>/dev/null | cut -d'=' -f2-)

GITHUB_PROXY_ENABLED="${GITHUB_PROXY_ENABLED_ENV:-${GITHUB_PROXY_ENABLED_FILE:-false}}"
GITHUB_TOOL_PREFIX="${GITHUB_TOOL_PREFIX_ENV:-${GITHUB_TOOL_PREFIX_FILE:-mcp_github__}}"

READY_UPSTREAMS=$(curl -sf "${ROOT_URL}/ready" | jq -c '.mcp.upstreams // []' 2>/dev/null || echo "[]")
echo "  /ready mcp.upstreams: ${READY_UPSTREAMS}"

TOOLS_LIST=$(curl -sf -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 99,
    "method": "tools/list",
    "params": {}
  }')

GITHUB_PROXY_TOOL_COUNT=$(echo "$TOOLS_LIST" | jq -r --arg pfx "$GITHUB_TOOL_PREFIX" '.result.tools[].name | select(startswith($pfx))' 2>/dev/null | wc -l | tr -d ' ')

if [ "$GITHUB_PROXY_ENABLED" = "true" ]; then
    echo -e "${GREEN}✓ INFO${NC}: GitHub MCP Proxy is ENABLED (prefix: ${GITHUB_TOOL_PREFIX})"
    if [ "$GITHUB_PROXY_TOOL_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: Found $GITHUB_PROXY_TOOL_COUNT GitHub-proxied tool(s) (${GITHUB_TOOL_PREFIX}*)"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠ WARN${NC}: Proxy enabled but no tools found with prefix (${GITHUB_TOOL_PREFIX}*)"
        echo "  Check: GITHUB_PERSONAL_ACCESS_TOKEN, upstream stderr, /ready payload"
    fi
else
    if [ -n "$UPSTREAMS_JSON_FILE" ]; then
        echo -e "${YELLOW}⚠ INFO${NC}: MCP_UPSTREAMS_JSON is set in .env.development (custom upstreams)."
    else
        echo -e "${YELLOW}⚠ INFO${NC}: GitHub MCP Proxy is DISABLED"
        echo "  To enable GitHub proxy mode (server-side):"
        echo "    1. Set MCP_GITHUB_PROXY_ENABLED=true"
        echo "    2. Set GITHUB_PERSONAL_ACCESS_TOKEN"
        echo "    3. Restart the server"
    fi
fi

# Summary
echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
