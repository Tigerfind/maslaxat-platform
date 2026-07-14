#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════
# eMaslaxat — Deployment Script for UzInfoCom VPS
# Ubuntu 22.04+ server with Docker
# ═══════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════"
echo "  eMaslaxat Production Deployment"
echo "═══════════════════════════════════════════"

# ─── Configuration ────────────────────────────
PROJECT_DIR="/var/www/emaslaxat"
DOMAIN="${DOMAIN:-emaslaxat.uz}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

# ─── Step 1: System Setup ────────────────────
setup_system() {
    echo ""
    echo "── Step 1: System Setup ──"

    sudo apt update && sudo apt upgrade -y
    sudo apt install -y curl git ufw

    # Docker
    if ! command -v docker &>/dev/null; then
        echo "Installing Docker..."
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker "$USER"
        echo "Docker installed. You may need to log out and back in for docker group."
    fi

    # Docker Compose plugin
    if ! docker compose version &>/dev/null; then
        sudo apt install -y docker-compose-plugin
    fi

    # Certbot for SSL
    sudo apt install -y certbot

    echo "✅ System setup complete"
}

# ─── Step 2: Firewall ────────────────────────
setup_firewall() {
    echo ""
    echo "── Step 2: Firewall ──"

    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 80/tcp    # HTTP
    sudo ufw allow 443/tcp   # HTTPS
    sudo ufw --force enable

    echo "✅ Firewall configured (SSH + HTTP + HTTPS)"
}

# ─── Step 3: Clone/Update Code ───────────────
deploy_code() {
    echo ""
    echo "── Step 3: Deploy Code ──"

    if [ -d "$PROJECT_DIR" ]; then
        cd "$PROJECT_DIR"
        git pull origin main
    else
        echo "⚠️  Clone the repo manually first:"
        echo "    git clone YOUR_REPO_URL $PROJECT_DIR"
        echo "    Then re-run this script."
        exit 1
    fi

    echo "✅ Code updated"
}

# ─── Step 4: Configure Environment ───────────
setup_env() {
    echo ""
    echo "── Step 4: Environment Configuration ──"

    cd "$PROJECT_DIR"

    if [ ! -f backend/api/.env ]; then
        cp backend/api/.env.example backend/api/.env

        # Set secure values
        sed -i "s/CHANGE_ME_SECURE_PASSWORD/$DB_PASSWORD/g" backend/api/.env
        sed -i "s/CHANGE_ME_RANDOM_256_BIT_SECRET/$JWT_SECRET/g" backend/api/.env
        sed -i "s/YOUR_DOMAIN/$DOMAIN/g" backend/api/.env

        echo ""
        echo "╔═══════════════════════════════════════════════╗"
        echo "║  .env created with auto-generated secrets     ║"
        echo "║  SAVE THESE VALUES:                           ║"
        echo "║  DB_PASSWORD=$DB_PASSWORD"
        echo "║  JWT_SECRET=$JWT_SECRET"
        echo "╚═══════════════════════════════════════════════╝"
        echo ""
        echo "⚠️  Edit backend/api/.env to add your ANTHROPIC_API_KEY"
    else
        echo ".env already exists, skipping"
    fi

    # Update nginx domain
    sed -i "s/YOUR_DOMAIN/$DOMAIN/g" deployment/nginx/default.conf

    echo "✅ Environment configured"
}

# ─── Step 5: SSL Certificate ─────────────────
setup_ssl() {
    echo ""
    echo "── Step 5: SSL Certificate ──"

    # Stop nginx if running (port 80 needed for certbot)
    docker compose down 2>/dev/null || true

    if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        sudo certbot certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" \
            --non-interactive --agree-tos --email "admin@$DOMAIN"
        echo "✅ SSL certificate obtained"
    else
        echo "SSL certificate already exists"
        sudo certbot renew --dry-run || echo "⚠️ Auto-renewal check failed"
    fi

    # Setup auto-renewal cron
    (sudo crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'docker compose -f $PROJECT_DIR/docker-compose.yml restart nginx'") | sudo crontab -

    echo "✅ SSL configured with auto-renewal"
}

# ─── Step 6: Build & Start ───────────────────
start_services() {
    echo ""
    echo "── Step 6: Build & Start ──"

    cd "$PROJECT_DIR"

    # Build images
    docker compose build --no-cache

    # Start all services
    docker compose up -d

    echo "✅ All services started"
}

# ─── Step 7: Database Seed ───────────────────
seed_database() {
    echo ""
    echo "── Step 7: Database Seed ──"

    cd "$PROJECT_DIR"

    # Wait for DB to be ready
    echo "Waiting for database..."
    sleep 10

    docker compose exec api node src/seeds/index.js

    echo "✅ Database seeded"
}

# ─── Step 8: Health Check ────────────────────
health_check() {
    echo ""
    echo "── Step 8: Health Check ──"

    sleep 5

    echo ""
    echo "═══════════════════════════════════════════"
    echo "  DEPLOYMENT REPORT"
    echo "═══════════════════════════════════════════"

    # API
    API=$(curl -sf http://localhost:3001/api/health 2>/dev/null | grep -o '"status":"OK"' || echo "FAIL")
    echo "  API:        $API"

    # Frontend
    FE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "FAIL")
    echo "  Frontend:   HTTP $FE"

    # Nginx
    NX=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "FAIL")
    echo "  Nginx:      HTTP $NX"

    # Socket.io
    SO=$(curl -sf "http://localhost:3001/socket.io/?EIO=4&transport=polling" 2>/dev/null | head -c 5 || echo "FAIL")
    echo "  Socket.io:  ${SO:0:5}..."

    # Docker containers
    echo ""
    docker compose ps

    echo ""
    echo "═══════════════════════════════════════════"
    echo "  READY: https://$DOMAIN"
    echo "═══════════════════════════════════════════"
    echo ""
    echo "  Admin login:  admin@maslaxat.uz / admin123"
    echo "  Client login: client@maslaxat.uz / client123"
    echo ""
    echo "  ⚠️  Change default passwords after first login!"
    echo "═══════════════════════════════════════════"
}

# ─── Quick Update (pull & restart) ───────────
quick_update() {
    echo ""
    echo "── Quick Update ──"
    cd "$PROJECT_DIR"

    git pull origin main
    docker compose build
    docker compose up -d
    health_check
}

# ─── Backup ──────────────────────────────────
backup() {
    echo ""
    echo "── Creating Backup ──"
    cd "$PROJECT_DIR"

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mkdir -p /backup/emaslaxat

    # Database dump
    docker compose exec -T postgres pg_dump -U emaslaxat_user emaslaxat > "/backup/emaslaxat/db_$TIMESTAMP.sql"

    echo "✅ Backup saved: /backup/emaslaxat/db_$TIMESTAMP.sql"
}

# ─── Logs ────────────────────────────────────
show_logs() {
    cd "$PROJECT_DIR"
    docker compose logs -f --tail=100 "${2:-}"
}

# ─── Main ────────────────────────────────────
case "${1:-help}" in
    setup)
        setup_system
        setup_firewall
        ;;
    deploy)
        deploy_code
        setup_env
        start_services
        health_check
        ;;
    full)
        setup_system
        setup_firewall
        deploy_code
        setup_env
        setup_ssl
        start_services
        seed_database
        health_check
        ;;
    ssl)
        setup_ssl
        docker compose restart nginx
        ;;
    update)
        quick_update
        ;;
    seed)
        seed_database
        ;;
    backup)
        backup
        ;;
    logs)
        show_logs "$@"
        ;;
    restart)
        cd "$PROJECT_DIR"
        docker compose restart
        health_check
        ;;
    stop)
        cd "$PROJECT_DIR"
        docker compose down
        ;;
    status)
        cd "$PROJECT_DIR"
        health_check
        ;;
    *)
        echo ""
        echo "Usage: $0 COMMAND"
        echo ""
        echo "Commands:"
        echo "  setup    - Install Docker, configure firewall (run once)"
        echo "  full     - Complete first-time setup & deploy (run once)"
        echo "  deploy   - Pull code, build, start (without system setup)"
        echo "  update   - Quick update: git pull + rebuild + restart"
        echo "  ssl      - Obtain/renew SSL certificate"
        echo "  seed     - Seed database with test data"
        echo "  backup   - Backup database"
        echo "  logs     - View logs (logs api, logs frontend, etc)"
        echo "  restart  - Restart all services"
        echo "  stop     - Stop all services"
        echo "  status   - Health check"
        echo ""
        echo "First time:"
        echo "  1. git clone YOUR_REPO /var/www/emaslaxat"
        echo "  2. DOMAIN=maslaxat.uz $0 full"
        echo ""
        echo "Updates:"
        echo "  $0 update"
        ;;
esac
