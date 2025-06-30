# LocalStack Example 3: Asynchronous Job Processing

This example demonstrates an asynchronous job processing architecture using LocalStack to emulate AWS services locally.

## Overview

Unlike the synchronous examples in localstack-1 and localstack-2, this tutorial implements a production-like async pattern where:
1. API requests are immediately acknowledged with a job ID
2. Processing happens asynchronously in the background
3. Results are stored and can be retrieved later

## Components

### AWS Services (via LocalStack)
- **API Gateway**: REST API endpoint for receiving requests
- **Lambda Functions**:
  - `api-gateway-handler`: Receives requests and queues jobs
  - `multiplicator`: Processes jobs from the queue
- **SQS Queue**: `multiplication-queue` for async job management
- **S3 Bucket**: `frontend` for static hosting and result storage

### Infrastructure
- **LocalStack**: AWS service emulation
- **Docker Compose**: Container orchestration

## Getting Started

### Prerequisites
- Docker and Docker Compose installed
- Node.js for local development (optional)

### Running the Example

1. Start the services:
   ```bash
   npm start
   ```
   This will:
   - Package Lambda functions into zip files
   - Start LocalStack container
   - Initialize all AWS resources via bootstrap script

2. Stop the services:
   ```bash
   npm stop
   ```

## Accessing the Application

### Frontend
- **URL**: http://localhost:4566/frontend/index.html
- Simple web interface to submit multiplication requests

### API Endpoint
- **URL**: `POST http://localhost:4566/restapis/myid123/local/_user_request_/multiply`
- **Body**: 
  ```json
  {
    "num1": 5,
    "num2": 10
  }
  ```
- **Response**:
  ```json
  {
    "requestId": "1234567890-abc123",
    "status": "processing",
    "message": "Your calculation has been queued for processing",
    "resultUrl": "http://localhost:4566/frontend/results/1234567890-abc123.json"
  }
  ```

### LocalStack Dashboard
- **URL**: http://localhost:4566
- Monitor AWS resources and logs

## How It Works

1. **Request Submission**: User submits two numbers via the frontend
2. **Job Queuing**: API handler validates input and sends a message to SQS
3. **Async Processing**: Worker Lambda picks up the message, calculates the result
4. **Result Storage**: Result is saved to S3 as a JSON file
5. **Result Retrieval**: User can fetch the result from the provided URL

## Development Notes

- Lambda functions are automatically deployed on startup
- Frontend changes require restarting services or manual S3 sync
- Processing includes a 4-second delay to simulate real work
- Results are stored at `s3://frontend/results/{requestId}.json`

## Troubleshooting

- Check LocalStack logs: `docker logs localstack3`
- Verify services are running: `docker-compose ps`
- Ensure Lambda zips exist: `ls lambdas/*.zip`