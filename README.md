# MaslaXat - Online Legal Platform

## Overview
MaslaXat is a comprehensive online legal platform designed for the Uzbekistan market, providing seamless connections between clients and legal professionals through video consultations, document services, and AI-powered legal assistance.

## Platform Features

### Core Services
- **Video Consultations**: WebRTC-based real-time video calls with recording capabilities
- **Legal Document Services**: AI-enhanced document generation and review
- **Payment Integration**: Support for Payme, Click, and Uzcard payment systems
- **Multi-language Support**: Uzbek, Russian, and English interfaces
- **Mobile Application**: Native mobile app with full functionality
- **Admin Dashboard**: Comprehensive analytics and management tools

### Technical Architecture
- **Microservices Architecture**: 10+ independent services for scalability
- **Real-time Communication**: Socket.io for live chat and notifications
- **AI Integration**: OpenAI GPT-4 and Claude-3 for legal consultations
- **Database**: PostgreSQL with Redis caching and Elasticsearch for search
- **Security**: JWT authentication, 2FA, and comprehensive security measures
- **Containerization**: Docker with Docker Compose orchestration

## File Structure

```
maslaXat-platform/
├── backend/                 # Backend microservices
│   ├── auth-service/       # Authentication and authorization
│   ├── consultation-service/ # Consultation booking and management
│   ├── video-service/      # WebRTC video calling
│   ├── payment-service/    # Payment processing
│   ├── ai-service/         # AI-powered legal assistance
│   ├── document-service/   # Document management
│   ├── notification-service/ # Email, SMS, push notifications
│   ├── analytics-service/  # Analytics and reporting
│   ├── monitoring-service/ # System monitoring and logging
│   └── gateway/           # API Gateway
├── frontend/              # React.js web application
├── mobile/               # React Native mobile app
├── admin/               # Admin panel dashboard
├── database/            # Database schemas and migrations
├── docker/             # Docker configurations
├── docs/              # Documentation
└── deployment/       # Deployment scripts and configurations
```

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd maslaXat-platform
```

2. Setup environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the platform:
```bash
docker-compose up -d
```

4. Access the applications:
- Frontend: http://localhost:3000
- Admin Panel: http://localhost:3001
- API Gateway: http://localhost:8080
- Mobile App: Run in development mode

### Environment Configuration

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/maslaxat
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret

# AI Services
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-key

# Payment Systems
PAYME_MERCHANT_ID=your-payme-id
CLICK_MERCHANT_ID=your-click-id
UZCARD_MERCHANT_ID=your-uzcard-id

# Email Service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password

# File Storage
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_BUCKET_NAME=your-bucket

# Video Service
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
```

## Services Documentation

### Authentication Service
- JWT-based authentication with refresh tokens
- Two-factor authentication (2FA)
- Social login integration
- Role-based access control

### Consultation Service
- Booking management
- Schedule coordination
- Consultation history
- Rating and review system

### Video Service
- WebRTC implementation
- Call recording
- Screen sharing
- Chat integration

### Payment Service
- Multiple payment provider support
- Transaction history
- Refund processing
- Invoice generation

### AI Service
- Legal document analysis
- Contract review
- Legal advice generation
- Multi-language support

### Document Service
- File upload and storage
- Document templates
- AI-enhanced editing
- Version control

### Notification Service
- Email notifications
- SMS alerts
- Push notifications
- Real-time updates

### Analytics Service
- User behavior tracking
- Revenue analytics
- Consultation metrics
- Performance monitoring

## API Documentation

API documentation is available at:
- Swagger UI: http://localhost:8080/docs
- OpenAPI Spec: http://localhost:8080/api-docs

## Mobile Application

The React Native mobile app includes:
- Video calling with WebRTC
- Document sharing
- Real-time chat
- Push notifications
- Offline capabilities

## Admin Panel

The admin dashboard provides:
- User management
- Analytics and reporting
- System monitoring
- Content management
- Financial oversight

## Security Features

- JWT authentication with refresh tokens
- Two-factor authentication
- Rate limiting and DDoS protection
- Data encryption at rest and in transit
- XSS and CSRF protection
- Input validation and sanitization
- Audit logging

## Monitoring and Logging

- Application performance monitoring
- Error tracking and reporting
- Real-time system metrics
- Log aggregation and analysis
- Health checks and alerts

## Deployment

### Development
```bash
docker-compose -f docker-compose.dev.yml up
```

### Production
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Scaling
```bash
docker-compose up -d --scale consultation-service=3
```

## Testing

```bash
# Run all tests
npm test

# Run specific service tests
npm run test:auth
npm run test:consultation

# Run integration tests
npm run test:integration
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please contact:
- Email: support@maslaxat.uz
- Documentation: /docs
- Issues: GitHub Issues

## Roadmap

- [ ] Blockchain integration for document verification
- [ ] Voice recognition for consultations
- [ ] Advanced AI legal research
- [ ] Integration with government services
- [ ] Multi-currency support
- [ ] Advanced analytics dashboard