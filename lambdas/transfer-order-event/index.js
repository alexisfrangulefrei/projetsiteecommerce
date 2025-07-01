const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamo = new DynamoDBClient({
  endpoint: 'http://host.docker.internal:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});

// Lambda handler to transfer order events from DynamoDB stream to OrderEventsDB
exports.handler = async (event) => {
  try {
    // Iterate over each record in the DynamoDB stream event
    for (const record of event.Records) {
      if (record.eventName === 'INSERT') {
        const newImage = record.dynamodb.NewImage;
        const eventId = newImage.orderId.S + '-' + Date.now();
        const orderEvent = {
          eventId: { S: eventId },
          orderId: { S: newImage.orderId.S },
          status: { S: newImage.status.S },
          eventDate: { S: newImage.orderDate.S }
        };
        // Log the insertion of a new event
        console.log(`[TRANSFER-ORDER-EVENT] Inserting event: ${eventId}`);
        await dynamo.send(new PutItemCommand({
          TableName: 'OrderEventsDB',
          Item: orderEvent
        }));
        console.log(`[TRANSFER-ORDER-EVENT] Event inserted: ${eventId}`);
      }
    }
  } catch (err) {
    // Log any error during the transfer process
    console.error('[TRANSFER-ORDER-EVENT] Lambda error:', err);
    throw err;
  }
};