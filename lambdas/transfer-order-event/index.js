const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamo = new DynamoDBClient({
  endpoint: 'http://host.docker.internal:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});

exports.handler = async (event) => {
  try {
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
        console.log(`[DynamoDB] Inserting event: ${eventId}`);
        await dynamo.send(new PutItemCommand({
          TableName: 'OrderEventsDB',
          Item: orderEvent
        }));
        console.log(`[DynamoDB] Event inserted: ${eventId}`);
      }
    }
  } catch (err) {
    console.error('transfer-order-event Lambda error:', err);
    throw err;
  }
};