#!/bin/bash

# Lambda Auth Endpoints Test Script
# Usage: ./test-lambda-auth.sh [your-email] [your-password]

LAMBDA_URL="https://3ynqb3302m.execute-api.us-east-1.amazonaws.com"
EMAIL="${1:-test@example.com}"
PASSWORD="${2:-password123}"

echo "🧪 Testing Lambda Authentication Endpoints"
echo "=========================================="
echo ""

# Test 1: Health Check
echo "1️⃣  Testing Health Endpoint..."
echo "   GET $LAMBDA_URL/health"
curl -s -X GET "$LAMBDA_URL/health" | jq '.' || echo "Failed"
echo ""
echo ""

# Test 2: Register (optional - creates test user)
echo "2️⃣  Testing Register Endpoint..."
echo "   POST $LAMBDA_URL/register"
REGISTER_RESPONSE=$(curl -s -X POST "$LAMBDA_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"application\":\"TestApp\"}")
echo "$REGISTER_RESPONSE" | jq '.' 2>/dev/null || echo "$REGISTER_RESPONSE"
echo ""
echo ""

# Test 3: Login
echo "3️⃣  Testing Login Endpoint..."
echo "   POST $LAMBDA_URL/login"
LOGIN_RESPONSE=$(curl -s -X POST "$LAMBDA_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"

# Extract token
TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accesstoken' 2>/dev/null)

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
    echo "❌ Login failed - no token received"
    echo "   Response: $LOGIN_RESPONSE"
    echo ""
    echo "💡 Tips:"
    echo "   - Make sure you registered first, or use existing credentials"
    echo "   - Try: ./test-lambda-auth.sh your@email.com yourpassword"
    exit 1
else
    echo "✅ Token received: ${TOKEN:0:50}..."
fi
echo ""
echo ""

# Test 4: Get Me (Protected)
echo "4️⃣  Testing /me Endpoint (Protected)..."
echo "   GET $LAMBDA_URL/me"
echo "   Authorization: Bearer ${TOKEN:0:50}..."
ME_RESPONSE=$(curl -s -X GET "$LAMBDA_URL/me" \
  -H "Authorization: Bearer $TOKEN")
echo "$ME_RESPONSE" | jq '.' 2>/dev/null || echo "$ME_RESPONSE"
echo ""
echo ""

# Test 5: Check Status
echo "5️⃣  Testing Check Status Endpoint..."
echo "   POST $LAMBDA_URL/check-status"
curl -s -X POST "$LAMBDA_URL/check-status" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}" | jq '.' 2>/dev/null || echo "Failed"
echo ""
echo ""

# Test 6: Forgot Password
echo "6️⃣  Testing Forgot Password Endpoint..."
echo "   POST $LAMBDA_URL/forgot-password"
FORGOT_RESPONSE=$(curl -s -X POST "$LAMBDA_URL/forgot-password" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}")
echo "$FORGOT_RESPONSE" | jq '.' 2>/dev/null || echo "$FORGOT_RESPONSE"
echo ""
echo ""

# Test 7: Verify Reset Token (using a dummy token for testing)
echo "7️⃣  Testing Verify Reset Token Endpoint..."
echo "   POST $LAMBDA_URL/verify-reset-token"
echo "   (Testing with invalid token to verify endpoint exists)"
VERIFY_TOKEN_RESPONSE=$(curl -s -X POST "$LAMBDA_URL/verify-reset-token" \
  -H "Content-Type: application/json" \
  -d '{"token":"dummy-token-for-testing"}')
echo "$VERIFY_TOKEN_RESPONSE" | jq '.' 2>/dev/null || echo "$VERIFY_TOKEN_RESPONSE"
echo ""
echo ""

# Test 8: Reset Password (using dummy token for testing)
echo "8️⃣  Testing Reset Password Endpoint..."
echo "   POST $LAMBDA_URL/reset-password"
echo "   (Testing with invalid token to verify endpoint exists)"
RESET_PASSWORD_RESPONSE=$(curl -s -X POST "$LAMBDA_URL/reset-password" \
  -H "Content-Type: application/json" \
  -d '{"token":"dummy-token-for-testing","password":"newpassword123"}')
echo "$RESET_PASSWORD_RESPONSE" | jq '.' 2>/dev/null || echo "$RESET_PASSWORD_RESPONSE"
echo ""
echo ""

# Summary
echo "=========================================="
echo "✅ Test Complete!"
echo ""
echo "📋 Endpoints Tested:"
echo "   ✓ /health"
echo "   ✓ /register"
echo "   ✓ /login"
echo "   ✓ /me (protected)"
echo "   ✓ /check-status"
echo "   ✓ /forgot-password"
echo "   ✓ /verify-reset-token"
echo "   ✓ /reset-password"
echo ""
echo "🔑 Your access token (save for manual testing):"
echo "$TOKEN"
echo ""
echo "📖 Manual test example:"
echo "   curl -X GET $LAMBDA_URL/me \\"
echo "     -H \"Authorization: Bearer $TOKEN\""
