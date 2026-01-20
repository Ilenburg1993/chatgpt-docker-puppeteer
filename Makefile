# =============================================================================
# Docker Commands Makefile
# Quick commands for Docker operations
# =============================================================================

.PHONY: help build start stop restart logs clean test shell health

# Default target
help:
	@echo "Docker Management Commands:"
	@echo "  make build        - Build production image"
	@echo "  make build-dev    - Build development image"
	@echo "  make start        - Start containers"
	@echo "  make start-dev    - Start in development mode"
	@echo "  make stop         - Stop containers"
	@echo "  make restart      - Restart containers"
	@echo "  make logs         - View logs (follow)"
	@echo "  make logs-tail    - View last 100 lines"
	@echo "  make clean        - Stop and remove containers/volumes"
	@echo "  make shell        - Open shell in running container"
	@echo "  make health       - Check container health"
	@echo "  make test         - Run tests in container"

# Build production image
build:
	docker-compose build agent

# Build development image
build-dev:
	docker-compose build agent-dev

# Start production
start:
	docker-compose up -d agent

# Start development
start-dev:
	docker-compose --profile dev up -d agent-dev

# Stop all
stop:
	docker-compose down

# Restart
restart:
	docker-compose restart

# View logs
logs:
	docker-compose logs -f agent

# View last 100 lines
logs-tail:
	docker-compose logs --tail=100 agent

# Clean everything
clean:
	docker-compose down -v
	docker system prune -f

# Shell access
shell:
	docker-compose exec agent sh

# Health check
health:
	docker-compose ps
	@echo "\n=== Health Status ==="
	curl -f http://localhost:3008/api/health || echo "Health check failed"

# Run tests
test:
	docker-compose exec agent npm test

# Rebuild and start
rebuild: clean build start
	@echo "✅ Rebuild complete"
