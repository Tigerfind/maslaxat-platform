#!/bin/bash

# MaslaXat Platform Deployment Script
# This script deploys the complete MaslaXat legal platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="maslaxat-platform"
DOCKER_REGISTRY="maslaxat"
ENVIRONMENT=${1:-development}
BACKUP_DIR="/backup/maslaxat"
LOG_DIR="/var/log/maslaxat"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root for security reasons"
        exit 1
    fi
}

# Check system requirements
check_requirements() {
    log_info "Checking system requirements..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check available memory (minimum 4GB)
    AVAILABLE_MEM=$(free -g | grep "Mem:" | awk '{print $2}')
    if [[ $AVAILABLE_MEM -lt 4 ]]; then
        log_warning "Available memory is less than 4GB. This may cause performance issues."
    fi
    
    # Check available disk space (minimum 10GB)
    AVAILABLE_DISK=$(df -BG . | tail -1 | awk '{print $4}' | sed 's/G//')
    if [[ $AVAILABLE_DISK -lt 10 ]]; then
        log_warning "Available disk space is less than 10GB. This may cause issues."
    fi
    
    log_success "System requirements check completed"
}

# Create necessary directories
create_directories() {
    log_info "Creating necessary directories..."
    
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "logs"
    mkdir -p "uploads"
    mkdir -p "certs"
    
    # Set permissions
    chmod 755 "$BACKUP_DIR"
    chmod 755 "$LOG_DIR"
    chmod 755 "logs"
    chmod 755 "uploads"
    chmod 700 "certs"
    
    log_success "Directories created successfully"
}

# Setup environment file
setup_environment() {
    log_info "Setting up environment configuration..."
    
    if [[ ! -f ".env" ]]; then
        if [[ -f ".env.example" ]]; then
            cp .env.example .env
            log_warning "Environment file created from example. Please update .env with your configuration."
        else
            log_error ".env.example file not found"
            exit 1
        fi
    else
        log_info "Environment file already exists"
    fi
    
    # Create environment-specific overrides
    if [[ "$ENVIRONMENT" == "production" ]]; then
        if [[ -f ".env.prod" ]]; then
            log_info "Loading production environment overrides"
            export $(cat .env.prod | xargs)
        fi
    fi
    
    log_success "Environment setup completed"
}

# Generate SSL certificates (for production)
generate_ssl_certs() {
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_info "Generating SSL certificates..."
        
        if [[ ! -f "certs/fullchain.pem" ]] || [[ ! -f "certs/privkey.pem" ]]; then
            # Generate self-signed certificates for development
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                -keyout certs/privkey.pem \
                -out certs/fullchain.pem \
                -subj "/C=UZ/ST=Tashkent/L=Tashkent/O=MaslaXat/CN=maslaxat.uz"
            
            chmod 600 certs/privkey.pem
            chmod 644 certs/fullchain.pem
            
            log_warning "Self-signed certificates generated. For production, use proper SSL certificates."
        else
            log_info "SSL certificates already exist"
        fi
    fi
}

# Pull Docker images
pull_images() {
    log_info "Pulling Docker images..."
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        # Pull from registry in production
        docker-compose -f docker-compose.yml pull
    else
        # Build images locally in development
        log_info "Building Docker images locally..."
        docker-compose -f docker-compose.yml build
    fi
    
    log_success "Docker images ready"
}

# Start services
start_services() {
    log_info "Starting services..."
    
    # Stop any existing services
    docker-compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true
    
    # Start services based on environment
    if [[ "$ENVIRONMENT" == "production" ]]; then
        docker-compose -f docker-compose.yml up -d
    else
        docker-compose -f docker-compose.yml up -d
    fi
    
    log_success "Services started successfully"
}

# Wait for services to be ready
wait_for_services() {
    log_info "Waiting for services to be ready..."
    
    # Wait for database
    for i in {1..30}; do
        if docker-compose exec postgres pg_isready -U postgres &>/dev/null; then
            log_success "Database is ready"
            break
        fi
        echo -n "."
        sleep 2
    done
    
    # Wait for Redis
    for i in {1..30}; do
        if docker-compose exec redis redis-cli ping &>/dev/null; then
            log_success "Redis is ready"
            break
        fi
        echo -n "."
        sleep 2
    done
    
    # Wait for services to start
    sleep 10
    
    log_success "All services are ready"
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Copy and run initialization script
    docker-compose exec postgres psql -U postgres -d maslaxat -f /docker-entrypoint-initdb.d/init.sql
    
    log_success "Database migrations completed"
}

# Setup monitoring
setup_monitoring() {
    log_info "Setting up monitoring..."
    
    # Create log files
    touch "$LOG_DIR/auth-service.log"
    touch "$LOG_DIR/consultation-service.log"
    touch "$LOG_DIR/video-service.log"
    touch "$LOG_DIR/payment-service.log"
    touch "$LOG_DIR/ai-service.log"
    touch "$LOG_DIR/document-service.log"
    touch "$LOG_DIR/notification-service.log"
    touch "$LOG_DIR/analytics-service.log"
    touch "$LOG_DIR/monitoring-service.log"
    touch "$LOG_DIR/nginx.log"
    
    # Setup log rotation
    cat > /etc/logrotate.d/maslaxat << EOF
$LOG_DIR/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        docker-compose kill -s USR1 nginx 2>/dev/null || true
    endscript
}
EOF
    
    log_success "Monitoring setup completed"
}

# Health check
health_check() {
    log_info "Performing health checks..."
    
    # Check each service
    services=("gateway:8080" "auth-service:3001" "consultation-service:3002" "video-service:3003")
    
    for service in "${services[@]}"; do
        IFS=':' read -r name port <<< "$service"
        if curl -f "http://localhost:$port/health" &>/dev/null; then
            log_success "$name is healthy"
        else
            log_error "$name health check failed"
        fi
    done
    
    log_success "Health checks completed"
}

# Display access information
display_access_info() {
    log_info "Deployment completed successfully!"
    echo ""
    echo "=================================="
    echo "MaslaXat Platform Access Information"
    echo "=================================="
    echo ""
    echo "Frontend Application: http://localhost:3000"
    echo "Admin Panel: http://localhost:3001"
    echo "API Gateway: http://localhost:8080"
    echo "API Documentation: http://localhost:8080/docs"
    echo ""
    echo "Database:"
    echo "  PostgreSQL: localhost:5432"
    echo "  Redis: localhost:6379"
    echo "  Elasticsearch: localhost:9200"
    echo ""
    echo "Default Admin Credentials:"
    echo "  Email: admin@maslaxat.uz"
    echo "  Password: admin123"
    echo ""
    echo "Environment: $ENVIRONMENT"
    echo "=================================="
}

# Backup function
backup_data() {
    log_info "Creating backup..."
    
    BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="$BACKUP_DIR/backup_$BACKUP_TIMESTAMP"
    
    mkdir -p "$BACKUP_PATH"
    
    # Backup database
    docker-compose exec postgres pg_dump -U postgres maslaxat > "$BACKUP_PATH/database.sql"
    
    # Backup configuration
    cp -r .env docker-compose.yml "$BACKUP_PATH/"
    
    # Create archive
    tar -czf "$BACKUP_PATH.tar.gz" -C "$BACKUP_DIR" "backup_$BACKUP_TIMESTAMP"
    rm -rf "$BACKUP_PATH"
    
    log_success "Backup created: $BACKUP_PATH.tar.gz"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up old backups and logs..."
    
    # Remove backups older than 30 days
    find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +30 -delete
    
    # Remove old log files
    find "$LOG_DIR" -name "*.log" -mtime +7 -delete
    
    # Clean Docker
    docker system prune -f --volumes
    
    log_success "Cleanup completed"
}

# Main deployment function
main() {
    log_info "Starting MaslaXat platform deployment..."
    log_info "Environment: $ENVIRONMENT"
    
    check_root
    check_requirements
    create_directories
    setup_environment
    generate_ssl_certs
    
    # Optional backup before deployment
    if [[ "$ENVIRONMENT" == "production" ]]; then
        backup_data
    fi
    
    pull_images
    start_services
    wait_for_services
    run_migrations
    setup_monitoring
    health_check
    display_access_info
    
    # Cleanup
    cleanup
    
    log_success "Deployment completed successfully!"
    
    # Show logs command
    echo ""
    echo "To view logs, run:"
    echo "  docker-compose logs -f [service_name]"
    echo ""
    echo "To stop services, run:"
    echo "  docker-compose down"
    echo ""
}

# Handle script arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    backup)
        backup_data
        ;;
    cleanup)
        cleanup
        ;;
    health)
        health_check
        ;;
    stop)
        docker-compose down
        ;;
    restart)
        docker-compose restart
        ;;
    logs)
        docker-compose logs -f "${2:-}"
        ;;
    *)
        echo "Usage: $0 {deploy|backup|cleanup|health|stop|restart|logs [service]}"
        echo ""
        echo "Commands:"
        echo "  deploy          - Deploy the complete platform (default)"
        echo "  backup          - Create a backup of current data"
        echo "  cleanup         - Clean up old backups and logs"
        echo "  health          - Perform health checks on services"
        echo "  stop            - Stop all services"
        echo "  restart         - Restart all services"
        echo "  logs [service]  - View logs for all services or specific service"
        exit 1
        ;;
esac