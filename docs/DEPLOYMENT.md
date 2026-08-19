# MaslaXat Platform Deployment Guide

> **DEPRECATED: DO NOT USE THIS FILE TO DEPLOY OR RESTORE MASLAXAT.** It describes a legacy architecture and unsafe historical commands. Use the current release status in `DEPLOY.md`, the approval and rollback procedure in `docs/runbooks/deploy-rollback.md`, and the protected backup procedure in `docs/runbooks/backup-restore.md`. Production actions still require explicit approval and all current release gates.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Setup](#environment-setup)
- [Deployment Options](#deployment-options)
- [Configuration](#configuration)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Maintenance](#maintenance)

## Prerequisites

### System Requirements
- **Operating System**: Linux (Ubuntu 20.04+ recommended), macOS, Windows 10+
- **Memory**: Minimum 8GB RAM (16GB recommended for production)
- **Storage**: Minimum 50GB free space
- **Network**: Stable internet connection

### Software Requirements
- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **Git**: 2.20+
- **Node.js**: 18+ (for development)
- **PostgreSQL Client**: psql (for database management)

### Optional Tools
- **Make**: For using Makefile commands
- **Certbot**: For SSL certificate management
- **Monitoring Tools**: Prometheus, Grafana

## Quick Start

### 1. Clone the Repository
```bash
git clone <repository-url>
cd maslaXat-platform
```

### 2. Setup Environment
```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### 3. Deploy Platform
```bash
# Make deployment script executable
chmod +x deployment/deploy.sh

# Run deployment
./deployment/deploy.sh
```

### 4. Access Applications
- **Frontend**: http://localhost:3000
- **Admin Panel**: http://localhost:3001
- **API Documentation**: http://localhost:8080/docs

## Environment Setup

### Environment Variables

Create `.env` file with the following configuration:

```env
# Application
NODE_ENV=production
APP_URL=http://localhost:3000
ADMIN_URL=http://localhost:3001
API_URL=http://localhost:8080

# Database
DATABASE_URL=postgresql://postgres:postgres123@postgres:5432/maslaxat
REDIS_URL=redis://redis:6379
ELASTICSEARCH_URL=http://elasticsearch:9200

# Security
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-secret
BCRYPT_ROUNDS=12

# AI Services
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Payment Systems
PAYME_MERCHANT_ID=your-payme-merchant-id
CLICK_MERCHANT_ID=your-click-merchant-id
UZCARD_MERCHANT_ID=your-uzcard-merchant-id

# Email Service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Storage
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_REGION=your-region
AWS_BUCKET_NAME=maslaxat-files

# Video Service
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token

# Monitoring
SENTRY_DSN=your-sentry-dsn
NEW_RELIC_LICENSE_KEY=your-new-relic-key
LOG_LEVEL=info
```

### Configuration Files

#### Docker Compose Override (docker-compose.override.yml)
```yaml
version: '3.8'
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres123}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data

  redis:
    volumes:
      - ./data/redis:/data
```

#### Nginx Configuration
Location: `docker/nginx/nginx.conf`

## Deployment Options

### 1. Local Development

```bash
# Start development environment
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Or use the deployment script
./deployment/deploy.sh development
```

### 2. Production Deployment

```bash
# Production deployment
./deployment/deploy.sh production

# With custom domain
./deployment/deploy.sh production --domain yourdomain.com
```

### 3. Cloud Deployment

#### AWS Deployment
```bash
# Using AWS ECS
aws ecs create-cluster --cluster-name maslaxat-cluster

# Deploy services
aws ecs create-service --cluster maslaxat-cluster --service-name maslaxat-platform
```

#### DigitalOcean Deployment
```bash
# Using Docker Machine
docker-machine create --driver digitalocean maslaxat-host

# Deploy
docker-compose up -d
```

#### Google Cloud Platform
```bash
# Using Google Kubernetes Engine
gcloud container clusters create maslaxat-cluster

# Deploy to GKE
kubectl apply -f k8s/
```

### 4. Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml maslaxat
```

## Configuration

### SSL Certificate Setup

#### Using Let's Encrypt (Production)
```bash
# Install Certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem certs/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem certs/
```

#### Self-Signed Certificate (Development)
```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/C=UZ/ST=Tashkent/L=Tashkent/O=MaslaXat/CN=localhost"
```

### Database Configuration

#### Initial Setup
```bash
# Run database migrations
docker-compose exec postgres psql -U postgres -d maslaxat -f /docker-entrypoint-initdb.d/init.sql

# Create backup
docker-compose exec postgres pg_dump -U postgres maslaxat > backup.sql

# Restore from backup
docker-compose exec -T postgres psql -U postgres -d maslaxat < backup.sql
```

#### Performance Tuning
```sql
-- Optimize PostgreSQL for production
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
```

### Redis Configuration

#### Production Settings
```conf
# /etc/redis/redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
maxmemory-samples 5
tcp-keepalive 300
tcp-backlog 511
timeout 0
tcp-nodelay yes
repl-disable-tcp-nodelay no
```

## Monitoring

### Health Checks

All services include health check endpoints:
- **Gateway**: http://localhost:8080/health
- **Auth Service**: http://localhost:3001/health
- **Consultation Service**: http://localhost:3002/health

### Monitoring Stack

#### Prometheus Setup
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'maslaxat'
    static_configs:
      - targets: ['gateway:8080', 'auth-service:3001']
```

#### Grafana Dashboard
Import dashboard from `monitoring/grafana/dashboard.json`

### Log Management

#### Centralized Logging
```bash
# View logs for specific service
docker-compose logs -f auth-service

# View all logs
docker-compose logs

# Export logs
docker-compose logs --no-color > logs/platform.log
```

#### Log Rotation
```bash
# Setup logrotate
sudo cp deployment/logrotate.conf /etc/logrotate.d/maslaxat
```

## Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check service status
docker-compose ps

# View service logs
docker-compose logs service-name

# Restart specific service
docker-compose restart service-name
```

#### Database Connection Issues
```bash
# Test database connection
docker-compose exec postgres pg_isready -U postgres

# Check database logs
docker-compose logs postgres

# Reset database
docker-compose down -v
docker-compose up -d
```

#### Performance Issues
```bash
# Monitor resource usage
docker stats

# Check system resources
htop

# Analyze slow queries
docker-compose exec postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

### Debug Mode

#### Enable Debug Logging
```bash
# Set debug environment variable
export DEBUG=maslaxat:*

# Run with debug output
docker-compose up
```

#### Development Mode
```bash
# Start in development mode
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Security

### Security Checklist

- [ ] Change default passwords
- [ ] Enable SSL/TLS
- [ ] Configure firewall rules
- [ ] Set up fail2ban
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] Access control
- [ ] Audit logging

### Firewall Configuration

#### UFW (Ubuntu)
```bash
# Allow SSH
sudo ufw allow ssh

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow database (internal only)
sudo ufw allow from 172.16.0.0/12 to any port 5432

# Enable firewall
sudo ufw enable
```

### SSL/TLS Configuration

#### Strong SSL Configuration
```nginx
# nginx.conf
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

## Maintenance

### Regular Tasks

#### Daily
- Check service health
- Monitor resource usage
- Review error logs
- Check backup status

#### Weekly
- Security updates
- Performance analysis
- Database optimization
- Log cleanup

#### Monthly
- Full system backup
- Security audit
- Capacity planning
- Documentation update

### Backup Strategy

#### Automated Backups
```bash
# Setup cron job
crontab -e

# Add backup jobs
0 2 * * * /path/to/backup.sh
0 6 * * 0 /path/to/full-backup.sh
```

#### Backup Script
```bash
#!/bin/bash
# backup.sh

date=$(date +%Y%m%d_%H%M%S)
backup_dir="/backup/maslaxat/$date"

mkdir -p $backup_dir

# Database backup
docker-compose exec postgres pg_dump -U postgres maslaxat > $backup_dir/database.sql

# File backup
tar -czf $backup_dir/uploads.tar.gz uploads/

# Configuration backup
cp .env docker-compose.yml $backup_dir/

# Clean old backups
find /backup/maslaxat -type d -mtime +30 -exec rm -rf {} \;
```

### Update Process

#### Platform Updates
```bash
# Pull latest changes
git pull origin main

# Update services
docker-compose pull
docker-compose up -d

# Run migrations if needed
docker-compose exec postgres psql -U postgres -d maslaxat -f migrations/update.sql
```

#### Security Updates
```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade

# Update Docker images
docker-compose pull
docker-compose up -d

# Restart services
docker-compose restart
```

## Support

### Getting Help
- **Documentation**: Check docs/ directory
- **Issues**: GitHub Issues
- **Email**: support@maslaxat.uz
- **Community**: Discord/Slack channels

### Professional Support
- **Enterprise Support**: enterprise@maslaxat.uz
- **Custom Development**: dev@maslaxat.uz
- **Training**: training@maslaxat.uz

## Conclusion

This deployment guide provides comprehensive instructions for deploying the MaslaXat platform. Follow the steps carefully and adapt them to your specific environment and requirements. Regular maintenance and monitoring are essential for optimal platform performance and security.
