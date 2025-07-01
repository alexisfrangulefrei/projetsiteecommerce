#!/bin/bash

set -e

echo "➡️ Création du bucket S3 pour le front"
awslocal s3 mb s3://frontend

echo "📁 Upload du front sur S3"
awslocal s3 cp /var/frontend/index.html s3://frontend/index.html --content-type text/html
awslocal s3 cp /var/products.json s3://frontend/products.json --content-type application/json

awslocal s3 website s3://frontend/ --index-document index.html

echo "➡️ Création du bucket S3 pour les factures"
awslocal s3 mb s3://invoices

echo "🔄 Création de la queue SQS pour le traitement asynchrone"
# Create the SQS queue
awslocal sqs create-queue --queue-name order-queue

# Set the SQS queue URL and ARN directly (we know the format for LocalStack)
SQS_QUEUE_URL="http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/order-queue"
SQS_QUEUE_ARN="arn:aws:sqs:us-east-1:000000000000:order-queue"

echo "📦 Déploiement des lambdas"

echo "⏳ Attente du démarrage de DynamoDB..."
until awslocal dynamodb list-tables; do sleep 2; done

awslocal dynamodb delete-table --table-name OrderDB || true
awslocal dynamodb delete-table --table-name ArchiveDB || true

awslocal dynamodb create-table \
  --table-name OrderDB \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --attribute-definitions AttributeName=orderId,AttributeType=S \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table \
  --table-name ArchiveDB \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --attribute-definitions AttributeName=orderId,AttributeType=S \
  --billing-mode PAY_PER_REQUEST

for table in OrderDB ArchiveDB; do
  echo "⏳ Attente de la création de la table $table..."
  until awslocal dynamodb describe-table --table-name $table > /dev/null 2>&1; do
    sleep 1
  done
  echo "✅ Table $table créée."
done
echo "Tables DynamoDB créées :"
awslocal dynamodb list-tables

# Create the OrderEventsDB table to store events
awslocal dynamodb create-table \
  --table-name OrderEventsDB \
  --key-schema AttributeName=eventId,KeyType=HASH \
  --attribute-definitions AttributeName=eventId,AttributeType=S \
  --billing-mode PAY_PER_REQUEST

echo "⏳ Waiting for OrderEventsDB table creation..."
until awslocal dynamodb describe-table --table-name OrderEventsDB > /dev/null 2>&1; do
  sleep 1
done
echo "✅ OrderEventsDB table created."

# Deploy the transfer-order-event lambda
awslocal lambda create-function \
  --function-name transfer-order-event \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb:///var/task/transfer-order-event.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 30 \

# Enable stream
awslocal dynamodb update-table \
  --table-name OrderDB \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE

sleep 5 # (optionnel mais aide parfois)

# Debug: show table description
echo "Describe OrderDB:"
awslocal dynamodb describe-table --table-name OrderDB

# Wait for stream ARN
ORDERDB_STREAM_ARN=""
while [ -z "$ORDERDB_STREAM_ARN" ] || [ "$ORDERDB_STREAM_ARN" = "None" ]; do
  ORDERDB_STREAM_ARN=$(awslocal dynamodb describe-table --table-name OrderDB --query 'Table.LatestStreamArn' --output text)
  echo "Waiting for OrderDB stream ARN..."
  sleep 2
done
echo "OrderDB stream ARN: $ORDERDB_STREAM_ARN"

# Map the OrderDB stream to the transfer-order-event lambda
awslocal lambda create-event-source-mapping \
  --function-name transfer-order-event \
  --event-source-arn "$ORDERDB_STREAM_ARN" \
  --starting-position LATEST

# Create the traitement-commande Lambda function
awslocal lambda create-function \
  --function-name traitement-commande \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb:///var/task/traitement-commande.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 30

# Create the API Gateway handler Lambda function
awslocal lambda create-function \
  --function-name api-gateway-handler \
  --runtime nodejs18.x \
  --handler index.handler \
  --zip-file fileb:///var/task/api-gateway-handler.zip \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --timeout 10

# Set up the SQS event source mapping for the traitement-commande Lambda
awslocal lambda create-event-source-mapping \
  --function-name traitement-commande \
  --batch-size 1 \
  --event-source-arn "$SQS_QUEUE_ARN"

# Verify the email identity
awslocal ses verify-email-identity --email-address no-reply@localstack.cloud

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
echo "Creating /order resource..."
RESOURCE_ID=$(awslocal apigateway create-resource \
  --rest-api-id "$REST_API_ID" \
  --parent-id "$ROOT_RESOURCE_ID" \
  --path-part "order" \
  --query 'id' \
  --output text)
echo "Order resource created with ID: $RESOURCE_ID"

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
  --statement-id apigateway-order \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:000000000000:$REST_API_ID/*/POST/order"
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
echo "✅ API Gateway endpoint: http://localhost:4566/restapis/$REST_API_ID/local/_user_request_/order"
