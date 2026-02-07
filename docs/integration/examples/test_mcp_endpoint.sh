#!/bin/bash
# Test script for MCP endpoint
# Tests all MCP methods and tools

set -e

BASE_URL="http://localhost:3008/api/mcp"

echo "========================================="
echo "MCP Endpoint Test Script"
echo "========================================="
echo ""

# Test 1: Discovery (GET endpoint)
echo "[1/6] Testing Discovery Endpoint (GET /api/mcp)..."
curl -s "$BASE_URL" | jq '.'
echo ""

# Test 2: tools/list
echo "[2/6] Testing tools/list..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq '.result.tools | length'
echo ""

# Test 3: ollama_models
echo "[3/6] Testing ollama_models tool..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "ollama_models",
      "arguments": {}
    }
  }' | jq '.result.content[0].text' | head -20
echo ""

# Test 4: rag_health
echo "[4/6] Testing rag_health tool..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "rag_health",
      "arguments": {}
    }
  }' | jq '.result.content[0].text' | head -20
echo ""

# Test 5: rag_search
echo "[5/6] Testing rag_search tool..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "rag_search",
      "arguments": {
        "query": "CHROME_PROXY_PORT",
        "topK": 2
      }
    }
  }' | jq '.result.content[0].text' | head -30
echo ""

# Test 6: resources/read (rag://stats)
echo "[6/6] Testing resources/read (rag://stats)..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "resources/read",
    "params": {
      "uri": "rag://stats"
    }
  }' | jq '.result.contents[0].text | fromjson'
echo ""

echo "========================================="
echo "✅ All tests completed successfully!"
echo "========================================="
