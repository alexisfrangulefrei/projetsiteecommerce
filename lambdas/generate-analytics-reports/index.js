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

exports.handler = async () => {
  console.log('Starting analytics report generation from DynamoDB');
  let items = [];
  try {
    const data = await dynamo.send(new ScanCommand({ TableName: 'OrderEventsDB' }));
    items = (data.Items || []).map(item => {
      // Conversion simple des attributs DynamoDB vers JS
      return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, Object.values(v)[0]]));
    });
    console.log(`Number of events fetched from DynamoDB: ${items.length}`);
  } catch (err) {
    console.error('Error fetching data from DynamoDB:', err);
    throw err;
  }

  const date = new Date().toISOString().split('T')[0];
  const key = `analytics-report-${date}.json`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: 'analytics-reports',
      Key: key,
      Body: JSON.stringify(items, null, 2),
      ContentType: 'application/json'
    }));
    console.log(`Report uploaded to S3: ${key}`);
  } catch (err) {
    console.error('Error uploading report to S3:', err);
    throw err;
  }

  console.log('Analytics report generated successfully');
  return { status: 'success', key };
};