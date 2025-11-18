#!/bin/bash

# Complete AWS Lambda Deployment Script for Storm Gate
# This script handles everything: build, push, deploy, and configure Lambda function

set -e  # Exit on any error

# Configuration - Update these values for your setup
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-storm-gate-lambda}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-storm-gate}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-lambda-execution-role}"
API_GATEWAY_NAME="${API_GATEWAY_NAME:-storm-gate-api}"
API_STAGE_NAME="${API_STAGE_NAME:-prod}"

# Load environment variables from .env file if it exists
load_env_file() {
    if [ -f ".env" ]; then
        print_status "Loading environment variables from .env file..."
        # Export variables from .env file, handling quotes and special characters
        set -a  # automatically export all variables
        source <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//')
        set +a  # stop automatically exporting
        print_success "Environment variables loaded from .env"
    else
        print_warning ".env file not found, using default/environment values"
    fi
}

# Environment Variables - Will be loaded from .env or use these defaults
MONGODB_URL="${MONGODB_URL:-mongodb+srv://username:password@cluster.mongodb.net/stormGate?retryWrites=true&w=majority}"
CLIENT_ID="${CLIENT_ID:-your-azure-client-id}"
TENANT_ID="${TENANT_ID:-your-azure-tenant-id}"
ACCESS_TOKEN_SECRET="${ACCESS_TOKEN_SECRET:-your-access-token-secret}"
REFRESH_TOKEN_SECRET="${REFRESH_TOKEN_SECRET:-your-refresh-token-secret}"
CLOUDINARY_CLOUD_NAME="${CLOUDINARY_CLOUD_NAME:-your-cloudinary-name}"
CLOUDINARY_API_KEY="${CLOUDINARY_API_KEY:-your-cloudinary-key}"
CLOUDINARY_API_SECRET="${CLOUDINARY_API_SECRET:-your-cloudinary-secret}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install it first."
        exit 1
    fi
    
    print_success "All dependencies are installed"
}

# Check if AWS credentials are configured
check_aws_credentials() {
    print_status "Checking AWS credentials..."
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials are not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    # Get AWS Account ID if not provided
    if [ -z "$AWS_ACCOUNT_ID" ]; then
        AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        print_status "Using AWS Account ID: $AWS_ACCOUNT_ID"
    fi
    
    print_success "AWS credentials are configured"
}

# Validate environment variables
validate_env_vars() {
    print_status "Validating environment variables..."
    
    local missing_vars=()
    
    if [[ "$MONGODB_URL" == *"username:password"* ]]; then
        missing_vars+=("MONGODB_URL")
    fi
    
    if [[ "$CLIENT_ID" == "your-azure-client-id" ]]; then
        missing_vars+=("CLIENT_ID")
    fi
    
    if [[ "$TENANT_ID" == "your-azure-tenant-id" ]]; then
        missing_vars+=("TENANT_ID")
    fi
    
    if [[ "$ACCESS_TOKEN_SECRET" == "your-access-token-secret" ]]; then
        missing_vars+=("ACCESS_TOKEN_SECRET")
    fi
    
    if [[ "$REFRESH_TOKEN_SECRET" == "your-refresh-token-secret" ]]; then
        missing_vars+=("REFRESH_TOKEN_SECRET")
    fi
    
    if [[ "$CLOUDINARY_CLOUD_NAME" == "your-cloudinary-name" ]]; then
        missing_vars+=("CLOUDINARY_CLOUD_NAME")
    fi
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_warning "The following environment variables need to be updated:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        print_warning "You can set them as environment variables or edit this script directly"
        print_warning "Continuing with placeholder values - Lambda function may not work until configured"
    else
        print_success "Environment variables validated"
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    
    npm install
    print_success "Dependencies installed"
}

# Create ECR repository if it doesn't exist
create_ecr_repository() {
    print_status "Checking if ECR repository exists..."
    
    if ! aws ecr describe-repositories --repository-names $ECR_REPOSITORY_NAME --region $AWS_REGION &> /dev/null; then
        print_status "Creating ECR repository: $ECR_REPOSITORY_NAME"
        aws ecr create-repository \
            --repository-name $ECR_REPOSITORY_NAME \
            --region $AWS_REGION \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256
        print_success "ECR repository created successfully"
    else
        print_success "ECR repository already exists"
    fi
}

# Login to ECR
ecr_login() {
    print_status "Logging in to ECR..."
    
    aws ecr get-login-password --region $AWS_REGION | \
        docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
    
    print_success "Successfully logged in to ECR"
}

# Build Lambda container image
build_lambda_image() {
    print_status "Building Lambda container image..."
    
    # Check if Lambda Dockerfile exists
    if [ ! -f "Dockerfile.lambda" ]; then
        print_error "Dockerfile.lambda not found. Please ensure it exists."
        exit 1
    fi
    
    # Build the image with correct architecture for Lambda
    docker build --platform linux/amd64 -f Dockerfile.lambda -t $ECR_REPOSITORY_NAME:$IMAGE_TAG .
    
    # Tag for ECR
    docker tag $ECR_REPOSITORY_NAME:$IMAGE_TAG \
        $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$IMAGE_TAG
    
    print_success "Lambda container image built and tagged successfully"
}

# Push image to ECR
push_image() {
    print_status "Pushing image to ECR..."
    
    docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$IMAGE_TAG
    
    print_success "Image pushed to ECR successfully"
}

# Create IAM role for Lambda if it doesn't exist
create_lambda_role() {
    print_status "Checking Lambda execution role..."
    
    if ! aws iam get-role --role-name $LAMBDA_ROLE_NAME &> /dev/null; then
        print_status "Creating Lambda execution role: $LAMBDA_ROLE_NAME"
        
        # Create trust policy
        cat > /tmp/trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        # Create role
        aws iam create-role \
            --role-name $LAMBDA_ROLE_NAME \
            --assume-role-policy-document file:///tmp/trust-policy.json
        
        # Attach basic execution policy
        aws iam attach-role-policy \
            --role-name $LAMBDA_ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        
        # Create and attach ECR access policy
        cat > /tmp/lambda-ecr-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:BatchCheckLayerAvailability"
            ],
            "Resource": "*"
        }
    ]
}
EOF
        
        # Create ECR policy
        aws iam create-policy \
            --policy-name LambdaECRAccessPolicy \
            --policy-document file:///tmp/lambda-ecr-policy.json &> /dev/null || true
        
        # Attach ECR policy
        aws iam attach-role-policy \
            --role-name $LAMBDA_ROLE_NAME \
            --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/LambdaECRAccessPolicy &> /dev/null || true
        
        # Wait for role to be available
        print_status "Waiting for IAM role to be available..."
        sleep 10
        
        print_success "Lambda execution role created successfully"
    else
        print_success "Lambda execution role already exists"
    fi
}

# Create or update Lambda function
deploy_lambda_function() {
    print_status "Deploying Lambda function..."
    
    local image_uri="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$IMAGE_TAG"
    local role_arn="arn:aws:iam::$AWS_ACCOUNT_ID:role/$LAMBDA_ROLE_NAME"
    
    # Check if function exists
    if aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION &> /dev/null; then
        print_status "Updating existing Lambda function..."
        
        # Update function code
        aws lambda update-function-code \
            --function-name $LAMBDA_FUNCTION_NAME \
            --image-uri $image_uri \
            --region $AWS_REGION
        
        # Update function configuration
        aws lambda update-function-configuration \
            --function-name $LAMBDA_FUNCTION_NAME \
            --timeout 30 \
            --memory-size 512 \
            --region $AWS_REGION
            
        print_success "Lambda function updated successfully"
    else
        print_status "Creating new Lambda function..."
        
        # Create function
        aws lambda create-function \
            --function-name $LAMBDA_FUNCTION_NAME \
            --package-type Image \
            --code ImageUri=$image_uri \
            --role $role_arn \
            --timeout 30 \
            --memory-size 512 \
            --region $AWS_REGION \
            --description "Storm Gate API - Express.js containerized for Lambda"
            
        print_success "Lambda function created successfully"
    fi
    
    # Wait for function to be ready
    print_status "Waiting for Lambda function to be ready..."
    sleep 15
}

# Configure environment variables
configure_environment() {
    print_status "Configuring Lambda environment variables..."
    
    # Wait for Lambda function to be in Active state before configuring
    print_status "Waiting for Lambda function to be ready for configuration..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local state=$(aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION --query 'Configuration.State' --output text 2>/dev/null || echo "Unknown")
        local update_status=$(aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION --query 'Configuration.LastUpdateStatus' --output text 2>/dev/null || echo "Unknown")
        
        if [ "$state" = "Active" ] && [ "$update_status" = "Successful" ]; then
            print_success "Lambda function is ready for configuration"
            break
        fi
        
        print_status "Function state: $state, Update status: $update_status (attempt $attempt/$max_attempts)"
        sleep 10
        attempt=$((attempt + 1))
    done
    
    if [ $attempt -gt $max_attempts ]; then
        print_warning "Function may still be updating, attempting configuration anyway..."
    fi
    
    # Create a temporary JSON file for environment variables
    cat > /tmp/lambda-env.json << EOF
{
    "Variables": {
        "NODE_ENV": "production",
        "MONGODB_URL": "$MONGODB_URL",
        "CLIENT_ID": "$CLIENT_ID",
        "TENANT_ID": "$TENANT_ID",
        "ACCESS_TOKEN_SECRET": "$ACCESS_TOKEN_SECRET",
        "REFRESH_TOKEN_SECRET": "$REFRESH_TOKEN_SECRET",
        "CLOUDINARY_CLOUD_NAME": "$CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY": "$CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET": "$CLOUDINARY_API_SECRET",
        "BASE_URL": "$BASE_URL"
    }
}
EOF
    
    # Update Lambda function configuration using the JSON file
    aws lambda update-function-configuration \
        --function-name $LAMBDA_FUNCTION_NAME \
        --region $AWS_REGION \
        --environment file:///tmp/lambda-env.json > /dev/null
    
    # Clean up temporary file
    rm -f /tmp/lambda-env.json
    
    print_success "Environment variables configured successfully"
}

# Create HTTP API Gateway
create_api_gateway() {
    print_status "Setting up API Gateway: $API_GATEWAY_NAME"
    
    # Check if API already exists
    local existing_api=$(aws apigatewayv2 get-apis --region $AWS_REGION --query "Items[?Name=='$API_GATEWAY_NAME'].ApiId" --output text)
    
    if [ ! -z "$existing_api" ] && [ "$existing_api" != "None" ]; then
        print_warning "API Gateway '$API_GATEWAY_NAME' already exists with ID: $existing_api"
        API_ID=$existing_api
    else
        # Create new API Gateway
        local api_response=$(aws apigatewayv2 create-api \
            --name $API_GATEWAY_NAME \
            --protocol-type HTTP \
            --target "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$LAMBDA_FUNCTION_NAME" \
            --region $AWS_REGION)
        
        API_ID=$(echo $api_response | jq -r '.ApiId')
        print_success "API Gateway created with ID: $API_ID"
    fi
    
    # Get API endpoint
    API_ENDPOINT=$(aws apigatewayv2 get-api --api-id $API_ID --region $AWS_REGION --query 'ApiEndpoint' --output text)
    print_success "API Gateway endpoint: $API_ENDPOINT"
}

# Add Lambda permission for API Gateway
add_lambda_permission() {
    print_status "Adding Lambda permission for API Gateway..."
    
    local statement_id="api-gateway-invoke-$(date +%s)"
    
    # Add permission (ignore error if already exists)
    aws lambda add-permission \
        --function-name $LAMBDA_FUNCTION_NAME \
        --statement-id $statement_id \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:$AWS_REGION:$AWS_ACCOUNT_ID:$API_ID/*/*" \
        --region $AWS_REGION &> /dev/null || print_warning "Permission may already exist"
    
    print_success "Lambda permission added for API Gateway"
}

# Create integration and routes
setup_api_gateway_routing() {
    print_status "Setting up API Gateway routing..."
    
    # Get existing integrations
    local integrations=$(aws apigatewayv2 get-integrations --api-id $API_ID --region $AWS_REGION --query 'Items[0].IntegrationId' --output text)
    
    if [ "$integrations" == "None" ] || [ -z "$integrations" ]; then
        print_status "Creating Lambda integration..."
        
        local integration_response=$(aws apigatewayv2 create-integration \
            --api-id $API_ID \
            --integration-type AWS_PROXY \
            --integration-uri "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$LAMBDA_FUNCTION_NAME" \
            --payload-format-version "2.0" \
            --region $AWS_REGION)
        
        INTEGRATION_ID=$(echo $integration_response | jq -r '.IntegrationId')
        print_success "Integration created with ID: $INTEGRATION_ID"
    else
        INTEGRATION_ID=$integrations
        print_success "Integration already exists"
    fi
    
    # Check if default route exists
    local existing_route=$(aws apigatewayv2 get-routes --api-id $API_ID --region $AWS_REGION --query "Items[?RouteKey=='\$default'].RouteId" --output text)
    
    if [ "$existing_route" == "None" ] || [ -z "$existing_route" ]; then
        print_status "Creating default route..."
        
        aws apigatewayv2 create-route \
            --api-id $API_ID \
            --route-key '$default' \
            --target "integrations/$INTEGRATION_ID" \
            --region $AWS_REGION > /dev/null
        
        print_success "Default route created"
    else
        print_success "Default route already exists"
    fi
    
    # Create deployment stage
    local existing_stage=$(aws apigatewayv2 get-stages --api-id $API_ID --region $AWS_REGION --query "Items[?StageName=='$API_STAGE_NAME'].StageName" --output text)
    
    if [ "$existing_stage" == "None" ] || [ -z "$existing_stage" ]; then
        aws apigatewayv2 create-stage \
            --api-id $API_ID \
            --stage-name $API_STAGE_NAME \
            --auto-deploy \
            --region $AWS_REGION > /dev/null
        
        print_success "Stage '$API_STAGE_NAME' created with auto-deploy enabled"
    else
        print_success "Stage '$API_STAGE_NAME' already exists"
    fi
}

# Test Lambda function and API Gateway
test_deployment() {
    print_status "Testing deployment..."
    
    # Wait a bit for deployment to be ready
    sleep 10
    
    # Test Lambda function directly
    print_status "Testing Lambda function directly..."
    if aws lambda invoke \
        --function-name $LAMBDA_FUNCTION_NAME \
        --region $AWS_REGION \
        --cli-binary-format raw-in-base64-out \
        --payload '{"httpMethod":"GET","path":"/health"}' \
        /tmp/response.json &> /dev/null; then
        
        # Check response
        if grep -q '"statusCode":200\|"status":"Server is up and running"' /tmp/response.json; then
            print_success "Lambda function test successful!"
        else
            print_warning "Lambda function responded but may have issues:"
            cat /tmp/response.json | jq . 2>/dev/null || cat /tmp/response.json
        fi
    else
        print_warning "Lambda function test failed. Check CloudWatch logs for details."
    fi
    
    # Test API Gateway endpoints
    if [ ! -z "$API_ENDPOINT" ]; then
        print_status "Testing API Gateway endpoints..."
        
        local health_status=$(curl -s -o /dev/null -w "%{http_code}" "$API_ENDPOINT/health" || echo "000")
        if [ "$health_status" == "200" ]; then
            print_success "API Gateway health endpoint working: $API_ENDPOINT/health"
        else
            print_warning "API Gateway health endpoint returned status: $health_status"
        fi
        
        local docs_status=$(curl -s -o /dev/null -w "%{http_code}" "$API_ENDPOINT/api-docs/" || echo "000")
        if [ "$docs_status" == "200" ]; then
            print_success "API Gateway docs endpoint working: $API_ENDPOINT/api-docs/"
        else
            print_warning "API Gateway docs endpoint returned status: $docs_status"
        fi
    fi
    
    # Clean up test files
    rm -f /tmp/response.json /tmp/trust-policy.json /tmp/lambda-ecr-policy.json
}

# Display deployment information
display_info() {
    echo ""
    print_success "🎉 Complete Lambda deployment finished!"
    echo ""
    echo "📋 Deployment Summary:"
    echo "  Function Name: $LAMBDA_FUNCTION_NAME"
    echo "  Image URI: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$IMAGE_TAG"
    echo "  Region: $AWS_REGION"
    echo "  Memory: 512MB"
    echo "  Timeout: 30 seconds"
    
    if [ ! -z "$API_ENDPOINT" ]; then
        echo ""
        echo "🌐 API Gateway Information:"
        echo "  API Name: $API_GATEWAY_NAME"
        echo "  API ID: $API_ID"
        echo "  API URL: $API_ENDPOINT"
        echo ""
        echo "🔗 Live Endpoints:"
        echo "  Health Check: $API_ENDPOINT/health"
        echo "  API Documentation: $API_ENDPOINT/api-docs/"
        echo "  Authentication: $API_ENDPOINT/auth/*"
        echo "  File Upload: $API_ENDPOINT/api/*"
        echo "  User Management: $API_ENDPOINT/api/user/*"
        echo ""
        echo "🧪 Test Commands:"
        echo "  curl $API_ENDPOINT/health"
        echo "  curl $API_ENDPOINT/api-docs/"
        echo ""
        echo "⚠️  Azure AD Update Required:"
        echo "  Add this redirect URI to your Azure AD app:"
        echo "  $API_ENDPOINT/auth/callback"
    else
        echo ""
        echo "🧪 Test Commands:"
        echo "  Health Check:"
        echo "    aws lambda invoke --function-name $LAMBDA_FUNCTION_NAME --cli-binary-format raw-in-base64-out --payload '{\"httpMethod\":\"GET\",\"path\":\"/health\"}' response.json"
        echo ""
        echo "  API Docs:"
        echo "    aws lambda invoke --function-name $LAMBDA_FUNCTION_NAME --cli-binary-format raw-in-base64-out --payload '{\"httpMethod\":\"GET\",\"path\":\"/api-docs\"}' response.json"
    fi
    echo ""
    echo "📊 Monitoring:"
    echo "  View logs: aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --follow --region $AWS_REGION"
    echo "  Function URL: https://console.aws.amazon.com/lambda/home?region=$AWS_REGION#/functions/$LAMBDA_FUNCTION_NAME"
    echo ""
    echo "🚀 Next Steps:"
    echo "  1. ✅ Lambda function is deployed and configured"
    echo "  2. 🔧 Set up API Gateway for HTTP endpoints (optional)"
    echo "  3. 🌐 Configure custom domain and SSL certificate"
    echo "  4. 📈 Set up monitoring and alerting"
    echo "  5. 🔒 Review and tighten IAM permissions"
    echo ""
    echo "💡 Tips:"
    echo "  - Update environment variables: Edit this script and re-run"
    echo "  - Update code: Re-run this script to rebuild and deploy"
    echo "  - Monitor performance: Check CloudWatch metrics"
    echo ""
}

# Show help
show_help() {
    echo "Complete AWS Lambda Deployment Script for Storm Gate"
    echo "=================================================="
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --region REGION          AWS region (default: us-east-1)"
    echo "  --repository NAME        ECR repository name (default: storm-gate-lambda)"
    echo "  --function-name NAME     Lambda function name (default: storm-gate)"
    echo "  --tag TAG               Image tag (default: latest)"
    echo "  --account-id ID         AWS Account ID (auto-detected if not provided)"
    echo "  --role-name NAME        IAM role name (default: lambda-execution-role)"
    echo "  --skip-test             Skip function testing"
    echo "  --skip-api-gateway      Skip API Gateway setup"
    echo "  --api-gateway-only      Only set up API Gateway (requires existing Lambda function)"
    echo "  --help                  Show this help message"
    echo ""
    echo "Environment Variables (set these before running):"
    echo "  MONGODB_URL             MongoDB connection string"
    echo "  CLIENT_ID               Azure AD Client ID"
    echo "  TENANT_ID               Azure AD Tenant ID"
    echo "  ACCESS_TOKEN_SECRET     JWT access token secret"
    echo "  REFRESH_TOKEN_SECRET    JWT refresh token secret"
    echo "  CLOUDINARY_CLOUD_NAME   Cloudinary cloud name"
    echo "  CLOUDINARY_API_KEY      Cloudinary API key"
    echo "  CLOUDINARY_API_SECRET   Cloudinary API secret"
    echo ""
    echo "Example:"
    echo "  export MONGODB_URL='mongodb+srv://user:pass@cluster.mongodb.net/db'"
    echo "  export CLIENT_ID='your-azure-client-id'"
    echo "  $0 --function-name my-api --region us-west-2"
}

# Main execution
main() {
    echo "🚀 Complete AWS Lambda Deployment Script for Storm Gate"
    echo "======================================================="
    echo ""
    
    local SKIP_TEST=false
    local SKIP_API_GATEWAY=false
    local API_GATEWAY_ONLY=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --region)
                AWS_REGION="$2"
                shift 2
                ;;
            --repository)
                ECR_REPOSITORY_NAME="$2"
                shift 2
                ;;
            --function-name)
                LAMBDA_FUNCTION_NAME="$2"
                shift 2
                ;;
            --tag)
                IMAGE_TAG="$2"
                shift 2
                ;;
            --account-id)
                AWS_ACCOUNT_ID="$2"
                shift 2
                ;;
            --role-name)
                LAMBDA_ROLE_NAME="$2"
                shift 2
                ;;
            --skip-test)
                SKIP_TEST=true
                shift
                ;;
            --skip-api-gateway)
                SKIP_API_GATEWAY=true
                shift
                ;;
            --api-gateway-only)
                API_GATEWAY_ONLY=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Execute deployment steps based on options
    check_dependencies
    check_aws_credentials
    
    if [ "$API_GATEWAY_ONLY" = true ]; then
        print_status "API Gateway only mode - setting up API Gateway for existing Lambda function"
        create_api_gateway
        add_lambda_permission
        setup_api_gateway_routing
        
        if [ "$SKIP_TEST" = false ]; then
            test_deployment
        fi
    else
        # Full deployment
        load_env_file
        validate_env_vars
        install_dependencies
        create_ecr_repository
        create_lambda_role
        ecr_login
        build_lambda_image
        push_image
        deploy_lambda_function
        configure_environment
        
        # Set up API Gateway unless skipped
        if [ "$SKIP_API_GATEWAY" = false ]; then
            create_api_gateway
            add_lambda_permission
            setup_api_gateway_routing
        fi
        
        if [ "$SKIP_TEST" = false ]; then
            test_deployment
        fi
    fi
    
    display_info
}

# Run the main function
main "$@"
