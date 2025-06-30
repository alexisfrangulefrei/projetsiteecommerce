#!/bin/bash

set -e

echo "➡️ Création du bucket S3 pour le front"
awslocal s3 mb s3://frontend

echo "📁 Upload du front sur S3"
awslocal s3 cp /var/frontend/index.html s3://frontend/index.html --content-type text/html

awslocal s3 website s3://frontend/ --index-document index.html

echo "🔄 Création de la queue SQS pour le traitement asynchrone"
# Create the SQS queue
echo "Creating SQS queue..."
awslocal sqs create-queue --queue-name multiplication-queue
echo "SQS queue created"

# Set the SQS queue URL and ARN directly (we know the format for LocalStack)
SQS_QUEUE_URL="http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/multiplication-queue"
SQS_QUEUE_ARN="arn:aws:sqs:us-east-1:000000000000:multiplication-queue"
echo "SQS queue URL: $SQS_QUEUE_URL"
echo "SQS queue ARN: $SQS_QUEUE_ARN"

echo "📦 Déploiement des lambdas"

# Create the results directory in S3
echo "Creating results directory in S3..."
awslocal s3api put-object --bucket frontend --key results/

# Create the multiplicator Lambda function (SQS subscriber)
echo "Creating multiplicator Lambda function..."
awslocal lambda create-function --function-name multiplicator \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb:///var/task/multiplicator.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 30

# Create the API Gateway handler Lambda function
echo "Creating API Gateway handler Lambda function..."
awslocal lambda create-function --function-name api-gateway-handler \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb:///var/task/api-gateway-handler.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 10

# Set up the SQS event source mapping for the multiplicator Lambda
echo "Setting up SQS event source mapping..."
EVENT_SOURCE_MAPPING=$(awslocal lambda create-event-source-mapping \
  --function-name multiplicator \
  --batch-size 1 \
  --event-source-arn "$SQS_QUEUE_ARN")

echo "Event source mapping created: $EVENT_SOURCE_MAPPING"

# https://docs.localstack.cloud/user-guide/aws/apigateway/
echo "🌐 Création de l'API Gateway"

# Create a REST API
echo "Creating REST API..."
REST_API_ID="myid123"
# Create REST API and get the root resource ID directly
ROOT_RESOURCE_ID=$(awslocal apigateway create-rest-api --name "my-api" --tags '{"_custom_id_":"myid123"}' --query 'rootResourceId' --output text)

echo "API Gateway created with ID: $REST_API_ID"
echo "Root resource ID: $ROOT_RESOURCE_ID"

# Create a resource
echo "Creating /multiply resource..."
RESOURCE_ID=$(awslocal apigateway create-resource \
  --rest-api-id "$REST_API_ID" \
  --parent-id "$ROOT_RESOURCE_ID" \
  --path-part "multiply" \
  --query 'id' \
  --output text)
echo "Multiply resource created with ID: $RESOURCE_ID"

# Add a method
echo "Adding POST method to resource..."
awslocal apigateway put-method \
  --rest-api-id "$REST_API_ID" \
  --resource-id "$RESOURCE_ID" \
  --http-method POST \
  --authorization-type "NONE"
echo "POST method added successfully"

# Add an integration
echo "Setting up Lambda integration..."
awslocal apigateway put-integration \
  --rest-api-id "$REST_API_ID" \
  --resource-id "$RESOURCE_ID" \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:api-gateway-handler/invocations
echo "Lambda integration added successfully"

# Add Lambda permission for API Gateway handler
echo "Adding Lambda permission for API Gateway handler..."
awslocal lambda add-permission \
  --function-name api-gateway-handler \
  --statement-id apigateway-multiply \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:000000000000:$REST_API_ID/*/POST/multiply"
echo "Lambda permission added successfully"

# Note: We're using environment variables DISABLE_CORS_CHECKS=1 and DISABLE_CUSTOM_CORS_APIGATEWAY=1 instead of manual CORS configuration
echo "Using environment variables for CORS configuration"

# Create a deployment
echo "Creating API deployment..."
DEPLOYMENT_ID=$(awslocal apigateway create-deployment \
  --rest-api-id "$REST_API_ID" \
  --stage-name local \
  --query 'id' \
  --output text)
echo "Deployment created with ID: $DEPLOYMENT_ID"

# Verify the resources
echo "Verifying API resources..."
awslocal apigateway get-resources --rest-api-id "$REST_API_ID"

echo "✅ API Gateway setup complete!"
echo "✅ API Gateway endpoint: http://localhost:4566/restapis/$REST_API_ID/local/_user_request_/multiply"
