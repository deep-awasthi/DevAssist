#!/bin/bash

# Color styles for logs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===============================================${NC}"
echo -e "${BLUE}              DevAssist Launcher               ${NC}"
echo -e "${BLUE}===============================================${NC}"

# Check if Ollama is running locally on the host machine
echo -e "Checking if native Ollama is running on the host..."
if curl -s -f http://localhost:11434/ > /dev/null; then
    echo -e "${GREEN}✔ Native Ollama detected running on host (Port 11434).${NC}"
    echo -e "${GREEN}🚀 Utilizing native Ollama with Metal GPU acceleration (Recommended for M1 Mac).${NC}"
    echo -e "Starting backend and frontend in Docker..."
    
    # Run only backend and frontend services, set OLLAMA_HOST to host.docker.internal
    export OLLAMA_HOST="http://host.docker.internal:11434"
    docker compose up --build backend frontend
else
    echo -e "${YELLOW}⚠ Native Ollama not detected running on host.${NC}"
    echo -e "${YELLOW}ℹ Running Ollama inside Docker (CPU-only mode, will be slower).${NC}"
    echo -e "Starting all services (Ollama, Backend, Frontend)..."
    
    # Run all services including the docker Ollama service
    export OLLAMA_HOST="http://ollama:11434"
    docker compose up --build
fi
