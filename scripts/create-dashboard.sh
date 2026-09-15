#!/bin/bash

# CloudWatch Dashboard for Storm Gate
#
# Builds a single dashboard from metrics AWS already publishes for free:
#   - AWS/Lambda basic metrics (Invocations, Errors, Duration, Throttles, Concurrency)
#   - AWS/ApiGateway basic metrics for the HTTP API (Count, 4xx, 5xx, Latency)
#   - Logs Insights widgets over the function's existing log group
#
# Deliberately does NOT create metric filters or custom metrics — those are
# $0.30/metric/month each. Everything here reads data that is already being
# collected and paid for.
#
# Cost: 3 dashboards/month are free tier; this is one of them. Logs Insights
# queries scan $0.005/GB with 5GB/month free. See --cost for details.

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-storm-gate}"
API_GATEWAY_NAME="${API_GATEWAY_NAME:-storm-gate-api}"
DASHBOARD_NAME="${DASHBOARD_NAME:-Storm-Gate}"
# Default view window. Storm-Gate sees bursty, low-volume traffic, so a short
# window renders an empty dashboard even when everything is healthy.
DASHBOARD_WINDOW="${DASHBOARD_WINDOW:--PT24H}"
LAMBDA_TIMEOUT_MS=30000

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status()  { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

show_cost() {
    cat <<'COST_EOF'
What this dashboard costs
=========================

Free:
  - The dashboard itself. AWS gives you 3 dashboards (up to 50 metrics)
    per month at no charge. This uses 1 of the 3 and ~20 metrics.
  - Every metric on it. Lambda and API Gateway basic metrics are published
    automatically at no cost. No detailed/enhanced monitoring is enabled.

Effectively free at this app's volume:
  - The 4 log widgets run CloudWatch Logs Insights queries, billed at
    $0.005 per GB scanned, with 5 GB/month included in the free tier.
    Each widget scans only its time window (default 3h). An auth service
    logging a few MB/day will not come close to 5 GB.
    Note: the queries re-run every time the dashboard is open or refreshed.

Not created by this script (would cost money):
  - Metric filters / custom metrics ($0.30 each per month)
  - CloudWatch alarms (10 standard alarms free, then $0.10 each)
  - X-Ray tracing, Lambda Insights, Contributor Insights

To keep log costs bounded, set a retention policy (logs default to
"never expire", which bills storage forever):

  aws logs put-retention-policy \
    --log-group-name /aws/lambda/storm-gate \
    --retention-in-days 30 --region us-east-1
COST_EOF
}

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --function-name NAME    Lambda function name (default: storm-gate)"
    echo "  --api-name NAME         API Gateway name (default: storm-gate-api)"
    echo "  --dashboard-name NAME   Dashboard name (default: Storm-Gate)"
    echo "  --region REGION         AWS region (default: us-east-1)"
    echo "  --window ISO8601        Default time window (default: -PT24H, e.g. -PT3H, -P7D)"
    echo "  --dry-run               Print the dashboard JSON, don't create it"
    echo "  --delete                Delete the dashboard"
    echo "  --cost                  Explain exactly what is and isn't free"
    echo "  --help                  Show this help"
}

DRY_RUN=false
DELETE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --function-name)  LAMBDA_FUNCTION_NAME="$2"; shift 2 ;;
        --api-name)       API_GATEWAY_NAME="$2"; shift 2 ;;
        --dashboard-name) DASHBOARD_NAME="$2"; shift 2 ;;
        --region)         AWS_REGION="$2"; shift 2 ;;
        --window)         DASHBOARD_WINDOW="$2"; shift 2 ;;
        --dry-run)        DRY_RUN=true; shift ;;
        --delete)         DELETE=true; shift ;;
        --cost)           show_cost; exit 0 ;;
        --help|-h)        usage; exit 0 ;;
        *) print_error "Unknown option: $1"; usage; exit 1 ;;
    esac
done

command -v aws >/dev/null 2>&1 || { print_error "AWS CLI not installed"; exit 1; }
command -v jq  >/dev/null 2>&1 || { print_error "jq not installed (brew install jq)"; exit 1; }
aws sts get-caller-identity >/dev/null 2>&1 || { print_error "AWS credentials not configured"; exit 1; }

if [ "$DELETE" = true ]; then
    aws cloudwatch delete-dashboards --dashboard-names "$DASHBOARD_NAME" --region "$AWS_REGION"
    print_success "Deleted dashboard '$DASHBOARD_NAME'"
    exit 0
fi

LOG_GROUP="/aws/lambda/${LAMBDA_FUNCTION_NAME}"

# The HTTP API's metrics are keyed by ApiId, not by name, so resolve it.
print_status "Looking up API Gateway '$API_GATEWAY_NAME'..."
API_ID=$(aws apigatewayv2 get-apis --region "$AWS_REGION" \
    --query "Items[?Name=='${API_GATEWAY_NAME}'].ApiId" --output text 2>/dev/null || echo "")

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    print_warning "No API Gateway named '$API_GATEWAY_NAME' found — building a Lambda-only dashboard."
    API_ID=""
else
    print_success "Found API Gateway: $API_ID"
fi

# Warn early rather than letting the user stare at an empty dashboard.
if ! aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
     --region "$AWS_REGION" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
    print_warning "Log group $LOG_GROUP does not exist yet. Log widgets stay empty until the function runs."
fi

TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON" "$TMP_JSON.raw"' EXIT

# Placeholders are substituted below. Written with a quoted heredoc so JSON
# escapes (\\w in the Logs Insights regexes) survive untouched.
cat > "$TMP_JSON.raw" <<'JSON_EOF'
{
  "start": "__WINDOW__",
  "periodOverride": "auto",
  "widgets": [
    {
      "type": "text", "x": 0, "y": 0, "width": 24, "height": 2,
      "properties": {
        "markdown": "# Storm-Gate — __FUNCTION_NAME__ (__REGION__)\nAuth service health. All metrics here are AWS-published basic metrics (no cost). Log widgets query the existing `__LOG_GROUP__` log group.\n\n**Default window: __WINDOW__.** This service is low-traffic — if widgets read *No data found*, widen the time range at the top right rather than assuming an outage.\n\n[Tail logs](https://__REGION__.console.aws.amazon.com/cloudwatch/home?region=__REGION__#logsV2:log-groups/log-group/$252Faws$252Flambda$252F__FUNCTION_NAME__) · [Function](https://__REGION__.console.aws.amazon.com/lambda/home?region=__REGION__#/functions/__FUNCTION_NAME__)"
      }
    },
    {
      "type": "metric", "x": 0, "y": 2, "width": 8, "height": 5,
      "properties": {
        "view": "singleValue", "sparkline": true, "region": "__REGION__",
        "title": "Lambda — window totals", "stat": "Sum", "period": 300,
        "metrics": [
          [ "AWS/Lambda", "Invocations", "FunctionName", "__FUNCTION_NAME__", { "label": "Invocations" } ],
          [ ".", "Errors", ".", ".", { "label": "Errors", "color": "#d62728" } ],
          [ ".", "Throttles", ".", ".", { "label": "Throttles", "color": "#ff7f0e" } ]
        ]
      }
    },
    {
      "type": "metric", "x": 8, "y": 2, "width": 8, "height": 5,
      "properties": {
        "view": "singleValue", "sparkline": true, "region": "__REGION__",
        "title": "API Gateway — window totals", "stat": "Sum", "period": 300,
        "metrics": [
          [ "AWS/ApiGateway", "Count", "ApiId", "__API_ID__", { "label": "Requests" } ],
          [ ".", "4xx", ".", ".", { "label": "4xx", "color": "#ff7f0e" } ],
          [ ".", "5xx", ".", ".", { "label": "5xx", "color": "#d62728" } ]
        ]
      }
    },
    {
      "type": "metric", "x": 16, "y": 2, "width": 8, "height": 5,
      "properties": {
        "view": "singleValue", "sparkline": true, "region": "__REGION__",
        "title": "Duration (ms)", "period": 300,
        "metrics": [
          [ "AWS/Lambda", "Duration", "FunctionName", "__FUNCTION_NAME__", { "label": "avg", "stat": "Average" } ],
          [ "...", { "label": "p95", "stat": "p95" } ],
          [ "...", { "label": "max", "stat": "Maximum", "color": "#d62728" } ]
        ]
      }
    },
    {
      "type": "metric", "x": 0, "y": 7, "width": 12, "height": 6,
      "properties": {
        "view": "timeSeries", "stacked": false, "region": "__REGION__",
        "title": "Invocations vs errors", "stat": "Sum", "period": 300,
        "yAxis": { "left": { "min": 0 } },
        "metrics": [
          [ "AWS/Lambda", "Invocations", "FunctionName", "__FUNCTION_NAME__", { "label": "Invocations", "color": "#1f77b4" } ],
          [ ".", "Errors", ".", ".", { "label": "Errors", "color": "#d62728" } ],
          [ ".", "Throttles", ".", ".", { "label": "Throttles", "color": "#ff7f0e" } ]
        ]
      }
    },
    {
      "type": "metric", "x": 12, "y": 7, "width": 12, "height": 6,
      "properties": {
        "view": "timeSeries", "region": "__REGION__",
        "title": "Error rate (%)", "period": 300,
        "yAxis": { "left": { "min": 0, "label": "%", "showUnits": false } },
        "metrics": [
          [ { "expression": "100 * (errors / MAX([invocations, 1]))", "label": "Lambda error rate", "id": "rate", "color": "#d62728", "region": "__REGION__" } ],
          [ "AWS/Lambda", "Errors", "FunctionName", "__FUNCTION_NAME__", { "id": "errors", "stat": "Sum", "visible": false } ],
          [ ".", "Invocations", ".", ".", { "id": "invocations", "stat": "Sum", "visible": false } ]
        ],
        "annotations": {
          "horizontal": [ { "label": "1%", "value": 1, "color": "#ff7f0e" } ]
        }
      }
    },
    {
      "type": "metric", "x": 0, "y": 13, "width": 12, "height": 6,
      "properties": {
        "view": "timeSeries", "region": "__REGION__",
        "title": "Lambda duration (ms)", "period": 300,
        "yAxis": { "left": { "min": 0 } },
        "metrics": [
          [ "AWS/Lambda", "Duration", "FunctionName", "__FUNCTION_NAME__", { "label": "avg", "stat": "Average" } ],
          [ "...", { "label": "p95", "stat": "p95", "color": "#ff7f0e" } ],
          [ "...", { "label": "max", "stat": "Maximum", "color": "#d62728" } ]
        ],
        "annotations": {
          "horizontal": [ { "label": "30s timeout", "value": __TIMEOUT_MS__, "color": "#d62728", "fill": "above" } ]
        }
      }
    },
    {
      "type": "metric", "x": 12, "y": 13, "width": 12, "height": 6,
      "properties": {
        "view": "timeSeries", "region": "__REGION__",
        "title": "API Gateway latency (ms)", "period": 300,
        "yAxis": { "left": { "min": 0 } },
        "metrics": [
          [ "AWS/ApiGateway", "Latency", "ApiId", "__API_ID__", { "label": "Total p95", "stat": "p95" } ],
          [ ".", "IntegrationLatency", ".", ".", { "label": "Lambda p95", "stat": "p95", "color": "#2ca02c" } ]
        ]
      }
    },
    {
      "type": "metric", "x": 0, "y": 19, "width": 12, "height": 6,
      "properties": {
        "view": "timeSeries", "region": "__REGION__",
        "title": "Concurrency", "period": 300,
        "yAxis": { "left": { "min": 0 } },
        "metrics": [
          [ "AWS/Lambda", "ConcurrentExecutions", "FunctionName", "__FUNCTION_NAME__", { "label": "Concurrent executions", "stat": "Maximum" } ]
        ]
      }
    },
    {
      "type": "log", "x": 12, "y": 19, "width": 12, "height": 6,
      "properties": {
        "region": "__REGION__", "view": "bar",
        "title": "Cold starts vs warm invocations",
        "query": "SOURCE '__LOG_GROUP__' | filter @type = \"REPORT\"\n| stats count(*) as invocations, count(@initDuration) as coldStarts by bin(5m)"
      }
    },
    {
      "type": "log", "x": 0, "y": 25, "width": 24, "height": 7,
      "properties": {
        "region": "__REGION__", "view": "table",
        "title": "Recent errors (winston + uncaught)",
        "query": "SOURCE '__LOG_GROUP__' | fields @timestamp, @message\n| filter @message like /(?i)(error|exception|unhandled|rejected)/\n| filter @type != \"REPORT\"\n| sort @timestamp desc\n| limit 50"
      }
    },
    {
      "type": "log", "x": 0, "y": 32, "width": 12, "height": 7,
      "properties": {
        "region": "__REGION__", "view": "table",
        "title": "HTTP status codes (morgan)",
        "query": "SOURCE '__LOG_GROUP__' | parse @message /\"(?<method>[A-Z]+) (?<path>[^ ?]+)[^\"]*\" (?<status>\\d{3})/\n| filter ispresent(status)\n| stats count(*) as requests by status, method\n| sort requests desc\n| limit 25"
      }
    },
    {
      "type": "log", "x": 12, "y": 32, "width": 12, "height": 7,
      "properties": {
        "region": "__REGION__", "view": "table",
        "title": "Auth failures",
        "query": "SOURCE '__LOG_GROUP__' | fields @timestamp, @message\n| filter @message like /(?i)(verification failed|JWT verification error|Audience mismatch|invalid token|unauthorized|JWKS)/\n| sort @timestamp desc\n| limit 50"
      }
    }
  ]
}
JSON_EOF

sed -e "s|__FUNCTION_NAME__|${LAMBDA_FUNCTION_NAME}|g" \
    -e "s|__REGION__|${AWS_REGION}|g" \
    -e "s|__LOG_GROUP__|${LOG_GROUP}|g" \
    -e "s|__API_ID__|${API_ID}|g" \
    -e "s|__TIMEOUT_MS__|${LAMBDA_TIMEOUT_MS}|g" \
    -e "s|__WINDOW__|${DASHBOARD_WINDOW}|g" \
    "$TMP_JSON.raw" > "$TMP_JSON"

# Drop the API Gateway widgets rather than render them against an empty ApiId.
if [ -z "$API_ID" ]; then
    jq '.widgets |= map(select((.properties.title // "") | test("API Gateway") | not))' \
        "$TMP_JSON" > "$TMP_JSON.tmp" && mv "$TMP_JSON.tmp" "$TMP_JSON"
fi

jq empty "$TMP_JSON" || { print_error "Generated dashboard JSON is invalid"; exit 1; }

METRIC_COUNT=$(jq '[.widgets[].properties.metrics // [] | length] | add // 0' "$TMP_JSON")

if [ "$DRY_RUN" = true ]; then
    jq . "$TMP_JSON"
    print_status "Dry run — nothing created. Metric count: $METRIC_COUNT"
    exit 0
fi

print_status "Creating dashboard '$DASHBOARD_NAME' ($METRIC_COUNT metrics)..."
aws cloudwatch put-dashboard \
    --dashboard-name "$DASHBOARD_NAME" \
    --dashboard-body "file://$TMP_JSON" \
    --region "$AWS_REGION" \
    --output text > /dev/null

print_success "Dashboard created."
echo ""
echo "  https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${DASHBOARD_NAME}"
echo ""

EXISTING=$(aws cloudwatch list-dashboards --region "$AWS_REGION" --query 'length(DashboardEntries)' --output text 2>/dev/null || echo "?")
if [ "$EXISTING" != "?" ] && [ "$EXISTING" -gt 3 ] 2>/dev/null; then
    print_warning "You now have $EXISTING dashboards in $AWS_REGION. Only 3 are free; the rest bill at \$3/month each."
else
    print_status "Dashboards in $AWS_REGION: $EXISTING of 3 free."
fi

RETENTION=$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$AWS_REGION" \
    --query 'logGroups[0].retentionInDays' --output text 2>/dev/null || echo "None")
if [ "$RETENTION" = "None" ] || [ -z "$RETENTION" ]; then
    print_warning "$LOG_GROUP has no retention policy — logs are stored forever and billed forever."
    echo "  Fix: aws logs put-retention-policy --log-group-name $LOG_GROUP --retention-in-days 30 --region $AWS_REGION"
fi

echo ""
print_status "Run '$0 --cost' for the full free-tier breakdown."
