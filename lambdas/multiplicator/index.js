const AWS = require('aws-sdk');
// We'll initialize S3 client inside functions with more specific options
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Handler for processing SQS messages
exports.handler = async (event) => {
    console.log("SQS multiplicator lambda triggered with event:", JSON.stringify(event));
    
    // SQS event contains Records array
    if (event.Records && Array.isArray(event.Records)) {
        const results = [];
        
        // Process each message in the batch
        for (const record of event.Records) {
            try {
                // Parse the message body
                const messageBody = JSON.parse(record.body);
                console.log("Processing message:", messageBody);
                
                // Extract request data
                const { num1, num2, requestId } = messageBody;
                
                console.log(`Starting calculation for requestId: ${requestId}, nums: ${num1} and ${num2}`);
                
                // Simulate long processing
                await sleep(4000);
                
                // Do the calculation
                const product = num1 * num2;
                console.log(`Calculation complete: ${num1} * ${num2} = ${product}`);
                
                // Store the result in S3
                const result = {
                    requestId,
                    status: 'completed',
                    calculation: {
                        num1,
                        num2,
                        product
                    },
                    result: `Le produit de ${num1} et ${num2} est ${product}`,
                    completedAt: new Date().toISOString()
                };
                
                // Use more specific endpoint configuration for LocalStack
                const s3Local = new AWS.S3({
                    endpoint: 'http://host.docker.internal:4566',
                    s3ForcePathStyle: true,
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    region: 'us-east-1'
                });

                await s3Local.putObject({
                    Bucket: 'frontend',
                    Key: `results/${requestId}.json`,
                    Body: JSON.stringify(result),
                    ContentType: 'application/json'
                }).promise();
                
                // Also log the result to make it easily accessible for testing
                console.log(`RESULT DATA: ${JSON.stringify(result)}`);
                
                console.log(`Result stored in S3 for requestId: ${requestId}`);
                results.push({
                    requestId,
                    success: true
                });
                
            } catch (error) {
                console.error("Error processing SQS message:", error);
                
                // Try to extract requestId for error reporting
                let requestId = 'unknown';
                try {
                    const messageBody = JSON.parse(record.body);
                    requestId = messageBody.requestId || 'unknown';
                } catch (e) {
                    console.error("Could not parse message body for error reporting");
                }
                
                // Store error in S3
                try {
                    const errorResult = {
                        requestId,
                        status: 'error',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                    
                    // Use more specific endpoint configuration for LocalStack
                    const s3Local = new AWS.S3({
                        endpoint: 'http://host.docker.internal:4566',
                        s3ForcePathStyle: true,
                        accessKeyId: 'test',
                        secretAccessKey: 'test',
                        region: 'us-east-1'
                    });

                    await s3Local.putObject({
                        Bucket: 'frontend',
                        Key: `results/${requestId}.json`,
                        Body: JSON.stringify(errorResult),
                        ContentType: 'application/json'
                    }).promise();
                    
                    // Also log the error to make it easily accessible for testing
                    console.log(`ERROR DATA: ${JSON.stringify(errorResult)}`);
                    
                    console.log(`Error stored in S3 for requestId: ${requestId}`);
                } catch (s3Error) {
                    console.error("Failed to store error in S3:", s3Error);
                }
                
                results.push({
                    requestId,
                    success: false,
                    error: error.message
                });
            }
        }
        
        return {
            batchItemFailures: results
                .filter(r => !r.success)
                .map(r => ({ itemIdentifier: r.requestId }))
        };
    } else if (event.body) {
        // For backward compatibility - direct API Gateway invocation
        try {
            let body = JSON.parse(event.body);
            console.log("Direct invocation with body:", body);
            await sleep(7000); // Keep the delay for testing
            const product = body.num1 * body.num2;
            console.log("Direct calculation result:", product);
            
            return {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST',
                    'Content-Type': 'application/json'
                },
                statusCode: 200,
                body: JSON.stringify({
                    result: `Le produit de ${body.num1} et ${body.num2} est ${product}`
                })
            };
        } catch (error) {
            console.error("Error in direct invocation:", error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }
    } else {
        // Unknown event type
        console.error("Unknown event type:", event);
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid event format" })
        };
    }
};
