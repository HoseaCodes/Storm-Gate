# AWS Lambda Container Deployment Guide

This guide covers deploying the Storm Gate API as a containerized AWS Lambda function.

## 🏗️ Architecture Overview

```
Internet → API Gateway → Lambda Container → MongoDB Atlas/DocumentDB
                    ↓
                CloudWatch Logs
```

## 📋 Prerequisites

### 1. AWS Services Setup
- **AWS Account** with appropriate permissions
- **AWS CLI** configured (`aws configure`)
- **Docker** installed and running
- **MongoDB Atlas** or **AWS DocumentDB** cluster

### 2. Required AWS Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:*",
        "ecr:*",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PassRole",
        "apigateway:*",
        "logs:*"
      ],
    }
  ]
}
# Build Lambda container
docker build -f Dockerfile.lambda -t storm-gate-lambda .

# Tag for ECR
docker tag storm-gate-lambda:latest \
  <account-id>.dkr.ecr.<region>.amazonaws.com/storm-gate-lambda:latest

# Push to ECR
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/storm-gate-lambda:latest
```

### Step 4: Create Lambda Function
```bash
# Create Lambda function from container
aws lambda create-function \
  --function-name storm-gate-api \
  --package-type Image \
  --code ImageUri=<account-id>.dkr.ecr.<region>.amazonaws.com/storm-gate-lambda:latest \
  --role arn:aws:iam::<account-id>:role/lambda-execution-role \
  --timeout 30 \
  --memory-size 512
```

## 📝 Detailed Setup Instructions

### 1. Database Configuration

#### Option A: MongoDB Atlas (Recommended)
```bash
# Create MongoDB Atlas cluster
# Get connection string: mongodb+srv://username:password@cluster.mongodb.net/storm-gate
```

#### Option B: AWS DocumentDB
```bash
# Create DocumentDB cluster
aws docdb create-db-cluster \
  --db-cluster-identifier storm-gate-docdb \
  --engine docdb \
  --master-username admin \
  --master-user-password <password>
```

### 2. ECR Repository Setup
```bash
# Create ECR repository
aws ecr create-repository \
  --repository-name storm-gate-lambda \
  --region us-east-1

# Get login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 3. IAM Role Creation
```bash
# Create Lambda execution role
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document '{
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
  }'

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### 4. Container Build and Push
```bash
# Build container for Lambda
docker build -f Dockerfile.lambda -t storm-gate-lambda .

# Test container locally (optional)
docker run -p 9000:8080 --env-file .env storm-gate-lambda

# Tag and push to ECR
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
ECR_URI=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/storm-gate-lambda

docker tag storm-gate-lambda:latest $ECR_URI:latest
docker push $ECR_URI:latest
```

### 5. Lambda Function Creation
```bash
# Create Lambda function
aws lambda create-function \
  --function-name storm-gate-api \
  --package-type Image \
  --code ImageUri=$ECR_URI:latest \
  --role arn:aws:iam::$ACCOUNT_ID:role/lambda-execution-role \
  --timeout 30 \
  --memory-size 512 \
  --environment Variables='{
    "NODE_ENV":"production",
    "MONGODB_URL":"your-mongodb-connection-string",
    "CLIENT_ID":"your-azure-client-id",
    "TENANT_ID":"your-azure-tenant-id",
    "ACCESS_TOKEN_SECRET":"your-access-token-secret",
    "REFRESH_TOKEN_SECRET":"your-refresh-token-secret",
    "CLOUDINARY_CLOUD_NAME":"your-cloudinary-name",
    "CLOUDINARY_API_KEY":"your-cloudinary-key",
    "CLOUDINARY_API_SECRET":"your-cloudinary-secret"
  }'
```

### 6. API Gateway Setup
```bash
# Create REST API
aws apigatewayv2 create-api \
  --name storm-gate-api \
  --protocol-type HTTP \
  --target arn:aws:lambda:$REGION:$ACCOUNT_ID:function:storm-gate-api

# Add Lambda permission for API Gateway
aws lambda add-permission \
  --function-name storm-gate-api \
  --statement-id api-gateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com
```

## 🔧 Configuration Management

### Environment Variables
Set these in AWS Lambda Console or via CLI:

```bash
aws lambda update-function-configuration \
  --function-name storm-gate-api \
  --environment Variables='{
    "NODE_ENV":"production",
    "MONGODB_URL":"mongodb+srv://...",
    "CLIENT_ID":"your-client-id",
    "TENANT_ID":"your-tenant-id",
    "ACCESS_TOKEN_SECRET":"your-secret",
    "REFRESH_TOKEN_SECRET":"your-secret",
    "CLOUDINARY_CLOUD_NAME":"your-name",
    "CLOUDINARY_API_KEY":"your-key",
    "CLOUDINARY_API_SECRET":"your-secret"
  }'
```

### Using AWS Secrets Manager (Recommended for Production)
```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name storm-gate/mongodb \
  --secret-string '{"connectionString":"mongodb+srv://..."}'

# Update Lambda to use Secrets Manager
# Add IAM policy for Secrets Manager access
```

## 📊 Monitoring and Logging

### CloudWatch Logs
```bash
# View Lambda logs
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/storm-gate-api

# Tail logs in real-time
aws logs tail /aws/lambda/storm-gate-api --follow
```

### X-Ray Tracing (Optional)
```bash
# Enable X-Ray tracing
aws lambda update-function-configuration \
  --function-name storm-gate-api \
  --tracing-config Mode=Active
```

## 🧪 Testing

### Local Testing
```bash
# Test Lambda container locally
npm run start:lambda

# Test with curl
curl http://localhost:8080/health
```

### Lambda Testing
```bash
# Invoke Lambda function directly
aws lambda invoke \
  --function-name storm-gate-api \
  --payload '{"httpMethod":"GET","path":"/health"}' \
  response.json

# Test via API Gateway
curl https://your-api-gateway-url/health
```

## 🔄 CI/CD Pipeline

### GitHub Actions Example
```yaml
name: Deploy to Lambda
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Build and push Docker image
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI
          docker build -f Dockerfile.lambda -t storm-gate-lambda .
          docker tag storm-gate-lambda:latest $ECR_URI:latest
          docker push $ECR_URI:latest
      
      - name: Update Lambda function
        run: |
          aws lambda update-function-code \
            --function-name storm-gate-api \
            --image-uri $ECR_URI:latest
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Cold Start Performance
```bash
# Increase memory allocation
aws lambda update-function-configuration \
  --function-name storm-gate-api \
  --memory-size 1024

# Use provisioned concurrency
aws lambda put-provisioned-concurrency-config \
  --function-name storm-gate-api \
  --qualifier $LATEST \
  --provisioned-concurrency-count 2
```

#### 2. Database Connection Issues
```javascript
// Check connection in Lambda logs
console.log('MongoDB connection state:', mongoose.connection.readyState);
// 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
```

#### 3. File Upload Issues
```bash
# Check /tmp directory permissions
ls -la /tmp/

# Monitor /tmp usage (Lambda limit: 512MB)
du -sh /tmp/
```

#### 4. JWT Verification Issues
```bash
# Enable JWT debugging
aws lambda update-function-configuration \
  --function-name storm-gate-api \
  --environment Variables='{"DEBUG_JWT":"true",...}'
```

### Performance Optimization

#### 1. Container Image Optimization
```dockerfile
# Multi-stage build for smaller images
FROM public.ecr.aws/lambda/nodejs:18 AS builder
# ... build steps

FROM public.ecr.aws/lambda/nodejs:18
COPY --from=builder /app .
```

#### 2. Database Connection Pooling
```javascript
// Optimize connection pool settings
const options = {
  maxPoolSize: 5,        // Reduced for Lambda
  minPoolSize: 1,
  maxIdleTimeMS: 30000,  // Close idle connections
  serverSelectionTimeoutMS: 5000
};
```

## 📈 Scaling Considerations

### Concurrent Executions
```bash
# Set reserved concurrency
aws lambda put-reserved-concurrency \
  --function-name storm-gate-api \
  --reserved-concurrent-executions 100
```

### API Gateway Rate Limiting
```bash
# Set throttling limits
aws apigatewayv2 update-stage \
  --api-id your-api-id \
  --stage-name $default \
  --throttle-config RateLimit=1000,BurstLimit=2000
```

## 💰 Cost Optimization

### 1. Right-size Memory Allocation
- Start with 512MB, monitor CloudWatch metrics
- Increase if CPU-bound, decrease if memory usage is low

### 2. Use Provisioned Concurrency Sparingly
- Only for critical endpoints with strict latency requirements
- Monitor cost vs. performance trade-offs

### 3. Optimize Cold Starts
- Minimize container image size
- Use connection pooling
- Consider Lambda SnapStart (when available for containers)

## 🔒 Security Best Practices

### 1. Environment Variables
```bash
# Use AWS Secrets Manager for sensitive data
aws secretsmanager get-secret-value --secret-id storm-gate/secrets
```

### 2. VPC Configuration (if needed)
```bash
# Configure Lambda in VPC for database access
aws lambda update-function-configuration \
  --function-name storm-gate-api \
  --vpc-config SubnetIds=subnet-12345,SecurityGroupIds=sg-12345
```

### 3. IAM Least Privilege
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## 📚 Additional Resources

- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [API Gateway HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html)
- [MongoDB Atlas AWS Integration](https://docs.atlas.mongodb.com/reference/amazon-aws/)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)

## 🆘 Support

For issues:
1. Check CloudWatch logs: `/aws/lambda/storm-gate-api`
2. Monitor X-Ray traces (if enabled)
3. Review API Gateway access logs
4. Test locally with `npm run start:lambda`
