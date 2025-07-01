const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const http = require('http');

const s3 = new S3Client({
  endpoint: 'http://host.docker.internal:4566',
  forcePathStyle: true,
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});
const dynamo = new DynamoDBClient({
  endpoint: 'http://host.docker.internal:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});
const ses = new SESClient({
  endpoint: 'http://host.docker.internal:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});

function generateOrderId() {
  return Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10);
}

async function checkStock(productName, requestedQuantity) {
  const url = 'http://host.docker.internal:4566/frontend/products.json';
  console.log(`[Stock] Checking stock for product: ${productName}, requested: ${requestedQuantity}`);
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const products = JSON.parse(data);
          const product = products.find(p => p.name === productName);
          if (!product) {
            console.log(`[Stock] Product not found: ${productName}`);
            return resolve({ isStockValid: false, available: 0 });
          }
          const ok = product.quantite >= requestedQuantity;
          console.log(`[Stock] Found product: ${productName}, stock: ${product.quantite}, ok: ${ok}`);
          resolve({ isStockValid: ok, available: product.quantite });
        } catch (e) {
          console.error('[Stock] Error parsing products.json:', e);
          reject(e);
        }
      });
    }).on('error', (err) => {
      console.error('[Stock] Error fetching products.json:', err);
      reject(err);
    });
  });
}

// Lambda handler for processing orders from SQS
exports.handler = async (event) => {
  // Log the received SQS event
  console.log("[ORDER-PROCESSING] SQS order-processing lambda triggered with event:", JSON.stringify(event));
  if (event.Records && Array.isArray(event.Records)) {
    const results = [];
    for (const record of event.Records) {
      try {
        // Parse the SQS message body
        const messageBody = JSON.parse(record.body);
        console.log('[ORDER-PROCESSING] Processing message for product :', messageBody.product);
        const { name, firstname, email, address, product, quantity, price, requestId } = messageBody;
        const orderId = requestId || generateOrderId();
        if (requestId) {
          console.log(`[ORDER-PROCESSING] Order ID from idempotence key: ${requestId}`);
          // Check if the order already exists in the database
          const dynamoResult = await dynamo.send(new GetItemCommand({
            TableName: 'OrderDB',
            Key: { orderId: { S: requestId } }
          }));
          if (dynamoResult.Item) {
            console.log(`[ORDER-PROCESSING] Order already exists in the database: ${requestId}`);
            results.push({ orderId: requestId, success: true });
            continue;
          }
        }
        const orderDate = new Date().toISOString();
        const estimatedDeliveryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        // Check product stock
        const stockResult = await checkStock(product, quantity);
        const status = stockResult.isStockValid ? 'valid' : 'invalid';
        const availableStock = stockResult.available;
        console.log(`[ORDER-PROCESSING] Stock status for order ${orderId}: ${status}`);
        // 1. Save order in DynamoDB (OrderDB)
        console.log(`[ORDER-PROCESSING] Saving order ${orderId} to OrderDB...`);
        await dynamo.send(new PutItemCommand({
          TableName: 'OrderDB',
          Item: {
            orderId: { S: orderId },
            name: { S: name },
            firstname: { S: firstname },
            email: { S: email },
            address: { S: address },
            product: { S: product },
            quantity: { N: quantity.toString() },
            price: { N: price.toString() },
            orderDate: { S: orderDate },
            status: { S: status }
          }
        }));
        // 2. Archive order in DynamoDB (ArchiveDB)
        console.log(`[ORDER-PROCESSING] Archiving order ${orderId} to ArchiveDB...`);
        await dynamo.send(new PutItemCommand({
          TableName: 'ArchiveDB',
          Item: {
            orderId: { S: orderId },
            archivedAt: { S: orderDate },
            status: { S: status }
          }
        }));
        // 3. Generate invoice in S3 if order is valid
        if (status === 'valid') {
          const invoice = {
            orderId,
            name,
            firstname,
            email,
            address,
            product,
            quantity,
            price,
            orderDate,
            estimatedDeliveryDate,
            status
          };
          console.log(`[ORDER-PROCESSING] Generating invoice for order ${orderId} in S3...`);
          await s3.send(new PutObjectCommand({
            Bucket: 'invoices',
            Key: `${orderId}.json`,
            Body: JSON.stringify(invoice),
            ContentType: 'application/json'
          }));
        }
        // 4. Send confirmation or error email via SES (simulated)
        let emailBody;
        if (status === 'valid') {
          emailBody = `Thank you ${firstname} ${name} for your order #${orderId} :\nProduct: ${product}\nQuantity: ${quantity}\nTotal price: ${price} €\nStatus: ${status}`;
        } else {
          emailBody = `Sorry ${firstname} ${name}, your order #${orderId} for product '${product}' could not be processed because the requested quantity (${quantity}) exceeds the available stock (${availableStock}).\nPlease place a new order with a quantity less than or equal to ${availableStock}.`;
        }
        console.log(`[ORDER-PROCESSING] Sending email for order ${orderId} to ${email}...`);
        await ses.send(new SendEmailCommand({
          Destination: { ToAddresses: [email] },
          Message: {
            Body: { Text: { Data: emailBody } },
            Subject: { Data: `Order confirmation #${orderId}` }
          },
          Source: 'no-reply@localstack.cloud'
        }));
        console.log(`[ORDER-PROCESSING] Order ${orderId} processed successfully.`);
        results.push({ orderId, success: true });
      } catch (error) {
        // Log any error during order processing
        console.error(`[ORDER-PROCESSING] Order processing error:`, error, record.messageId);
        results.push({ orderId: record.messageId, success: false, error: error.message });
      }
    }
    // Return batch item failures for SQS partial batch response
    return {
      batchItemFailures: results.filter(r => !r.success).map(r => ({ itemIdentifier: r.orderId }))
    };
  } else {
    // Log invalid event format
    console.error('[ORDER-PROCESSING] Invalid event format:', event);
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid event format" }) };
  }
};
