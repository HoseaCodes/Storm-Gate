#!/bin/bash

# AWS Lambda Resource Cleanup Script for Storm Gate
# This script removes all AWS resources created by the Lambda deployment

set -e  # Exit on any error

# Configuration - Update these values to match your deployment
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-storm-gate-lambda}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-storm-gate}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-lambda-execution-role}"
API_GATEWAY_NAME="${API_GATEWAY_NAME:-storm-gate-api}"
ECR_POLICY_NAME="LambdaECRAccessPolicy"

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

# Check if AWS credentials are configured
check_aws_credentials() {
    print_status "Checking AWS credentials..."
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials are not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    # Get AWS Account ID
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_status "Using AWS Account ID: $AWS_ACCOUNT_ID"
    
    print_success "AWS credentials are configured"
}

# Confirm deletion with user
confirm_deletion() {
    echo ""
    print_warning "⚠️  WARNING: This will DELETE the following AWS resources:"
    echo ""
    echo "  🗑️  Lambda Function: $LAMBDA_FUNCTION_NAME"
    echo "  🗑️  API Gateway: $API_GATEWAY_NAME"
    echo "  🗑️  ECR Repository: $ECR_REPOSITORY_NAME (and all images)"
    echo "  🗑️  IAM Role: $LAMBDA_ROLE_NAME"
    echo "  🗑️  IAM Policy: $ECR_POLICY_NAME"
    echo "  🗑️  CloudWatch Log Group: /aws/lambda/$LAMBDA_FUNCTION_NAME"
    echo ""
    print_warning "This action CANNOT be undone!"
    echo ""
    
    read -p "Are you sure you want to delete all these resources? (type 'DELETE' to confirm): " confirmation
    
    if [ "$confirmation" != "DELETE" ]; then
        print_status "Cleanup cancelled by user"
        exit 0
    fi
    
    print_status "Proceeding with resource deletion..."
}

# Delete Lambda function
delete_lambda_function() {
    print_status "Deleting Lambda function: $LAMBDA_FUNCTION_NAME"
    
    if aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION &> /dev/null; then
        aws lambda delete-function \
            --function-name $LAMBDA_FUNCTION_NAME \
            --region $AWS_REGION
        print_success "Lambda function deleted successfully"
    else
        print_warning "Lambda function '$LAMBDA_FUNCTION_NAME' not found (may already be deleted)"
    fi
}

# Delete API Gateway
delete_api_gateway() {
    print_status "Deleting API Gateway: $API_GATEWAY_NAME"
    
    local api_id=$(aws apigatewayv2 get-apis --region $AWS_REGION --query "Items[?Name=='$API_GATEWAY_NAME'].ApiId" --output text 2>/dev/null || echo "")
    
    if [ ! -z "$api_id" ] && [ "$api_id" != "None" ]; then
        aws apigatewayv2 delete-api \
            --api-id $api_id \
            --region $AWS_REGION
        print_success "API Gateway deleted successfully"
    else
        print_warning "API Gateway '$API_GATEWAY_NAME' not found (may already be deleted)"
    fi
}

# Delete CloudWatch Log Group
delete_log_group() {
    print_status "Deleting CloudWatch log group: /aws/lambda/$LAMBDA_FUNCTION_NAME"
    
    if aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/$LAMBDA_FUNCTION_NAME" --region $AWS_REGION --query 'logGroups[0]' --output text | grep -q "/aws/lambda/$LAMBDA_FUNCTION_NAME"; then
        aws logs delete-log-group \
            --log-group-name "/aws/lambda/$LAMBDA_FUNCTION_NAME" \
            --region $AWS_REGION
        print_success "CloudWatch log group deleted successfully"
    else
        print_warning "CloudWatch log group not found (may already be deleted)"
    fi
}

# Delete ECR repository and all images
delete_ecr_repository() {
    print_status "Deleting ECR repository: $ECR_REPOSITORY_NAME"
    
    if aws ecr describe-repositories --repository-names $ECR_REPOSITORY_NAME --region $AWS_REGION &> /dev/null; then
        # Delete repository and all images
        aws ecr delete-repository \
            --repository-name $ECR_REPOSITORY_NAME \
            --region $AWS_REGION \
            --force
        print_success "ECR repository and all images deleted successfully"
    else
        print_warning "ECR repository '$ECR_REPOSITORY_NAME' not found (may already be deleted)"
    fi
}

# Delete IAM policy
delete_iam_policy() {
    print_status "Deleting IAM policy: $ECR_POLICY_NAME"
    
    local policy_arn="arn:aws:iam::$AWS_ACCOUNT_ID:policy/$ECR_POLICY_NAME"
    
    if aws iam get-policy --policy-arn $policy_arn &> /dev/null; then
        # First detach from role if attached
        if aws iam list-entities-for-policy --policy-arn $policy_arn --query 'PolicyRoles[0].RoleName' --output text | grep -q "$LAMBDA_ROLE_NAME"; then
            print_status "Detaching policy from role: $LAMBDA_ROLE_NAME"
            aws iam detach-role-policy \
                --role-name $LAMBDA_ROLE_NAME \
                --policy-arn $policy_arn
        fi
        
        # Delete policy
        aws iam delete-policy --policy-arn $policy_arn
        print_success "IAM policy deleted successfully"
    else
        print_warning "IAM policy '$ECR_POLICY_NAME' not found (may already be deleted)"
    fi
}

# Delete IAM role
delete_iam_role() {
    print_status "Deleting IAM role: $LAMBDA_ROLE_NAME"
    
    if aws iam get-role --role-name $LAMBDA_ROLE_NAME &> /dev/null; then
        # Detach managed policies
        print_status "Detaching managed policies from role..."
        
        # Detach AWS managed policy
        aws iam detach-role-policy \
            --role-name $LAMBDA_ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole &> /dev/null || true
        
        # Delete role
        aws iam delete-role --role-name $LAMBDA_ROLE_NAME
        print_success "IAM role deleted successfully"
    else
        print_warning "IAM role '$LAMBDA_ROLE_NAME' not found (may already be deleted)"
    fi
}

# Clean up local files
cleanup_local_files() {
    print_status "Cleaning up local test files..."
    
    local files_to_remove=(
        "response-health.json"
        "response-api-docs.json"
        "response.json"
        "test-lambda-health.json"
        "test-lambda-api-docs.json"
    )
    
    for file in "${files_to_remove[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            print_status "Removed: $file"
        fi
    done
    
    print_success "Local test files cleaned up"
}

# Show cleanup summary
show_summary() {
    echo ""
    print_success "🎉 Cleanup completed successfully!"
    echo ""
    echo "📋 Resources Deleted:"
    echo "  ✅ Lambda Function: $LAMBDA_FUNCTION_NAME"
    echo "  ✅ API Gateway: $API_GATEWAY_NAME"
    echo "  ✅ ECR Repository: $ECR_REPOSITORY_NAME"
    echo "  ✅ IAM Role: $LAMBDA_ROLE_NAME"
    echo "  ✅ IAM Policy: $ECR_POLICY_NAME"
    echo "  ✅ CloudWatch Log Group: /aws/lambda/$LAMBDA_FUNCTION_NAME"
    echo "  ✅ Local test files"
    echo ""
    echo "💡 Notes:"
    echo "  - Your source code and configuration files are preserved"
    echo "  - You can redeploy anytime with: ./deploy-lambda-complete.sh"
    echo "  - Your .env file and other local files remain unchanged"
    echo ""
    echo "💰 Cost Impact:"
    echo "  - No more Lambda charges (pay-per-request)"
    echo "  - No more ECR storage charges"
    echo "  - CloudWatch logs charges stopped"
    echo ""
}

# Show help
show_help() {
    echo "AWS Lambda Resource Cleanup Script for Storm Gate"
    echo "==============================================="
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --region REGION          AWS region (default: us-east-1)"
    echo "  --repository NAME        ECR repository name (default: storm-gate-lambda)"
    echo "  --function-name NAME     Lambda function name (default: storm-gate)"
    echo "  --role-name NAME         IAM role name (default: lambda-execution-role)"
    echo "  --force                  Skip confirmation prompt"
    echo "  --help                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Interactive cleanup"
    echo "  $0 --force                          # Skip confirmation"
    echo "  $0 --function-name my-api --force   # Custom function name"
    echo ""
    echo "⚠️  WARNING: This will permanently delete all AWS resources!"
}

# Main execution
main() {
    echo "🗑️  AWS Lambda Resource Cleanup Script for Storm Gate"
    echo "====================================================="
    echo ""
    
    local FORCE_DELETE=false
    
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
            --role-name)
                LAMBDA_ROLE_NAME="$2"
                shift 2
                ;;
            --force)
                FORCE_DELETE=true
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
    
    # Execute cleanup steps
    check_aws_credentials
    
    if [ "$FORCE_DELETE" = false ]; then
        confirm_deletion
    else
        print_warning "Force mode enabled - skipping confirmation"
    fi
    
    echo ""
    print_status "Starting resource deletion..."
    echo ""
    
    delete_lambda_function
    delete_api_gateway
    delete_log_group
    delete_ecr_repository
    delete_iam_policy
    delete_iam_role
    cleanup_local_files
    
    show_summary
}

# Run the main function
main "$@"
