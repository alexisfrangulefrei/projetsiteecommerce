const AWS = require('aws-sdk');
const sqs = new AWS.SQS({ endpoint: 'http://localhost:4566' });

exports.handler = async (event) => {
    console.log("API Gateway handler received event:", JSON.stringify(event));
    
    try {
        // Parse the request body
        const body = JSON.parse(event.body);
        console.log("Request body:", body);
        
        // Validate the input
        if (body.num1 === undefined || body.num2 === undefined) {
            return {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST',
                    'Content-Type': 'application/json'
                },
                statusCode: 400,
                body: JSON.stringify({
                    error: "Missing required parameters: num1 and num2"
                })
            };
        }
        
        // Generate a unique request ID
        const requestId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 15);
        
        // Create a message with the request data
        const message = {
            num1: body.num1,
            num2: body.num2,
            requestId: requestId,
            timestamp: new Date().toISOString()
        };
        
        // Send the message to SQS
        const queueUrl = 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/multiplication-queue';
        
        await sqs.sendMessage({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message)
        }).promise();
        
        console.log(`Message sent to SQS with requestId: ${requestId}`);
        
        // Return a response immediately with the request ID
        return {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Content-Type': 'application/json'
            },
            statusCode: 202, // Accepted
            body: JSON.stringify({
                requestId: requestId,
                status: 'processing',
                message: 'Your calculation has been queued for processing',
                resultUrl: `http://localhost:4566/frontend/results/${requestId}.json`
            })
        };
    } catch (error) {
        console.error("Error processing request:", error);
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
