const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

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

// Lambda handler to generate analytics reports from DynamoDB and upload to S3
exports.handler = async () => {
  // Start the analytics report generation process
  console.log('[GENERATE-ANALYTICS-REPORTS] Starting analytics report generation from DynamoDB');
  let items = [];
  try {
    // Scan the OrderEventsDB table to fetch all events
    const data = await dynamo.send(new ScanCommand({ TableName: 'OrderEventsDB' }));
    items = (data.Items || []).map(item => {
      // Convert DynamoDB attributes to plain JS objects
      return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, Object.values(v)[0]]));
    });
    console.log(`[GENERATE-ANALYTICS-REPORTS] Number of events fetched from DynamoDB: ${items.length}`);
  } catch (err) {
    // Log any error during DynamoDB scan
    console.error('[GENERATE-ANALYTICS-REPORTS] Error fetching data from DynamoDB:', err);
    throw err;
  }

  const date = new Date().toISOString().split('T')[0];
  const key = `analytics-report-${date}.json`;

  try {
    // Upload the analytics report as a JSON file to S3
    await s3.send(new PutObjectCommand({
      Bucket: 'analytics-reports',
      Key: key,
      Body: JSON.stringify(items, null, 2),
      ContentType: 'application/json'
    }));
    console.log(`[GENERATE-ANALYTICS-REPORTS] Report uploaded to S3: ${key}`);
  } catch (err) {
    // Log any error during S3 upload
    console.error('[GENERATE-ANALYTICS-REPORTS] Error uploading report to S3:', err);
    throw err;
  }

  // Final log for successful report generation
  console.log('[GENERATE-ANALYTICS-REPORTS] Analytics report generated successfully');
  return { status: 'success', key };
};