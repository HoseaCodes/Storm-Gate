# AWS ECR Deployment Guide for Storm Gate

This guide will help you deploy your Storm Gate application to AWS Elastic Container Registry (ECR) and run it on various AWS services.

## Prerequisites

### 1. Install Required Tools

- **AWS CLI**: [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Docker**: [Installation Guide](https://docs.docker.com/get-docker/)

### 2. Configure AWS Credentials

```bash
aws configure
```

You'll need:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., `us-east-1`)
- Default output format (e.g., `json`)

### 3. Required AWS Permissions

Your AWS user/role needs the following permissions:
- `ecr:CreateRepository`
- `ecr:GetAuthorizationToken`
- `ecr:BatchCheckLayerAvailability`
- `ecr:GetDownloadUrlForLayer`
- `ecr:BatchGetImage`
- `ecr:PutImage`
- `ecr:InitiateLayerUpload`
- `ecr:UploadLayerPart`
- `ecr:CompleteLayerUpload`

## Quick Start

### 1. Deploy to ECR (Automated)

Use the provided deployment script:

```bash
./deploy-to-ecr.sh
```

### 2. Deploy with Custom Options

```bash
./deploy-to-ecr.sh \
  --region us-west-2 \
  --repository my-storm-gate \
  --tag v1.0.0 \
  --cleanup
```

## Manual Deployment Steps

If you prefer to run commands manually:

### 1. Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name storm-gate \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true
```

### 2. Login to ECR

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 3. Build and Tag Image

```bash
# Build the image
docker build -t storm-gate:latest .

# Tag for ECR
docker tag storm-gate:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/storm-gate:latest
```

### 4. Push to ECR

```bash
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/storm-gate:latest
```

## Local Testing

### Using Docker Compose

Test your containerized application locally:

```bash
# Build and start the application
docker-compose up --build

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Using Docker Directly

```bash
# Build the image
docker build -t storm-gate:local .

# Run the container
docker run -p 8080:8080 --env-file .env storm-gate:local

# Run with interactive shell for debugging
docker run -it --env-file .env storm-gate:local /bin/sh
```

## Deployment Options

### 1. AWS ECS (Elastic Container Service)

Create an ECS task definition using your ECR image:

```json
{
  "family": "storm-gate",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "storm-gate",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/storm-gate:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/storm-gate",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### 2. AWS EKS (Elastic Kubernetes Service)

Create a Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storm-gate
spec:
  replicas: 2
  selector:
    matchLabels:
      app: storm-gate
  template:
    metadata:
      labels:
        app: storm-gate
    spec:
      containers:
      - name: storm-gate
        image: <account-id>.dkr.ecr.us-east-1.amazonaws.com/storm-gate:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
---
apiVersion: v1
kind: Service
metadata:
  name: storm-gate-service
spec:
  selector:
    app: storm-gate
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
```

### 3. AWS App Runner

Create an App Runner service using your ECR image through the AWS Console or CLI.

## Environment Variables

Make sure to configure these environment variables in your deployment:

- `NODE_ENV=production`
- Database connection strings
- API keys and secrets
- Any other application-specific variables

**Important**: Never include sensitive environment variables in your Docker image. Use AWS Secrets Manager, Parameter Store, or ECS/EKS environment variable injection.

## Monitoring and Logging

### CloudWatch Logs

Configure your container to send logs to CloudWatch:

```bash
# Create log group
aws logs create-log-group --log-group-name /aws/ecs/storm-gate
```

### Health Checks

The Dockerfile includes a health check. You can also configure health checks in your ECS task definition or Kubernetes deployment.

## Security Best Practices

1. **Use specific image tags** instead of `latest` in production
2. **Enable image scanning** in ECR
3. **Use IAM roles** for container permissions
4. **Store secrets** in AWS Secrets Manager
5. **Use VPC** for network isolation
6. **Enable encryption** at rest and in transit

## Troubleshooting

### Common Issues

1. **Authentication Error**
   ```bash
   # Re-authenticate with ECR
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
   ```

2. **Repository Not Found**
   ```bash
   # Create the repository
   aws ecr create-repository --repository-name storm-gate --region us-east-1
   ```

3. **Build Failures**
   ```bash
   # Check Docker daemon is running
   docker info
   
   # Build with verbose output
   docker build --no-cache -t storm-gate:latest .
   ```

### Debugging Container Issues

```bash
# Run container with shell access
docker run -it --entrypoint /bin/sh <image-name>

# Check container logs
docker logs <container-id>

# Inspect container
docker inspect <container-id>
```

## Script Options

The `deploy-to-ecr.sh` script supports the following options:

- `--region REGION`: AWS region (default: us-east-1)
- `--repository NAME`: ECR repository name (default: storm-gate)
- `--tag TAG`: Image tag (default: latest)
- `--account-id ID`: AWS Account ID (auto-detected if not provided)
- `--cleanup`: Clean up local images after push
- `--help`: Show help message

## Environment Variables for Script

You can also set these environment variables instead of using command-line options:

- `AWS_REGION`
- `ECR_REPOSITORY_NAME`
- `IMAGE_TAG`
- `AWS_ACCOUNT_ID`

## Next Steps

After deploying to ECR, you can:

1. Set up CI/CD pipelines using AWS CodePipeline
2. Configure auto-scaling for your containers
3. Set up monitoring and alerting
4. Implement blue-green deployments
5. Configure load balancing and SSL termination

## Support

For issues related to:
- **AWS Services**: Check AWS documentation or contact AWS Support
- **Docker**: Check Docker documentation
- **Application**: Check application logs and health endpoints
