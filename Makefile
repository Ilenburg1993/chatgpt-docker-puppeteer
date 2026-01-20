# =============================================================================
# Enhanced Makefile with Production & Development Workflows
# =============================================================================

.PHONY: help build start stop restart logs clean test shell health \
        build-prod start-prod stop-prod monitoring backup restore

# Colors for output
RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[1;33m
NC=\033[0m # No Color

# Default target
help:
	@echo "$(GREEN)Docker Management Commands:$(NC)"
	@echo ""
	@echo "$(YELLOW)Development:$(NC)"
	@echo "  make build        - Build development image"
	@echo "  make start        - Start development containers"
	@echo "  make dev          - Build and start in development mode"
	@echo "  make logs         - View logs (follow)"
	@echo "  make shell        - Open shell in running container"
	@echo ""
	@echo "$(YELLOW)Production:$(NC)"
	@echo "  make build-prod   - Build production image"
	@echo "  make start-prod   - Start production stack"
	@echo "  make stop-prod    - Stop production stack"
	@echo "  make restart-prod - Restart production"
	@echo ""
	@echo "$(YELLOW)Testing:$(NC)"
	@echo "  make test         - Run all tests"
	@echo "  make test-health  - Health check test"
	@echo "  make test-lock    - File locking test"
	@echo ""
	@echo "$(YELLOW)Monitoring:$(NC)"
	@echo "  make monitoring   - Start Prometheus + Grafana"
	@echo "  make health       - Check container health"
	@echo "  make stats        - Show resource usage"
	@echo ""
	@echo "$(YELLOW)Maintenance:$(NC)"
	@echo "  make clean        - Stop and remove containers/volumes"
	@echo "  make backup       - Backup data volumes"
	@echo "  make restore      - Restore from backup"
	@echo "  make prune        - Clean Docker system"

# =============================================================================
# Development Workflows
# =============================================================================

build:
	@echo "$(GREEN)Building development image...$(NC)"
	docker-compose build agent

build-dev:
	@echo "$(GREEN)Building development image with dev profile...$(NC)"
	docker-compose build agent-dev

start:
	@echo "$(GREEN)Starting development containers...$(NC)"
	docker-compose up -d agent
	@make health

dev: build-dev
	@echo "$(GREEN)Starting in development mode...$(NC)"
	docker-compose --profile dev up agent-dev

stop:
	@echo "$(YELLOW)Stopping containers...$(NC)"
	docker-compose down

restart:
	@echo "$(YELLOW)Restarting containers...$(NC)"
	docker-compose restart

# =============================================================================
# Production Workflows
# =============================================================================

build-prod:
	@echo "$(GREEN)Building production image...$(NC)"
	docker-compose -f docker-compose.prod.yml build agent
	@echo "$(GREEN)Production image built successfully$(NC)"

start-prod:
	@echo "$(GREEN)Starting production stack...$(NC)"
	docker-compose -f docker-compose.prod.yml up -d agent
	@echo "$(GREEN)Waiting for services to be healthy...$(NC)"
	@sleep 5
	@make health-prod

stop-prod:
	@echo "$(YELLOW)Stopping production stack...$(NC)"
	docker-compose -f docker-compose.prod.yml down

restart-prod:
	@echo "$(YELLOW)Restarting production...$(NC)"
	docker-compose -f docker-compose.prod.yml restart agent

# =============================================================================
# Monitoring
# =============================================================================

monitoring:
	@echo "$(GREEN)Starting monitoring stack (Prometheus + Grafana)...$(NC)"
	docker-compose -f docker-compose.prod.yml --profile monitoring up -d
	@echo "$(GREEN)Prometheus: http://localhost:9091$(NC)"
	@echo "$(GREEN)Grafana: http://localhost:3001 (admin/admin)$(NC)"

health:
	@echo "$(GREEN)Checking container health...$(NC)"
	@docker-compose ps
	@echo ""
	@echo "$(GREEN)API Health Check:$(NC)"
	@curl -f http://localhost:3008/api/health 2>/dev/null && echo "$(GREEN)✓ Healthy$(NC)" || echo "$(RED)✗ Unhealthy$(NC)"

health-prod:
	@echo "$(GREEN)Checking production health...$(NC)"
	@docker-compose -f docker-compose.prod.yml ps
	@echo ""
	@curl -f http://localhost:3008/api/health 2>/dev/null && echo "$(GREEN)✓ Production Healthy$(NC)" || echo "$(RED)✗ Production Unhealthy$(NC)"

stats:
	@echo "$(GREEN)Resource usage:$(NC)"
	@docker stats --no-stream chatgpt-agent 2>/dev/null || docker stats --no-stream chatgpt-agent-prod

# =============================================================================
# Testing
# =============================================================================

test:
	@echo "$(GREEN)Running all tests...$(NC)"
	docker-compose exec agent npm test

test-health:
	@echo "$(GREEN)Running health tests...$(NC)"
	docker-compose exec agent npm run test:health

test-lock:
	@echo "$(GREEN)Running lock tests...$(NC)"
	docker-compose exec agent npm run test:lock

test-config:
	@echo "$(GREEN)Running config tests...$(NC)"
	docker-compose exec agent npm run test:config

# =============================================================================
# Logs
# =============================================================================

logs:
	docker-compose logs -f agent

logs-tail:
	docker-compose logs --tail=100 agent

logs-prod:
	docker-compose -f docker-compose.prod.yml logs -f agent

# =============================================================================
# Shell Access
# =============================================================================

shell:
	@echo "$(GREEN)Opening shell in container...$(NC)"
	docker-compose exec agent sh

shell-prod:
	@echo "$(GREEN)Opening shell in production container...$(NC)"
	docker-compose -f docker-compose.prod.yml exec agent sh

# =============================================================================
# Maintenance
# =============================================================================

clean:
	@echo "$(RED)Stopping and removing all containers and volumes...$(NC)"
	docker-compose down -v
	@echo "$(GREEN)Cleanup complete$(NC)"

clean-prod:
	@echo "$(RED)Stopping and removing production stack...$(NC)"
	docker-compose -f docker-compose.prod.yml down -v

prune:
	@echo "$(RED)Cleaning Docker system...$(NC)"
	docker system prune -f
	docker volume prune -f

backup:
	@echo "$(GREEN)Creating backup...$(NC)"
	@mkdir -p backups
	@docker run --rm \
		-v chatgpt-docker-puppeteer_fila-prod:/data/fila:ro \
		-v chatgpt-docker-puppeteer_respostas-prod:/data/respostas:ro \
		-v chatgpt-docker-puppeteer_logs-prod:/data/logs:ro \
		-v $$(pwd)/backups:/backup \
		alpine tar czf /backup/backup-$$(date +%Y%m%d-%H%M%S).tar.gz /data
	@echo "$(GREEN)Backup created in ./backups/$(NC)"

restore:
	@echo "$(YELLOW)Available backups:$(NC)"
	@ls -lh backups/*.tar.gz 2>/dev/null || echo "No backups found"
	@echo ""
	@echo "$(RED)To restore, run:$(NC)"
	@echo "docker run --rm -v chatgpt-docker-puppeteer_fila-prod:/data/fila -v ./backups:/backup alpine tar xzf /backup/backup-XXXXXX.tar.gz -C /"

# =============================================================================
# Advanced
# =============================================================================

rebuild: clean build start
	@echo "$(GREEN)✅ Rebuild complete$(NC)"

rebuild-prod: clean-prod build-prod start-prod
	@echo "$(GREEN)✅ Production rebuild complete$(NC)"

inspect:
	@echo "$(GREEN)Container inspection:$(NC)"
	@docker inspect chatgpt-agent 2>/dev/null || docker inspect chatgpt-agent-prod

network:
	@echo "$(GREEN)Network configuration:$(NC)"
	@docker network inspect chatgpt-docker-puppeteer_agent-network

volumes:
	@echo "$(GREEN)Volume information:$(NC)"
	@docker volume ls | grep chatgpt

size:
	@echo "$(GREEN)Image size comparison:$(NC)"
	@docker images | grep chatgpt-agent

# =============================================================================
# CI/CD Helpers
# =============================================================================

ci-test:
	@echo "$(GREEN)Running CI test suite...$(NC)"
	docker-compose up -d agent
	@sleep 10
	docker-compose exec -T agent npm run test:health
	docker-compose exec -T agent npm run test:config
	docker-compose down

ci-build:
	@echo "$(GREEN)Building for CI/CD...$(NC)"
	docker build --build-arg NODE_ENV=production -t chatgpt-agent:ci .
	@echo "$(GREEN)Image built: chatgpt-agent:ci$(NC)"

# =============================================================================
# Linux-specific (if needed)
# =============================================================================

start-linux:
	@echo "$(GREEN)Starting with Linux-optimized config...$(NC)"
	docker-compose -f docker-compose.linux.yml up -d agent
