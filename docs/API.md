# MaslaXat API Documentation

## Overview

MaslaXat API is a RESTful API that provides comprehensive functionality for the online legal platform. The API follows REST conventions and returns JSON responses.

## Base URL

```
Development: http://localhost:8080/api/v1
Production: https://api.maslaxat.uz/api/v1
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Response Format

All responses are in JSON format with the following structure:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `422` - Validation Error
- `500` - Internal Server Error

## API Endpoints

### Authentication

#### Register User
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "phone": "+998901234567",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "patronymic": "Smith",
  "role": "client"
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123",
  "rememberMe": false
}
```

#### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Logout
```http
POST /auth/logout
Authorization: Bearer <token>
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Verify Email
```http
GET /auth/verify-email?token=<verification-token>
```

#### Password Reset
```http
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Reset Password
```http
POST /auth/reset-password
Content-Type: application/json

{
  "token": "reset-token",
  "newPassword": "newSecurePassword123"
}
```

### Two-Factor Authentication

#### Setup 2FA
```http
POST /auth/2fa/setup
Authorization: Bearer <token>
```

#### Verify 2FA Setup
```http
POST /auth/2fa/verify-setup
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "123456"
}
```

#### Disable 2FA
```http
POST /auth/2fa/disable
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "123456"
}
```

### Users

#### Get Current User
```http
GET /users/me
Authorization: Bearer <token>
```

#### Update Profile
```http
PUT /users/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+998901234567"
}
```

#### Upload Avatar
```http
POST /users/me/avatar
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary-data>
```

### Lawyers

#### Get Lawyers List
```http
GET /lawyers?page=1&limit=20&specialization=civil&rating=4.5
Authorization: Bearer <token>
```

#### Get Lawyer Profile
```http
GET /lawyers/{lawyerId}
Authorization: Bearer <token>
```

#### Create Lawyer Profile
```http
POST /lawyers/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "licenseNumber": "LIC-12345",
  "specialization": "Civil Law, Family Law",
  "experienceYears": 10,
  "education": "Tashkent State University of Law",
  "consultationFee": 100000,
  "bio": "Experienced lawyer...",
  "languages": ["uz", "ru", "en"]
}
```

#### Update Lawyer Profile
```http
PUT /lawyers/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "specialization": "Civil Law, Family Law, Business Law",
  "consultationFee": 120000
}
```

### Consultations

#### Get Consultations
```http
GET /consultations?page=1&limit=20&status=pending
Authorization: Bearer <token>
```

#### Create Consultation
```http
POST /consultations
Authorization: Bearer <token>
Content-Type: application/json

{
  "lawyerId": "lawyer-uuid",
  "scheduledAt": "2023-12-25T10:00:00Z",
  "duration": 60,
  "topic": "Family Law Consultation",
  "description": "Need advice on divorce proceedings",
  "type": "video",
  "priority": "high"
}
```

#### Get Consultation Details
```http
GET /consultations/{consultationId}
Authorization: Bearer <token>
```

#### Update Consultation Status
```http
PUT /consultations/{consultationId}/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "confirmed",
  "notes": "Client confirmed availability"
}
```

#### Rate Consultation
```http
POST /consultations/{consultationId}/rate
Authorization: Bearer <token>
Content-Type: application/json

{
  "rating": 5,
  "review": "Excellent service, very helpful lawyer"
}
```

### Video Calls

#### Start Video Call
```http
POST /video/calls/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "consultationId": "consultation-uuid"
}
```

#### Join Video Call
```http
POST /video/calls/{callId}/join
Authorization: Bearer <token>
```

#### End Video Call
```http
POST /video/calls/{callId}/end
Authorization: Bearer <token>
```

### Documents

#### Upload Document
```http
POST /documents
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary-data>
type: "contract"
category: "legal"
tags: ["important", "2023"]
```

#### Get Documents
```http
GET /documents?page=1&limit=20&type=contract
Authorization: Bearer <token>
```

#### Download Document
```http
GET /documents/{documentId}/download
Authorization: Bearer <token>
```

#### Delete Document
```http
DELETE /documents/{documentId}
Authorization: Bearer <token>
```

### Payments

#### Create Payment
```http
POST /payments
Authorization: Bearer <token>
Content-Type: application/json

{
  "consultationId": "consultation-uuid",
  "amount": 100000,
  "currency": "UZS",
  "provider": "payme",
  "type": "consultation_fee"
}
```

#### Get Payment Status
```http
GET /payments/{paymentId}/status
Authorization: Bearer <token>
```

#### Process Payment Callback
```http
POST /payments/callback
Content-Type: application/json

{
  "transactionId": "txn-123",
  "status": "completed",
  "amount": 100000,
  "provider": "payme"
}
```

### Messages

#### Get Messages
```http
GET /consultations/{consultationId}/messages?page=1&limit=50
Authorization: Bearer <token>
```

#### Send Message
```http
POST /consultations/{consultationId}/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "text",
  "content": "Hello, I need some advice"
}
```

#### Send File Message
```http
POST /consultations/{consultationId}/messages/file
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary-data>
```

### AI Assistant

#### Get Legal Advice
```http
POST /ai/advice
Authorization: Bearer <token>
Content-Type: application/json

{
  "question": "What are the requirements for starting a business in Uzbekistan?",
  "context": "I'm planning to open a software company"
}
```

#### Analyze Document
```http
POST /ai/analyze-document
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary-data>
documentType: "contract"
```

#### Generate Document
```http
POST /ai/generate-document
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "nda",
  "parties": {
    "partyA": "Company A",
    "partyB": "Company B"
  },
  "duration": "2 years"
}
```

### Notifications

#### Get Notifications
```http
GET /notifications?page=1&limit=20&isRead=false
Authorization: Bearer <token>
```

#### Mark Notification as Read
```http
PUT /notifications/{notificationId}/read
Authorization: Bearer <token>
```

#### Delete Notification
```http
DELETE /notifications/{notificationId}
Authorization: Bearer <token>
```

### Analytics

#### Get Dashboard Stats
```http
GET /analytics/dashboard
Authorization: Bearer <token>
```

#### Get User Analytics
```http
GET /analytics/users?startDate=2023-01-01&endDate=2023-12-31
Authorization: Bearer <token>
```

#### Get Revenue Analytics
```http
GET /analytics/revenue?period=monthly&year=2023
Authorization: Bearer <token>
```

#### Get Consultation Analytics
```http
GET /analytics/consultations?startDate=2023-01-01&endDate=2023-12-31
Authorization: Bearer <token>
```

### System

#### Health Check
```http
GET /health
```

#### System Status
```http
GET /system/status
Authorization: Bearer <token>
```

#### Get System Settings
```http
GET /system/settings
Authorization: Bearer <token>
```

#### Update System Settings
```http
PUT /system/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "app_name": "MaslaXat Legal Platform",
  "maintenance_mode": false
}
```

## WebSocket Events

The platform uses Socket.io for real-time communication. Connect to:

```
ws://localhost:8080
```

### Events

#### Connection
```javascript
socket.on('connect', () => {
  console.log('Connected to server');
});
```

#### Join Consultation Room
```javascript
socket.emit('join-consultation', {
  consultationId: 'consultation-uuid'
});
```

#### Send Message
```javascript
socket.emit('send-message', {
  consultationId: 'consultation-uuid',
  message: 'Hello world',
  type: 'text'
});
```

#### Receive Message
```javascript
socket.on('new-message', (data) => {
  console.log('New message:', data);
});
```

#### User Status Update
```javascript
socket.on('user-status-change', (data) => {
  console.log('User status changed:', data);
});
```

#### Consultation Status Update
```javascript
socket.on('consultation-status-change', (data) => {
  console.log('Consultation status changed:', data);
});
```

## Error Codes

| Code | Description |
|------|-------------|
| AUTH_001 | Invalid credentials |
| AUTH_002 | Token expired |
| AUTH_003 | Invalid token |
| AUTH_004 | Account not verified |
| AUTH_005 | Account suspended |
| USER_001 | User not found |
| USER_002 | Email already exists |
| USER_003 | Phone already exists |
| CONSULTATION_001 | Consultation not found |
| CONSULTATION_002 | Invalid consultation status |
| CONSULTATION_003 | Time slot not available |
| PAYMENT_001 | Payment failed |
| PAYMENT_002 | Invalid payment amount |
| DOCUMENT_001 | File too large |
| DOCUMENT_002 | Invalid file type |
| AI_001 | AI service unavailable |
| SYSTEM_001 | Internal server error |

## Rate Limiting

API endpoints are rate-limited to prevent abuse:

- **Authentication endpoints**: 5 requests per minute
- **General endpoints**: 100 requests per 15 minutes
- **File upload endpoints**: 10 requests per minute

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset time

## Pagination

List endpoints support pagination using the following parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

Response includes pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Filtering and Sorting

List endpoints support filtering and sorting:

### Filtering
```http
GET /lawyers?specialization=civil&rating=4.5&availability=available
```

### Sorting
```http
GET /consultations?sortBy=scheduledAt&sortOrder=desc
```

## File Uploads

File uploads support the following formats:
- Documents: PDF, DOC, DOCX, TXT (Max: 10MB)
- Images: JPG, JPEG, PNG, GIF (Max: 5MB)
- Audio: MP3, WAV (Max: 50MB)
- Video: MP4, AVI, MOV (Max: 100MB)

## SDKs and Libraries

Official SDKs are available for:
- JavaScript/Node.js
- Python
- PHP
- React Native

## Support

For API support and questions:
- Email: api-support@maslaxat.uz
- Documentation: https://docs.maslaxat.uz
- Status Page: https://status.maslaxat.uz