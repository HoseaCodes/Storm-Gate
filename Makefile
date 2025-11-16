# Storm Gate - Docker and ECR Management

# Variables
IMAGE_NAME := storm-gate
IMAGE_TAG := latest
AWS_REGION := us-east-1
ECR_REPO := storm-gate

# Help target
.PHONY: help
help: ## Show this help message
	@echo "Storm Gate - Docker and ECR Management"
	@echo "======================================"
	@echo ""
	@echo "Available targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Local Development
.PHONY: build
build: ## Build Docker image locally
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

.PHONY: run
run: ## Run the application locally with Docker
	docker run -p 8080:8080 --env-file .env $(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: run-detached
run-detached: ## Run the application in detached mode
	docker run -d -p 8080:8080 --env-file .env --name storm-gate-container $(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: stop
stop: ## Stop the running container
	docker stop storm-gate-container || true
	docker rm storm-gate-container || true

.PHONY: logs
logs: ## View container logs
	docker logs -f storm-gate-container

.PHONY: shell
shell: ## Get shell access to the container
	docker run -it --env-file .env $(IMAGE_NAME):$(IMAGE_TAG) /bin/sh

# Docker Compose
.PHONY: compose-up
compose-up: ## Start application with docker-compose
	docker-compose up --build

.PHONY: compose-up-detached
compose-up-detached: ## Start application with docker-compose in detached mode
	docker-compose up -d --build

.PHONY: compose-down
compose-down: ## Stop docker-compose services
	docker-compose down

.PHONY: compose-logs
compose-logs: ## View docker-compose logs
	docker-compose logs -f

# ECR Deployment (handled by lambda-deploy now)
# Use lambda-deploy for complete deployment including ECR

# Lambda Deployment
.PHONY: lambda-deploy
lambda-deploy: ## Complete Lambda + API Gateway deployment
	./deploy-lambda-complete.sh

.PHONY: lambda-deploy-only
lambda-deploy-only: ## Deploy Lambda function only (skip API Gateway)
	./deploy-lambda-complete.sh --skip-api-gateway

.PHONY: lambda-deploy-custom
lambda-deploy-custom: ## Deploy to Lambda with custom settings
	./deploy-lambda-complete.sh --function-name $(LAMBDA_FUNCTION_NAME) --tag $(IMAGE_TAG) --region $(AWS_REGION)

.PHONY: api-gateway-setup
api-gateway-setup: ## Set up API Gateway for existing Lambda function
	./deploy-lambda-complete.sh --api-gateway-only

.PHONY: lambda-cleanup
lambda-cleanup: ## Delete all Lambda and API Gateway resources (WARNING: Destructive!)
	./cleanup-lambda.sh

.PHONY: lambda-cleanup-force
lambda-cleanup-force: ## Delete all resources without confirmation
	./cleanup-lambda.sh --force

# Monitoring
.PHONY: lambda-logs
lambda-logs: ## View recent Lambda logs
	aws logs tail /aws/lambda/storm-gate --region us-east-1 --since 1h --format short

.PHONY: lambda-logs-follow
lambda-logs-follow: ## Follow Lambda logs in real-time
	aws logs tail /aws/lambda/storm-gate --region us-east-1 --follow --format short

.PHONY: lambda-test-health
lambda-test-health: ## Test Lambda health endpoint directly
	aws lambda invoke --function-name storm-gate --cli-binary-format raw-in-base64-out --payload '{"httpMethod":"GET","path":"/health"}' /tmp/test-response.json && cat /tmp/test-response.json | jq . && rm -f /tmp/test-response.json

.PHONY: ecr-login
ecr-login: ## Login to AWS ECR
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com

# Cleanup
.PHONY: clean
clean: ## Remove local Docker images and containers
	docker stop storm-gate-container || true
	docker rm storm-gate-container || true
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) || true

.PHONY: clean-all
clean-all: ## Remove all Docker images, containers, and volumes
	docker system prune -af
	docker volume prune -f

# Testing
.PHONY: test-local
test-local: build run-detached ## Build and test the application locally
	@echo "Waiting for application to start..."
	@sleep 10
	@echo "Testing health endpoint..."
	@curl -f http://localhost:8080/health || (echo "Health check failed" && make stop && exit 1)
	@echo "Health check passed!"
	@make stop

# Development helpers
.PHONY: dev
dev: ## Start development environment
	npm run dev

.PHONY: dev-lambda
dev-lambda: ## Start Lambda development environment
	npm run dev:lambda

.PHONY: install
install: ## Install dependencies
	npm install

.PHONY: check-env
check-env: ## Check if required environment variables are set
	@echo "Checking environment variables..."
	@test -f .env || (echo "❌ .env file not found" && exit 1)
	@echo "✅ .env file exists"
	@command -v aws >/dev/null 2>&1 || (echo "❌ AWS CLI not installed" && exit 1)
	@echo "✅ AWS CLI is installed"
	@command -v docker >/dev/null 2>&1 || (echo "❌ Docker not installed" && exit 1)
	@echo "✅ Docker is installed"
	@aws sts get-caller-identity >/dev/null 2>&1 || (echo "❌ AWS credentials not configured" && exit 1)
	@echo "✅ AWS credentials are configured"

# Quick deployment workflow
.PHONY: deploy
deploy: check-env build ecr-deploy ## Complete deployment workflow: check env, build, and deploy to ECR

.DEFAULT_GOAL := help
