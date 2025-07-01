const AWS = require('aws-sdk');
const sqs = new AWS.SQS({ endpoint: 'http://localhost:4566' });

// Lambda handler for API Gateway requests
exports.handler = async (event) => {
    // Log the received event from API Gateway
    console.log("[API-GATEWAY-HANDLER] API Gateway handler received event:", JSON.stringify(event));
    
    try {
        // Lire la clé d'idempotence dans les headers
        const idempotenceKey = event.headers && (event.headers['Idempotence-Key'] || event.headers['idempotence-key']);
        if (!idempotenceKey) {
            return {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Idempotence-Key',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST',
                    'Content-Type': 'application/json'
                },
                statusCode: 400,
                body: JSON.stringify({
                    error: "Missing Idempotence-Key header"
                })
            };
        }
        
        // Parse the request body from the incoming event
        const body = JSON.parse(event.body);
        
        // Validate the input fields (all are required)
        if (
            !body.name || !body.firstname || !body.email || !body.address ||
            !body.product || typeof body.quantity !== 'number' || typeof body.price !== 'number'
        ) {
            // Return a 400 Bad Request if validation fails
            return {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST',
                    'Content-Type': 'application/json'
                },
                statusCode: 400,
                body: JSON.stringify({
                    error: "Missing required parameters: name, firstname, email, address, product, quantity, price"
                })
            };
        }
        
        // Generate a unique request ID for tracking
        const requestId = idempotenceKey || Date.now().toString() + '-' + Math.random().toString(36).substring(2, 15);
        
        // Create a message object to send to SQS
        const message = {
            ...body,
            requestId: requestId,
            timestamp: new Date().toISOString()
        };
        
        // SQS queue URL (LocalStack)
        const queueUrl = 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/order-queue';
        
        // Send the message to the SQS queue
        await sqs.sendMessage({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message)
        }).promise();
        
        console.log(`[API-GATEWAY-HANDLER] Message sent to SQS with requestId: ${requestId}`);
        
        // Return a 202 Accepted response with the request ID
        return {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Idempotence-Key',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Content-Type': 'application/json'
            },
            statusCode: 202, // Accepted
            body: JSON.stringify({
                requestId: requestId,
                status: 'processing',
                message: 'Your order has been queued for processing'
            })
        };
    } catch (error) {
        // Log any error that occurs during processing
        console.error("[API-GATEWAY-HANDLER] Error processing request:", error);
        return {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Content-Type': 'application/json'
            },
            statusCode: 500,
            body: JSON.stringify({
                error: `Internal server error: ${error.message}`
            })
        };
    }
};