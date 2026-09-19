#!/bin/bash

# One-time AWS setup for the staging CI/CD pipeline.
#
# Run this once, from a laptop, with credentials that can write IAM. Everything
# it creates is idempotent, so re-running it after a change is safe and is the
# intended way to amend the deploy policy.
#
# What it creates, and why each piece is here rather than in the deploy itself:
#
#   1. A GitHub OIDC identity provider. This is what lets the workflow trade a
#      short-lived GitHub token for AWS credentials, so no AWS access key ever
#      sits in a GitHub secret. There is exactly one of these per account and
#      it is shared by every repository, so this script adopts an existing one
#      rather than failing.
#
#   2. storm-gate-github-deploy -- the role the workflow assumes. Its trust
#      policy is pinned to this repository AND to the `staging` GitHub
#      Environment. That pinning is the whole security boundary: this
#      repository is public, so a trust policy with a wildcard subject would
#      let anyone's fork open a pull request that assumes this role and deploys
#      whatever it likes. Read the condition block below before you widen it.
#
#   3. storm-gate-staging-lambda-role -- the execution role the staging
#      function runs as. Created here, out of band, specifically so that the
#      deploy role does NOT need iam:CreateRole. A CI role that can mint IAM
#      roles can escalate to anything in the account; a CI role that can only
#      pass one named, pre-existing role cannot.
#
#   4. The staging ECR repository, with a lifecycle policy. Each image is about
#      340 MB, and a deploy per merge adds one. Without expiry, staging alone
#      would be the largest line on the bill within a few months -- ECR storage
#      is already ~90% of this service's AWS cost. Untagged layers go after a
#      day; tagged images keep the last 10, which is ten rollback targets.
#
#   5. The staging log group, with 14-day retention. A log group created
#      implicitly by Lambda retains forever and bills forever; production's
#      does exactly that today. Creating it up front is the only way to set
#      retention before the first invocation writes to it.
#
#   6. The staging HTTP API, empty. Created here only so the deploy policy can
#      name its id rather than granting write access to every API in the
#      account -- which would include production's. See step 7.
#
# It deliberately does NOT create the Lambda function, nor the API's routes,
# integration or stage. The deploy script builds those on its first run, and
# having one owner for them means there is no second definition to drift.

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
GITHUB_REPO="${GITHUB_REPO:-HoseaCodes/Storm-Gate}"
GITHUB_ENVIRONMENT="${GITHUB_ENVIRONMENT:-staging}"

DEPLOY_ROLE_NAME="${DEPLOY_ROLE_NAME:-storm-gate-github-deploy}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-storm-gate-staging-lambda-role}"
ECR_REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-storm-gate-lambda-staging}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-storm-gate-staging}"
API_GATEWAY_NAME="${API_GATEWAY_NAME:-storm-gate-api-staging}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
KEEP_IMAGES="${KEEP_IMAGES:-10}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_status()  { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --repo)        GITHUB_REPO="$2"; shift 2 ;;
        --region)      AWS_REGION="$2"; shift 2 ;;
        --environment) GITHUB_ENVIRONMENT="$2"; shift 2 ;;
        --dry-run)     DRY_RUN=1; shift ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "  --repo OWNER/NAME     GitHub repository (default: $GITHUB_REPO)"
            echo "  --region REGION       AWS region (default: $AWS_REGION)"
            echo "  --environment NAME    GitHub Environment to trust (default: $GITHUB_ENVIRONMENT)"
            echo "  --dry-run             Print what would change, touch nothing"
            echo ""
            echo "Run once with IAM-capable credentials. Idempotent; re-run to amend."
            exit 0 ;;
        *) print_error "Unknown option: $1"; exit 1 ;;
    esac
done

# Every mutating call goes through here.
#
# The plan is printed to stderr, not stdout. Several callers below append
# `>/dev/null` to silence the AWS CLI's own JSON reply, and when this echoed to
# stdout that redirect swallowed the plan line too -- so `--dry-run` reported
# "[SUCCESS] OIDC provider created" for five of the eleven calls without ever
# showing that it intended to create anything. A dry run that under-reports is
# worse than no dry run, because it is read as reassurance.
run() {
    if [ "$DRY_RUN" = "1" ]; then
        echo "    would run: aws $*" >&2
        return 0
    fi
    aws "$@"
}

# Report a change in the tense that matches what actually happened. Takes the
# action in present tense: "create the GitHub OIDC provider".
report_change() {
    if [ "$DRY_RUN" = "1" ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} would $1"
    else
        print_success "$(printf '%s' "$1" | sed -e 's/^create /created /' \
            -e 's/^update /updated /' -e 's/^write /wrote /' \
            -e 's/^apply /applied /' -e 's/^set /set /')"
    fi
}

if [ "$DRY_RUN" = "1" ]; then
    echo -e "${YELLOW}[DRY-RUN]${NC} Nothing will be created or changed. Lines marked"
    echo -e "${YELLOW}[DRY-RUN]${NC} 'would run' are the exact AWS calls a real run makes."
    echo ""
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CALLER=$(aws sts get-caller-identity --query Arn --output text)
print_status "Account $ACCOUNT_ID in $AWS_REGION, as $CALLER"

# Using root credentials to set up a least-privilege CI role is an odd pairing,
# and root access keys cannot be scoped, rotated by policy, or attributed to a
# person. Worth fixing, but not a reason to block this script.
case "$CALLER" in
    *:root) print_warning "These are root credentials. Consider an IAM admin user for this instead — root keys cannot be scoped or rotated by policy." ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------------------
# 1. GitHub OIDC provider
# ---------------------------------------------------------------------------
print_status "Checking for the GitHub OIDC provider..."
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" &>/dev/null; then
    print_success "OIDC provider already exists (shared account-wide; left as is)"
else
    print_status "Creating the GitHub OIDC provider..."
    # The thumbprint argument is required by the API but is no longer what STS
    # actually verifies -- since 2023 it trusts the provider's certificate via
    # a managed root CA list instead. This is the value AWS's own docs use; it
    # is passed to satisfy the parameter, not as a security control, which is
    # why a thumbprint rotation at GitHub will not break this.
    run iam create-open-id-connect-provider \
        --url "https://token.actions.githubusercontent.com" \
        --client-id-list "sts.amazonaws.com" \
        --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
    report_change "create the GitHub OIDC provider"
fi

# ---------------------------------------------------------------------------
# 2. The deploy role the workflow assumes
# ---------------------------------------------------------------------------
# Two conditions, both required:
#
#   sub = repo:<owner>/<repo>:environment:staging
#     Set when a job declares `environment: staging`. It ties the credentials
#     to a GitHub Environment, which is the thing that can carry required
#     reviewers and a branch allow-list. Note that this is the environment
#     claim, not the ref claim -- a job WITHOUT `environment:` in it produces
#     `...:ref:refs/heads/staging` instead and will be refused by this policy.
#     That is intended: it means someone cannot quietly drop the environment
#     from the workflow to bypass its protection rules.
#
#   ref = refs/heads/staging
#     Belt and braces. The environment's own "deployment branches" setting is
#     the real enforcement, but that setting lives in the GitHub UI where it
#     can be changed without a commit. This one lives in AWS.
#
# aud is pinned because an unpinned audience accepts tokens minted for other
# relying parties.
cat > "$TMP/trust.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:environment:${GITHUB_ENVIRONMENT}",
          "token.actions.githubusercontent.com:ref": "refs/heads/staging"
        }
      }
    }
  ]
}
JSON

if aws iam get-role --role-name "$DEPLOY_ROLE_NAME" &>/dev/null; then
    print_status "Updating trust policy on $DEPLOY_ROLE_NAME..."
    run iam update-assume-role-policy \
        --role-name "$DEPLOY_ROLE_NAME" \
        --policy-document "file://$TMP/trust.json"
    report_change "update the trust policy on $DEPLOY_ROLE_NAME"
else
    print_status "Creating $DEPLOY_ROLE_NAME..."
    run iam create-role \
        --role-name "$DEPLOY_ROLE_NAME" \
        --description "GitHub Actions staging deploys for ${GITHUB_REPO}" \
        --max-session-duration 3600 \
        --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
    report_change "create role $DEPLOY_ROLE_NAME"
fi


# ---------------------------------------------------------------------------
# 3. The staging Lambda execution role
# ---------------------------------------------------------------------------
if aws iam get-role --role-name "$LAMBDA_ROLE_NAME" &>/dev/null; then
    print_success "Execution role $LAMBDA_ROLE_NAME already exists"
else
    print_status "Creating execution role $LAMBDA_ROLE_NAME..."
    cat > "$TMP/lambda-trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
    run iam create-role \
        --role-name "$LAMBDA_ROLE_NAME" \
        --description "Execution role for the storm-gate staging function" \
        --assume-role-policy-document "file://$TMP/lambda-trust.json" >/dev/null

    run iam attach-role-policy \
        --role-name "$LAMBDA_ROLE_NAME" \
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

    # Pull rights for the image it runs from. Scoped to the staging repository:
    # the deploy script's own version of this role grants ecr:* on "*", which
    # lets the function read every image in the account.
    cat > "$TMP/lambda-ecr.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${ECR_REPOSITORY_NAME}"
    }
  ]
}
JSON
    run iam put-role-policy \
        --role-name "$LAMBDA_ROLE_NAME" \
        --policy-name "storm-gate-staging-ecr-pull" \
        --policy-document "file://$TMP/lambda-ecr.json"

    report_change "create role $LAMBDA_ROLE_NAME with basic-execution and scoped ECR pull"
    # IAM is eventually consistent: a role can exist and still be refused by
    # lambda:CreateFunction for a few seconds after creation.
    [ "$DRY_RUN" = "1" ] || sleep 10
fi

# ---------------------------------------------------------------------------
# 4. The staging ECR repository, with expiry
# ---------------------------------------------------------------------------
if aws ecr describe-repositories --repository-names "$ECR_REPOSITORY_NAME" --region "$AWS_REGION" &>/dev/null; then
    print_success "ECR repository $ECR_REPOSITORY_NAME already exists"
else
    print_status "Creating ECR repository $ECR_REPOSITORY_NAME..."
    run ecr create-repository \
        --repository-name "$ECR_REPOSITORY_NAME" \
        --region "$AWS_REGION" \
        --image-scanning-configuration scanOnPush=true \
        --encryption-configuration encryptionType=AES256 >/dev/null
    report_change "create ECR repository $ECR_REPOSITORY_NAME"
fi

# Applied every run, not just on create, so editing KEEP_IMAGES takes effect.
cat > "$TMP/lifecycle.json" <<JSON
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Untagged layers are build residue; nothing can roll back to them.",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 1
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Keep the last ${KEEP_IMAGES} staging builds as rollback targets.",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["staging-"],
        "countType": "imageCountMoreThan",
        "countNumber": ${KEEP_IMAGES}
      },
      "action": { "type": "expire" }
    }
  ]
}
JSON

print_status "Applying the ECR lifecycle policy..."
run ecr put-lifecycle-policy \
    --repository-name "$ECR_REPOSITORY_NAME" \
    --region "$AWS_REGION" \
    --lifecycle-policy-text "file://$TMP/lifecycle.json" >/dev/null
report_change "apply the ECR lifecycle policy (untagged expire after 1 day; last $KEEP_IMAGES staging builds kept)"

# A container-image function is pulled by the LAMBDA SERVICE PRINCIPAL, not by
# the function's execution role, so the repository needs a resource-based grant
# as well. Without it, CreateFunction fails with:
#
#   AccessDeniedException: Lambda does not have permission to access the ECR
#   image. Check the ECR permissions.
#
# which reads like a caller-credentials problem and is not one. The ECR pull
# policy on the execution role above does not substitute for this.
#
# Easy to miss because the AWS Console adds this policy silently when you
# create a container function through it -- production's repository has it for
# that reason, and deploy-lambda-complete.sh has never created it. Nothing
# surfaced the gap until a repository was built from scratch.
#
# Applied every run, like the lifecycle policy, so it is repaired if removed.
cat > "$TMP/ecr-repo-policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaECRImageRetrievalPolicy",
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Condition": {
        "StringLike": {
          "aws:sourceArn": "arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${LAMBDA_FUNCTION_NAME}"
        }
      }
    }
  ]
}
JSON

# sourceArn is pinned to the one staging function. Production's equivalent
# policy allows function:* -- any function in the account can pull from it.
print_status "Granting the Lambda service pull access to the repository..."
run ecr set-repository-policy \
    --repository-name "$ECR_REPOSITORY_NAME" \
    --region "$AWS_REGION" \
    --policy-text "file://$TMP/ecr-repo-policy.json" >/dev/null
report_change "grant lambda.amazonaws.com pull access, scoped to $LAMBDA_FUNCTION_NAME"

# ---------------------------------------------------------------------------
# 5. The log group, created early so retention is set before the first write
# ---------------------------------------------------------------------------
LOG_GROUP="/aws/lambda/${LAMBDA_FUNCTION_NAME}"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$AWS_REGION" \
        --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" --output text 2>/dev/null | grep -q .; then
    print_success "Log group $LOG_GROUP already exists"
else
    print_status "Creating log group $LOG_GROUP..."
    run logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION"
    report_change "create log group $LOG_GROUP"
fi

run logs put-retention-policy \
    --log-group-name "$LOG_GROUP" \
    --retention-in-days "$LOG_RETENTION_DAYS" \
    --region "$AWS_REGION"
report_change "set log retention to $LOG_RETENTION_DAYS days"

# ---------------------------------------------------------------------------
# 6. The HTTP API
# ---------------------------------------------------------------------------
# Created here, empty, purely so that the deploy role's policy can name its id.
# The alternative is granting the deploy role write access to
# arn:aws:apigateway:<region>::/apis/* -- which is every API in the account,
# production's included, and would make the scoping above decorative.
#
# Deliberately created WITHOUT --target, unlike the deploy script's own call.
# --target is API Gateway's quick-create, which needs the Lambda function to
# already exist -- and it does not yet. The deploy script's
# setup_api_gateway_routing builds the integration, the $default route and the
# stage on its first run regardless of how the API came to exist, so a bare
# API here loses nothing.
print_status "Checking for the staging HTTP API..."
API_ID=$(aws apigatewayv2 get-apis --region "$AWS_REGION" \
    --query "Items[?Name=='${API_GATEWAY_NAME}'].ApiId" --output text 2>/dev/null || echo "")

if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
    print_success "HTTP API $API_GATEWAY_NAME already exists ($API_ID)"
elif [ "$DRY_RUN" = "1" ]; then
    # Not via run(), because a real run needs the new id back out of the call.
    echo "    would run: aws apigatewayv2 create-api --name $API_GATEWAY_NAME --protocol-type HTTP --region $AWS_REGION" >&2
    # A placeholder, so the deploy policy below is still generated and can be
    # inspected. A real run pins the policy to the actual id.
    API_ID="DRYRUNAPIID"
    report_change "create HTTP API $API_GATEWAY_NAME"
else
    print_status "Creating HTTP API $API_GATEWAY_NAME..."
    API_ID=$(aws apigatewayv2 create-api \
        --name "$API_GATEWAY_NAME" \
        --protocol-type HTTP \
        --region "$AWS_REGION" \
        --query 'ApiId' --output text)
    report_change "create HTTP API $API_GATEWAY_NAME ($API_ID)"
fi

# ---------------------------------------------------------------------------
# 7. The deploy role's permissions
# ---------------------------------------------------------------------------
# Written last because it names the API id, which only exists after step 6.
#
# Scoped to the staging resources by ARN: the staging function, the staging
# ECR repository, the staging API, and one passable execution role. The deploy
# role cannot read or update the production function, push to its repository,
# or touch its API -- so a mistake in this workflow, or a compromised branch,
# cannot reach production.
#
# The one unavoidably broad grant is apigateway:GET on the /apis collection,
# which lists every API's name and id. API Gateway has no way to scope a
# collection listing, and the deploy script resolves the staging API by name.
# It is a read of names and ids only, and it is why step 6 creates the API
# here rather than letting the deploy script create it under /apis/*.
cat > "$TMP/deploy-policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthTokenIsAccountWideByDesign",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushOnlyToTheStagingRepository",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${ECR_REPOSITORY_NAME}"
    },
    {
      "Sid": "ManageOnlyTheStagingFunction",
      "Effect": "Allow",
      "Action": [
        "lambda:AddPermission",
        "lambda:CreateFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:GetPolicy",
        "lambda:InvokeFunction",
        "lambda:RemovePermission",
        "lambda:TagResource",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${LAMBDA_FUNCTION_NAME}"
    },
    {
      "Sid": "PassOnlyTheStagingExecutionRole",
      "Effect": "Allow",
      "Action": ["iam:GetRole", "iam:PassRole"],
      "Resource": "arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}"
    },
    {
      "Sid": "ListApisToResolveTheStagingOneByName",
      "Effect": "Allow",
      "Action": "apigateway:GET",
      "Resource": "arn:aws:apigateway:${AWS_REGION}::/apis"
    },
    {
      "Sid": "WriteOnlyToTheStagingApi",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PATCH",
        "apigateway:PUT"
      ],
      "Resource": [
        "arn:aws:apigateway:${AWS_REGION}::/apis/${API_ID}",
        "arn:aws:apigateway:${AWS_REGION}::/apis/${API_ID}/*"
      ]
    },
    {
      "Sid": "ReadLogsForTheSmokeTest",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${LAMBDA_FUNCTION_NAME}:*"
    }
  ]
}
JSON

print_status "Writing the inline deploy policy..."
run iam put-role-policy \
    --role-name "$DEPLOY_ROLE_NAME" \
    --policy-name "storm-gate-staging-deploy" \
    --policy-document "file://$TMP/deploy-policy.json"
report_change "write the scoped deploy policy onto $DEPLOY_ROLE_NAME"

# ---------------------------------------------------------------------------
# What is left for a human
# ---------------------------------------------------------------------------
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${DEPLOY_ROLE_NAME}"

echo ""
echo "======================================================================"
if [ "$DRY_RUN" = "1" ]; then
    print_warning "Dry run complete. Nothing above was created or changed."
    echo "           Re-run without --dry-run to apply it."
else
    print_success "AWS side is ready."
fi
echo "======================================================================"
echo ""
echo "Deploy role ARN:"
echo "  $ROLE_ARN"
echo ""
if [ "$DRY_RUN" = "1" ]; then
    echo "Staging URL: not known yet — the API does not exist until a real run."
else
    echo "Staging URL (live after the first deploy, on the \$default stage):"
    echo "  https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
fi
echo ""
echo "Now, on GitHub — Settings > Environments > New environment > 'staging':"
echo ""
echo "  Deployment branches: 'Selected branches' -> staging"
echo "     Without this, the environment's secrets are reachable from any"
echo "     branch, and the AWS trust policy's ref condition is the only thing"
echo "     standing between a pushed branch and a staging deploy."
echo ""
echo "  Environment secrets (Settings > Environments > staging > secrets):"
echo "     AWS_DEPLOY_ROLE_ARN   $ROLE_ARN"
echo "     MONGODB_URL           staging cluster only — never the prod cluster"
echo "     CLIENT_SECRET         staging Azure app registration"
echo "     ACCESS_TOKEN_SECRET   generate fresh; must differ from prod"
echo "     REFRESH_TOKEN_SECRET  generate fresh; must differ from prod"
echo "     JWT_SECRET            generate fresh; must differ from prod"
echo "     JWT_PRIVATE_KEY       from: node scripts/generate-jwt-keys.mjs"
echo ""
echo "  Environment variables (same page, 'Variables' tab):"
echo "     CLIENT_ID, TENANT_ID, REDIRECT_URI, CORS_ORIGINS,"
echo "     OIDC_ALLOWED_RETURN_ORIGINS, JWT_PUBLIC_KEY, JWT_ISSUER"
echo ""
print_warning "The token secrets and the JWT keypair MUST be different from production."
echo "  They are what makes a token trustworthy. Share the signing key and a"
echo "  token minted by staging — against a database seeded with test users —"
echo "  verifies cleanly in production, because prod publishes the same key at"
echo "  its JWKS endpoint and every consumer of @storm-gate/express honours it."
echo ""
echo "Then: git push origin staging"
