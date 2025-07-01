#!/bin/bash

set -e

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

#######################################
# S3 BUCKETS
#######################################
setup_s3() {
  echo "➡️ Creating S3 buckets"
  awslocal s3 mb s3://frontend
  awslocal s3 mb s3://invoices
  awslocal s3 mb s3://analytics-reports

  echo "📁 Uploading frontend files"
  awslocal s3 cp /var/frontend/index.html s3://frontend/index.html --content-type text/html
  awslocal s3 cp /var/products.json s3://frontend/products.json --content-type application/json
  awslocal s3 website s3://frontend/ --index-document index.html
}

#######################################
# SQS QUEUES
#######################################
setup_sqs() {
  echo "🔄 Creating SQS queues"
  awslocal sqs create-queue --queue-name dead-letter-queue
  awslocal sqs create-queue --queue-name order-queue \
    --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:dead-letter-queue\",\"maxReceiveCount\":3}"}'
}

#######################################
# DYNAMODB TABLES
#######################################
setup_dynamodb() {
  echo "⏳ Waiting for DynamoDB to be ready..."
  until awslocal dynamodb list-tables; do sleep 2; done

  # List existing tables once
  existing_tables=$(awslocal dynamodb list-tables --query 'TableNames' --output text)
  for table in OrderDB ArchiveDB; do
    # Delete the table only if it exists
    if echo "$existing_tables" | grep -qw "$table"; then
      awslocal dynamodb delete-table --table-name $table
    fi
    awslocal dynamodb create-table \
      --table-name $table \
      --key-schema AttributeName=orderId,KeyType=HASH \
      --attribute-definitions AttributeName=orderId,AttributeType=S \
      --billing-mode PAY_PER_REQUEST
    echo "⏳ Waiting for $table creation..."
    until awslocal dynamodb describe-table --table-name $table > /dev/null 2>&1; do sleep 1; done
    echo "✅ Table $table created."
  done

  awslocal dynamodb create-table \
    --table-name OrderEventsDB \
    --key-schema AttributeName=eventId,KeyType=HASH \
    --attribute-definitions AttributeName=eventId,AttributeType=S \
    --billing-mode PAY_PER_REQUEST
  echo "⏳ Waiting for OrderEventsDB creation..."
  until awslocal dynamodb describe-table --table-name OrderEventsDB > /dev/null 2>&1; do sleep 1; done
  echo "✅ OrderEventsDB table created."

  # List tables if any exist (after all creations)
  current_tables=$(awslocal dynamodb list-tables --query 'TableNames' --output text)
  if [ -n "$current_tables" ]; then
    echo "Tables DynamoDB existantes : $current_tables"
  fi
}

#######################################
# LAMBDAS
#######################################
deploy_lambdas() {
  echo "📦 Deploying Lambda functions"
  awslocal lambda create-function --function-name transfer-order-event --runtime nodejs18.x --handler index.handler --zip-file fileb:///var/task/transfer-order-event.zip --role arn:aws:iam::000000000000:role/lambda-role --timeout 30
  awslocal lambda create-function --function-name order-processing --runtime nodejs18.x --handler index.handler --zip-file fileb:///var/task/order-processing.zip --role arn:aws:iam::000000000000:role/lambda-role --timeout 30
  awslocal lambda create-function --function-name api-gateway-handler --runtime nodejs18.x --handler index.handler --zip-file fileb:///var/task/api-gateway-handler.zip --role arn:aws:iam::000000000000:role/lambda-role --timeout 10
  awslocal lambda create-function --function-name generate-analytics-reports --runtime nodejs18.x --handler index.handler --zip-file fileb:///var/task/generate-analytics-reports.zip --role arn:aws:iam::000000000000:role/lambda-role --timeout 10
}

#######################################
# EVENT SOURCE MAPPINGS
#######################################
setup_event_sources() {
  # Enable DynamoDB stream
  awslocal dynamodb update-table --table-name OrderDB --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE
  sleep 5

  # Get stream ARN
  ORDERDB_STREAM_ARN=""
  while [ -z "$ORDERDB_STREAM_ARN" ] || [ "$ORDERDB_STREAM_ARN" = "None" ]; do
    ORDERDB_STREAM_ARN=$(awslocal dynamodb describe-table --table-name OrderDB --query 'Table.LatestStreamArn' --output text)
    echo "Waiting for OrderDB stream ARN..."
    sleep 2
  done
  echo "OrderDB stream ARN: $ORDERDB_STREAM_ARN"

  # Map stream to Lambda
  awslocal lambda create-event-source-mapping --function-name transfer-order-event --event-source-arn "$ORDERDB_STREAM_ARN" --starting-position LATEST

  # SQS to Lambda
  SQS_QUEUE_ARN="arn:aws:sqs:us-east-1:000000000000:order-queue"
  awslocal lambda create-event-source-mapping --function-name order-processing --batch-size 1 --event-source-arn "$SQS_QUEUE_ARN"
}

#######################################
# SES SETUP
#######################################
setup_ses() {
  awslocal ses verify-email-identity --email-address no-reply@localstack.cloud
}

#######################################
# EVENTBRIDGE (SCHEDULED LAMBDA)
#######################################
setup_eventbridge() {
  aws --endpoint-url=http://localhost:4566 --region us-east-1 events put-rule \
    --name weekly-analytics-report \
    --schedule-expression "rate(1 minute)"
  aws --endpoint-url=http://localhost:4566 --region us-east-1 lambda add-permission \
    --function-name generate-analytics-reports \
    --statement-id eventbridge-invoke \
    --action 'lambda:InvokeFunction' \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:us-east-1:000000000000:rule/weekly-analytics-report
  aws --endpoint-url=http://localhost:4566 --region us-east-1 events put-targets \
    --rule weekly-analytics-report \
    --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:000000000000:function:generate-analytics-reports"
}

#######################################
# API GATEWAY
#######################################
setup_apigateway() {
  echo "🌐 Setting up API Gateway"
  REST_API_ID="myid123"
  ROOT_RESOURCE_ID=$(awslocal apigateway create-rest-api --name "my-api" --tags '{"_custom_id_":"myid123"}' --query 'rootResourceId' --output text)
  RESOURCE_ID=$(awslocal apigateway create-resource --rest-api-id "$REST_API_ID" --parent-id "$ROOT_RESOURCE_ID" --path-part "order" --query 'id' --output text)
  awslocal apigateway put-method --rest-api-id "$REST_API_ID" --resource-id "$RESOURCE_ID" --http-method POST --authorization-type "NONE"
  awslocal apigateway put-integration --rest-api-id "$REST_API_ID" --resource-id "$RESOURCE_ID" --http-method POST --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:api-gateway-handler/invocations
  awslocal lambda add-permission --function-name api-gateway-handler --statement-id apigateway-order --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:000000000000:$REST_API_ID/*/POST/order"
  DEPLOYMENT_ID=$(awslocal apigateway create-deployment --rest-api-id "$REST_API_ID" --stage-name local --query 'id' --output text)
  awslocal apigateway get-resources --rest-api-id "$REST_API_ID"
  echo "✅ API Gateway endpoint: http://localhost:4566/restapis/$REST_API_ID/local/_user_request_/order"
}

#######################################
# MAIN EXECUTION
#######################################
main() {
  setup_s3
  setup_sqs
  setup_dynamodb
  deploy_lambdas
  setup_event_sources
  setup_ses
  setup_eventbridge
  setup_apigateway
  echo "✅ All resources created and configured!"
}

main
