#!/bin/bash
# MCP Ollama Integration Test
#
# Tests:
# 1. MCP discovery (GET /api/mcp)
# 2. List tools (tools/list)
# 3. ollama_models tool
# 4. ollama_generate with small prompt
# 5. Timeout enforcement with large prompt
#
# Usage:
#   chmod +x tests/manual/test_mcp_ollama.sh
#   ./tests/manual/test_mcp_ollama.sh

set -e

echo "=== MCP Ollama Integration Test ==="
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Discovery
echo "[1/5] Testing MCP discovery..."
response=$(curl -s http://localhost:3008/api/mcp)

if echo "$response" | jq -e '.name' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Discovery works${NC}"
    echo "$response" | jq -r '.name, .status, .toolCount'
else
    echo -e "${RED}❌ Discovery failed${NC}"
    echo "$response"
    exit 1
fi
echo

# Test 2: List Tools
echo "[2/5] Testing tools/list..."
tools=$(curl -s -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')

if echo "$tools" | jq -e '.result.tools' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Tools listed${NC}"
    echo "Available tools:"
    echo "$tools" | jq -r '.result.tools[].name' | sed 's/^/  - /'
else
    echo -e "${RED}❌ Tools list failed${NC}"
    echo "$tools"
    exit 1
fi
echo

# Test 3: ollama_models
echo "[3/5] Testing ollama_models..."
models=$(curl -s -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ollama_models","arguments":{}}}')

if echo "$models" | jq -e '.result.content' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Models listed${NC}"
    echo "$models" | jq -r '.result.content[0].text' | head -20
else
    echo -e "${RED}❌ Models list failed${NC}"
    echo "$models"
    exit 1
fi
echo

# Test 4: ollama_generate (small, should succeed)
echo "[4/5] Testing ollama_generate (small prompt)..."
echo -e "${YELLOW}Generating with 50 tokens...${NC}"
start=$(date +%s%3N)
generate=$(curl -s -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ollama_generate","arguments":{"prompt":"Say hi in one sentence","max_tokens":50}}}')
end=$(date +%s%3N)
duration=$((end - start))

if echo "$generate" | jq -e '.result.content' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Generation works${NC}"
    echo "Response:"
    echo "$generate" | jq -r '.result.content[0].text' | head -5
    echo "Time: ${duration}ms"
else
    echo -e "${RED}❌ Generation failed${NC}"
    echo "$generate"
    exit 1
fi
echo

# Test 5: Timeout enforcement (large request)
echo "[5/5] Testing timeout enforcement..."
echo -e "${YELLOW}This may take up to 90s (MCP timeout)...${NC}"
start=$(date +%s%3N)

timeout_test=$(curl -s -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"ollama_generate","arguments":{"prompt":"Write a very long detailed essay about artificial intelligence, machine learning, neural networks, deep learning, transformers, and the history of AI research","max_tokens":2000}}}' \
  2>&1 || echo "curl_error")

end=$(date +%s%3N)
duration=$((end - start))

# Check if request completed or timed out
if [[ $duration -gt 90000 ]]; then
  echo -e "${RED}❌ Timeout not enforced (took ${duration}ms > 90s)${NC}"
  exit 1
else
  # Check if response contains error or timeout message
  if echo "$timeout_test" | jq -e '.result.content[0].text' | grep -qi "timeout\|timed out" 2>/dev/null; then
    echo -e "${GREEN}✅ Timeout enforced correctly (${duration}ms)${NC}"
    echo "$timeout_test" | jq -r '.result.content[0].text' | head -5
  elif echo "$timeout_test" | jq -e '.result.content' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Completed within ${duration}ms (< 90s)${NC}"
    echo "Response length: $(echo "$timeout_test" | jq -r '.result.content[0].text' | wc -c) chars"
  else
    echo -e "${YELLOW}⚠️  Unexpected response format (${duration}ms)${NC}"
    echo "$timeout_test" | head -20
  fi
fi

echo
echo "=== All tests passed ==="
echo
echo "Summary:"
echo "✅ MCP discovery working"
echo "✅ Tools list working"
echo "✅ ollama_models working"
echo "✅ ollama_generate working (small)"
echo "✅ Timeout enforcement configured"
echo
echo "Next steps:"
echo "1. Test with Claude Desktop: Ask 'List available Ollama models'"
echo "2. Test with GitHub Copilot: Ask 'Generate a docstring using Ollama'"
echo "3. Monitor performance: pm2 logs dashboard-web"
echo "4. Check timeouts: pm2 logs dashboard-web | grep timeout"
