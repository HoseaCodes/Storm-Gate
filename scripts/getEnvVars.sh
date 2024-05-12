#!/bin/bash

region=${1:-us-east-2} #<------------- change region here

if [ -n "$region" ]; then
    aws ssm get-parameters-by-path --region "$region" --path "/development/webapp" --with-decryption |  jq -r '.Parameters[]|((.Name|capture(".*/(?<a>.*)").a+"=")+.Value)' > ./.env
else
    echo "Input missing. Exiting..."
fi