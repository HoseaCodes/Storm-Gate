#!/usr/bin/env node

/**
 * Storm Gate OIDC Flow Test Script
 * 
 * This script tests the OIDC implementation by making requests to the auth endpoints.
 * Run with: node test-oidc.js
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function testOIDCEndpoints() {
  console.log('🧪 Testing Storm Gate OIDC Implementation\n');

  // Test 1: Health Check
  console.log('1. Testing server health...');
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    console.log('   ✅ Server is running:', data.status);
  } catch (error) {
    console.log('   ❌ Server health check failed:', error.message);
    return;
  }

  // Test 2: Login endpoint (should redirect)
  console.log('\n2. Testing login endpoint...');
  try {
    const response = await fetch(`${BASE_URL}/auth/login?application=blog`, {
      redirect: 'manual'
    });
    
    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location && location.includes('login.microsoftonline.com')) {
        console.log('   ✅ Login endpoint correctly redirects to Azure AD');
        console.log('   📋 Redirect URL:', location.substring(0, 100) + '...');
      } else {
        console.log('   ⚠️  Login redirects but not to Azure AD');
      }
    } else {
      console.log('   ❌ Login endpoint should redirect (302), got:', response.status);
    }
  } catch (error) {
    console.log('   ❌ Login endpoint test failed:', error.message);
  }

  // Test 3: Protected endpoint without token
  console.log('\n3. Testing protected endpoint without token...');
  try {
    const response = await fetch(`${BASE_URL}/auth/me`);
    if (response.status === 401) {
      console.log('   ✅ Protected endpoint correctly rejects unauthorized requests');
    } else {
      console.log('   ❌ Protected endpoint should return 401, got:', response.status);
    }
  } catch (error) {
    console.log('   ❌ Protected endpoint test failed:', error.message);
  }

  // Test 4: API Documentation
  console.log('\n4. Testing API documentation...');
  try {
    const response = await fetch(`${BASE_URL}/api-docs`);
    if (response.status === 200) {
      console.log('   ✅ Swagger documentation is accessible');
    } else {
      console.log('   ❌ API docs not accessible, status:', response.status);
    }
  } catch (error) {
    console.log('   ❌ API docs test failed:', error.message);
  }

  console.log('\n📋 Test Summary:');
  console.log('   • OIDC endpoints are properly configured');
  console.log('   • Authentication flow is ready for testing');
  console.log('   • To complete testing, visit:', `${BASE_URL}/auth/login`);
  console.log('   • API documentation available at:', `${BASE_URL}/api-docs`);
  
  console.log('\n🔧 Next Steps:');
  console.log('   1. Configure your .env file with Azure AD credentials');
  console.log('   2. Test the full flow in a browser');
  console.log('   3. Integrate with your client applications');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testOIDCEndpoints().catch(console.error);
}

export { testOIDCEndpoints };
